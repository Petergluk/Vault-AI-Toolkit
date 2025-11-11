// vault-ai-toolkit/src/settings.ts
 // v9.9.0 @ 2025-09-20 12:00:00

 /**
  * @file settings.ts
  * @description Управляет UI настроек, определяет все типы данных и предоставляет стандартные значения.
  * @module settings
  * 
  * @changelog
  * - 9.9.0 (2025-09-20): [UX/REFACTOR] Implemented real-time YAML validation for the 'qualityScale' setting. Added comprehensive JSDoc comments and a standard file header.
  * - 9.8.0 (2025-09-19): [UX/STABILITY] Added a configurable API delay setting (`apiDelayMs`).
  * - 9.7.0 (2025-09-18): [FEATURE] Added UI setting for embedding model selection.
  */
 
 import { App, PluginSettingTab, Setting, Modal, Notice, parseYaml } from 'obsidian';
 import SemanticLocusAI from './main';
 import { DEFAULT_PROMPTS, DEFAULT_CONTENT_TYPES, DEFAULT_STATUSES, DEFAULT_PROJECTS } from './defaults';
 
 // Interfaces
 /**
  * @interface DictionaryItem
  * @description Represents a single item in a taxonomy dictionary (e.g., a content type or status).
  */
 export interface DictionaryItem { id: string; name: string; description: string; }
 
 /**
  * @interface PromptItem
  * @description Represents a complete AI prompt, including system instructions and a user template.
  */
 export interface PromptItem { id: string; name: string; model: string; system_prompt: string; user_prompt_template: string; }
 
 export type GeminiModel = 'gemini-2.5-pro' | 'gemini-2.5-flash';
 export type EmbeddingModel = 'gemini-embedding-001' | 'gemini-embedding-exp-03-07';
 
 /**
  * @interface GenerationConfig
  * @description Configuration options for the Gemini API text generation.
  */
 export interface GenerationConfig {
     temperature: number;
     topP: number;
     maxOutputTokens: number;
 }
 
 /**
  * @interface VaultAIToolkitSettings
  * @description Defines the shape of the entire settings object for the plugin.
  */
 export interface VaultAIToolkitSettings {
     ollamaEnabled: boolean;
     ollamaEndpoint: string;
     excludeFolders: string[];
     contentTypes: DictionaryItem[];
     statuses: DictionaryItem[];
     projects: DictionaryItem[];
     coreTags: string;
     qualityScale: string;
     rubricator: any;
     prompts: PromptItem[];
     batchSize: number;
     maxBatchSizeInChars: number;
     skipProcessedFiles: boolean;
     minFileSize: number;
     categorizeWithFullText: boolean;
     apiDelayMs: number;
     modelRoles: {
         enrichment: GeminiModel;
         synthesis: GeminiModel;
         local: string;
     };
     embeddingModel: EmbeddingModel;
     generationConfig: GenerationConfig;
     browserNotesPerPage: number;
     browserDefaultSortOrder: 'path' | 'size' | 'created' | 'modified' | 'quality_score';
     backupEnabled: boolean;
     backupLocation: string;
     backupKeepDays: number;
     usageStatistics: {
         date: string;
         geminiRequests: number;
         tokensUsed: number;
         filesProcessedLocally: number;
     };
     yamlMigrationCompleted: boolean;
     debugModeEnabled: boolean;
     [key: string]: any;
 }
 
 export const DEFAULT_SETTINGS: VaultAIToolkitSettings = {
     ollamaEnabled: false,
     ollamaEndpoint: 'http://localhost:11434',
     excludeFolders: ['.obsidian', '.trash', '_archive'],
     
     contentTypes: DEFAULT_CONTENT_TYPES,
     statuses: DEFAULT_STATUSES,
     projects: DEFAULT_PROJECTS,
     coreTags: 'осознанность, смысл, поток, состояние, сознание, восприятие, внимание, эго, ценности, потребности, выбор, воля, свобода, любовь, жизнь, смерть, время, реальность, пустота, ответственность, баланс, ритм, энергия, практика, медитация, дыхание, движение, танец, массаж, коучинг, терапия, психология, философия, духовность, дзен, даосизм, буддизм, нно, випассана, нейропоинг, процессуальный_подход, нарративная_практика, сказкотерапия, тело, телесность, соматика, эмбодимент, психосоматика, эмоции, чувства, травма, отношения, семья, дети, сообщество, деньги, творчество, музыка, маркетинг, коммуникация, конфликт, успех, питание, зависимость',
     qualityScale: `
 levels:
   1:
     level_name: "Неактуальное"
     description: "Заметка имевшая смысл когда-то, или утратившая контекст, подпись к видео в фб, поздравление, сообщение о том что я приезжаю в мск, etc."
   2:
     level_name: "Фрагмент"
     description: "Сырая мысль, цитата, техническая заметка. Не несет самостоятельной ценности вне контекста."
   3:
     level_name: "Сиюминутное"
     description: "Личные заметки, бытовые наблюдения, технические списки. Ценность в основном для автора в момент времени (например, список вариантов для нейминга)."
   4:
     level_name: "Набросок"
     description: "Неструктурированная мысль, черновик, личный опыт, дневниковая запись. Полезна для автора, но требует доработки для аудитории."
   5:
     level_name: "Рефлексия"
     description: "Личная рефлексия или история, имеющая эмоциональную или ситуативную ценность. Интересно, но сильно привязано к контексту автора."
   6:
     level_name: "Рабочий материал"
     description: "Структурированный черновик, текст с четкой идеей, но неоконченный, требующий редактуры и стилистической доработки."
   7:
     level_name: "Статья"
     description: "Хорошо написанный, структурированный и ясный текст, который несет ценность для читателя. Готов к использованию."
   8:
     level_name: "Инсайт"
     description: "Текст, содержащий глубокое прозрение, синтез идей, уникальную модель или мощную практику. Обладает высокой ценностью для аудитории."
   9:
     level_name: "Ключевой текст"
     description: "Глубокий и проработанный текст, являющийся ядром проекта или важной самостоятельной работой."
   10:
     level_name: "Нетленное"
     description: "Фундаментальная работа, которая лежит в основе мировоззрения автора. Сохраняет актуальность вне времени и контекста."
 `,
     rubricator: { name: "Не импортирован", structure: [] },
     prompts: DEFAULT_PROMPTS,
     
     batchSize: 10,
     maxBatchSizeInChars: 100000,
     skipProcessedFiles: true,
     minFileSize: 50,
     categorizeWithFullText: false,
     apiDelayMs: 1100,
 
     modelRoles: {
         enrichment: 'gemini-2.5-flash',
         synthesis: 'gemini-2.5-pro',
         local: 'llama3'
     },
     embeddingModel: 'gemini-embedding-001',
 
     generationConfig: {
         temperature: 0.5,
         topP: 0.95,
         maxOutputTokens: 8192,
     },
 
     browserNotesPerPage: 50,
     browserDefaultSortOrder: 'path',
 
     backupEnabled: true,
     backupLocation: '.backups/semantic-locus-ai',
     backupKeepDays: 7,
 
     usageStatistics: {
         date: new Date().toISOString().slice(0, 10),
         geminiRequests: 0,
         tokensUsed: 0,
         filesProcessedLocally: 0,
     },
     yamlMigrationCompleted: false,
     debugModeEnabled: false,
 };
 
 /**
  * @class VaultAIToolkitSettingTab
  * @description Renders the plugin's settings page with multiple tabs.
  */
 export class VaultAIToolkitSettingTab extends PluginSettingTab {
 	plugin: SemanticLocusAI;
 
 	constructor(app: App, plugin: SemanticLocusAI) {
 		super(app, plugin);
 		this.plugin = plugin;
 	}
 
 	display(): void {
 		const { containerEl } = this;
 		containerEl.empty();
 		containerEl.createEl('h2', { text: 'Настройки Semantic Locus AI' });
         
         const tabContainer = containerEl.createDiv('slai-settings-tabs');
         const contentContainer = containerEl.createDiv('slai-settings-content');
 
         const tabs: Record<string, (el: HTMLElement) => void> = {
             'Общие и API': (el) => this.renderGeneralTab(el),
             'Таксономия': (el) => this.renderTaxonomyTab(el),
             'Промпты': (el) => this.renderPromptsTab(el),
         };
         
         let firstTab = true;
         for (const tabName in tabs) {
             const tabButton = tabContainer.createEl('button', { text: tabName, cls: 'slai-tab-button' });
             const tabContent = contentContainer.createDiv({ cls: `slai-tab-content` });
             if (firstTab) {
                 tabButton.addClass('active');
                 tabContent.addClass('active');
                 firstTab = false;
             }
             tabButton.onClickEvent(() => {
                 tabContainer.findAll('.slai-tab-button').forEach(btn => btn.removeClass('active'));
                 contentContainer.findAll('.slai-tab-content').forEach(content => content.removeClass('active'));
                 tabButton.addClass('active');
                 tabContent.addClass('active');
             });
             tabs[tabName](tabContent);
         }
         this.addTabStyles();
 	}
 
     private addTooltip(setting: Setting, text: string) {
         setting.nameEl.createEl('div', { text: '?', cls: 'slai-tooltip-icon' }).setAttribute('aria-label', text);
     }
 
     private renderGeneralTab(containerEl: HTMLElement) {
         containerEl.createEl('h3', { text: 'Cloud AI (Gemini)' });
        // FIX: Removed API key setting from UI to comply with guidelines.
         new Setting(containerEl).setName('Настройка Gemini API').setDesc('Ключ Gemini API теперь должен быть установлен через переменную окружения `API_KEY`. Этот плагин будет автоматически использовать его. Пользовательский интерфейс для ввода ключа был удален в соответствии с лучшими практиками безопасности.');
         
         containerEl.createEl('h4', { text: 'Назначение моделей по ролям' });
         const enrichmentSetting = new Setting(containerEl).setName('Модель для анализа и обогащения').setDesc('Быстрая и дешевая модель для массовой обработки.').addDropdown(dd => dd
             .addOption('gemini-2.5-flash', 'Gemini 2.5 Flash')
             .addOption('gemini-2.5-pro', 'Gemini 2.5 Pro')
             .setValue(this.plugin.settings.modelRoles.enrichment)
             .onChange(async (value: GeminiModel) => { this.plugin.settings.modelRoles.enrichment = value; await this.plugin.saveSettings(); }));
         this.addTooltip(enrichmentSetting, 'Эта модель будет использоваться по умолчанию для анализа и добавления метаданных в ваши заметки.');
 
         const synthesisSetting = new Setting(containerEl).setName('Модель для синтеза дубликатов').setDesc('Мощная модель для качественного объединения текстов.').addDropdown(dd => dd
             .addOption('gemini-2.5-pro', 'Gemini 2.5 Pro')
             .addOption('gemini-2.5-flash', 'Gemini 2.5 Flash')
             .setValue(this.plugin.settings.modelRoles.synthesis)
             .onChange(async (value: GeminiModel) => { this.plugin.settings.modelRoles.synthesis = value; await this.plugin.saveSettings(); }));
         this.addTooltip(synthesisSetting, 'Эта модель будет использоваться для сложных задач, таких как слияние нескольких похожих заметок в одну.');
 
         const embeddingSetting = new Setting(containerEl)
             .setName('Модель для семантического поиска (Sense_ID)')
             .setDesc('Модель для создания "смыслового отпечатка" файла.')
             .addDropdown(dd => dd
                 .addOption('gemini-embedding-001', 'gemini-embedding-001 (Stable)')
                 .addOption('gemini-embedding-exp-03-07', 'gemini-embedding-exp-03-07 (Experimental)')
                 .setValue(this.plugin.settings.embeddingModel)
                 .onChange(async (value: EmbeddingModel) => {
                     this.plugin.settings.embeddingModel = value;
                     await this.plugin.saveSettings();
                 }));
         this.addTooltip(embeddingSetting, 'Stable - надежная и проверенная модель. Experimental - новейшая модель, потенциально более качественная, но может быть нестабильной.');
 
         containerEl.createEl('h4', { text: 'Generation Parameters' });
         const tempSetting = new Setting(containerEl).setName('Temperature').addSlider(slider => slider.setLimits(0, 2, 0.1).setValue(this.plugin.settings.generationConfig.temperature).setDynamicTooltip().onChange(async (value) => { this.plugin.settings.generationConfig.temperature = value; await this.plugin.saveSettings(); }));
         this.addTooltip(tempSetting, 'Контролирует случайность ответа. Низкие значения (e.g., 0.2) делают ответ более предсказуемым, высокие (e.g., 1.8) — более креативным.');
         const topPSetting = new Setting(containerEl).setName('Top-P').addSlider(slider => slider.setLimits(0, 1, 0.05).setValue(this.plugin.settings.generationConfig.topP).setDynamicTooltip().onChange(async (value) => { this.plugin.settings.generationConfig.topP = value; await this.plugin.saveSettings(); }));
         this.addTooltip(topPSetting, 'Альтернативный способ контроля случайности. Рекомендуется изменять либо Temperature, либо Top-P, но не оба сразу.');
         const maxTokensSetting = new Setting(containerEl).setName('Token limit').addText(text => text.setValue(String(this.plugin.settings.generationConfig.maxOutputTokens)).onChange(async (value) => { this.plugin.settings.generationConfig.maxOutputTokens = Number(value) || 8192; await this.plugin.saveSettings(); }));
         this.addTooltip(maxTokensSetting, 'Максимальное количество токенов, которое модель может сгенерировать в одном ответе. Увеличьте, если получаете обрезанные ответы.');
 
         containerEl.createEl('h3', { text: 'Local AI (Ollama)' });
         new Setting(containerEl).setName('Включить поддержку Ollama').setDesc('Использовать локальные модели для некоторых задач, если они доступны.').addToggle(toggle => toggle.setValue(this.plugin.settings.ollamaEnabled).onChange(async (value) => { this.plugin.settings.ollamaEnabled = value; await this.plugin.saveSettings(); this.display(); }));
         if (this.plugin.settings.ollamaEnabled) {
             new Setting(containerEl).setName('Ollama Endpoint').setDesc('Адрес вашего локального сервера Ollama.').addText(text => text.setPlaceholder('http://localhost:11434').setValue(this.plugin.settings.ollamaEndpoint).onChange(async (value) => { this.plugin.settings.ollamaEndpoint = value; await this.plugin.saveSettings(); }));
         }
 
         containerEl.createEl('h3', { text: 'Processing Settings' });
         const batchSizeSetting = new Setting(containerEl).setName('Batch Size').setDesc('Макс. кол-во файлов в одном запросе к API.').addSlider(slider => slider.setLimits(1, 50, 1).setValue(this.plugin.settings.batchSize).setDynamicTooltip().onChange(async (value) => { this.plugin.settings.batchSize = value; await this.plugin.saveSettings(); }));
         this.addTooltip(batchSizeSetting, 'Ограничивает количество файлов, отправляемых в одном пакете. Итоговый размер пакета также ограничен настройкой "Maximum Batch Size".');
         
         const maxBatchSizeSetting = new Setting(containerEl).setName('Maximum Batch Size (characters)').setDesc('Макс. суммарный размер текстов в одном пакете.').addText(text => text.setValue(String(this.plugin.settings.maxBatchSizeInChars)).onChange(async (value) => { this.plugin.settings.maxBatchSizeInChars = Number(value) || 150000; await this.plugin.saveSettings(); }));
         this.addTooltip(maxBatchSizeSetting, 'Предотвращает ошибки, связанные с превышением лимита контекста модели. Пакет будет сформирован, не превышая это значение, даже если количество файлов меньше "Batch Size".');
 
         new Setting(containerEl).setName('Skip Processed Files').setDesc('Пропускать файлы, у которых уже есть метаданные.').addToggle(toggle => toggle.setValue(this.plugin.settings.skipProcessedFiles).onChange(async (value) => { this.plugin.settings.skipProcessedFiles = value; await this.plugin.saveSettings(); }));
         new Setting(containerEl).setName('Minimum File Size').setDesc('Пропускать файлы меньше указанного размера (в символах).').addText(text => text.setValue(String(this.plugin.settings.minFileSize)).onChange(async (value) => { this.plugin.settings.minFileSize = Number(value) || 0; await this.plugin.saveSettings(); }));
         
         const categorizeSetting = new Setting(containerEl).setName('Категоризация по полному тексту').addToggle(toggle => toggle.setValue(this.plugin.settings.categorizeWithFullText).onChange(async (value) => { this.plugin.settings.categorizeWithFullText = value; await this.plugin.saveSettings(); }));
         this.addTooltip(categorizeSetting, 'Если включено, для определения категории (suggested_path) будет отправляться полный текст файла. Если отключено (по умолчанию), будут отправляться только его резюме и теги, что быстрее и дешевле.');
 
         const apiDelaySetting = new Setting(containerEl)
             .setName('Задержка между запросами к API (мс)')
             .addText(text => text.setValue(String(this.plugin.settings.apiDelayMs)).onChange(async (value) => {
                 this.plugin.settings.apiDelayMs = Number(value) || 1100;
                 await this.plugin.saveSettings();
             }));
         this.addTooltip(apiDelaySetting, 'Пауза для предотвращения превышения лимитов Google API (60 запросов в минуту для бесплатного тарифа). Увеличьте, если получаете ошибки 429.');
 
         new Setting(containerEl).setName('Исключенные папки').setDesc('Папки, которые следует игнорировать (через запятую).').addTextArea(text => text.setValue(this.plugin.settings.excludeFolders.join(', ')).onChange(async (value) => { this.plugin.settings.excludeFolders = value.split(',').map(f => f.trim()).filter(Boolean); await this.plugin.saveSettings(); }));
 
         containerEl.createEl('h3', { text: 'Visual Browser Settings' });
         new Setting(containerEl).setName('Notes Per Page').setDesc('Number of notes to display per page').addSlider(slider => slider.setLimits(10, 200, 10).setValue(this.plugin.settings.browserNotesPerPage).setDynamicTooltip().onChange(async (value) => { this.plugin.settings.browserNotesPerPage = value; await this.plugin.saveSettings(); }));
         new Setting(containerEl).setName('Default Sort Order').setDesc('Default sorting for Visual Browser').addDropdown(dropdown => dropdown
             .addOption('path', 'File Path')
             .addOption('size', 'Size')
             .addOption('created', 'Creation Date')
             .addOption('modified', 'Modification Date')
             .addOption('quality_score', 'Quality Score')
             .setValue(this.plugin.settings.browserDefaultSortOrder)
             .onChange(async (value: any) => { this.plugin.settings.browserDefaultSortOrder = value; await this.plugin.saveSettings(); }));
 
         containerEl.createEl('h3', { text: 'Отладка' });
         new Setting(containerEl)
             .setName('Режим отладки')
             .setDesc('Логировать все запросы и ответы к AI в файл debug.log.md в папке плагина.')
             .addToggle(toggle => toggle
                 .setValue(this.plugin.settings.debugModeEnabled)
                 .onChange(async (value) => {
                     this.plugin.settings.debugModeEnabled = value;
                     await this.plugin.saveSettings();
                 }));
 
         containerEl.createEl('h3', { text: 'Usage Statistics (Today)' });
         const stats = this.plugin.settings.usageStatistics;
         new Setting(containerEl).setName('Gemini Requests').setDesc(`${stats.geminiRequests}`);
         new Setting(containerEl).setName('Tokens Used').setDesc(`${stats.tokensUsed}`);
         new Setting(containerEl).setName('Files Processed Locally').setDesc(`${stats.filesProcessedLocally}`);
     }
 
     private renderTaxonomyTab(containerEl: HTMLElement) {
         this.renderDictionarySection(containerEl, 'Типы контента', 'contentTypes');
         this.renderDictionarySection(containerEl, 'Статусы', 'statuses');
         this.renderDictionarySection(containerEl, 'Проекты', 'projects');
         
         containerEl.createEl('h3', { text: 'Ядро Тегов' });
         new Setting(containerEl).setDesc('Введите основные теги через запятую.').addTextArea(text => text.setValue(this.plugin.settings.coreTags).onChange(async (value) => { this.plugin.settings.coreTags = value; await this.plugin.saveSettings(); }));
 
         containerEl.createEl('h3', { text: 'Шкала Качества' });
         const qualitySetting = new Setting(containerEl).setDesc('Опишите критерии оценки в формате YAML.').addTextArea(text => {
             text.setValue(this.plugin.settings.qualityScale).onChange(async (value) => {
                 this.plugin.settings.qualityScale = value;
                 try {
                     parseYaml(value);
                     text.inputEl.removeClass('slai-yaml-error');
                     qualitySetting.descEl.setText('Опишите критерии оценки в формате YAML.');
                 } catch (e) {
                     text.inputEl.addClass('slai-yaml-error');
                     qualitySetting.descEl.setText(`Ошибка синтаксиса YAML: ${e.message}`);
                 }
                 await this.plugin.saveSettings();
             });
             text.inputEl.style.height = '150px';
             text.inputEl.style.fontFamily = 'monospace';
         });
 
         containerEl.createEl('h3', { text: 'Рубрикатор' });
         const rubricatorName = this.plugin.settings.rubricator?.name || 'Не импортирован';
         new Setting(containerEl)
             .setName('Структура папок для AI')
             .setDesc(`Текущая активная структура: ${rubricatorName}`)
             .addButton(btn => btn.setButtonText('Импортировать из data/rubricator.yaml').onClick(async () => {
                 const path = `${this.plugin.manifest.dir}/data/rubricator.yaml`;
                 if (!await this.app.vault.adapter.exists(path)) {
                     new Notice(`Файл не найден: ${path}. Убедитесь, что он существует.`);
                     return;
                 }
                 try {
                     const content = await this.app.vault.adapter.read(path);
                     this.plugin.settings.rubricator = parseYaml(content);
                     await this.plugin.saveSettings();
                     new Notice(`Структура "${this.plugin.settings.rubricator.name}" импортирована!`);
                     this.display();
                 } catch (e) {
                     new Notice('Ошибка парсинга rubricator.yaml. Проверьте консоль.');
                     console.error('Ошибка парсинга rubricator.yaml:', e);
                 }
             }));
 
         new Setting(containerEl)
             .setName('Сброс таксономии')
             .setDesc('Восстановить все словари (типы, статусы, проекты), теги и шкалу качества к стандартным значениям. Ваши личные изменения будут утеряны.')
             .addButton(btn => btn
                 .setButtonText('Сбросить таксономию к стандартной')
                 .setWarning()
                 .onClick(async () => {
                     if (confirm('Вы уверены, что хотите сбросить всю таксономию к стандартной? Ваши изменения будут утеряны.')) {
                         this.plugin.settings.contentTypes = DEFAULT_CONTENT_TYPES;
                         this.plugin.settings.statuses = DEFAULT_STATUSES;
                         this.plugin.settings.projects = DEFAULT_PROJECTS;
                         this.plugin.settings.coreTags = DEFAULT_SETTINGS.coreTags;
                         this.plugin.settings.qualityScale = DEFAULT_SETTINGS.qualityScale;
                         await this.plugin.saveSettings();
                         new Notice('Таксономия сброшена к стандартной.');
                         this.display();
                     }
                 }));
     }
     
     private renderDictionarySection(containerEl: HTMLElement, title: string, settingKey: 'contentTypes' | 'statuses' | 'projects') {
         containerEl.createEl('h3', { text: title });
         
         this.plugin.settings[settingKey].forEach((item, index) => {
             new Setting(containerEl)
                 .addText(text => {
                     text.setPlaceholder('ID (нередактируемый)')
                         .setValue(item.id)
                         .setDisabled(true);
                 })
                 .addText(text => text.setPlaceholder('Название').setValue(item.name).onChange(async (value) => { this.plugin.settings[settingKey][index].name = value; await this.plugin.saveSettings(); }))
                 .addText(text => text.setPlaceholder('Описание').setValue(item.description).onChange(async (value) => { this.plugin.settings[settingKey][index].description = value; await this.plugin.saveSettings(); }))
                 .addButton(btn => btn.setIcon('trash').setTooltip('Удалить').setWarning().onClick(async () => { this.plugin.settings[settingKey].splice(index, 1); await this.plugin.saveSettings(); this.display(); }));
         });
 
         new Setting(containerEl).addButton(btn => btn.setButtonText(`Добавить ${title.toLowerCase()}`).onClick(async () => { 
             const newId = `new_${settingKey.slice(0, -1)}_${Date.now()}`;
             this.plugin.settings[settingKey].push({ id: newId, name: 'Новый элемент', description: '' }); 
             await this.plugin.saveSettings(); 
             this.display(); 
         }));
     }
 
     private renderPromptsTab(containerEl: HTMLElement) {
         containerEl.createEl('h3', { text: 'Промпты для AI' });
         
         this.plugin.settings.prompts.forEach((prompt, index) => {
             new Setting(containerEl)
                 .setName(prompt.name)
                 .setDesc(`ID: ${prompt.id} (нередактируемый)`)
                 .addButton(btn => btn.setButtonText('Редактировать').onClick(() => {
                         new PromptEditModal(this.app, prompt, async (updatedPrompt) => {
                             this.plugin.settings.prompts[index] = updatedPrompt;
                             await this.plugin.saveSettings();
                             this.display();
                         }).open();
                     }));
         });
 
         new Setting(containerEl)
             .setName('Сброс промптов')
             .setDesc('Восстановить все промпты к стандартным значениям, поставляемым с плагином. Ваши личные изменения будут утеряны.')
             .addButton(btn => btn
                 .setButtonText('Сбросить промпты к стандартным')
                 .setWarning()
                 .onClick(async () => {
                     if (confirm('Вы уверены, что хотите сбросить все промпты к стандартным? Ваши изменения будут утеряны.')) {
                         this.plugin.settings.prompts = DEFAULT_PROMPTS;
                         await this.plugin.saveSettings();
                         new Notice('Промпты сброшены к стандартным.');
                         this.display();
                     }
                 }));
     }
 
     private addTabStyles() {
         const styleId = 'slai-settings-styles'; if (document.getElementById(styleId)) return;
         const style = document.createElement('style'); style.id = styleId;
         style.textContent = `
             .slai-settings-tabs { display: flex; border-bottom: 1px solid var(--background-modifier-border); margin-bottom: 20px; }
             .slai-tab-button { background: none; border: none; padding: 10px 15px; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
             .slai-tab-button:hover { color: var(--text-normal); }
             .slai-tab-button.active { color: var(--text-accent); border-bottom-color: var(--text-accent); }
             .slai-tab-content { display: none; }
             .slai-tab-content.active { display: block; }
             .slai-prompt-modal .setting-item { flex-direction: column; align-items: flex-start; }
             .slai-prompt-modal textarea { width: 100%; min-height: 150px; }
             .setting-item-description { width: 100%; }
             .slai-tooltip-icon {
                 position: relative;
                 display: inline-block;
                 width: 16px;
                 height: 16px;
                 border-radius: 50%;
                 background-color: var(--text-muted);
                 color: var(--background-primary);
                 text-align: center;
                 font-size: 12px;
                 line-height: 16px;
                 cursor: help;
                 margin-left: 8px;
                 font-weight: bold;
             }
             .slai-tooltip-icon:hover::after {
                 content: attr(aria-label);
                 position: absolute;
                 bottom: 125%;
                 left: 50%;
                 transform: translateX(-50%);
                 background-color: var(--background-secondary);
                 color: var(--text-normal);
                 border: 1px solid var(--background-modifier-border);
                 border-radius: 4px;
                 padding: 8px;
                 font-size: 12px;
                 white-space: pre-wrap;
                 z-index: 10;
                 width: 250px;
                 text-align: left;
                 pointer-events: none;
             }
             .slai-yaml-error {
                 border-color: var(--text-error) !important;
             }
             .setting-item-description { color: var(--text-muted); }
             .slai-yaml-error + .setting-item-description { color: var(--text-error); }
         `; document.head.appendChild(style);
     }
 }
 
 class PromptEditModal extends Modal {
     constructor(app: App, private prompt: PromptItem, private onSave: (prompt: PromptItem) => Promise<void>) { super(app); }
     onOpen() {
         const { contentEl } = this;
         contentEl.addClass('slai-prompt-modal');
         contentEl.createEl('h2', { text: 'Редактировать промпт' });
         new Setting(contentEl).setName('Название').addText(text => text.setValue(this.prompt.name).onChange(v => this.prompt.name = v));
         new Setting(contentEl).setName('ID (нередактируемый)').addText(text => text.setValue(this.prompt.id).setDisabled(true));
         contentEl.createEl('h4', { text: 'Системный промпт' });
         const systemPromptEl = contentEl.createEl('textarea', { text: this.prompt.system_prompt });
         contentEl.createEl('h4', { text: 'Шаблон пользовательского промпта' });
         const userPromptEl = contentEl.createEl('textarea', { text: this.prompt.user_prompt_template });
         new Setting(contentEl).addButton(btn => btn.setButtonText('Сохранить').setCta().onClick(async () => {
             this.prompt.system_prompt = systemPromptEl.value;
             this.prompt.user_prompt_template = userPromptEl.value;
             await this.onSave(this.prompt);
             this.close();
         }));
     }
     onClose() { this.contentEl.empty(); }
 }