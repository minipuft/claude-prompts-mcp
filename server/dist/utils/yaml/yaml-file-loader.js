// @lifecycle canonical - File-based YAML loading with validation and discovery
/**
 * YAML File Loader Utilities
 *
 * Provides file-based YAML loading with sync/async support,
 * directory discovery, and error recovery patterns.
 */
import { readFileSync, existsSync, readdirSync } from 'fs';
import { readFile } from 'fs/promises';
import { join, extname, basename } from 'path';
import { parseYaml, parseYamlOrThrow, } from './yaml-parser.js';
/**
 * Load and parse YAML file asynchronously
 *
 * @param filePath - Path to YAML file
 * @param options - Loading options
 * @returns Parsed data or undefined if file not found (unless required)
 *
 * @example
 * ```typescript
 * const config = await loadYamlFile<Config>('config.yaml');
 * const required = await loadYamlFile<Config>('config.yaml', { required: true });
 * ```
 */
export async function loadYamlFile(filePath, options) {
    const encoding = options?.encoding ?? 'utf-8';
    if (!existsSync(filePath)) {
        if (options?.required) {
            throw new Error(`Required YAML file not found: ${filePath}`);
        }
        return options?.defaultValue;
    }
    const content = await readFile(filePath, encoding);
    return parseYamlOrThrow(content, { ...options, filename: filePath });
}
/**
 * Load and parse YAML file synchronously
 *
 * @param filePath - Path to YAML file
 * @param options - Loading options
 * @returns Parsed data or undefined if file not found (unless required)
 */
export function loadYamlFileSync(filePath, options) {
    const encoding = options?.encoding ?? 'utf-8';
    if (!existsSync(filePath)) {
        if (options?.required) {
            throw new Error(`Required YAML file not found: ${filePath}`);
        }
        return options?.defaultValue;
    }
    const content = readFileSync(filePath, encoding);
    return parseYamlOrThrow(content, { ...options, filename: filePath });
}
/**
 * Load YAML file with full result information (sync)
 *
 * Returns detailed result object including file existence and parse status.
 * Useful when you need to distinguish between missing files and parse errors.
 *
 * @param filePath - Path to YAML file
 * @param options - Loading options
 * @returns Full result object with file and parse status
 */
export function loadYamlFileWithResult(filePath, options) {
    const encoding = options?.encoding ?? 'utf-8';
    const fileExists = existsSync(filePath);
    if (!fileExists) {
        return {
            success: false,
            fileExists: false,
            filePath,
            error: {
                message: `File not found: ${filePath}`,
                filename: filePath,
            },
        };
    }
    try {
        const content = readFileSync(filePath, encoding);
        const parseResult = parseYaml(content, { ...options, filename: filePath });
        return {
            ...parseResult,
            filePath,
            fileExists: true,
        };
    }
    catch (error) {
        return {
            success: false,
            fileExists: true,
            filePath,
            error: {
                message: error instanceof Error ? error.message : String(error),
                filename: filePath,
            },
        };
    }
}
/**
 * Discover YAML files in a directory
 *
 * @param dirPath - Directory to scan
 * @param options - Discovery options
 * @returns Array of full paths to YAML files
 *
 * @example
 * ```typescript
 * const yamlFiles = discoverYamlFiles('./config');
 * // Returns: ['./config/app.yaml', './config/db.yml']
 * ```
 */
export function discoverYamlFiles(dirPath, options) {
    if (!existsSync(dirPath)) {
        return [];
    }
    const includeYml = options?.includeYml ?? true;
    const recursive = options?.recursive ?? false;
    const results = [];
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = join(dirPath, entry.name);
        if (entry.isDirectory() && recursive) {
            results.push(...discoverYamlFiles(fullPath, options));
        }
        else if (entry.isFile()) {
            const ext = extname(entry.name).toLowerCase();
            if (ext === '.yaml' || (includeYml && ext === '.yml')) {
                results.push(fullPath);
            }
        }
    }
    return results;
}
/**
 * Discover subdirectories containing a YAML entry point file
 *
 * Useful for discovering methodology directories or other
 * structured YAML configurations where each subdirectory
 * represents a distinct entity.
 *
 * @param rootDir - Root directory to scan
 * @param entryPointName - Name of entry point file (default: 'methodology.yaml')
 * @returns Array of subdirectory names that contain the entry point
 *
 * @example
 * ```typescript
 * // Directory structure:
 * // methodologies/
 * //   cageerf/
 * //     methodology.yaml  <-- entry point
 * //   react/
 * //     methodology.yaml  <-- entry point
 * //   empty/              <-- no entry point
 *
 * const dirs = discoverYamlDirectories('./methodologies', 'methodology.yaml');
 * // Returns: ['cageerf', 'react']
 * ```
 */
export function discoverYamlDirectories(rootDir, entryPointName = 'methodology.yaml') {
    if (!existsSync(rootDir)) {
        return [];
    }
    try {
        const entries = readdirSync(rootDir, { withFileTypes: true });
        return entries
            .filter((entry) => {
            if (!entry.isDirectory())
                return false;
            const entryPath = join(rootDir, entry.name, entryPointName);
            return existsSync(entryPath);
        })
            .map((entry) => entry.name);
    }
    catch {
        return [];
    }
}
/**
 * Check if a path points to a YAML file
 *
 * @param filePath - Path to check
 * @param options - Check options
 * @returns True if path is a YAML file
 */
export function isYamlFile(filePath, options) {
    const ext = extname(filePath).toLowerCase();
    const includeYml = options?.includeYml ?? true;
    return ext === '.yaml' || (includeYml && ext === '.yml');
}
/**
 * Get the base name of a YAML file without extension
 *
 * @param filePath - Path to YAML file
 * @returns Base name without .yaml or .yml extension
 *
 * @example
 * ```typescript
 * getYamlBaseName('path/to/config.yaml') // 'config'
 * getYamlBaseName('methodology.yml')     // 'methodology'
 * ```
 */
export function getYamlBaseName(filePath) {
    const base = basename(filePath);
    const ext = extname(base).toLowerCase();
    if (ext === '.yaml' || ext === '.yml') {
        return base.slice(0, -ext.length);
    }
    return base;
}
//# sourceMappingURL=yaml-file-loader.js.map