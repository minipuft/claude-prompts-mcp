// @lifecycle canonical - Core YAML parsing with comprehensive error handling
/**
 * YAML Parser Utilities
 *
 * Provides type-safe YAML parsing with detailed error handling.
 * Designed to be reusable across frameworks and future prompt YAML support.
 */

// One YAML library, not two. `yaml` backs the source-preserving resource writer, and running
// js-yaml beside it put both in the `cpm` bundle for no behavioural gain: measured on the 105
// bundled resources, the two parse to identical values 105/105, with a control (an explicit
// `%YAML 1.1` directive) confirming the probe can see a difference when one exists. Dropping
// js-yaml removes 125,991 input bytes from that bundle.
//
// What DID change is serializer FORMATTING: `YAML.stringify` and js-yaml's `dump` agree
// byte-for-byte on only 24 of those 105 files, though all 105 round-trip to the same value. That
// affects freshly created files and the writer's structural-rewrite tier, never what a file means.
import * as YAML from 'yaml';

/**
 * Options for YAML parsing
 */
export interface YamlParseOptions {
  /** Filename for error messages */
  filename?: string;
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
  try {
    const data = YAML.parse(content, { prettyErrors: true }) as T;

    return { success: true, data };
  } catch (error) {
    if (error instanceof YAML.YAMLParseError) {
      const errorDetails: YamlParseError = {
        message: error.message,
        cause: error,
      };

      // `linePos` counts from 1; this contract counts `line` from 0, and `parseYamlOrThrow`
      // adds the 1 back when it formats. Converting here rather than at the reader keeps the
      // single documented meaning of the field.
      const position = error.linePos?.[0];
      if (position !== undefined) {
        errorDetails.line = position.line - 1;
        errorDetails.column = position.col;
      }
      if (options?.filename) {
        errorDetails.filename = options.filename;
      }

      return { success: false, error: errorDetails };
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

    return { success: false, error: errorDetails };
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
  return YAML.stringify(data, {
    indent: options?.indent ?? 2,
    lineWidth: options?.lineWidth ?? 80,
    // js-yaml's `noRefs: true` is `yaml`'s `aliasDuplicateObjects: false`. Without it, a value
    // reachable twice is emitted once with an anchor and once as an alias, which is valid YAML
    // that reads as a different document to a human and to any line-based diff.
    aliasDuplicateObjects: !(options?.noRefs ?? true),
    // `yaml` spells js-yaml's `sortKeys` as `sortMapEntries`.
    sortMapEntries: options?.sortKeys ?? false,
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
