import type { Logger } from '../logging/index.js';
import type { PersistedSessionStore } from './types.js';
export interface ChainSessionStore {
    ensureInitialized(): Promise<void>;
    load(): Promise<PersistedSessionStore>;
    save(store: PersistedSessionStore): Promise<void>;
}
export interface FileBackedChainSessionStoreOptions {
    fallbackPaths?: string[];
}
export declare class FileBackedChainSessionStore implements ChainSessionStore {
    private readonly filePath;
    private readonly logger?;
    private readonly directory;
    private readonly fallbackPaths;
    constructor(filePath: string, logger?: Logger | undefined, options?: FileBackedChainSessionStoreOptions);
    ensureInitialized(): Promise<void>;
    load(): Promise<PersistedSessionStore>;
    save(store: PersistedSessionStore): Promise<void>;
}
