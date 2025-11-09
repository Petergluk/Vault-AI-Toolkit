// vault-ai-toolkit/src/DataManager.ts
// v2.3.0 @ 2025-09-20 12:00:00

/**
 * @file DataManager.ts
 * @description Предоставляет централизованный и типизированный доступ к словарям и промптам, хранящимся в `settings`.
 * @module DataManager
 * 
 * @changelog
 * - 2.3.0 (2025-09-20): [REFACTOR] Added standard file header and JSDoc comments for enhanced code clarity and maintainability.
 * - 2.2.0 (2025-09-15): [FEATURE] Added `getProjectsList` to support the new 'Project' taxonomy.
 * - 2.1.0 (2025-09-12): Добавлены геттеры для `qualityScale` и `rubricator`.
 */

import { App } from 'obsidian';
import { VaultAIToolkitSettings, PromptItem } from './settings';

/**
 * @class DataManager
 * @description A service class that acts as an interface to the plugin's settings,
 * providing convenient, memoized access to taxonomies and prompts.
 */
export class DataManager {
    private settings: VaultAIToolkitSettings;

    /**
     * @param app The Obsidian App instance.
     * @param settings The plugin's settings object.
     */
    constructor(app: App, settings: VaultAIToolkitSettings) {
        this.settings = settings;
    }

    /**
     * @returns A list of content type IDs.
     */
    public getContentTypesList(): string[] { return this.settings.contentTypes.map(item => item.id); }

    /**
     * @returns A list of status IDs.
     */
    public getStatusesList(): string[] { return this.settings.statuses.map(item => item.id); }

    /**
     * @returns A list of project IDs.
     */
    public getProjectsList(): string[] { return this.settings.projects.map(item => item.id); }
    
    /**
     * @returns The core tags as a single comma-separated string.
     */
    public getCoreTags(): string { return this.settings.coreTags; }

    /**
     * @returns The quality scale criteria as a YAML string.
     */
    public getQualityScaleCriteria(): string { return this.settings.qualityScale; }
    
    /**
     * @returns The rubricator structure object.
     */
    public getRubricator(): any { return this.settings.rubricator; }

    /**
     * Retrieves a specific prompt configuration by its unique ID.
     * @param id The ID of the prompt to find.
     * @returns The found `PromptItem` or `undefined`.
     */
    public getPromptById(id: string): PromptItem | undefined { return this.settings.prompts.find(p => p.id === id); }
}