/**
 * YAML Parser Utilities
 *
 * Provides type-safe YAML parsing with detailed error handling.
 * Designed to be reusable across methodologies and future prompt YAML support.
 */
import yaml from 'js-yaml';
/**
 * Options for YAML parsing
 */
export interface YamlParseOptions {
    /** Filename for error messages */
    filename?: string;
    /** Custom schema (default: DEFAULT_SCHEMA) */
    schema?: yaml.Schema;
    /** Allow duplicate keys in objects */
    allowDuplicateKeys?: boolean;
    /** Emit warnings via callback */
    onWarning?: (warning: yaml.YAMLException) => void;
}
/**
 * Detailed error information from YAML parsing
 */
export interface YamlParseError {
    /** Human-readable error message */
    message: string;
    /** Source filename if provided */
    filename?: string;
    /** Line number (0-indexed) where error occurred */
    line?: number;
    /** Column number where error occurred */
    column?: number;
    /** Code snippet around the error */
    snippet?: string;
    /** Original error for debugging */
    cause?: Error;
}
/**
 * Result object from YAML parsing operations
 */
export interface YamlParseResult<T> {
    /** Whether parsing succeeded */
    success: boolean;
    /** Parsed data (undefined if failed) */
    data?: T;
    /** Error details (undefined if succeeded) */
    error?: YamlParseError;
    /** Non-fatal warnings encountered */
    warnings?: string[];
}
/**
 * Parse YAML content with comprehensive error handling
 *
 * Returns a result object with success/error info rather than throwing.
 * Use this when you want to handle parsing failures gracefully.
 *
 * @param content - YAML string to parse
 * @param options - Parsing options
 * @returns Result object with parsed data or error details
 *
 * @example
 * ```typescript
 * const result = parseYaml<Config>(yamlString, { filename: 'config.yaml' });
 * if (result.success) {
 *   console.log(result.data);
 * } else {
 *   console.error(`Error at line ${result.error?.line}: ${result.error?.message}`);
 * }
 * ```
 */
export declare function parseYaml<T>(content: string, options?: YamlParseOptions): YamlParseResult<T>;
/**
 * Parse YAML content, throwing on error
 *
 * Use when parsing failure should halt execution.
 * Provides detailed error messages for debugging.
 *
 * @param content - YAML string to parse
 * @param options - Parsing options
 * @returns Parsed data
 * @throws Error with detailed message on parse failure
 *
 * @example
 * ```typescript
 * try {
 *   const config = parseYamlOrThrow<Config>(yamlString, { filename: 'config.yaml' });
 * } catch (error) {
 *   // Error message includes filename, line, column
 * }
 * ```
 */
export declare function parseYamlOrThrow<T>(content: string, options?: YamlParseOptions): T;
/**
 * Serialize data to YAML string
 *
 * @param data - Data to serialize
 * @param options - Serialization options
 * @returns YAML string representation
 */
export declare function serializeYaml(data: unknown, options?: {
    indent?: number;
    lineWidth?: number;
    noRefs?: boolean;
    sortKeys?: boolean;
}): string;
/**
 * Format a YAML parse error for logging
 *
 * @param error - Parse error to format
 * @returns Formatted error string
 */
export declare function formatYamlError(error: YamlParseError): string;
