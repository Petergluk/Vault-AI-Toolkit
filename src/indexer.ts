// vault-ai-toolkit/src/indexer.ts
 // v2.8.0 @ 2025-09-20 12:00:00
 
 /**
  * @file indexer.ts
  * @description Управляет кэшем метаданных файлов хранилища на диске и в памяти, включая семантические эмбеддинги.
  * @module indexer
  * 
  * @changelog
  * - 2.8.0 (2025-09-20): [REFACTOR] Added standard file header and comprehensive JSDoc comments to the main class, its methods, and exported interfaces.
  * - 2.7.0 (2025-09-18): [FEATURE] Implemented handling for large semantic embedding vectors.
  * - 2.6.0 (2025-09-17): [FEATURE] Added `extractPlainSenseId` helper method.
  */
 
 import { App, TFile, Notice, CachedMetadata } from 'obsidian';
 import { VaultAIToolkitSettings } from './settings';
 
 /**
  * @interface FileMetadata
  * @description Represents the AI-generated metadata stored in a file's frontmatter and the indexer's cache.
  */
 export interface FileMetadata {
     suggested_path?: string;
     tags?: string[];
     content_type?: string;
     status?: string;
     project?: string;
     quality_score?: number;
     sense_id?: string;
     summary?: string;
     embedding?: number[];
     processed_date?: string;
     ai_model?: string;
     category?: string;
 }
 
 /**
  * @interface IndexedFile
  * @description Represents a single file within the vault index, containing its path, stats, and metadata.
  */
 export interface IndexedFile {
     path: string;
     hash: string;
     size: number;
     modified: Date;
     created: Date;
     metadata?: FileMetadata;
     content?: string;
 }
 
 /**
  * @interface VaultIndex
  * @description The structure of the entire vault metadata cache.
  */
 export interface VaultIndex {
     version: string;
     indexed_at: string;
     stats: { total_files: number; with_ai_metadata: number; unique_tags: number; };
     files: IndexedFile[];
     embeddings: Record<string, number[]>; // Maps a plain sense_id to its vector
 }
 
 /**
  * @class VaultIndexer
  * @description Manages the creation, loading, updating, and querying of the vault's metadata cache.
  */
 export class VaultIndexer {
 	private app: App;
 	private settings: VaultAIToolkitSettings;
 	private index: VaultIndex | null = null;
 	private indexPath: string;
 	
 	constructor(app: App, settings: VaultAIToolkitSettings) {
 		this.app = app;
 		this.settings = settings;
         this.indexPath = `${this.app.vault.configDir}/plugins/semantic-locus-ai/metadata_cache.json`;
 	}
 	
     /**
      * Scans the entire vault, re-indexing all markdown files to build a fresh metadata cache.
      * @returns A promise that resolves to the newly created `VaultIndex`.
      */
 	async reindexVault(): Promise<VaultIndex> {
 		console.log('Semantic Locus AI: Начинаю переиндексацию хранилища...');
 		const startTime = Date.now();
 		const files = this.app.vault.getMarkdownFiles();
 		const indexedFiles: IndexedFile[] = [];
         const embeddings: Record<string, number[]> = {};
 		for (const file of files) {
 			if (this.shouldSkipFile(file)) continue;
 			try {
 				const indexed = await this.indexFile(file);
                 if (indexed) {
 				    indexedFiles.push(indexed);
                     if (indexed.metadata?.sense_id && indexed.metadata?.embedding) {
                         const plainSenseId = this.extractPlainSenseId(indexed.metadata.sense_id) || indexed.metadata.sense_id;
                         embeddings[plainSenseId] = indexed.metadata.embedding;
                         delete indexed.metadata.embedding;
                     }
                 }
 			} catch (error) {
 				console.error(`[Indexer] Критическая ошибка при индексации ${file.path}:`, error);
 			}
 		}
 		const stats = this.calculateStats(indexedFiles);
 		this.index = {
 			version: '2.8.0',
 			indexed_at: new Date().toISOString(),
 			stats,
 			files: indexedFiles,
             embeddings: this.index?.embeddings || embeddings
 		};
 		await this.saveIndex();
 		const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
 		console.log(`Semantic Locus AI: Индексация завершена. Обработано ${indexedFiles.length} файлов за ${elapsed}с`);
 		return this.index;
 	}
 
     /**
      * Creates an `IndexedFile` object for a single TFile.
      * @param file The `TFile` to index.
      * @returns A promise resolving to an `IndexedFile` object or null if parsing fails.
      */
 	async indexFile(file: TFile): Promise<IndexedFile | null> {
         try {
             const content = await this.app.vault.cachedRead(file);
             const cache = this.app.metadataCache.getFileCache(file);
             const metadata = this.extractMetadata(cache);
             
             const hash = this.calculateHash(content);
             return { path: file.path, hash, size: content.length, modified: new Date(file.stat.mtime), created: new Date(file.stat.ctime), metadata, content: content.slice(0, 1000) };
         } catch (e) {
             if (e.name === 'YAMLParseError') {
                 console.warn(`[Indexer] Пропущен файл с некорректным YAML: ${file.path}. Ошибка: ${e.message}`);
                 return null;
             } else {
                 console.error(`[Indexer] Не удалось проиндексировать файл ${file.path}:`, e);
                 throw e;
             }
         }
 	}
 
     private extractMetadata(cache: CachedMetadata | null): FileMetadata | undefined {
         const fm = cache?.frontmatter;
         if (!fm) return undefined;
         const metadata: FileMetadata = {
             suggested_path: fm.suggested_path,
             tags: this.normalizeTags(fm.tags),
             content_type: fm.content_type,
             status: fm.status,
             project: fm.project,
             quality_score: typeof fm.quality_score === 'number' ? fm.quality_score : undefined,
             sense_id: fm.sense_id,
             summary: fm.summary,
             processed_date: fm.processed_date,
             ai_model: fm.ai_model
         };
         Object.keys(metadata).forEach(key => { if (metadata[key as keyof FileMetadata] === undefined || metadata[key as keyof FileMetadata] === null) { delete metadata[key as keyof FileMetadata]; } });
         return Object.keys(metadata).length > 0 ? metadata : undefined;
     }
 	
     /**
      * Updates the metadata for a specific file in the index and saves the changes.
      * @param filePath The path of the file to update.
      * @param metadata The new metadata to merge with existing data.
      */
 	async updateFileMetadata(filePath: string, metadata: FileMetadata): Promise<void> {
 		if (!this.index) await this.loadIndex();
 		if (!this.index) throw new Error('Не удалось загрузить индекс для обновления.');
 		
         const fileIndex = this.index.files.findIndex(f => f.path === filePath);
 		
         if (metadata.sense_id && metadata.embedding) {
             const plainSenseId = this.extractPlainSenseId(metadata.sense_id) || metadata.sense_id;
             this.index.embeddings[plainSenseId] = metadata.embedding;
             delete metadata.embedding;
         }
 
         if (fileIndex !== -1) { 
             this.index.files[fileIndex].metadata = { ...this.index.files[fileIndex].metadata, ...metadata }; 
         } else { 
             const file = this.app.vault.getAbstractFileByPath(filePath) as TFile; 
             if (file) { 
                 const newIndexedFile = await this.indexFile(file); 
                 if (newIndexedFile) { 
                     newIndexedFile.metadata = metadata; 
                     this.index.files.push(newIndexedFile); 
                 } 
             } 
         }
 
 		this.index.stats = this.calculateStats(this.index.files);
 		await this.saveIndex();
 	}
 
     /**
      * Finds files semantically similar to a given sense_id by comparing embedding vectors.
      * @param senseId The sense_id (can be a markdown link or plain) of the source file.
      * @param threshold The minimum cosine similarity score to be considered a match.
      * @param topN The maximum number of similar files to return.
      * @returns A promise resolving to a sorted array of similar files and their similarity scores.
      */
 	async findSimilarFiles(senseId: string, threshold: number = 0.75, topN: number = 10): Promise<Array<{file: IndexedFile, similarity: number}>> {
 		if (!this.index) await this.loadIndex();
         const plainSenseId = this.extractPlainSenseId(senseId) || senseId;
         
         if (!this.index || !this.index.embeddings[plainSenseId]) { return []; }
 		
         const targetVector = this.index.embeddings[plainSenseId];
 		const similarities: Array<{file: IndexedFile, similarity: number}> = [];
 		
         for (const file of this.index.files) {
 			if (!file.metadata?.sense_id) continue;
             const candidateSenseId = this.extractPlainSenseId(file.metadata.sense_id) || file.metadata.sense_id;
             if (candidateSenseId === plainSenseId) continue;
 
             const candidateVector = this.index.embeddings[candidateSenseId];
 			if (!candidateVector) continue;
 
 			const similarity = this.cosineSimilarity(targetVector, candidateVector);
 			if (similarity >= threshold) { similarities.push({ file, similarity }); }
 		}
 		similarities.sort((a, b) => b.similarity - a.similarity);
 		return similarities.slice(0, topN);
 	}
     
     /**
      * Finds groups of semantically similar files (duplicates) across the entire vault.
      * @param threshold The cosine similarity threshold to group files.
      * @returns A promise resolving to an array of duplicate groups.
      */
     public async findDuplicateGroups(threshold: number): Promise<Array<{files: IndexedFile[], averageSimilarity: number}>> {
         if (!this.index) await this.loadIndex();
         if (!this.index) return [];
 
         const notice = new Notice('Сравниваю файлы... Это может занять некоторое время.', 0);
         
         const filesWithEmbeddings = this.index.files.filter(f => {
             if (!f.metadata?.sense_id) return false;
             const plainId = this.extractPlainSenseId(f.metadata.sense_id);
             return !!plainId && !!this.index?.embeddings[plainId];
         });
         
         const groups: Map<string, Set<string>> = new Map();
         const similarities: Map<string, number> = new Map();
 
         for (let i = 0; i < filesWithEmbeddings.length; i++) {
             for (let j = i + 1; j < filesWithEmbeddings.length; j++) {
                 const file1 = filesWithEmbeddings[i];
                 const file2 = filesWithEmbeddings[j];
 
                 const id1 = this.extractPlainSenseId(file1.metadata!.sense_id!)!;
                 const id2 = this.extractPlainSenseId(file2.metadata!.sense_id!)!;
 
                 const vec1 = this.index.embeddings[id1];
                 const vec2 = this.index.embeddings[id2];
                 
                 if (!vec1 || !vec2) continue;
 
                 const similarity = this.cosineSimilarity(vec1, vec2);
                 if (similarity >= threshold) {
                     const key = `${file1.path}|${file2.path}`;
                     similarities.set(key, similarity);
                     
                     let group1 = groups.get(file1.path);
                     let group2 = groups.get(file2.path);
 
                     if (!group1 && !group2) {
                         const newGroup = new Set([file1.path, file2.path]);
                         groups.set(file1.path, newGroup);
                         groups.set(file2.path, newGroup);
                     } else if (group1 && !group2) {
                         group1.add(file2.path);
                         groups.set(file2.path, group1);
                     } else if (!group1 && group2) {
                         group2.add(file1.path);
                         groups.set(file1.path, group2);
                     } else if (group1 && group2 && group1 !== group2) {
                         group2.forEach(path => {
                             group1!.add(path);
                             groups.set(path, group1!);
                         });
                     }
                 }
             }
         }
         notice.hide();
 
         const uniqueGroups = new Set(groups.values());
         const result: Array<{files: IndexedFile[], averageSimilarity: number}> = [];
 
         uniqueGroups.forEach(groupPaths => {
             const groupFiles = Array.from(groupPaths).map(path => filesWithEmbeddings.find(f => f.path === path)!);
             let totalSimilarity = 0;
             let count = 0;
             const paths = Array.from(groupPaths);
             for (let i = 0; i < paths.length; i++) {
                 for (let j = i + 1; j < paths.length; j++) {
                     const key1 = `${paths[i]}|${paths[j]}`;
                     const key2 = `${paths[j]}|${paths[i]}`;
                     const sim = similarities.get(key1) || similarities.get(key2) || 0;
                     totalSimilarity += sim;
                     count++;
                 }
             }
             const averageSimilarity = count > 0 ? totalSimilarity / count : 0;
             result.push({ files: groupFiles, averageSimilarity });
         });
 
         return result.sort((a, b) => b.averageSimilarity - a.averageSimilarity);
     }
     
 	private cosineSimilarity(vecA: number[], vecB: number[]): number {
 		if (vecA.length !== vecB.length) return 0;
 		let dotProduct = 0; let normA = 0; let normB = 0;
 		for (let i = 0; i < vecA.length; i++) { dotProduct += vecA[i] * vecB[i]; normA += vecA[i] * vecA[i]; normB += vecB[i] * vecB[i]; }
 		if (normA === 0 || normB === 0) return 0;
 		return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
 	}
 
     /**
      * Retrieves all files currently in the index. Loads from disk if not in memory.
      * @returns A promise that resolves to an array of `IndexedFile` objects.
      */
 	async getAllIndexedFiles(): Promise<IndexedFile[]> { if (!this.index) await this.loadIndex(); return this.index?.files || []; }
     
     private shouldSkipFile(file: TFile): boolean { return this.settings.excludeFolders.some((folder: string) => file.path.startsWith(folder)); }
     
     /**
      * Extracts the plain sense_id (e.g., "sid-...") from a markdown link format.
      * @param senseId The raw sense_id string from frontmatter.
      * @returns The plain sense_id or null if not found.
      */
     public extractPlainSenseId(senseId: string | undefined | null): string | null {
         if (!senseId) return null;
         if (senseId.startsWith('sid-')) return senseId;
         const match = senseId.match(/\[.*?\]\(obsidian:\/\/vault-ai-toolkit\?action=similar&sense_id=(sid-.*?)\)/);
         return match ? match[1] : null;
     }
 
     private normalizeTags(rawTags: unknown): string[] | undefined {
         if (!rawTags) return undefined;
         let tagsArray: string[] = [];
         if (typeof rawTags === 'string') { tagsArray = rawTags.split(','); } 
         else if (Array.isArray(rawTags)) { tagsArray = rawTags.map(String); } 
         else { return undefined; }
         const cleanedTags = tagsArray.map(tag => tag.trim().replace(/^#/, '')).filter(tag => tag.length > 0);
         return cleanedTags.length > 0 ? cleanedTags : undefined;
     }
 
 	private calculateHash(content: string): string { let hash = 0; for (let i = 0; i < content.length; i++) { const char = content.charCodeAt(i); hash = ((hash << 5) - hash) + char; hash |= 0; } return hash.toString(16); }
 	private calculateStats(files: IndexedFile[]): VaultIndex['stats'] { const uniqueTags = new Set<string>(); let withAiMetadata = 0; files.forEach(file => { if (file.metadata?.sense_id || file.metadata?.suggested_path) { withAiMetadata++; } file.metadata?.tags?.forEach(tag => uniqueTags.add(tag)); }); return { total_files: files.length, with_ai_metadata: withAiMetadata, unique_tags: uniqueTags.size }; }
 	
     private async loadIndex(): Promise<void> {
         try {
             if (await this.app.vault.adapter.exists(this.indexPath)) {
                 const content = await this.app.vault.adapter.read(this.indexPath);
                 this.index = JSON.parse(content);
                 if (this.index) {
                     if (!this.index.embeddings) { this.index.embeddings = {}; }
                     this.index.files.forEach(file => { file.modified = new Date(file.modified); file.created = new Date(file.created); });
                 }
             } else {
                 this.index = { version: '2.8.0', indexed_at: new Date().toISOString(), stats: { total_files: 0, with_ai_metadata: 0, unique_tags: 0 }, files: [], embeddings: {} };
             }
         } catch (error) {
             console.error('Semantic Locus AI: Не удалось загрузить индекс:', error);
             this.index = null;
         }
     }
 
 	private async saveIndex(): Promise<void> { if (!this.index) return; try { await this.app.vault.adapter.write(this.indexPath, JSON.stringify(this.index, null, 2)); } catch (error) { console.error('Semantic Locus AI: Не удалось сохранить индекс:', error); new Notice('Не удалось сохранить кэш индекса: ' + error.message); } }
     async getStats(): Promise<VaultIndex['stats']> { if (!this.index) await this.loadIndex(); return this.index?.stats || { total_files: 0, with_ai_metadata: 0, unique_tags: 0 }; }
 }