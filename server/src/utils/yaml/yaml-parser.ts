// @lifecycle canonical - Core YAML parsing with comprehensive error handling
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
export function parseYaml<T>(content: string, options?: YamlParseOptions): YamlParseResult<T> {
  const warnings: string[] = [];

  try {
    const data = yaml.load(content, {
      schema: options?.schema ?? yaml.DEFAULT_SCHEMA,
      filename: options?.filename,
      onWarning: (warning) => {
        warnings.push(warning.message);
        options?.onWarning?.(warning);
      },
    }) as T;

    const result: YamlParseResult<T> = {
      success: true,
      data,
    };

    if (warnings.length > 0) {
      result.warnings = warnings;
    }

    return result;
  } catch (error) {
    if (error instanceof yaml.YAMLException) {
      const errorDetails: YamlParseError = {
        message: error.message,
        line: error.mark?.line,
        column: error.mark?.column,
        snippet: error.mark?.snippet,
        cause: error,
      };

      if (options?.filename) {
        errorDetails.filename = options.filename;
      }

      const errorResult: YamlParseResult<T> = {
        success: false,
        error: errorDetails,
      };

      if (warnings.length > 0) {
        errorResult.warnings = warnings;
      }

      return errorResult;
    }

    // Handle unexpected errors
    const errorDetails: YamlParseError = {
      message: error instanceof Error ? error.message : String(error),
    };

    if (options?.filename) {
      errorDetails.filename = options.filename;
    }
    if (error instanceof Error) {
      errorDetails.cause = error;
    }

    const errorResult: YamlParseResult<T> = {
      success: false,
      error: errorDetails,
    };

    if (warnings.length > 0) {
      errorResult.warnings = warnings;
    }

    return errorResult;
  }
}

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
export function parseYamlOrThrow<T>(content: string, options?: YamlParseOptions): T {
  const result = parseYaml<T>(content, options);

  if (!result.success) {
    const error = result.error!;
    const location = error.line !== undefined ? ` at line ${error.line + 1}` : '';
    const column = error.column !== undefined ? `:${error.column}` : '';
    const file = error.filename ? ` in ${error.filename}` : '';

    throw new Error(`YAML parse error${file}${location}${column}: ${error.message}`);
  }

  return result.data!;
}

/**
 * Serialize data to YAML string
 *
 * @param data - Data to serialize
 * @param options - Serialization options
 * @returns YAML string representation
 */
export function serializeYaml(
  data: unknown,
  options?: {
    indent?: number;
    lineWidth?: number;
    noRefs?: boolean;
    sortKeys?: boolean;
  }
): string {
  return yaml.dump(data, {
    indent: options?.indent ?? 2,
    lineWidth: options?.lineWidth ?? 80,
    noRefs: options?.noRefs ?? true,
    sortKeys: options?.sortKeys ?? false,
  });
}

/**
 * Format a YAML parse error for logging
 *
 * @param error - Parse error to format
 * @returns Formatted error string
 */
export function formatYamlError(error: YamlParseError): string {
  const parts: string[] = [];

  if (error.filename) {
    parts.push(`File: ${error.filename}`);
  }

  if (error.line !== undefined) {
    const location =
      error.column !== undefined ? `${error.line + 1}:${error.column}` : `line ${error.line + 1}`;
    parts.push(`Location: ${location}`);
  }

  parts.push(`Error: ${error.message}`);

  if (error.snippet) {
    parts.push(`\nContext:\n${error.snippet}`);
  }

  return parts.join('\n');
}
