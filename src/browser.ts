// vault-ai-toolkit/src/browser.ts
 // v8.6.0 @ 2025-09-20 12:00:00
 
 /**
  * @file browser.ts
  * @description Реализует высокопроизводительный Visual Note Browser с интерактивными карточками и режимом ленты.
  * @module browser
  * 
  * @changelog
  * - 8.6.0 (2025-09-20): [UX/REFACTOR] Replaced the native `prompt()` for quality score editing with a custom, user-friendly `QualityScoreEditModal`. Added comprehensive JSDoc comments to all classes and methods.
  * - 8.5.1 (2025-09-19): [FIX] Replaced deprecated `requestLayoutUpdate` with `trigger('layout-change')` for UI updates.
  * - 8.5.0 (2025-09-19): [FEATURE] Implemented Shift-selection for checkboxes.
  */
 
 import { App, ItemView, TFile, WorkspaceLeaf, Notice, Setting, debounce, Modal, MarkdownRenderer, SliderComponent } from 'obsidian';
 import { VaultIndexer, IndexedFile } from './indexer';
 import { VaultAIToolkitSettings, DictionaryItem } from './settings';
 import { AIEnrichmentEngine } from './engine';
 import { SimilarFilesModal } from './main';
 
 export const VIEW_TYPE_VISUAL_BROWSER = 'visual-note-browser';
 
 type SortField = 'path' | 'created' | 'modified' | 'size' | 'quality_score';
 type SortDirection = 'asc' | 'desc';
 type ViewMode = 'grid' | 'feed';
 
 interface BrowserState {
     searchQuery: string;
     showOnlyWithSuggestions: boolean;
     contentType: string;
     status: string;
     project: string;
     sortField: SortField;
     sortDirection: SortDirection;
     viewMode: ViewMode;
 }
 
 interface SmartFilterOptions {
     contentTypes: DictionaryItem[];
     statuses: DictionaryItem[];
     projects: DictionaryItem[];
 }
 
 /**
  * @class BrowserRenderer
  * @description Отвечает за отрисовку всех UI-элементов Visual Note Browser.
  */
 class BrowserRenderer {
     private container: HTMLElement;
     private grid: HTMLElement;
     private stats: HTMLElement;
     private bulkActions: HTMLElement;
 
     constructor(container: HTMLElement) {
         this.container = container;
         this.container.empty();
     }
 
     public buildLayout() {
         this.container.createDiv('vnb-filters');
         this.grid = this.container.createDiv('vnb-note-grid');
         this.bulkActions = this.container.createDiv('vnb-bulk-actions');
         this.bulkActions.createDiv('vnb-bulk-buttons');
         this.stats = this.bulkActions.createDiv('vnb-stats');
     }
 
     public updateLayout(viewMode: ViewMode) {
         this.grid.className = viewMode === 'grid' ? 'vnb-note-grid' : 'vnb-note-feed';
     }
 
     private _stripFrontmatter(content: string): string {
         const yamlRegex = /^---\s*[\s\S]*?---\s*/;
         return content.replace(yamlRegex, '').trim();
     }
 
     public renderFilters(
         state: BrowserState, 
         smartOptions: SmartFilterOptions,
         onStateChange: (key: keyof BrowserState, value: any) => void
     ) {
         const filterPanel = this.container.querySelector('.vnb-filters');
         if (!filterPanel) return;
         filterPanel.empty();
 
         const leftGroup = filterPanel.createDiv('vnb-filter-group-left');
         new Setting(leftGroup).addSearch(s => {
             s.setPlaceholder('Поиск...');
             s.setValue(state.searchQuery);
             s.onChange(debounce((value) => onStateChange('searchQuery', value), 300, true));
         });
         
         const sortSetting = new Setting(leftGroup);
         sortSetting.addDropdown(dd => dd
             .addOption('path', 'Путь файла')
             .addOption('created', 'Дата создания')
             .addOption('modified', 'Дата изменения')
             .addOption('size', 'Размер')
             .addOption('quality_score', 'Качество')
             .setValue(state.sortField)
             .onChange(value => onStateChange('sortField', value as SortField))
         );
         sortSetting.addButton(btn => btn
             .setIcon(state.sortDirection === 'asc' ? 'arrow-up' : 'arrow-down')
             .setTooltip(state.sortDirection === 'asc' ? 'По возрастанию' : 'По убыванию')
             .onClick(() => onStateChange('sortDirection', state.sortDirection === 'asc' ? 'desc' : 'asc'))
         );
         
         const rightGroup = filterPanel.createDiv('vnb-filter-group-right');
         
         const createDropdown = (key: keyof BrowserState, options: DictionaryItem[], placeholder: string) => {
             new Setting(rightGroup).addDropdown(dropdown => {
                 dropdown.addOption('all', placeholder);
                 options.forEach(opt => dropdown.addOption(opt.id, opt.name));
                 dropdown.setValue(state[key] as string);
                 dropdown.onChange(value => onStateChange(key, value));
             });
         };
         
         createDropdown('contentType', smartOptions.contentTypes, 'Все типы');
         createDropdown('status', smartOptions.statuses, 'Все статусы');
         createDropdown('project', smartOptions.projects, 'Все проекты');
 
         const viewModeSetting = new Setting(rightGroup);
         viewModeSetting.controlEl.addClass('vnb-view-mode-toggle');
         viewModeSetting.addButton(btn => btn
             .setIcon('layout-grid')
             .setTooltip('Режим сетки')
             .onClick(() => onStateChange('viewMode', 'grid'))
             .setDisabled(state.viewMode === 'grid')
         );
         viewModeSetting.addButton(btn => btn
             .setIcon('list')
             .setTooltip('Режим ленты')
             .onClick(() => onStateChange('viewMode', 'feed'))
             .setDisabled(state.viewMode === 'feed')
         );
     }
 
     public renderBulkActions(
         state: BrowserState,
         onStateChange: (key: keyof BrowserState, value: any) => void,
         handlers: {
             onRefresh: () => void,
             onSelectAll: () => void,
             onInvertSelection: () => void,
             onAcceptAll: () => void,
             onDeleteSelected: () => void,
         }
     ) {
         const bulkButtons = this.container.querySelector('.vnb-bulk-buttons');
         if (!bulkButtons) return;
         bulkButtons.empty();
 
         const leftSide = bulkButtons.createDiv('vnb-bulk-group');
         leftSide.createEl('button', { text: 'Выделить все' }).onClickEvent(handlers.onSelectAll);
         leftSide.createEl('button', { text: 'Инвертировать' }).onClickEvent(handlers.onInvertSelection);
         leftSide.createEl('button', { text: '✅ Принять все' }).onClickEvent(handlers.onAcceptAll);
         leftSide.createEl('button', { text: '🗑️ Удалить', cls: 'mod-warning' }).onClickEvent(handlers.onDeleteSelected);
 
         const rightSide = bulkButtons.createDiv('vnb-bulk-group');
         const suggestionToggle = new Setting(rightSide)
             .setName('Только с предложениями AI')
             .addToggle(t => {
                 t.setValue(state.showOnlyWithSuggestions);
                 t.onChange(val => onStateChange('showOnlyWithSuggestions', val));
             });
         suggestionToggle.nameEl.setAttr('aria-label', 'Показывает только файлы, для которых AI предложил папку для перемещения');
 
         new Setting(rightSide).addButton(btn => btn
             .setIcon('refresh-cw')
             .setTooltip('Обновить список файлов из хранилища')
             .onClick(handlers.onRefresh)
         );
     }
 
     public renderNoteCard(
         file: IndexedFile, 
         isSelected: boolean, 
         handlers: {
             onSelectionChange: (filePath: string, isShiftClick: boolean) => void,
             onOpen: () => void,
             onTagClick: (type: keyof BrowserState, value: string) => void,
             onQualityEdit: () => void,
             onFindSimilar: () => void,
         }
     ) {
         const card = this.grid.createDiv({ cls: `vnb-note-card ${isSelected ? 'is-selected' : ''}` });
         card.onClickEvent(async (evt) => { if (!(evt.target as HTMLElement).closest('button, input, .vnb-tag')) handlers.onOpen(); });
         
         const header = card.createDiv('vnb-card-header');
         header.createEl('h3', { text: file.path.split('/').pop()?.replace('.md', '') || 'Без имени' });
         
         const checkbox = header.createEl('input', { type: 'checkbox', cls: 'vnb-checkbox' });
         checkbox.checked = isSelected;
         checkbox.onClickEvent((e) => {
             e.stopPropagation();
             handlers.onSelectionChange(file.path, e.shiftKey);
         });
 
         const summary = file.metadata?.summary;
         const cleanedContent = this._stripFrontmatter(file.content || '');
         const previewText = summary ? `📝 ${summary}` : (cleanedContent.slice(0, 150) + '...' || 'Нет содержимого');
         card.createEl('p', { text: previewText, cls: 'vnb-summary' });
         
         const metaPanel = card.createDiv('vnb-meta-panel');
         
         const createTag = (text: string, type: keyof BrowserState, value: string, extraCls: string = '') => {
             const tag = metaPanel.createEl('span', { text, cls: `vnb-tag vnb-clickable ${extraCls}` });
             tag.dataset.filterType = type;
             tag.dataset.filterValue = value;
             tag.onClickEvent(e => { e.stopPropagation(); handlers.onTagClick(type, value); });
             return tag;
         };
 
         if (file.metadata?.content_type) createTag(file.metadata.content_type, 'contentType', file.metadata.content_type);
         if (file.metadata?.status) createTag(file.metadata.status, 'status', file.metadata.status);
         if (file.metadata?.project) createTag(`🚀 ${file.metadata.project}`, 'project', file.metadata.project);
         
         if (file.metadata?.quality_score) {
             const qualityTag = createTag(`⭐ ${file.metadata.quality_score}/10`, 'searchQuery', '', 'vnb-quality-tag');
             qualityTag.removeAttribute('data-filter-type');
             qualityTag.onClickEvent(e => { e.stopPropagation(); handlers.onQualityEdit(); });
         }
 
         if (file.metadata?.sense_id) {
             const senseTag = metaPanel.createEl('span', { text: `🔍 Похожие`, cls: 'vnb-tag vnb-clickable' });
             senseTag.onClickEvent(e => { e.stopPropagation(); handlers.onFindSimilar(); });
         }
 
         return card;
     }
 
     public renderNoteFeedItem(
         file: IndexedFile,
         isSelected: boolean,
         handlers: {
             onSelectionChange: (filePath: string, isShiftClick: boolean) => void,
             onOpen: () => void;
             onExpand: (contentEl: HTMLElement, buttonEl: HTMLButtonElement) => Promise<void>;
         }
     ) {
         const item = this.grid.createDiv({ cls: `vnb-feed-item ${isSelected ? 'is-selected' : ''}` });
 
         const mainContent = item.createDiv('vnb-feed-main');
         const checkbox = mainContent.createEl('input', { type: 'checkbox', cls: 'vnb-checkbox' });
         checkbox.checked = isSelected;
         checkbox.onClickEvent((e) => {
             e.stopPropagation();
             handlers.onSelectionChange(file.path, e.shiftKey);
         });
         
         const textContent = mainContent.createDiv('vnb-feed-text');
         const title = textContent.createEl('h3', { text: file.path.split('/').pop()?.replace('.md', '') || 'Без имени' });
         title.onClickEvent(handlers.onOpen);
         
         const summary = file.metadata?.summary;
         const cleanedContent = this._stripFrontmatter(file.content || '');
         const previewText = summary ? `📝 ${summary}` : (cleanedContent.slice(0, 200) + '...' || 'Нет содержимого');
         textContent.createEl('p', { text: previewText, cls: 'vnb-summary' });
         
         const actions = mainContent.createDiv('vnb-feed-actions');
         const expandButton = actions.createEl('button', { text: 'Развернуть' });
         
         const expandedContent = item.createDiv('vnb-expanded-content');
         
         expandButton.onClickEvent(async (e) => {
             e.stopPropagation();
             const isExpanded = item.classList.toggle('is-expanded');
             if (isExpanded) {
                 await handlers.onExpand(expandedContent, expandButton);
             } else {
                 expandButton.setText('Развернуть');
             }
         });
         
         return item;
     }
 
     public renderSuggestion(card: HTMLElement, file: IndexedFile, onAccept: () => void, onReject: () => void) {
         const sorterPanel = card.createDiv('vnb-sorter-panel');
         sorterPanel.createDiv({ text: `AI предлагает переместить в:` });
         sorterPanel.createEl('strong', { text: file.metadata?.suggested_path });
         const buttonGroup = sorterPanel.createDiv('vnb-button-group');
         buttonGroup.createEl('button', { text: '✅ Принять', cls: 'mod-cta' }).onClickEvent(async (e) => { e.stopPropagation(); onAccept(); });
         buttonGroup.createEl('button', { text: '❌ Отклонить', cls: 'mod-warning' }).onClickEvent(async (e) => { e.stopPropagation(); onReject(); });
     }
     
     public renderPagination(hasMore: boolean, onLoadMore: () => void) {
         const existingButton = this.grid.querySelector('.vnb-load-more');
         if (existingButton) existingButton.remove();
 
         if (hasMore) {
             const button = this.grid.createEl('button', { text: 'Загрузить еще...', cls: 'vnb-load-more' });
             button.onClickEvent(onLoadMore);
         }
     }
 
     public updateStats(selected: number, displayed: number) {
         this.stats.setText(`Выбрано: ${selected} из ${displayed}`);
     }
 
     public clearGrid() { this.grid.empty(); }
     public setEmptyMessage(message: string) { this.grid.setText(message); }
 }
 
 /**
  * @class QualityScoreEditModal
  * @description A modal for editing the quality score of a file using a slider.
  */
 class QualityScoreEditModal extends Modal {
     private newScore: number;
 
     /**
      * @param app The Obsidian App instance.
      * @param file The file whose score is being edited.
      * @param onSave Callback function to execute when the new score is saved.
      */
     constructor(app: App, private file: IndexedFile, private onSave: (newScore: number) => void) {
         super(app);
         this.newScore = file.metadata?.quality_score ?? 5;
     }
 
     onOpen() {
         const { contentEl } = this;
         contentEl.createEl("h2", { text: `Оценка качества для "${this.file.path.split('/').pop()}"` });
 
         let scoreValueEl: HTMLElement;
         new Setting(contentEl)
             .setName("Качество")
             .setDesc("Выберите оценку от 1 до 10.")
             .addSlider(slider => {
                 slider
                     .setLimits(1, 10, 1)
                     .setValue(this.newScore)
                     .setDynamicTooltip()
                     .onChange(value => {
                         this.newScore = value;
                         scoreValueEl.setText(`${value} / 10`);
                     });
             })
             .settingEl.createDiv('', (el) => {
                 scoreValueEl = el;
                 el.addClass('vait-quality-score-value');
                 el.setText(`${this.newScore} / 10`);
             });
 
         new Setting(contentEl)
             .addButton(btn => btn
                 .setButtonText("Сохранить")
                 .setCta()
                 .onClick(() => {
                     this.onSave(this.newScore);
                     this.close();
                 }));
     }
 
     onClose() {
         this.contentEl.empty();
     }
 }
 
 /**
  * @class VisualNoteBrowser
  * @description The main view class for the Visual Note Browser, handling state management, data filtering, and user interactions.
  */
 export class VisualNoteBrowser extends ItemView {
     private settings: VaultAIToolkitSettings;
     private indexer: VaultIndexer;
     private engine: AIEnrichmentEngine;
     private renderer: BrowserRenderer;
     
     private state: BrowserState;
     private currentFolderPath: string | null = null;
     private specialViewModeTitle: string | null = null;
     private selectedFiles: Set<string> = new Set();
     private allVaultFiles: IndexedFile[] = [];
     private filteredFiles: IndexedFile[] = [];
     private expandedContentCache: Map<string, string> = new Map();
     private currentPage: number = 1;
     private lastClickedFile: string | null = null;
 
     constructor(leaf: WorkspaceLeaf, settings: VaultAIToolkitSettings, indexer: VaultIndexer, engine: AIEnrichmentEngine) {
         super(leaf);
         this.settings = settings;
         this.indexer = indexer;
         this.engine = engine;
         this.state = {
             searchQuery: '',
             showOnlyWithSuggestions: false,
             contentType: 'all',
             status: 'all',
             project: 'all',
             sortField: settings.browserDefaultSortOrder,
             sortDirection: 'asc',
             viewMode: 'grid',
         };
     }
 
     getViewType(): string { return VIEW_TYPE_VISUAL_BROWSER; }
     getDisplayText(): string { 
         return this.specialViewModeTitle || (this.currentFolderPath ? `Browser: ${this.currentFolderPath}` : 'Visual Note Browser'); 
     }
     getIcon(): string { return 'layout-grid'; }
 
     async onOpen() {
         const container = this.containerEl.children[1] as HTMLElement;
         container.addClass('vait-visual-browser');
         this.renderer = new BrowserRenderer(container);
         this.addStyles();
         this.renderer.buildLayout();
         this.renderer.renderFilters(this.state, { contentTypes: [], statuses: [], projects: [] }, this.handleStateChange.bind(this));
         await this.loadInitialData();
     }
     
     /**
      * Sets the browser to display files from a specific folder.
      * @param folderPath The path of the folder to display, or null to display all files.
      */
     async setFolder(folderPath: string | null) {
         this.currentFolderPath = folderPath;
         this.specialViewModeTitle = null;
         this.currentPage = 1;
         this.selectedFiles.clear();
         this.lastClickedFile = null;
         await this.leaf.setViewState({ type: VIEW_TYPE_VISUAL_BROWSER, state: this.getViewState(), active: true });
         this.applyFiltersAndRender();
         this.app.workspace.trigger('layout-change');
     }
     
     /**
      * Sets the browser to a special mode to display a list of similar files.
      * @param sourceSenseId The sense_id of the source file.
      * @param similarFiles An array of files that are similar to the source.
      */
     async displaySimilarFiles(sourceSenseId: string, similarFiles: Array<{file: IndexedFile, similarity: number}>) {
         this.currentFolderPath = null;
         this.specialViewModeTitle = `Похожие на ${sourceSenseId.substring(0, 12)}...`;
         this.state = { ...this.state, searchQuery: '', contentType: 'all', status: 'all', project: 'all' };
 
         this.filteredFiles = similarFiles.map(item => item.file);
         this.sortFiles(this.filteredFiles);
 
         this.currentPage = 1;
         this.applyFiltersAndRender();
         this.app.workspace.trigger('layout-change');
     }
 
     getViewState() { return { currentFolderPath: this.currentFolderPath, state: this.state }; }
     
     async setState(viewState: any) {
         if (viewState) {
             this.currentFolderPath = viewState.currentFolderPath;
             this.state = { ...this.state, ...viewState.state };
             this.specialViewModeTitle = null;
             await this.applyFiltersAndRender();
             this.app.workspace.trigger('layout-change');
         }
     }
     
     async loadInitialData() {
         const notice = new Notice('Загрузка данных браузера...', 0);
         this.allVaultFiles = await this.indexer.getAllIndexedFiles();
         notice.hide();
         await this.setFolder(null);
     }
     
     private handleStateChange(key: keyof BrowserState, value: any) {
         (this.state as any)[key] = value;
         this.currentPage = 1;
         this.specialViewModeTitle = null;
         
         this.applyFiltersAndRender();
         this.app.workspace.trigger('layout-change');
     }
     
     private applyFiltersAndRender() {
         if (!this.renderer) return;
 
         if (this.specialViewModeTitle) {
             // For similar files view, we don't re-filter
         } else {
             let filesInScope = this.currentFolderPath
                 ? this.allVaultFiles.filter(file => file.path.startsWith(this.currentFolderPath + '/'))
                 : this.allVaultFiles.filter(file => !this.settings.excludeFolders.some(folder => file.path.startsWith(folder)));
 
             this.filteredFiles = filesInScope.filter(file => {
                 const metadata = file.metadata || {};
                 if (this.state.showOnlyWithSuggestions && !metadata.suggested_path) return false;
                 if (this.state.searchQuery && !file.path.toLowerCase().includes(this.state.searchQuery.toLowerCase()) && !(metadata.summary || file.content || '').toLowerCase().includes(this.state.searchQuery.toLowerCase())) return false;
                 if (this.state.contentType !== 'all' && metadata.content_type !== this.state.contentType) return false;
                 if (this.state.status !== 'all' && metadata.status !== this.state.status) return false;
                 if (this.state.project !== 'all' && metadata.project !== this.state.project) return false;
                 return true;
             });
 
             this.sortFiles(this.filteredFiles);
         }
 
         const smartOptions: SmartFilterOptions = { contentTypes: [], statuses: [], projects: [] };
         const seenContentTypes = new Set<string>();
         const seenStatuses = new Set<string>();
         const seenProjects = new Set<string>();
 
         this.filteredFiles.forEach(file => {
             if (file.metadata?.content_type) seenContentTypes.add(file.metadata.content_type);
             if (file.metadata?.status) seenStatuses.add(file.metadata.status);
             if (file.metadata?.project) seenProjects.add(file.metadata.project);
         });
 
         const findInDict = (id: string, dict: DictionaryItem[]) => dict.find(item => item.id === id);
 
         smartOptions.contentTypes = Array.from(seenContentTypes).map(id => findInDict(id, this.settings.contentTypes)).filter((i): i is DictionaryItem => !!i);
         smartOptions.statuses = Array.from(seenStatuses).map(id => findInDict(id, this.settings.statuses)).filter((i): i is DictionaryItem => !!i);
         smartOptions.projects = Array.from(seenProjects).map(id => findInDict(id, this.settings.projects)).filter((i): i is DictionaryItem => !!i);
         
         this.renderer.renderFilters(this.state, smartOptions, this.handleStateChange.bind(this));
         this.renderer.renderBulkActions(this.state, this.handleStateChange.bind(this), {
             onRefresh: this.loadInitialData.bind(this),
             onSelectAll: this.handleSelectAll.bind(this),
             onInvertSelection: this.handleInvertSelection.bind(this),
             onAcceptAll: this.acceptAllSuggestions.bind(this),
             onDeleteSelected: this.deleteSelected.bind(this),
         });
 
         this.renderVisibleFiles();
         this.updateStats();
     }
 
     private renderVisibleFiles() {
         this.renderer.clearGrid();
         this.renderer.updateLayout(this.state.viewMode);
         const notesPerPage = this.settings.browserNotesPerPage;
         const endIndex = this.currentPage * notesPerPage;
         const filesToDisplay = this.filteredFiles.slice(0, endIndex);
 
         if (filesToDisplay.length === 0) {
             this.renderer.setEmptyMessage(this.specialViewModeTitle ? `Похожие файлы не найдены.` : (this.currentFolderPath ? `В папке "${this.currentFolderPath}" нет файлов, соответствующих фильтрам.` : 'Нет файлов для отображения.'));
         } else {
             if (this.state.viewMode === 'grid') {
                 filesToDisplay.forEach(file => this.renderCard(file));
             } else {
                 filesToDisplay.forEach(file => this.renderFeedItem(file));
             }
         }
 
         this.renderer.renderPagination(this.filteredFiles.length > endIndex, () => {
             this.currentPage++;
             this.renderVisibleFiles();
         });
     }
 
     private sortFiles(files: IndexedFile[]) {
         const { sortField, sortDirection } = this.state;
         const dir = sortDirection === 'asc' ? 1 : -1;
         files.sort((a, b) => {
             switch(sortField) {
                 case 'path': return a.path.localeCompare(b.path) * dir;
                 case 'size': return (a.size - b.size) * dir;
                 case 'created': return (a.created.getTime() - b.created.getTime()) * dir;
                 case 'modified': return (a.modified.getTime() - b.modified.getTime()) * dir;
                 case 'quality_score':
                     const scoreA = a.metadata?.quality_score ?? -1;
                     const scoreB = b.metadata?.quality_score ?? -1;
                     return (scoreA - scoreB) * dir;
                 default: return 0;
             }
         });
     }
 
     private renderCard(file: IndexedFile) {
         const card = this.renderer.renderNoteCard(file, this.selectedFiles.has(file.path), {
             onSelectionChange: this.handleFileSelection.bind(this),
             onOpen: () => {
                 const targetFile = this.app.vault.getAbstractFileByPath(file.path);
                 if (targetFile instanceof TFile) this.app.workspace.getLeaf().openFile(targetFile);
             },
             onTagClick: (type, value) => this.handleStateChange(type, value),
             onQualityEdit: () => this.editQualityScore(file),
             onFindSimilar: () => this.findSimilar(file),
         });
         
         if (file.metadata?.suggested_path) {
             this.renderer.renderSuggestion(card, file, () => this.acceptSuggestion(file), () => this.rejectSuggestion(file));
         }
     }
 
     private renderFeedItem(file: IndexedFile) {
         const item = this.renderer.renderNoteFeedItem(file, this.selectedFiles.has(file.path), {
             onSelectionChange: this.handleFileSelection.bind(this),
             onOpen: () => {
                 const targetFile = this.app.vault.getAbstractFileByPath(file.path);
                 if (targetFile instanceof TFile) this.app.workspace.getLeaf().openFile(targetFile);
             },
             onExpand: async (contentEl, buttonEl) => {
                 contentEl.empty();
                 buttonEl.setText('Загрузка...');
                 
                 let content = this.expandedContentCache.get(file.path);
                 if (!content) {
                     const tFile = this.app.vault.getAbstractFileByPath(file.path);
                     if (tFile instanceof TFile) {
                         content = await this.app.vault.read(tFile);
                         this.expandedContentCache.set(file.path, content);
                     } else {
                         content = 'Не удалось загрузить содержимое файла.';
                     }
                 }
                 
                 await MarkdownRenderer.render(this.app, content, contentEl, file.path, this);
                 buttonEl.setText('Свернуть');
             },
         });
     }
 
     private updateStats() {
         this.renderer.updateStats(this.selectedFiles.size, this.filteredFiles.length);
     }
 
     private handleFileSelection(clickedFilePath: string, isShiftClick: boolean) {
         const { selectedFiles, lastClickedFile, filteredFiles } = this;
 
         if (isShiftClick && lastClickedFile) {
             const lastClickedIndex = filteredFiles.findIndex(f => f.path === lastClickedFile);
             const clickedIndex = filteredFiles.findIndex(f => f.path === clickedFilePath);
 
             if (lastClickedIndex !== -1 && clickedIndex !== -1) {
                 const start = Math.min(lastClickedIndex, clickedIndex);
                 const end = Math.max(lastClickedIndex, clickedIndex);
                 for (let i = start; i <= end; i++) {
                     selectedFiles.add(filteredFiles[i].path);
                 }
             }
         } else {
             if (selectedFiles.has(clickedFilePath)) {
                 selectedFiles.delete(clickedFilePath);
             } else {
                 selectedFiles.add(clickedFilePath);
             }
             this.lastClickedFile = clickedFilePath;
         }
 
         this.renderVisibleFiles();
         this.updateStats();
     }
 
     private handleSelectAll() {
         this.selectedFiles = new Set(this.filteredFiles.map(f => f.path));
         this.renderVisibleFiles();
         this.updateStats();
     }
 
     private handleInvertSelection() {
         const newSelection = new Set<string>();
         const currentSelection = this.selectedFiles;
         this.filteredFiles.forEach(file => {
             if (!currentSelection.has(file.path)) {
                 newSelection.add(file.path);
             }
         });
         this.selectedFiles = newSelection;
         this.renderVisibleFiles();
         this.updateStats();
     }
     
     private async editQualityScore(file: IndexedFile) {
         new QualityScoreEditModal(this.app, file, async (newScore) => {
             const targetFile = this.app.vault.getAbstractFileByPath(file.path);
             if (!(targetFile instanceof TFile)) return;
 
             await this.app.fileManager.processFrontMatter(targetFile, fm => { fm.quality_score = newScore; });
 
             const cachedFile = this.allVaultFiles.find(f => f.path === file.path);
             if (cachedFile) {
                 if (!cachedFile.metadata) cachedFile.metadata = {};
                 cachedFile.metadata.quality_score = newScore;
             }
             
             new Notice(`Оценка для ${targetFile.basename} обновлена.`);
             this.applyFiltersAndRender();
         }).open();
     }
 
     private async findSimilar(file: IndexedFile) {
         if (!file.metadata?.sense_id) {
             new Notice('У файла нет смыслового отпечатка (sense_id).');
             return;
         }
         const plainSenseId = this.indexer.extractPlainSenseId(file.metadata.sense_id);
         if (!plainSenseId) {
             new Notice('Не удалось извлечь sense_id для поиска.');
             return;
         }
         const notice = new Notice('Ищу похожие файлы...', 0);
         try {
             const similarFiles = await this.indexer.findSimilarFiles(plainSenseId);
             notice.hide();
             if (similarFiles.length === 0) {
                 new Notice('Похожие файлы не найдены.');
             } else {
                 new SimilarFilesModal(this.app, file.path.split('/').pop() || '', similarFiles).open();
             }
         } catch (error) {
             notice.hide();
             new Notice(`Ошибка поиска: ${error.message}`);
         }
     }
 
     private async acceptAllSuggestions() {
         const filesToProcess = Array.from(this.selectedFiles)
             .map(path => this.allVaultFiles.find(f => f.path === path))
             .filter((f): f is IndexedFile => !!f && !!f.metadata?.suggested_path);
             
         if (filesToProcess.length === 0) {
             new Notice('Не выбрано файлов с предложениями.');
             return;
         }
         for (const file of filesToProcess) {
             await this.acceptSuggestion(file);
         }
         new Notice(`Обработано ${filesToProcess.length} предложений.`);
     }
 
     private async deleteSelected() {
         if (this.selectedFiles.size === 0) {
             new Notice('Файлы не выбраны.');
             return;
         }
         if (!confirm(`Вы уверены, что хотите удалить ${this.selectedFiles.size} файлов?`)) {
             return;
         }
         let deletedCount = 0;
         for (const path of this.selectedFiles) {
             const file = this.app.vault.getAbstractFileByPath(path);
             if (file instanceof TFile) {
                 await this.app.vault.trash(file, true);
                 deletedCount++;
             }
         }
         
         this.allVaultFiles = this.allVaultFiles.filter(f => !this.selectedFiles.has(f.path));
         this.selectedFiles.clear();
         new Notice(`Удалено ${deletedCount} файлов.`);
         this.applyFiltersAndRender();
     }
     
     private async acceptSuggestion(file: IndexedFile) {
         const suggestedPath = file.metadata?.suggested_path;
         if (!suggestedPath) return;
         
         const targetFile = this.app.vault.getAbstractFileByPath(file.path);
         if (!(targetFile instanceof TFile)) {
             new Notice(`Файл не найден: ${file.path}`);
             return;
         }
 
         const newPath = `${suggestedPath}/${targetFile.name}`;
         try {
             if (!await this.app.vault.adapter.exists(suggestedPath)) {
                 await this.app.vault.createFolder(suggestedPath);
             }
             await this.app.fileManager.renameFile(targetFile, newPath);
             
             this.allVaultFiles = this.allVaultFiles.filter(f => f.path !== file.path);
             this.selectedFiles.delete(file.path);
             
             setTimeout(async () => {
                 const movedFile = this.app.vault.getAbstractFileByPath(newPath);
                 if (movedFile instanceof TFile) {
                     await this.app.fileManager.processFrontMatter(movedFile, fm => delete fm.suggested_path);
                 }
             }, 500);
 
             new Notice(`Файл перемещен в ${suggestedPath}`);
             this.applyFiltersAndRender();
         } catch (error) {
             new Notice(`Ошибка перемещения: ${error.message}`);
             console.error(error);
         }
     }
 
     private async rejectSuggestion(file: IndexedFile) {
         const targetFile = this.app.vault.getAbstractFileByPath(file.path);
         if (!(targetFile instanceof TFile)) {
             new Notice(`Файл не найден: ${file.path}`);
             return;
         }
         
         await this.app.fileManager.processFrontMatter(targetFile, fm => delete fm.suggested_path);
         
         const cachedFile = this.allVaultFiles.find(f => f.path === file.path);
         if (cachedFile?.metadata) {
             delete cachedFile.metadata.suggested_path;
         }
         
         new Notice(`Предложение для ${targetFile.basename} отклонено.`);
         this.applyFiltersAndRender();
     }
 
     private addStyles() {
         const styleId = 'vait-browser-styles'; if (document.getElementById(styleId)) return;
         const style = document.createElement('style'); style.id = styleId;
         style.textContent = `
             .vait-visual-browser .view-header { padding-block: 0 !important; }
             .vait-visual-browser { display: flex; flex-direction: column; height: 100%; }
             .vnb-filters { padding: 5px 10px; background: var(--background-secondary); border-bottom: 1px solid var(--background-modifier-border); display: flex; flex-wrap: wrap; gap: 10px; align-items: center; justify-content: space-between; }
             .vnb-filters .setting-item { padding: 0; border: none; }
             .vnb-filters .setting-item-info { display: none; }
             .vnb-filter-group-left, .vnb-filter-group-right { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
             .vnb-view-mode-toggle .setting-item-control { display: flex; gap: 5px; }
 
             .vnb-note-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1rem; padding: 1rem; overflow-y: auto; flex: 1; }
             .vnb-note-card { background-color: var(--background-secondary); border-radius: 8px; padding: 1rem; cursor: pointer; display: flex; flex-direction: column; justify-content: space-between; gap: 0.75rem; border: 1px solid var(--background-modifier-border); transition: all 0.2s ease; }
             .vnb-note-card:hover { border-color: var(--interactive-accent); }
             .vnb-note-card.is-selected { border-color: var(--interactive-accent); box-shadow: 0 0 0 2px var(--interactive-accent); }
             
             .vnb-card-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
             .vnb-checkbox { position: static; flex-shrink: 0; margin-top: 2px; }
             .vnb-card-header h3 { flex-grow: 1; margin: 0; font-size: 1.1em; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
 
             .vnb-summary { font-size: 0.9em; color: var(--text-muted); margin: 0; font-style: italic; max-height: 100px; overflow: hidden; }
             .vnb-meta-panel { display: flex; flex-wrap: wrap; gap: 0.5rem; }
             .vnb-tag { background-color: var(--background-modifier-border); color: var(--text-muted); padding: 2px 8px; border-radius: 12px; font-size: 0.8em; }
             .vnb-tag.vnb-clickable { cursor: pointer; transition: background-color 0.2s ease; }
             .vnb-tag.vnb-clickable:hover { background-color: var(--background-modifier-hover); }
             .vnb-quality-tag { background-color: #f5a623; color: white; }
             .vnb-sorter-panel { margin-top: 0.75rem; padding: 0.75rem; background-color: var(--background-primary); border-radius: 6px; font-size: 0.9em; }
             .vnb-sorter-panel strong { color: var(--text-accent); }
             .vnb-button-group { display: flex; gap: 0.5rem; margin-top: 0.5rem; }
             .vnb-button-group button { flex: 1; }
 
             .vnb-note-feed { display: flex; flex-direction: column; gap: 0.5rem; padding: 1rem; overflow-y: auto; flex: 1; }
             .vnb-feed-item { background-color: var(--background-secondary); border-radius: 6px; border: 1px solid var(--background-modifier-border); padding: 0.75rem; transition: all 0.2s ease; }
             .vnb-feed-item.is-selected { border-color: var(--interactive-accent); }
             .vnb-feed-main { display: flex; align-items: flex-start; gap: 1rem; }
             .vnb-feed-main .vnb-checkbox { position: static; margin-top: 5px; }
             .vnb-feed-text { flex: 1; }
             .vnb-feed-text h3 { margin: 0; cursor: pointer; }
             .vnb-feed-text h3:hover { color: var(--text-accent); }
             .vnb-feed-actions { margin-left: auto; }
             .vnb-expanded-content { display: none; margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--background-modifier-border); }
             .vnb-feed-item.is-expanded .vnb-expanded-content { display: block; }
 
             .vnb-bulk-actions { padding: 5px 10px; border-top: 1px solid var(--background-modifier-border); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 10px; }
             .vnb-bulk-buttons { display: flex; justify-content: space-between; align-items: center; flex-grow: 1; }
             .vnb-bulk-group { display: flex; gap: 10px; align-items: center; }
             .vnb-bulk-group .setting-item { padding: 0; border: none; }
             .vnb-bulk-group .setting-item-info { display: none; }
             .vnb-stats { font-size: 0.9em; color: var(--text-muted); }
             .vnb-load-more { width: 100%; grid-column: 1 / -1; margin-top: 1rem; }
             .vnb-note-feed .vnb-load-more { grid-column: auto; }
             .vait-quality-score-value { margin-left: 10px; font-weight: bold; min-width: 50px; text-align: center; }
         `; document.head.appendChild(style);
     }
 }