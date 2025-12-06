/**
 * YAML File Loader Utilities
 *
 * Provides file-based YAML loading with sync/async support,
 * directory discovery, and error recovery patterns.
 */
import { type YamlParseOptions, type YamlParseResult } from './yaml-parser.js';
/**
 * Options for file-based YAML loading
 */
export interface YamlFileLoadOptions extends Omit<YamlParseOptions, 'filename'> {
    /** Throw error if file not found (default: false) */
    required?: boolean;
    /** Default value to return if file not found */
    defaultValue?: unknown;
    /** Encoding for file read (default: utf-8) */
    encoding?: BufferEncoding;
}
/**
 * Result from file loading operation
 */
export interface YamlFileLoadResult<T> extends YamlParseResult<T> {
    /** Full path to the file */
    filePath: string;
    /** Whether file existed */
    fileExists: boolean;
}
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
export declare function loadYamlFile<T>(filePath: string, options?: YamlFileLoadOptions): Promise<T | undefined>;
/**
 * Load and parse YAML file synchronously
 *
 * @param filePath - Path to YAML file
 * @param options - Loading options
 * @returns Parsed data or undefined if file not found (unless required)
 */
export declare function loadYamlFileSync<T>(filePath: string, options?: YamlFileLoadOptions): T | undefined;
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
export declare function loadYamlFileWithResult<T>(filePath: string, options?: YamlFileLoadOptions): YamlFileLoadResult<T>;
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
export declare function discoverYamlFiles(dirPath: string, options?: {
    /** Include .yml extension (default: true) */
    includeYml?: boolean;
    /** Recurse into subdirectories (default: false) */
    recursive?: boolean;
}): string[];
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
export declare function discoverYamlDirectories(rootDir: string, entryPointName?: string): string[];
/**
 * Check if a path points to a YAML file
 *
 * @param filePath - Path to check
 * @param options - Check options
 * @returns True if path is a YAML file
 */
export declare function isYamlFile(filePath: string, options?: {
    includeYml?: boolean;
}): boolean;
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
export declare function getYamlBaseName(filePath: string): string;
