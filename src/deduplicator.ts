// vault-ai-toolkit/src/deduplicator.ts
// v1.4.0 @ 2025-09-20 12:00:00

/**
 * @file deduplicator.ts
 * @description Реализует логику поиска и удаления точных (100% идентичных) дубликатов файлов на основе их хэша.
 * @module deduplicator
 * 
 * @changelog
 * - 1.4.0 (2025-09-20): [REFACTOR] Added standard file header and JSDoc comments for clarity and maintainability.
 * - 1.3.5 (2025-09-19): [FIX] Correctly reference and update the 'Apply' button in the Duplicate Manager modal.
 */

import { App, TFile, Notice, Modal, Setting, ButtonComponent } from 'obsidian';

// Расширяем интерфейс Vault, чтобы TypeScript знал о возможном наличии hash
declare module 'obsidian' {
    interface Vault {
        hash(file: TFile, algorithm: 'md5' | 'sha1' | 'sha256'): Promise<string>;
    }
}

/**
 * @interface ExactDuplicateGroup
 * @description Represents a group of files that are exact duplicates of each other.
 */
interface ExactDuplicateGroup {
    hash: string;
    files: TFile[];
}

/**
 * @class ExactDeduplicator
 * @description A service to find and manage files that are 100% identical in content.
 */
export class ExactDeduplicator {
    private app: App;

    constructor(app: App) {
        this.app = app;
    }

    /**
     * Finds exact duplicates within a specified folder and opens a management modal.
     * @param folderPath The path of the folder to scan for duplicates.
     */
    async findAndRemoveDuplicates(folderPath: string): Promise<void> {
        const notice = new Notice(`Ищу точные дубликаты в папке "${folderPath}"...`, 0);

        try {
            const filesInFolder = this.app.vault.getMarkdownFiles().filter(file => file.path.startsWith(folderPath));
            
            if (filesInFolder.length < 2) {
                notice.hide();
                new Notice('В папке недостаточно файлов для поиска дубликатов.');
                return;
            }

            const groups = await this.groupFilesByHash(filesInFolder);
            const duplicateGroups = groups.filter(g => g.files.length > 1);

            if (duplicateGroups.length === 0) {
                notice.hide();
                new Notice('Точные дубликаты не найдены.');
                return;
            }
            
            notice.hide();
            new DuplicateManagerModal(this.app, duplicateGroups).open();

        } catch (error) {
            notice.hide();
            new Notice(`Ошибка при поиске дубликатов: ${error.message}`);
            console.error('Ошибка поиска точных дубликатов:', error);
        }
    }

    private async groupFilesByHash(files: TFile[]): Promise<ExactDuplicateGroup[]> {
        const hashes = new Map<string, TFile[]>();
        for (const file of files) {
            const content = await this.app.vault.cachedRead(file);
            const hash = await this.getFileHash(content);
            if (!hashes.has(hash)) { hashes.set(hash, []); }
            hashes.get(hash)?.push(file);
        }
        for (const group of hashes.values()) {
            group.sort((a, b) => a.stat.ctime - b.stat.ctime);
        }
        return Array.from(hashes.entries()).map(([hash, files]) => ({ hash, files }));
    }

    private async getFileHash(content: string): Promise<string> {
        const encoder = new TextEncoder();
        const data = encoder.encode(content);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }
}

/**
 * @class DuplicateManagerModal
 * @description A modal window for users to review groups of duplicate files and decide which ones to keep.
 */
class DuplicateManagerModal extends Modal {
    private decisions: Map<string, { keep: TFile, delete: TFile[] }> = new Map();

    constructor(app: App, private duplicateGroups: ExactDuplicateGroup[]) {
        super(app);
        this.duplicateGroups.forEach(group => {
            const fileToKeep = group.files[0];
            const filesToDelete = group.files.slice(1);
            this.decisions.set(group.hash, { keep: fileToKeep, delete: filesToDelete });
        });
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: `Найдено ${this.duplicateGroups.length} групп дубликатов` });
        contentEl.createEl('p', { text: 'Выберите, какой файл оставить в каждой группе. Невыбранные файлы в группах будут удалены.' });

        const container = contentEl.createDiv({ cls: 'vait-deduplicator-container' });
        
        let applyButton: ButtonComponent;

        this.duplicateGroups.forEach((group) => {
            const groupEl = container.createDiv({ cls: 'vait-deduplicator-group' });
            groupEl.createEl('h4', { text: `Группа дубликатов:` });

            const setting = new Setting(groupEl);
            setting.controlEl.addClass('vait-radio-group');
            
            group.files.forEach(file => {
                const radioContainer = setting.controlEl.createDiv();
                const radio = radioContainer.createEl('input', { type: 'radio' });
                radio.name = `group-${group.hash}`;

                radioContainer.createEl('label', { text: file.path });
                
                if (file.path === this.decisions.get(group.hash)?.keep.path) {
                    radio.checked = true;
                }

                radio.onchange = () => {
                    const filesToDelete = group.files.filter(f => f.path !== file.path);
                    this.decisions.set(group.hash, { keep: file, delete: filesToDelete });
                    applyButton.setButtonText(`Применить и удалить ${this.countFilesToDelete()} дубликатов`);
                };
            });
        });

        new Setting(contentEl).addButton(btn => {
            applyButton = btn; // Capture the button component itself.
            btn
                .setButtonText(`Применить и удалить ${this.countFilesToDelete()} дубликатов`)
                .setCta()
                .onClick(() => this.applyDecisions());
        });
    }

    private countFilesToDelete(): number {
        return Array.from(this.decisions.values()).reduce((sum, decision) => sum + decision.delete.length, 0);
    }

    async applyDecisions() {
        let totalDeleted = 0;
        const notice = new Notice('Удаление дубликатов...', 0);
        for (const decision of this.decisions.values()) {
            for (const file of decision.delete) {
                await this.app.vault.trash(file, true);
                totalDeleted++;
            }
        }
        notice.hide();
        new Notice(`Успешно удалено ${totalDeleted} дубликатов.`);
        this.close();
    }

    onClose() {
        this.contentEl.empty();
    }
}