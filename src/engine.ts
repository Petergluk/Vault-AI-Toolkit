// vault-ai-toolkit/src/engine.ts
 // v10.1.0 @ 2025-09-20 12:00:00
 
 /**
  * @file engine.ts
  * @description Ядро AI-обработки. Взаимодействует с Gemini API через официальный SDK для анализа и обогащения заметок.
  * @module engine
  * 
  * @changelog
  * - 10.1.0 (2025-09-20): [REFACTOR] Added standard file header and comprehensive JSDoc comments to the main class and its public methods, significantly improving code documentation.
  * - 10.0.0 (2025-09-20): [REFACTOR] Major refactoring to use the official @google/genai SDK instead of manual fetch calls.
  * - 9.1.1 (2025-09-19): [FIX] Resolved a type incompatibility for the 'tags' property.
  * - 9.1.0 (2025-09-19): [IMPROVEMENT] Implemented "Beginning + End" strategy for large text embeddings.
  */
 
 import { App, TFile, Notice, stringifyYaml, FrontMatterCache } from 'obsidian';
 import { GoogleGenAI, GenerateContentResponse } from '@google/genai';
 import { VaultIndexer, FileMetadata } from './indexer';
 import { VaultAIToolkitSettings, GeminiModel, PromptItem, EmbeddingModel } from './settings';
 import { DataManager } from './DataManager';
 
 /**
  * @interface AIProcessingResult
  * @description Represents the raw data structure returned by the AI for a single file analysis.
  */
 interface AIProcessingResult {
     suggested_path?: string;
     tags?: string[] | string;
     content_type?: string;
     status?: string;
     project?: string;
     quality_score?: number;
     summary?: string;
     sense_id?: string;
 }
 
 /**
  * @interface AIBatchProcessingResult
  * @description Extends AIProcessingResult to include the filename for batch processing context.
  */
 interface AIBatchProcessingResult extends AIProcessingResult {
     filename: string;
 }
 
 /**
  * @interface FileWithContent
  * @description A helper interface for batching files with their content and metadata.
  */
 interface FileWithContent {
     file: TFile;
     content: string;
     metadata?: FrontMatterCache;
 }
 
 /**
  * @class AIEnrichmentEngine
  * @description The core class responsible for all interactions with the AI model.
  * It handles batching, prompt construction, API calls, and updating file metadata.
  */
 export class AIEnrichmentEngine {
 	private app: App;
 	private settings: VaultAIToolkitSettings;
     private dataManager: DataManager;
 	private indexer: VaultIndexer;
 	private abortController: AbortController | null = null;
 	
 	constructor(app: App, settings: VaultAIToolkitSettings, dataManager: DataManager, indexer: VaultIndexer) {
 		this.app = app;
 		this.settings = settings;
         this.dataManager = dataManager;
 		this.indexer = indexer;
 	}
 
     /**
      * Analyzes a list of files to generate metadata such as tags, summary, and quality score.
      * @param files An array of TFile objects to analyze.
      */
     async analyzeFiles(files: TFile[]): Promise<void> {
         const promptTemplate = this.dataManager.getPromptById('text_analyzer');
         if (!promptTemplate) {
             new Notice('Ошибка: промпт "Text Analyzer" (id: text_analyzer) не найден в настройках.', 15000);
             return;
         }
         await this.runProcessing("Анализ метаданных", files, promptTemplate);
 	}
 
     /**
      * Analyzes a list of files to suggest a new folder path for categorization.
      * @param files An array of TFile objects to categorize.
      */
     async categorizeFiles(files: TFile[]): Promise<void> {
         const promptTemplate = this.dataManager.getPromptById('categorizer');
         if (!promptTemplate) {
             new Notice('Ошибка: промпт "Categorizator" (id: categorizer) не найден в настройках.', 15000);
             return;
         }
         await this.runProcessing("Категоризация файлов", files, promptTemplate);
     }
 
 	private async runProcessing(operationName: string, files: TFile[], promptTemplate: PromptItem): Promise<void> {
         this.abortController = new AbortController();
         try {
             const filesToProcess = this.filterFiles(files, promptTemplate.id);
 			if (filesToProcess.length === 0) { new Notice(`Нет файлов для операции "${operationName}".`); return; }
             
             const modelToUse = this.settings.modelRoles.enrichment;
             new Notice(`Начинаю операцию "${operationName}" для ${filesToProcess.length} файлов. Модель: ${modelToUse}`, 5000);
 
             await this.processBatches(filesToProcess, promptTemplate, modelToUse);
         } catch (error) {
             new Notice(`Критическая ошибка (${operationName}): ${error.message}`);
             console.error(`Критическая ошибка (${operationName}):`, error);
         } finally {
             this.abortController = null;
         }
     }
 
 	private async processBatches(files: TFile[], promptTemplate: PromptItem, modelToUse: GeminiModel | string): Promise<void> {
         let processedCount = 0;
         const filesWithContent: FileWithContent[] = await Promise.all(
             files.map(async (file) => ({ 
                 file, 
                 content: await this.app.vault.cachedRead(file),
                 metadata: this.app.metadataCache.getFileCache(file)?.frontmatter
             }))
         );
 
         const batches = this.createBatches(filesWithContent, this.settings.batchSize, this.settings.maxBatchSizeInChars);
 
         for (const batch of batches) {
             if (this.abortController?.signal.aborted) { new Notice('Обработка прервана.'); break; }
 
             try {
                 const payload = this.buildPayloadForPrompt(batch, promptTemplate.id);
                 const prompt = this.buildPrompt(payload, promptTemplate);
                 const batchFilePaths = batch.map(item => item.file.path);
                 const responseText = await this.callGeminiAPI(prompt, modelToUse, batchFilePaths, promptTemplate.id);
                 const results = this.parseBatchResponse(responseText);
 
                 if (results.length !== batch.length) {
                     console.warn(`AI Mismatch: AI returned ${results.length} results, but batch size was ${batch.length}. Manually mapping by index.`);
                     if (results.length === 0) {
                         throw new Error('AI returned zero valid results for the batch.');
                     }
                 }
 
                 for (let i = 0; i < batch.length; i++) {
                     try {
                         if (i >= results.length) {
                             console.warn(`No result from AI for file: ${batch[i].file.path}`);
                             continue;
                         }
 
                         const resultWithFilename: AIBatchProcessingResult = {
                             ...results[i],
                             filename: batch[i].file.path,
                         };
 
                         const file = this.app.vault.getAbstractFileByPath(resultWithFilename.filename) as TFile;
                         if (file) {
                             await this.updateFile(file, resultWithFilename, modelToUse);
                             processedCount++;
                         }
                     } catch (fileError) {
                         console.error(`Failed to process file: ${batch[i].file.path}. Error:`, fileError);
                         new Notice(`Ошибка обработки файла: ${batch[i].file.basename}. См. консоль.`);
                     }
                 }
                 new Notice(`Обработано ${processedCount} / ${files.length} файлов...`);
                 await this.sleep(this.settings.apiDelayMs);
             } catch (batchError) {
                 console.error('Ошибка при обработке пакета:', batchError);
                 const errorMessage = (batchError as Error).message || String(batchError);
                 if (errorMessage.includes('429')) {
                     new Notice('Превышен лимит запросов. Пауза на 60 секунд...');
                     await this.sleep(60000);
                 } else {
                     new Notice(`Ошибка обработки пакета: ${errorMessage}`, 10000);
                     break; 
                 }
             }
         }
     }
     
     private buildPayloadForPrompt(batch: FileWithContent[], promptId: string): any[] {
         if (promptId === 'text_analyzer') {
             return batch.map(item => ({
                 filename: item.file.path,
                 content: item.content.slice(0, 20000)
             }));
         }
         if (promptId === 'categorizer') {
             return batch.map(item => ({
                 filename: item.file.path,
                 summary: item.metadata?.summary || '',
                 tags: item.metadata?.tags || [],
                 project: item.metadata?.project || '',
                 content: this.settings.categorizeWithFullText ? item.content.slice(0, 20000) : undefined
             }));
         }
         return [];
     }
 
     private buildPrompt(payload: any[], promptTemplate: PromptItem): string {
         const payloadJson = JSON.stringify(payload, null, 2);
         
         const contentTypes = this.dataManager.getContentTypesList().join(', ');
         const statuses = this.dataManager.getStatusesList().join(', ');
         const projects = this.dataManager.getProjectsList().join(', ');
         const coreTags = this.dataManager.getCoreTags();
         const qualityInstruction = this.dataManager.getQualityScaleCriteria();
         const folderStructure = this.settings.rubricator ? stringifyYaml(this.settings.rubricator) : 'Структура папок не задана.';
 
         let prompt = `${promptTemplate.system_prompt}\n\n${promptTemplate.user_prompt_template}`;
         
         if (promptTemplate.id === 'text_analyzer') {
             prompt = prompt.replace(/{TEXT_CONTENT}/g, payloadJson);
             prompt = prompt.replace(/{CORE_TAGS}/g, coreTags);
             prompt = prompt.replace(/{PROJECT_LIST}/g, projects);
             prompt = prompt.replace(/{CONTENT_TYPES}/g, contentTypes);
             prompt = prompt.replace(/{STATUS_LIST}/g, statuses);
             prompt = prompt.replace(/{QUALITY_CRITERIA}/g, qualityInstruction);
         } else if (promptTemplate.id === 'categorizer') {
             const singlePayload = payload[0] || {};
             prompt = prompt.replace(/{SUMMARY}/g, singlePayload.summary || 'Нет');
             prompt = prompt.replace(/{TAGS}/g, (singlePayload.tags || []).join(', ') || 'Нет');
             prompt = prompt.replace(/{PROJECT}/g, singlePayload.project || 'Нет');
             prompt = prompt.replace(/{TEXT_CONTENT}/g, singlePayload.content || 'Не предоставлен');
             prompt = prompt.replace(/{REAL_FOLDER_STRUCTURE}/g, folderStructure);
         }
 
         return prompt;
     }
 
 	private async callGeminiAPI(prompt: string, modelName: GeminiModel | string, batchFilePaths: string[], promptId: string): Promise<string> {
 		if(!this.settings.geminiApiKey) {
             const msg = 'Ключ Gemini API не установлен в настройках.';
             new Notice(msg, 10000);
             throw new Error(msg);
         }
 
         try {
             const ai = new GoogleGenAI({apiKey: this.settings.geminiApiKey});
             const generationConfig = {
                 ...this.settings.generationConfig,
                 responseMimeType: "application/json",
             };
 
             const response: GenerateContentResponse = await ai.models.generateContent({
                 model: modelName,
                 contents: [{ parts: [{ text: prompt }] }],
                 config: generationConfig,
             });
 
             const finishReason = response.candidates?.[0]?.finishReason;
             if (finishReason === 'MAX_TOKENS') {
                 const errorMsg = "Ответ от AI был обрезан из-за лимита токенов.";
                 new Notice(errorMsg, 15000);
                 throw new Error(errorMsg);
             }
 
             const responseText = response.text;
             if (!responseText) {
                 throw new Error("Некорректный или пустой ответ от Gemini API.");
             }
 
             if (this.settings.debugModeEnabled) {
                 await this._logDebugData(prompt, responseText, modelName, batchFilePaths, promptId);
             }
 
             return responseText;
 
         } catch (error) {
             const errorMessage = (error as Error).message || String(error);
             console.error("Ошибка Gemini API:", error);
             let userMessage = `Ошибка Gemini API: ${errorMessage}`;
             if (errorMessage.includes('API key not valid')) userMessage = 'Ошибка Gemini API (400): Неверный ключ API.';
             if (errorMessage.includes('429')) userMessage = 'Ошибка Gemini API (429): Превышен лимит запросов.';
             new Notice(userMessage, 10000);
             throw new Error(userMessage);
         }
 	}
 
     /**
      * Generates a semantic embedding (vector representation) for a given text.
      * Truncates long texts using a "beginning + end" strategy to preserve context.
      * @param text The input text to embed.
      * @returns A promise that resolves to an array of numbers (the embedding vector) or null if an error occurs.
      */
     public async getSemanticEmbedding(text: string): Promise<number[] | null> {
         if (!this.settings.geminiApiKey) {
             console.error('Ключ Gemini API не установлен в настройках.');
             return null;
         }
         
         const modelName = this.settings.embeddingModel;
         const EMBEDDING_CHAR_LIMIT = 8000; // ~2048 токенов
         let textToSend = text;
 
         if (text.length > EMBEDDING_CHAR_LIMIT) {
             const halfLimit = Math.floor(EMBEDDING_CHAR_LIMIT / 2);
             const beginning = text.substring(0, halfLimit);
             const end = text.substring(text.length - halfLimit);
             textToSend = `${beginning}\n\n... [TRUNCATED] ...\n\n${end}`;
         }
 
         try {
             const ai = new GoogleGenAI({apiKey: this.settings.geminiApiKey});
             const result = await ai.models.embedContent({
                 model: modelName,
                 content: { parts: [{ text: textToSend }] }
             });
             
             const embedding = result.embedding;
             if (embedding?.values) {
                 return embedding.values;
             }
 
             console.warn(`Embedding API (${modelName}) вернул пустой результат для текста.`);
             return null;
 
         } catch (error) {
             const errorMessage = (error as Error).message || String(error);
             console.error(`Критическая ошибка при запросе к Embedding API (${modelName}):`, error);
             new Notice(`Ошибка API эмбеддингов: ${errorMessage}`);
             return null;
         }
     }
 
     private async _logDebugData(prompt: string, response: string, modelUsed: string, batchFiles: string[], promptId: string): Promise<void> {
         const logFolderName = '_VAIT_Debug_Logs';
         
         try {
             if (!await this.app.vault.adapter.exists(logFolderName)) {
                 await this.app.vault.createFolder(logFolderName);
             }
 
             const timestamp = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
             const batchSize = batchFiles.length;
             const fileName = `${promptId}_${timestamp}__${batchSize}-files.md`;
             const filePath = `${logFolderName}/${fileName}`;
 
             const fileList = batchFiles.map(f => `- \`${f}\``).join('\n');
             const logContent = `
 # VAIT Debug Log
 
 - **Timestamp:** ${new Date().toLocaleString()}
 - **Prompt ID:** \`${promptId}\`
 - **Model Used:** \`${modelUsed}\`
 - **Files in Batch (${batchSize}):**
 ${fileList}
 
 ---
 
 ## ➡️ Запрос (Prompt), отправленный в API
 
 \`\`\`text
 ${prompt}
 \`\`\`
 
 ---
 
 ## ⬅️ Ответ (Raw Response), полученный от API
 
 \`\`\`json
 ${response}
 \`\`\`
 `;
             await this.app.vault.create(filePath, logContent.trim());
 
         } catch (error) {
             console.error("Vault AI Toolkit Debug Log Error: Failed to write to log file.", error);
             new Notice("Ошибка записи лога отладки. Проверьте консоль.");
         }
     }
 
 	private parseBatchResponse(responseJson: string): AIProcessingResult[] {
 		try {
             const parsed = JSON.parse(responseJson);
             if (Array.isArray(parsed)) { return parsed; }
             if (typeof parsed === 'object' && parsed !== null) { return [parsed]; }
             throw new Error('Ответ AI не является массивом или одиночным объектом.'); 
 		} catch (error) {
             console.error('Не удалось распарсить пакетный ответ AI:', responseJson, error);
             new Notice('Ошибка: AI вернул некорректный JSON.');
             return [];
         }
 	}
 
 	private async updateFile(file: TFile, result: AIBatchProcessingResult, modelUsed: string): Promise<void> {
 		try {
             const { filename, ...dataFromApi } = result;
 
             const dataToSave: Partial<FileMetadata> = {
                 ...dataFromApi,
                 tags: (typeof dataFromApi.tags === 'string')
                     ? dataFromApi.tags.split(',').map(t => t.trim()).filter(Boolean)
                     : dataFromApi.tags,
             };
 
             const isAnalysis = 'summary' in dataToSave;
             let plainSenseId: string | undefined;
             let embeddingVector: number[] | null = null;
 
             if (isAnalysis) {
                 const content = await this.app.vault.cachedRead(file);
                 embeddingVector = await this.getSemanticEmbedding(content);
                 
                 if (embeddingVector) {
                     plainSenseId = `sid-${this.calculateHash(content)}`;
                     dataToSave.sense_id = `[🔍 ${plainSenseId}](obsidian://vault-ai-toolkit?action=similar&sense_id=${plainSenseId})`;
                 }
             }
 
 			await this.app.fileManager.processFrontMatter(file, (fm) => {
                 delete fm.embedding;
                 delete fm.filename;
                 delete fm.sense_id_plain;
 
                 Object.assign(fm, dataToSave);
                 
                 fm.processed_date = new Date().toISOString().slice(0, 10);
                 fm.ai_model = modelUsed;
 			});
             
             const metadataForIndexer: FileMetadata = dataToSave as FileMetadata;
             if (isAnalysis && plainSenseId && embeddingVector) {
                 metadataForIndexer.sense_id = plainSenseId;
                 metadataForIndexer.embedding = embeddingVector;
             }
 			await this.indexer.updateFileMetadata(file.path, metadataForIndexer);
 
 		} catch (e) { console.error(`Не удалось обновить метаданные для ${file.path}`, e); }
 	}
 
 	private filterFiles(files: TFile[], promptId: string): TFile[] {
 		return files.filter(file => {
             const cache = this.app.metadataCache.getFileCache(file);
             if (promptId === 'text_analyzer') {
                 if (this.settings.skipProcessedFiles && (cache?.frontmatter?.processed_date || cache?.frontmatter?.sense_id)) {
                     return false;
                 }
             }
             if (promptId === 'categorizer') {
                 if (!cache?.frontmatter?.summary) return false;
                 if (this.settings.skipProcessedFiles && cache?.frontmatter?.suggested_path) return false;
             }
 
 			const size = file.stat.size;
 			if (this.settings.minFileSize && size < this.settings.minFileSize) return false;
 			return true;
 		});
 	}
     
     private createBatches(items: FileWithContent[], maxCount: number, maxSizeInChars: number): FileWithContent[][] {
         const batches: FileWithContent[][] = [];
         if (items.length === 0) return batches;
 
         let currentBatch: FileWithContent[] = [];
         let currentBatchSize = 0;
 
         for (const item of items) {
             const itemSize = item.content.length;
 
             if (currentBatch.length > 0 && (currentBatch.length >= maxCount || currentBatchSize + itemSize > maxSizeInChars)) {
                 batches.push(currentBatch);
                 currentBatch = [];
                 currentBatchSize = 0;
             }
 
             currentBatch.push(item);
             currentBatchSize += itemSize;
         }
 
         if (currentBatch.length > 0) {
             batches.push(currentBatch);
         }
 
         return batches;
 	}
 
     public calculateHash(content: string): string { let hash = 0; for (let i = 0; i < content.length; i++) { const char = content.charCodeAt(i); hash = ((hash << 5) - hash) + char; hash |= 0; } return hash.toString(16); }
 	private sleep(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
 }