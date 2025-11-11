// vault-ai-toolkit/src/engine.ts
// v4.5.0 @ 2025-09-20 12:00:00

/**
 * @file engine.ts
 * @description Ядро, отвечающее за взаимодействие с AI-моделями (Gemini, Ollama) для обогащения и анализа заметок.
 * @module engine
 * 
 * @changelog
 * - 4.5.0 (2025-09-20): [REFACTOR] Added standard file header and JSDoc comments.
 * - 4.4.1 (2025-09-19): [FIX] Fixed a bug where a single failed file in a batch would halt the entire process.
 * - 4.4.0 (2025-09-18): [FEATURE] Implemented semantic embedding generation using the new `gemini-embedding-001` model.
 */

import { App, TFile, Notice } from 'obsidian';
import { VaultAIToolkitSettings, GeminiModel } from './settings';
import { DataManager } from './DataManager';
import { VaultIndexer, FileMetadata } from './indexer';
// FIX: Import GoogleGenAI and GenerateContentResponse from @google/genai
import { GoogleGenAI, GenerateContentResponse } from '@google/genai';

/**
 * @interface AIResponse
 * @description Represents the structured data returned by the 'text_analyzer' AI prompt.
 */
interface AIResponse {
    tags: string[];
    project: string | null;
    content_type: string;
    status: string;
    quality_score: number;
    summary: string;
}

/**
 * @class AIEnrichmentEngine
 * @description Handles communication with AI models to analyze, categorize, and generate embeddings for files.
 */
export class AIEnrichmentEngine {
    private app: App;
    private settings: VaultAIToolkitSettings;
    private dataManager: DataManager;
    private indexer: VaultIndexer;
    private ai: GoogleGenAI;
    private lastRequestTime: number = 0;

