import type { PersistedChainRunRegistry } from './types.js';
import type { Logger } from '../logging/index.js';
export interface ChainRunRegistry {
    ensureInitialized(): Promise<void>;
    load(): Promise<PersistedChainRunRegistry>;
    save(store: PersistedChainRunRegistry): Promise<void>;
}
export interface FileBackedChainRunRegistryOptions {
    fallbackPaths?: string[];
}
export declare class FileBackedChainRunRegistry implements ChainRunRegistry {
    private readonly filePath;
    private readonly logger?;
    private readonly directory;
    private readonly fallbackPaths;
    constructor(filePath: string, logger?: Logger | undefined, options?: FileBackedChainRunRegistryOptions);
    ensureInitialized(): Promise<void>;
    load(): Promise<PersistedChainRunRegistry>;
    save(store: PersistedChainRunRegistry): Promise<void>;
}
