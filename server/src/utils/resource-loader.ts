// @lifecycle canonical - Shared resource loader for JSON/YAML files with caching.
/**
 * Resource Loader
 *
 * Provides JSON/YAML loading with mtime-aware caching and minimal logging.
 * Intended for reuse across gates, frameworks, and prompts to avoid bespoke
 * file parsing logic.
 */

import { existsSync } from 'fs';
import { readFile, stat } from 'fs/promises';
import { extname } from 'path';

import { loadYamlFile, type YamlFileLoadOptions } from './yaml/index.js';

import type { Logger } from '../logging/index.js';

export type ResourceKind = 'json' | 'yaml';

export interface ResourceLoaderConfig {
  logger?: Logger;
}

export interface ResourceLoadOptions {
  kind?: ResourceKind | 'auto';
  useCache?: boolean;
  encoding?: BufferEncoding;
  yamlOptions?: Omit<YamlFileLoadOptions, 'required'>;
}

export interface ResourceLoadResult<T> {
  success: boolean;
  data?: T;
  error?: string;
  filePath: string;
  mtimeMs?: number;
  fromCache?: boolean;
}

export class ResourceLoader {
  private readonly logger: Logger | undefined;
  private readonly cache = new Map<string, { mtimeMs: number; data: unknown }>();

  constructor(config: ResourceLoaderConfig = {}) {
    this.logger = config.logger;
  }

  async load<T>(filePath: string, options?: ResourceLoadOptions): Promise<ResourceLoadResult<T>> {
    if (!existsSync(filePath)) {
      return { success: false, filePath, error: `File not found: ${filePath}` };
    }

    const kind = this.resolveKind(filePath, options?.kind);
    const useCache = options?.useCache ?? true;

    try {
      const fileStat = await stat(filePath);
      const cached = this.cache.get(filePath);

      if (useCache && cached && cached.mtimeMs === fileStat.mtimeMs) {
        return {
          success: true,
          data: cached.data as T,
          filePath,
          mtimeMs: cached.mtimeMs,
          fromCache: true,
        };
      }

      const yamlOptions: YamlFileLoadOptions = {
        ...(options?.yamlOptions ?? {}),
        required: true,
      };

      if (options?.encoding !== undefined) {
        yamlOptions.encoding = options.encoding;
      }

      const data =
        kind === 'yaml'
          ? await loadYamlFile<T>(filePath, yamlOptions)
          : options?.encoding !== undefined
            ? await this.loadJson<T>(filePath, options.encoding)
            : await this.loadJson<T>(filePath);

      // If YAML loader returns undefined despite required=true, treat as error
      if (data === undefined) {
        return {
          success: false,
          filePath,
          error: `Unable to load data from ${filePath}`,
        };
      }

      this.cache.set(filePath, { mtimeMs: fileStat.mtimeMs, data });

      return {
        success: true,
        data,
        filePath,
        mtimeMs: fileStat.mtimeMs,
        fromCache: false,
      };
    } catch (error) {
      this.logger?.warn('[ResourceLoader] Failed to load resource', {
        filePath,
        error,
      });

      return {
        success: false,
        filePath,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  clearCache(filePath?: string): void {
    if (filePath) {
      this.cache.delete(filePath);
      return;
    }

    this.cache.clear();
  }

  private resolveKind(filePath: string, explicit?: ResourceLoadOptions['kind']): ResourceKind {
    if (explicit && explicit !== 'auto') {
      return explicit;
    }

    const extension = extname(filePath).toLowerCase();
    return extension === '.yaml' || extension === '.yml' ? 'yaml' : 'json';
  }

  private async loadJson<T>(filePath: string, encoding: BufferEncoding = 'utf8'): Promise<T> {
    const content = await readFile(filePath, encoding);
    return JSON.parse(content.toString()) as T;
  }
}
