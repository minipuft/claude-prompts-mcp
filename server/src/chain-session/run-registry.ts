// @lifecycle canonical - Persists chain run registry data to disk.
import { promises as fs } from 'fs';
import path from 'path';

import { atomicWriteFile } from '../utils/atomic-file-write.js';

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

export class FileBackedChainRunRegistry implements ChainRunRegistry {
  private readonly directory: string;
  private readonly fallbackPaths: string[];

  constructor(
    private readonly filePath: string,
    private readonly logger?: Logger,
    options?: FileBackedChainRunRegistryOptions
  ) {
    this.directory = path.dirname(this.filePath);
    this.fallbackPaths = options?.fallbackPaths ?? [];
  }

  async ensureInitialized(): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
  }

  async load(): Promise<PersistedChainRunRegistry> {
    try {
      const data = await fs.readFile(this.filePath, 'utf-8');
      return JSON.parse(data) as PersistedChainRunRegistry;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        for (const fallbackPath of this.fallbackPaths) {
          try {
            const fallbackData = await fs.readFile(fallbackPath, 'utf-8');
            this.logger?.info?.(
              `[ChainRunRegistry] Loaded sessions from legacy path ${fallbackPath}`
            );
            return JSON.parse(fallbackData) as PersistedChainRunRegistry;
          } catch (fallbackError) {
            if ((fallbackError as NodeJS.ErrnoException).code !== 'ENOENT') {
              this.logger?.warn?.(
                `[ChainRunRegistry] Failed to load fallback sessions: ${
                  fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
                }`
              );
            }
          }
        }

        this.logger?.debug?.(
          `[ChainRunRegistry] No persisted sessions found at ${this.filePath}, starting fresh`
        );
        return {};
      }
      this.logger?.warn?.(
        `[ChainRunRegistry] Failed to load sessions: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return {};
    }
  }

  async save(store: PersistedChainRunRegistry): Promise<void> {
    try {
      // Use atomic write to prevent data corruption from concurrent processes
      await atomicWriteFile(this.filePath, JSON.stringify(store, null, 2));
      this.logger?.debug?.(`[ChainRunRegistry] Persisted chain run state to ${this.filePath}`);
    } catch (error) {
      this.logger?.error?.(
        `[ChainRunRegistry] Failed to persist session state: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
  }
}
