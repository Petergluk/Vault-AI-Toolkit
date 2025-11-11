// vault-ai-toolkit/src/main.ts
 // v5.7.0 @ 2025-09-20 12:00:00
 
 /**
  * @file main.ts
  * @description Основной файл плагина, инициализирующий все модули, команды и интеграции с Obsidian.
  * @module main
  * 
  * @changelog
  * - 5.7.0 (2025-09-20): [REFACTOR] Added standard file header and JSDoc comments for the main plugin class and its methods.
  * - 5.6.0 (2025-09-19): [STABILITY] Implemented TZ-Fix for YAML and 429 errors.
  * - 5.5.0 (2025-09-18): [FEATURE] Added command to recalculate all semantic sense_ids.
  */
 
 import { App, Plugin, TFile, Notice, MarkdownPostProcessorContext, TFolder, WorkspaceLeaf, Modal, Menu, parseYaml, stringifyYaml } from 'obsidian';
 import { VaultIndexer, IndexedFile } from './indexer';
 import { VisualNoteBrowser, VIEW_TYPE_VISUAL_BROWSER } from './browser';
 import { AIEnrichmentEngine } from './engine';
 import { DuplicateSynthesizer } from './synthesizer';
 import { ExactDeduplicator } from './deduplicator';
 import { VaultAIToolkitSettings, DEFAULT_SETTINGS, VaultAIToolkitSettingTab, PromptItem, DictionaryItem } from './settings';
 import { DataManager } from './DataManager';
 
 /**
  * @class SemanticLocusAI
  * @description The main entry point for the Obsidian plugin.
  */
 export default class SemanticLocusAI extends Plugin {
 	settings: VaultAIToolkitSettings;
 	indexer: VaultIndexer;
 	enrichmentEngine: AIEnrichmentEngine;
     synthesizer: DuplicateSynthesizer;
     deduplicator: ExactDeduplicator;
     dataManager: DataManager;
 
 	async onload() {
 		console.log('Semantic Locus AI: Загрузка плагина...');
 		await this.loadSettings();
         await this.migrateFromYaml();
 
         this.dataManager = new DataManager(this.app, this.settings);
 		this.indexer = new VaultIndexer(this.app, this.settings);
 		this.enrichmentEngine = new AIEnrichmentEngine(this.app, this.settings, this.dataManager, this.indexer);
         this.synthesizer = new DuplicateSynthesizer(this.app, this.settings, this.indexer);
         this.deduplicator = new ExactDeduplicator(this.app);
 
 		this.registerView(VIEW_TYPE_VISUAL_BROWSER, (leaf) => new VisualNoteBrowser(leaf, this.settings, this.indexer, this.enrichmentEngine));
 		
         this.addRibbonIcon('brain-circuit', 'Semantic Locus AI', (evt: MouseEvent) => {
             const menu = new Menu();
             menu.addItem((item) => item.setTitle('Открыть Visual Note Browser').setIcon('layout-grid').onClick(() => this.openVisualBrowser(null, true)));
             menu.addItem((item) => item.setTitle('1. Анализ метаданных в папке').setIcon('sparkles').onClick(() => this.runFileAnalysis()));
             menu.addItem((item) => item.setTitle('2. Предложить перемещение').setIcon('folder-move').onClick(() => this.runFileCategorization()));
             menu.showAtMouseEvent(evt);
         });
 
 		this.registerCommands();
         this.registerMarkdownPostProcessor(this.createButtonPostProcessor());
 		this.registerIntegrationEvents();
 		this.addSettingTab(new VaultAIToolkitSettingTab(this.app, this));
 		
 		this.app.workspace.onLayoutReady(async () => { await this.indexer.reindexVault(); });
 	}
     
     private registerIntegrationEvents(): void {
         this.registerEvent(
 			this.app.workspace.on('file-menu', (menu, file) => {
 				if (file instanceof TFile && file.extension === 'md') {
 					menu.addItem((item) => {
 						item.setTitle('AI: Проанализировать и добавить метаданные').setIcon('sparkles')
 							.onClick(async () => { await this.enrichmentEngine.analyzeFiles([file]); });
 					});
                     menu.addItem((item) => {
                         item.setTitle('AI: Найти похожие по смыслу').setIcon('search')
                             .onClick(() => this.findSimilarToCurrentFile());
                     });
 				}
                 if (file instanceof TFolder) {
                     menu.addItem((item) => {
                         item.setTitle('Открыть в Visual Note Browser').setIcon('layout-grid')
                             .onClick(() => this.openVisualBrowser(file.path, true));
                     });
                 }
 			})
 		);
         
         this.registerDomEvent(document, 'click', (evt: MouseEvent) => {
             if (evt.ctrlKey || evt.metaKey) {
                 const target = evt.target as HTMLElement;
                 const navFolder = target.closest('.nav-folder-title');
                 if (navFolder) {
                     const folderPath = navFolder.getAttribute('data-path');
                     if (folderPath) { evt.preventDefault(); this.openVisualBrowser(folderPath, true); }
                 }
             }
         });
 
         this.registerObsidianProtocolHandler("vault-ai-toolkit", async (params) => {
             console.log("Semantic Locus AI: Protocol handler triggered with params:", params);
             if (params.action === 'similar' && params.sense_id) {
                 await this.showSimilarFilesInBrowser(params.sense_id);
             } else {
                 console.error("Semantic Locus AI: Unknown or malformed action from protocol handler.", params);
                 new Notice(`Неизвестное действие для Semantic Locus AI: ${params.action}`);
             }
         });
     }
 
     private createButtonPostProcessor(): (el: HTMLElement, ctx: MarkdownPostProcessorContext) => void {
         return (el, ctx) => {
             if (!this.synthesizer.isReportFile(ctx.sourcePath)) { return; }
             const placeholders = el.findAll('code');
             placeholders.forEach(placeholder => {
                 const text = placeholder.innerText.trim();
                 const match = text.match(/^button-(synthesize|keep|delete-duplicates)-(.+)$/);
                 if (match) {
                     const [_, action, groupId] = match;
                     let button: HTMLButtonElement;
                     switch (action) {
                         case 'synthesize': button = this.createButton('🔀 Синтезировать', 'mod-cta', () => this.synthesizer.synthesizeGroupById(groupId)); break;
                         case 'keep': button = this.createButton('✅ Оставить все', '', () => this.synthesizer.keepGroupById(groupId)); break;
                         default: return;
                     }
                     placeholder.replaceWith(button);
                 }
             });
         };
     }
 
     private createButton(text: string, className: string, onClick: () => void): HTMLButtonElement {
         const button = document.createElement('button'); button.textContent = text;
         if (className) button.className = className; button.style.marginRight = '10px';
         button.addEventListener('click', onClick); return button;
     }
 	
 	registerCommands() {
 		this.addCommand({ id: 'open-visual-browser', name: 'Открыть Visual Note Browser', callback: () => this.openVisualBrowser(null, true) });
 		
         this.addCommand({ id: 'analyze-folder-metadata', name: 'AI: 1. Проанализировать и добавить метаданные в папке', callback: () => this.runFileAnalysis() });
         this.addCommand({ id: 'categorize-folder', name: 'AI: 2. Предложить перемещение для файлов в папке', callback: () => this.runFileCategorization() });
         
         this.addCommand({ id: 'find-exact-duplicates', name: 'AI: Найти и удалить точные дубликаты в папке', callback: () => this.runExactDeduplication() });
         this.addCommand({ id: 'clean-metadata', name: 'AI: Удалить метаданные Semantic Locus AI в папке', callback: () => this.cleanPluginMetadata() });
         this.addCommand({ id: 'find-similar-to-current', name: 'AI: Найти похожие на текущий файл', callback: () => this.findSimilarToCurrentFile() });
 		this.addCommand({ id: 'reindex-vault', name: 'Переиндексировать метаданные хранилища', callback: async () => { new Notice('Переиндексация хранилища...'); await this.indexer.reindexVault(); new Notice('Переиндексация завершена.'); } });
 		this.addCommand({ id: 'find-similar-notes', name: 'AI: Найти похожие заметки и создать отчет', callback: () => this.synthesizer.findAndReportDuplicates(0.85) });
         this.addCommand({ id: 'clean-old-embeddings', name: "AI: Очистить хранилище от старых 'embedding'", callback: () => this.cleanOldEmbeddings() });
 
         this.addCommand({
             id: 'recalculate-all-embeddings',
             name: 'AI: Пересчитать все sense_id (семантически)',
             callback: () => this.runSemanticRecalculation(),
         });
 
         this.addCommand({
             id: 'debug-show-settings',
             name: 'DEBUG: Показать текущие настройки в консоли',
             callback: () => {
                 console.log(JSON.stringify(this.settings, null, 2));
                 new Notice('Текущие настройки плагина выведены в консоль разработчика (Ctrl+Shift+I).');
             }
         });
 
         this.addCommand({
             id: 'reset-all-settings',
             name: 'RESET: Полный сброс всех настроек плагина',
             callback: async () => {
                 const confirmed = confirm('Вы уверены, что хотите полностью сбросить ВСЕ настройки Semantic Locus AI? Это действие необратимо и сотрет ваш API ключ, все словари и промпты.');
                 if (confirmed) {
                     this.settings = DEFAULT_SETTINGS;
                     await this.saveSettings();
                     new Notice('Все настройки плагина сброшены к стандартным.');
                 }
             }
         });
 	}
 	
 	/**
      * Opens the Visual Note Browser view, optionally focusing on a specific folder.
      * @param folderPath The path of the folder to focus on, or null for the root.
      * @param activate Whether to make the new view active.
      */
 	async openVisualBrowser(folderPath: string | null, activate: boolean) {
         this.app.workspace.detachLeavesOfType(VIEW_TYPE_VISUAL_BROWSER);
         const leaf = this.app.workspace.getLeaf('tab');
         await leaf.setViewState({ type: VIEW_TYPE_VISUAL_BROWSER, active: activate });
         const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_VISUAL_BROWSER)[0]?.view;
         if (view instanceof VisualNoteBrowser) {
             await view.setFolder(folderPath);
         }
         if (activate) { this.app.workspace.revealLeaf(leaf); }
 	}
     
     /**
      * Finds files similar to a given sense_id and displays them in the Visual Note Browser.
      * @param senseId The plain or markdown-linked sense_id to search for.
      */
     async showSimilarFilesInBrowser(senseId: string) {
         const notice = new Notice(`Ищу файлы, похожие на ${senseId}...`, 0);
         try {
             const similarFiles = await this.indexer.findSimilarFiles(senseId);
             notice.hide();
 
             if (similarFiles.length === 0) {
                 new Notice('Похожие файлы не найдены.');
                 return;
             }
 
             await this.openVisualBrowser(null, true);
             const view = this.app.workspace.getLeavesOfType(VIEW_TYPE_VISUAL_BROWSER)[0]?.view;
             if (view instanceof VisualNoteBrowser) {
                 await view.displaySimilarFiles(senseId, similarFiles);
             }
 
         } catch (error) {
             notice.hide();
             new Notice(`Ошибка поиска похожих файлов: ${error.message}`);
             console.error(error);
         }
     }
 
     private getCurrentFolder(): TFolder | null { return this.app.workspace.getActiveFile()?.parent ?? null; }
 	
 	async runFileAnalysis() {
         const folder = this.getCurrentFolder(); 
         if (!folder) { new Notice('Не удалось определить текущую папку.'); return; }
 		const files = this.app.vault.getMarkdownFiles().filter(file => file.path.startsWith(folder.path));
 		if (files.length === 0) { new Notice('В этой папке нет файлов для анализа.'); return; }
 		
         await this.enrichmentEngine.analyzeFiles(files);
         await this.indexer.reindexVault();
 	}
 
     async runFileCategorization() {
         const folder = this.getCurrentFolder(); 
         if (!folder) { new Notice('Не удалось определить текущую папку.'); return; }
 		const files = this.app.vault.getMarkdownFiles().filter(file => file.path.startsWith(folder.path));
 		if (files.length === 0) { new Notice('В этой папке нет файлов для категоризации.'); return; }
 		
         await this.enrichmentEngine.categorizeFiles(files);
         await this.indexer.reindexVault();
     }
 
     async runSemanticRecalculation() {
         const confirmed = confirm(`Вы уверены, что хотите пересчитать семантические отпечатки (sense_id) для ВСЕХ файлов в хранилище? Это может занять много времени и потратить токены API.`);
         if (!confirmed) {
             new Notice('Операция отменена.');
             return;
         }
 
         const files = this.app.vault.getMarkdownFiles();
         let processedCount = 0;
         const notice = new Notice(`Начинаю пересчет ${files.length} файлов...`, 0);
 
         for (const file of files) {
             try {
                 const content = await this.app.vault.read(file);
                 if (content.length < this.settings.minFileSize) continue;
 
                 const embeddingVector = await this.enrichmentEngine.getSemanticEmbedding(content);
 
                 if (embeddingVector) {
                     const plainSenseId = `sid-${this.enrichmentEngine.calculateHash(content)}`;
                     const newSenseIdLink = `[🔍 ${plainSenseId}](obsidian://vault-ai-toolkit?action=similar&sense_id=${plainSenseId})`;
 
                     try {
                         await this.app.fileManager.processFrontMatter(file, (fm) => {
                             fm.sense_id = newSenseIdLink;
                         });
                     } catch (e) {
                         if (e.name === 'YAMLParseError') {
                             console.warn(`File ${file.path} has no/invalid YAML frontmatter. Prepending empty frontmatter and retrying.`);
                             const originalContent = await this.app.vault.read(file);
                             const newContent = '---\n---\n' + originalContent;
                             await this.app.vault.modify(file, newContent);
                             
                             await this.app.fileManager.processFrontMatter(file, (fm) => {
                                 fm.sense_id = newSenseIdLink;
                             });
                         } else {
                             throw e;
                         }
                     }
 
                     await this.indexer.updateFileMetadata(file.path, {
                         sense_id: plainSenseId,
                         embedding: embeddingVector
                     });
 
                     processedCount++;
                     notice.setMessage(`Обработано ${processedCount} / ${files.length}...`);
                 } else {
                     console.warn(`Не удалось создать эмбеддинг для файла: ${file.path}`);
                 }
                 
                 await new Promise(resolve => setTimeout(resolve, this.settings.apiDelayMs)); 
 
             } catch (error) {
                 console.error(`Ошибка при пересчете sense_id для файла ${file.path}:`, error);
                 new Notice(`Ошибка обработки ${file.basename}. См. консоль.`);
             }
         }
 
         notice.hide();
         new Notice(`Пересчет завершен. Обновлено ${processedCount} файлов.`);
     }
 
     async runExactDeduplication() { const folder = this.getCurrentFolder(); if (!folder) { new Notice('Не удалось определить текущую папку.'); return; } await this.deduplicator.findAndRemoveDuplicates(folder.path); }
     
     async cleanPluginMetadata() {
         const folder = this.getCurrentFolder(); if (!folder) { new Notice('Не удалось определить текущую папку.'); return; }
         if (!confirm(`Вы уверены, что хотите удалить все метаданные Semantic Locus AI из файлов в папке "${folder.path}"?`)) { return; }
         const files = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith(folder.path)); let cleanedCount = 0; const fieldsToRemove = ['suggested_path', 'content_type', 'status', 'quality_score', 'sense_id', 'summary', 'processed_date', 'ai_model', 'project', 'sense_id_plain'];
         for (const file of files) { let changed = false; await this.app.fileManager.processFrontMatter(file, (fm) => { for (const field of fieldsToRemove) { if (fm[field]) { delete fm[field]; changed = true; } } }); if (changed) cleanedCount++; }
         await this.indexer.reindexVault(); new Notice(`Очищено ${cleanedCount} файлов.`);
     }
 
     async cleanOldEmbeddings() {
         if (!confirm(`Вы уверены, что хотите удалить старое поле 'embedding' из ВСЕХ файлов в хранилище?`)) { return; }
         const files = this.app.vault.getMarkdownFiles(); let cleanedCount = 0;
         const notice = new Notice(`Проверяю ${files.length} файлов...`, 0);
         for (const file of files) {
             try {
                 let changed = false;
                 await this.app.fileManager.processFrontMatter(file, (fm) => { if (fm.embedding) { delete fm.embedding; changed = true; } });
                 if (changed) cleanedCount++;
             } catch (e) { console.warn(`[Semantic Locus AI] Пропущен файл с некорректным YAML: ${file.path}.`); }
         }
         await this.indexer.reindexVault();
         notice.hide();
         new Notice(`Очищено ${cleanedCount} файлов от старого поля 'embedding'.`);
     }
 
     async findSimilarToCurrentFile() {
         const activeFile = this.app.workspace.getActiveFile(); if (!activeFile) { new Notice('Нет активного файла.'); return; }
         const cache = this.app.metadataCache.getFileCache(activeFile);
         const rawSenseId = cache?.frontmatter?.sense_id;
 
         if (!rawSenseId) { new Notice('У этого файла нет смыслового отпечатка (sense_id). Сначала проанализируйте его.'); return; }
         
         const plainSenseId = this.indexer.extractPlainSenseId(rawSenseId);
         if (!plainSenseId) { new Notice('Не удалось извлечь sense_id из метаданных.'); return; }
 
         const notice = new Notice('Ищу похожие файлы...', 0);
         try { 
             const similarFiles = await this.indexer.findSimilarFiles(plainSenseId); 
             notice.hide();
             if (similarFiles.length === 0) { new Notice('Похожие файлы не найдены.'); } else { new SimilarFilesModal(this.app, activeFile.basename, similarFiles).open(); }
         } catch (error) { notice.hide(); new Notice('Ошибка при поиске: ' + error.message); console.error(error); }
     }
 	
 	onunload() { console.log('Semantic Locus AI выгружен'); }
 
 	async loadSettings() {
         const savedData = await this.loadData();
         this.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
         
         if (savedData) {
             const { prompts, contentTypes, statuses, projects, ...otherSavedData } = savedData;
             Object.assign(this.settings, otherSavedData);
         }
 
         const mergeById = <T extends { id: string }>(defaultItems: T[], savedItems: T[] | undefined): T[] => {
             if (!savedItems) return defaultItems;
             const finalItems = new Map<string, T>();
             defaultItems.forEach(item => finalItems.set(item.id, item));
             savedItems.forEach(item => finalItems.set(item.id, item));
             return Array.from(finalItems.values());
         };
 
         this.settings.prompts = mergeById(DEFAULT_SETTINGS.prompts, savedData?.prompts);
         this.settings.contentTypes = mergeById(DEFAULT_SETTINGS.contentTypes, savedData?.contentTypes);
         this.settings.statuses = mergeById(DEFAULT_SETTINGS.statuses, savedData?.statuses);
         this.settings.projects = mergeById(DEFAULT_SETTINGS.projects, savedData?.projects);
     }
 
 	async saveSettings() { await this.saveData(this.settings); }
 
     async migrateFromYaml() {
         if (this.settings.yamlMigrationCompleted) return;
         const oldDataDir = `${this.app.vault.configDir}/${this.manifest.id}/data`;
         if (!await this.app.vault.adapter.exists(oldDataDir)) {
             this.settings.yamlMigrationCompleted = true;
             await this.saveSettings();
             return;
         }
         
         new Notice('Semantic Locus AI: Обнаружена старая папка /data. Начинаю миграцию...', 10000);
 
         try {
             const loadYaml = async (fileName: string): Promise<any> => {
                 const path = `${oldDataDir}/${fileName}`;
                 if (await this.app.vault.adapter.exists(path)) { 
                     const content = await this.app.vault.adapter.read(path);
                     return content ? parseYaml(content) : null;
                 }
                 return null;
             };
 
             const promptsData = await loadYaml('ai_prompts.yaml');
             if (promptsData?.prompts) {
                 const promptsMap = new Map<string, PromptItem>(this.settings.prompts.map(p => [p.id, p]));
                 for (const key in promptsData.prompts) {
                     const p = promptsData.prompts[key];
                     promptsMap.set(key, { id: key, name: key.replace(/_/g, ' '), model: p.model || '', system_prompt: p.system_prompt || '', user_prompt_template: p.user_prompt_template || '' });
                 }
                 this.settings.prompts = Array.from(promptsMap.values());
             }
 
             const contentTypesData = await loadYaml('content_types.yaml');
             if (contentTypesData?.types) this.settings.contentTypes = contentTypesData.types.map((t: any) => ({ id: t.name, name: t.display_name, description: t.description }));
 
             const taxonomyConfigData = await loadYaml('taxonomy_config.yaml');
             if (taxonomyConfigData?.statuses?.presets?.standard) this.settings.statuses = taxonomyConfigData.statuses.presets.standard.map((s: any) => ({ id: s.id, name: s.name, description: '' }));
 
             const tagsData = await loadYaml('tags.yaml');
             if (tagsData?.groups) this.settings.coreTags = Object.values(tagsData.groups).flatMap((g: any) => g.tags.map((t: any) => t.tag.replace(/^#/, ''))).join(', ');
 
             const qualityData = await loadYaml('quality_scale.yaml');
             if (qualityData) this.settings.qualityScale = stringifyYaml(qualityData);
 
             const rubricatorData = await loadYaml('rubricator.yaml');
             if (rubricatorData) this.settings.rubricator = rubricatorData;
             
             this.settings.yamlMigrationCompleted = true;
             await this.saveSettings();
             new Notice('Миграция настроек успешно завершена!');
             new Notice('Теперь можно безопасно удалить папку /data из папки плагина.', 15000);
 
         } catch (e) { new Notice('Ошибка при миграции настроек.', 10000); console.error("Ошибка миграции:", e); }
     }
 }
 
 /**
  * @class SimilarFilesModal
  * @description A modal window to display a list of files similar to a source file.
  */
 export class SimilarFilesModal extends Modal {
     constructor(app: App, private sourceFileName: string, private similarFiles: Array<{file: IndexedFile, similarity: number}>) { super(app); }
     onOpen() {
         const { contentEl } = this; contentEl.createEl('h2', { text: `Файлы, похожие на "${this.sourceFileName}"` });
         if (this.similarFiles.length === 0) { contentEl.createEl('p', { text: 'Похожие файлы не найдены.' }); return; }
         const list = contentEl.createEl('ul', { cls: 'similar-files-list' });
         this.similarFiles.forEach(item => {
             const listItem = list.createEl('li'); const similarityPercentage = (item.similarity * 100).toFixed(1);
             listItem.createEl('a', { text: item.file.path, href: '#' }).onClickEvent(async (e) => { e.preventDefault(); const targetFile = this.app.vault.getAbstractFileByPath(item.file.path); if (targetFile instanceof TFile) { this.close(); await this.app.workspace.getLeaf().openFile(targetFile); } });
             listItem.createEl('span', { text: ` - ${similarityPercentage}% сходства` });
         });
     }
     onClose() { this.contentEl.empty(); }
 }