// vault-ai-toolkit/src/synthesizer.ts
// v2.3.0 @ 2025-09-20 12:00:00

/**
 * @file synthesizer.ts
 * @description Реализует логику поиска семантически похожих заметок, создания интерактивных отчетов и (в будущем) их синтеза.
 * @module synthesizer
 * 
 * @changelog
 * - 2.3.0 (2025-09-20): [REFACTOR] Added standard file header and JSDoc comments for clarity and maintainability.
 * - 2.2.0 (2025-09-15): [AUDIT] Restored call to indexer.findDuplicateGroups and removed incorrect delete logic.
 * - 2.1.0 (2025-09-12): Реализована логика "Удалить дубликаты" (позже удалена).
 */

import { App, TFile, Notice } from 'obsidian';
import { VaultIndexer, IndexedFile } from './indexer';
import { VaultAIToolkitSettings } from './settings';

/**
 * @interface DuplicateGroup
 * @description Represents a group of semantically similar files, including their average similarity and processing status.
 */
interface DuplicateGroup {
    files: IndexedFile[];
    averageSimilarity: number;
    id: string;
    status: 'pending' | 'processed' | 'kept';
    masterFile?: string;
}

/**
 * @class DuplicateSynthesizer
 * @description Manages the workflow for finding, reporting on, and resolving semantic duplicates.
 */
export class DuplicateSynthesizer {
    private app: App;
    private settings: VaultAIToolkitSettings;
    private indexer: VaultIndexer;
    private reportFile: TFile | null = null;
    private duplicateGroups: Map<string, DuplicateGroup> = new Map();
    
    constructor(app: App, settings: VaultAIToolkitSettings, indexer: VaultIndexer) {
        this.app = app;
        this.settings = settings;
        this.indexer = indexer;
    }
    
    /**
     * Finds groups of similar files above a certain threshold and generates an interactive markdown report.
     * @param threshold The minimum cosine similarity to be considered a duplicate.
     */
    async findAndReportDuplicates(threshold: number = 0.85): Promise<void> {
        const notice = new Notice('Analyzing vault for similar notes...', 0);
        
        try {
            const allFiles = await this.indexer.getAllIndexedFiles();
            const unprocessedFiles = allFiles.filter(f => !f.metadata?.sense_id);

            if (unprocessedFiles.length > 0) {
                notice.hide();
                new Notice(`Found ${unprocessedFiles.length} unprocessed files. Please run "AI: Analyze and add coordinates" first to generate embeddings.`, 10000);
                return;
            }

            const groupsData = await this.indexer.findDuplicateGroups(threshold);
            
            if (groupsData.length === 0) {
                notice.hide();
                new Notice('No similar notes found.');
                return;
            }
            
            this.duplicateGroups.clear();
            groupsData.forEach((group, index) => {
                const newGroup: DuplicateGroup = { ...group, id: `group_${Date.now()}_${index}`, status: 'pending' };
                this.duplicateGroups.set(newGroup.id, newGroup);
            });
            
            const reportContent = this.generateInteractiveReport(Array.from(this.duplicateGroups.values()));
            const reportPath = `Duplicate_Analysis_${new Date().toISOString().slice(0, 10)}.md`;
            
            const existingReport = this.app.vault.getAbstractFileByPath(reportPath);
            if (existingReport instanceof TFile) {
                await this.app.vault.modify(existingReport, reportContent);
                this.reportFile = existingReport;
            } else {
                this.reportFile = await this.app.vault.create(reportPath, reportContent);
            }
            
            notice.hide();
            new Notice(`Found ${groupsData.length} groups of similar notes. Report created.`);
            await this.app.workspace.getLeaf().openFile(this.reportFile);
            
        } catch (error) {
            notice.hide();
            new Notice('Error finding duplicates: ' + error.message);
            console.error('Duplicate search error:', error);
        }
    }

    /**
     * Handles the 'synthesize' action for a group. (Currently a placeholder).
     * @param id The ID of the duplicate group.
     */
    async synthesizeGroupById(id: string) { 
        console.log(`Synthesizing group ${id}... (Not implemented yet)`); 
        new Notice('Функция "Синтезировать" будет добавлена в следующей итерации.');
        // TODO: Implement actual synthesis logic
    }

    /**
     * Handles the 'keep all' action for a group, marking it as resolved.
     * @param id The ID of the duplicate group.
     */
    async keepGroupById(id: string) { 
        const group = this.duplicateGroups.get(id);
        if (!group) return;
        group.status = 'kept';
        group.masterFile = 'Все файлы сохранены';
        new Notice(`Группа ${group.id.slice(-4)} отмечена как "сохранить все".`);
        await this.updateReport();
    }
    
    /**
     * Checks if a given file path corresponds to the currently active report file.
     * @param path The file path to check.
     * @returns True if the path matches the report file, false otherwise.
     */
    isReportFile(path: string): boolean {
        return this.reportFile?.path === path;
    }

    private generateInteractiveReport(groups: DuplicateGroup[]): string {
        let report = `# 🔍 Duplicate Notes Analysis\n\n`;
        report += `> Generated: ${new Date().toLocaleString()}\n`;
        report += `> Found **${groups.length}** groups of similar notes.\n\n---\n\n`;
        
        groups.forEach((group, index) => {
            report += this.generateGroupSection(group, index + 1);
        });
        
        return report;
    }
    
    private generateGroupSection(group: DuplicateGroup, index: number): string {
        const similarity = (group.averageSimilarity * 100).toFixed(1);
        
        let statusBadge = '⏳';
        if (group.status === 'processed') statusBadge = '✅';
        else if (group.status === 'kept') statusBadge = '📌';

        let section = `## ${statusBadge} Group ${index} (Similarity: ${similarity}%)\n\n`;
        
        if (group.status !== 'pending') {
            section += `> **Статус:** Обработано. Результат: ${group.masterFile?.startsWith('Все') ? group.masterFile : `[[${group.masterFile}]]`}\n\n`;
        }
        
        group.files.forEach((file) => {
            section += `### 📄 [[${file.path}]]\n`;
            if (file.metadata?.summary) {
                section += `> **Summary:** ${file.metadata.summary}\n\n`;
            } else if (file.content) {
                section += `> *${file.content.slice(0, 250).replace(/\n/g, ' ').trim()}...*\n\n`;
            }
            section += `- **Status:** ${file.metadata?.status || 'N/A'}, **Quality:** ${file.metadata?.quality_score || 'N/A'}/10\n\n`;
        });
        
        if (group.status === 'pending') {
            section += `#### Actions\n\n`;
            section += `\`button-synthesize-${group.id}\` `;
            section += `\`button-keep-${group.id}\` `;
        }
        
        section += `---\n\n`;
        return section;
    }

    /**
     * Regenerates the report content and updates the file on disk.
     */
    private async updateReport(): Promise<void> {
        if (!this.reportFile) return;
        const updatedContent = this.generateInteractiveReport(Array.from(this.duplicateGroups.values()));
        await this.app.vault.modify(this.reportFile, updatedContent);
    }
}