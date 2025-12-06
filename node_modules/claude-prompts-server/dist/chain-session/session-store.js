// @lifecycle canonical - Persists chain session data to disk.
import { promises as fs } from 'fs';
import path from 'path';
export class FileBackedChainSessionStore {
    constructor(filePath, logger, options) {
        this.filePath = filePath;
        this.logger = logger;
        this.directory = path.dirname(this.filePath);
        this.fallbackPaths = options?.fallbackPaths ?? [];
    }
    async ensureInitialized() {
        await fs.mkdir(this.directory, { recursive: true });
    }
    async load() {
        try {
            const data = await fs.readFile(this.filePath, 'utf-8');
            return JSON.parse(data);
        }
        catch (error) {
            if (error.code === 'ENOENT') {
                for (const fallbackPath of this.fallbackPaths) {
                    try {
                        const fallbackData = await fs.readFile(fallbackPath, 'utf-8');
                        this.logger?.info?.(`[ChainSessionStore] Loaded sessions from legacy path ${fallbackPath}`);
                        return JSON.parse(fallbackData);
                    }
                    catch (fallbackError) {
                        if (fallbackError.code !== 'ENOENT') {
                            this.logger?.warn?.(`[ChainSessionStore] Failed to load fallback sessions: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
                        }
                    }
                }
                this.logger?.debug?.(`[ChainSessionStore] No persisted sessions found at ${this.filePath}, starting fresh`);
                return {};
            }
            this.logger?.warn?.(`[ChainSessionStore] Failed to load sessions: ${error instanceof Error ? error.message : String(error)}`);
            return {};
        }
    }
    async save(store) {
        try {
            await fs.writeFile(this.filePath, JSON.stringify(store, null, 2), 'utf-8');
            this.logger?.debug?.(`[ChainSessionStore] Persisted session state to ${this.filePath}`);
        }
        catch (error) {
            this.logger?.error?.(`[ChainSessionStore] Failed to persist session state: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }
}
//# sourceMappingURL=session-store.js.map