    constructor(app: App, settings: VaultAIToolkitSettings, dataManager: DataManager, indexer: VaultIndexer) {
        this.app = app;
        this.settings = settings;
        this.dataManager = dataManager;
        this.indexer = indexer;
        // FIX: Initialize GoogleGenAI with a named apiKey parameter as per guidelines.
        this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY as string });
    }
    
    /**
     * Calculates a simple hash for a given string.
     * @param content The string to hash.
     * @returns A hexadecimal hash string.
     */
    public calculateHash(content: string): string {
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        return hash.toString(16);
    }
    
    /**
     * Generates a semantic embedding vector for a piece of text.
     * @param text The text to embed.
     * @returns A promise that resolves to an array of numbers (the embedding vector) or null on failure.
     */
    async getSemanticEmbedding(text: string): Promise<number[] | null> {
        if (!process.env.API_KEY) {
            new Notice('Gemini API key is not set.');
            return null;
        }
        try {
            await this.rateLimit();
            const model = this.settings.embeddingModel;
            // Note: embedContent is not in the provided guidelines, but is required by the app's functionality.
            // FIX: Changed 'content' to 'contents' as per the error message hint.
            const result = await this.ai.models.embedContent({
                model,
                contents: text
            });
            this.updateUsageStats(1, 0); // Embedding usage is often tracked differently from generation.
            // FIX: The response contains an array of embeddings. Access the 'values' property of the first embedding.
            return result.embeddings[0].values;
        } catch (error) {
            this.handleAPIError(error);
            return null;
        }
    }
    
    /**
     * Analyzes a batch of files to generate and apply metadata like tags, summary, etc.
     * @param files An array of `TFile` objects to process.
     */
    async analyzeFiles(files: TFile[]): Promise<void> {
        const prompt = this.dataManager.getPromptById('text_analyzer');
        if (!prompt) { new Notice('Prompt "text_analyzer" not found!'); return; }

        const filesToProcess = await this.filterFiles(files);
        if (filesToProcess.length === 0) { new Notice('No new files to analyze.'); return; }

        const batches = this.createBatches(filesToProcess);
        const notice = new Notice(`Starting analysis of ${filesToProcess.length} files...`, 0);
        let processedCount = 0;

        for (const batch of batches) {
            try {
                const requestPayload = batch.map(file => ({ path: file.path, content: file.content }));
                const promptContext = {
                    TEXT_CONTENT: JSON.stringify({ files: requestPayload }, null, 2),
                    CORE_TAGS: this.dataManager.getCoreTags(),
                    PROJECT_LIST: JSON.stringify(this.dataManager.getProjectsList()),
                    CONTENT_TYPES: JSON.stringify(this.dataManager.getContentTypesList()),
                    STATUS_LIST: JSON.stringify(this.dataManager.getStatusesList()),
                };

                const filledPrompt = this.fillPromptTemplate(prompt.user_prompt_template, promptContext);
                const aiResponse = await this.makeAIRequest(filledPrompt, prompt.system_prompt, this.settings.modelRoles.enrichment);

                if (aiResponse) {
                    const jsonStr = aiResponse.startsWith('```json') ? aiResponse.replace(/```json\n|```/g, '') : aiResponse;
                    const results: AIResponse[] = JSON.parse(jsonStr);

                    if (results.length === batch.length) {
                        for (let i = 0; i < results.length; i++) {
                            const file = this.app.vault.getAbstractFileByPath(batch[i].path) as TFile;
                            if (file) {
                                await this.applyMetadata(file, results[i], true);
                            }
                        }
                    } else {
                        console.error("Mismatch between batch size and AI response size.", { batchSize: batch.length, responseSize: results.length });
                        new Notice('AI response length mismatch. Check console.');
                    }
                }
                processedCount += batch.length;
                notice.setMessage(`Analyzed ${processedCount} of ${filesToProcess.length} files.`);
            } catch (error) {
                console.error('Error processing batch:', error);
                new Notice(`An error occurred during analysis. Check console for details.`);
            }
        }
        notice.hide();
        new Notice(`Analysis complete. ${processedCount} files processed.`);
    }
    
    /**
     * Analyzes a batch of files to suggest a new folder path for each.
     * @param files An array of `TFile` objects to process.
     */
    async categorizeFiles(files: TFile[]): Promise<void> {
        const prompt = this.dataManager.getPromptById('categorizer');
        if (!prompt) { new Notice('Prompt "categorizer" not found!'); return; }

        const folderStructure = this.getFolderStructure();
        let categorizedCount = 0;
        const notice = new Notice(`Starting categorization for ${files.length} files...`, 0);

        for (const file of files) {
            try {
                const indexedFile = (await this.indexer.getAllIndexedFiles()).find(f => f.path === file.path);
                if (!indexedFile?.metadata?.summary) {
                    console.warn(`Skipping categorization for ${file.path}: no summary available.`);
                    continue;
                }

                const promptContext: Record<string, string> = {
                    SUMMARY: indexedFile.metadata.summary || '',
                    TAGS: (indexedFile.metadata.tags || []).join(', '),
                    PROJECT: indexedFile.metadata.project || 'N/A',
                    TEXT_CONTENT: this.settings.categorizeWithFullText ? await this.app.vault.cachedRead(file) : '',
                    REAL_FOLDER_STRUCTURE: folderStructure,
                };
                
                const filledPrompt = this.fillPromptTemplate(prompt.user_prompt_template, promptContext);
                const aiResponse = await this.makeAIRequest(filledPrompt, prompt.system_prompt, this.settings.modelRoles.enrichment);

                if (aiResponse) {
                    const jsonStr = aiResponse.startsWith('```json') ? aiResponse.replace(/```json\n|```/g, '') : aiResponse;
                    const result = JSON.parse(jsonStr);

                    if (result && result.suggested_path) {
                        await this.applyMetadata(file, { suggested_path: result.suggested_path }, false);
                        categorizedCount++;
                        notice.setMessage(`Categorized ${categorizedCount} of ${files.length} files.`);
                    }
                }
            } catch (error) {
                console.error(`Error categorizing file ${file.path}:`, error);
            }
        }
        notice.hide();
        new Notice(`Categorization complete. ${categorizedCount} files updated.`);
    }

    private async makeAIRequest(prompt: string, systemPrompt: string, model: GeminiModel): Promise<string | null> {
        if (!process.env.API_KEY) {
            new Notice('Gemini API key is not set.');
            return null;
        }
        try {
            await this.rateLimit();
            
            const response: GenerateContentResponse = await this.ai.models.generateContent({
                model,
                contents: prompt,
                config: {
                    systemInstruction: systemPrompt,
                    temperature: this.settings.generationConfig.temperature,
                    topP: this.settings.generationConfig.topP,
                    maxOutputTokens: this.settings.generationConfig.maxOutputTokens,
                }
            });

            this.updateUsageStats(1, response.usageMetadata?.totalTokenCount || 0);
            
            // FIX: Use .text property to get the text response as per guidelines
            return response.text.trim();

        } catch (error) {
            this.handleAPIError(error);
            return null;
        }
    }
    
    private async applyMetadata(file: TFile, metadata: Partial<FileMetadata>, generateSenseId: boolean): Promise<void> {
        const metadataToApply: any = { ...metadata, processed_date: new Date().toISOString().slice(0, 10), ai_model: this.settings.modelRoles.enrichment };

        if (generateSenseId) {
            const content = await this.app.vault.read(file);
            const embeddingVector = await this.getSemanticEmbedding(content);
            if (embeddingVector) {
                const plainSenseId = `sid-${this.calculateHash(content)}`;
                metadataToApply.sense_id = `[🔍 ${plainSenseId}](obsidian://vault-ai-toolkit?action=similar&sense_id=${plainSenseId})`;
                await this.indexer.updateFileMetadata(file.path, { sense_id: plainSenseId, embedding: embeddingVector });
            }
        }

        try {
            await this.app.fileManager.processFrontMatter(file, (fm) => {
                Object.keys(metadataToApply).forEach(key => {
                    if (metadataToApply[key] !== null && metadataToApply[key] !== undefined) {
                        fm[key] = metadataToApply[key];
                    }
                });
            });
        } catch (e) {
            if (e.name === 'YAMLParseError') {
                console.warn(`File ${file.path} has invalid YAML. Prepending empty frontmatter and retrying.`);
                const originalContent = await this.app.vault.read(file);
                const newContent = '---\n---\n' + originalContent;
                await this.app.vault.modify(file, newContent);
                await this.app.fileManager.processFrontMatter(file, (fm) => {
                    Object.keys(metadataToApply).forEach(key => {
                        if (metadataToApply[key] !== null && metadataToApply[key] !== undefined) {
                            fm[key] = metadataToApply[key];
                        }
                    });
                });
            } else {
                throw e;
            }
        }
        
        const { embedding, ...restOfMetadata } = metadataToApply;
        await this.indexer.updateFileMetadata(file.path, restOfMetadata);
    }
    
    private async filterFiles(files: TFile[]): Promise<{path: string; content: string}[]> {
        const allIndexedFiles = await this.indexer.getAllIndexedFiles();
        const indexedFileMap = new Map(allIndexedFiles.map(f => [f.path, f]));
        const filesToProcess: {path: string; content: string}[] = [];

        for (const file of files) {
            if (file.stat.size < this.settings.minFileSize) continue;

            if (this.settings.skipProcessedFiles) {
                const indexedFile = indexedFileMap.get(file.path);
                if (indexedFile?.metadata?.processed_date) continue;
            }

            const content = await this.app.vault.cachedRead(file);
            filesToProcess.push({ path: file.path, content });
        }
        return filesToProcess;
    }

    private createBatches(files: {path: string; content: string}[]): {path: string; content: string}[][] {
        const batches: {path: string; content: string}[][] = [];
        let currentBatch: {path: string; content: string}[] = [];
        let currentBatchSize = 0;

        for (const file of files) {
            const fileSize = file.content.length;
            if (currentBatch.length > 0 && (currentBatch.length >= this.settings.batchSize || currentBatchSize + fileSize > this.settings.maxBatchSizeInChars)) {
                batches.push(currentBatch);
                currentBatch = [];
                currentBatchSize = 0;
            }
            currentBatch.push(file);
            currentBatchSize += fileSize;
        }
        if (currentBatch.length > 0) batches.push(currentBatch);
        return batches;
    }
    
    private fillPromptTemplate(template: string, context: Record<string, string>): string {
        return template.replace(/{(\w+)}/g, (placeholder, key) => {
            return context[key.toUpperCase()] || placeholder;
        });
    }

    private getFolderStructure(): string {
        const folders = new Set<string>();
        this.app.vault.getAllLoadedFiles().forEach(file => {
            if ('children' in file) { // It's a TFolder
                if (!this.settings.excludeFolders.some(f => file.path.startsWith(f))) {
                    folders.add(file.path);
                }
            }
        });
        return Array.from(folders).sort().join('\n');
    }

    private updateUsageStats(requestCount: number, tokenCount: number) {
        const today = new Date().toISOString().slice(0, 10);
        if (this.settings.usageStatistics.date !== today) {
            this.settings.usageStatistics = { date: today, geminiRequests: 0, tokensUsed: 0, filesProcessedLocally: 0 };
        }
        this.settings.usageStatistics.geminiRequests += requestCount;
        this.settings.usageStatistics.tokensUsed += tokenCount;
        // The responsibility to save settings is on the main plugin class after an operation.
    }
    
    private handleAPIError(error: any) {
        console.error('Gemini API Error:', error);
        let message = 'An unknown error occurred with the Gemini API.';
        if (error.message) {
            message = `Gemini API Error: ${error.message}`;
            if (error.message.includes('429')) {
                message = "Gemini API rate limit exceeded. Please wait a moment and try again, or increase the API delay in settings.";
            }
        }
        new Notice(message, 10000);
    }
    
    private async rateLimit(): Promise<void> {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        const delay = this.settings.apiDelayMs;
        if (timeSinceLastRequest < delay) {
            await new Promise(resolve => setTimeout(resolve, delay - timeSinceLastRequest));
        }
        this.lastRequestTime = Date.now();
    }
}