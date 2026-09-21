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
 * The tags a resource file may carry, which is exactly what js-yaml 5.3.0's default schema
 * resolved and no more.
 *
 * This list is a SECURITY boundary, not a style rule. A prompt pack is untrusted input — the
 * handbook prices installing one as letting its author write into your model's context — and the
 * `yaml` package resolves several tags js-yaml refused: `!!binary` (measured: produces a Buffer),
 * `!!set` and `!!omap` (silently, no warning at all), and any unknown tag including
 * `!!python/object/apply:os.system`, which it reduces to that tag's argument rather than refusing
 * the document. Nothing here executes them, but a loader that accepts a construct the rest of the
 * system has never seen is a gap, and swapping the parser must not widen what the server eats.
 *
 * Schema options do not close this: measured on `yaml` 2.9.1, `schema: 'core'` and
 * `customTags: []` leave `!!binary`, `!!set` and `!!omap` resolving with zero errors and zero
 * warnings. The check has to read the composed nodes.
 */
const PERMITTED_TAGS: ReadonlySet<string> = new Set([
  'tag:yaml.org,2002:str',
  'tag:yaml.org,2002:int',
  'tag:yaml.org,2002:float',
  'tag:yaml.org,2002:bool',
  'tag:yaml.org,2002:null',
  'tag:yaml.org,2002:seq',
  'tag:yaml.org,2002:map',
]);

/**
 * The first reason this document would have been refused under the previous parser, if any.
 *
 * Returns a sentence, not a boolean, because the caller puts it in front of an operator who has
 * to find the construct in their file.
 */
function findStrictnessViolation(doc: YAML.Document.Parsed): string | undefined {
  let violation: string | undefined;

  YAML.visit(doc, {
    Node(_key, node) {
      if (violation !== undefined) return YAML.visit.BREAK;
      const tag = (node as { tag?: string }).tag;
      if (typeof tag === 'string' && !PERMITTED_TAGS.has(tag)) {
        violation = `unsupported YAML tag ${tag}`;
        return YAML.visit.BREAK;
      }
      return undefined;
    },
    Pair(_key, pair) {
      if (violation !== undefined) return YAML.visit.BREAK;
      // js-yaml refused these outright ("object-based map does not support complex keys");
      // `yaml` stringifies the collection into a key like "[ 1, 2 ]", inventing a name.
      if (YAML.isCollection(pair.key)) {
        violation = 'a mapping key that is not a scalar';
        return YAML.visit.BREAK;
      }
      return undefined;
    },
  });

  return violation;
}

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
/**
 * Parse `content` under the strictness contract, or throw.
 *
 * Split out of `parseYaml` so the strictness rules read as one unit and the error-shaping below
 * stays separate from them.
 */
function parseStrictly<T>(content: string): T {
  const doc = YAML.parseDocument(content, { prettyErrors: true });

  // `parseDocument` COLLECTS problems instead of throwing them, so every one of these has to be
  // read explicitly. Reading them HERE is what makes the check universal: this function is the
  // only parse in the codebase — `loadYamlFile`, `loadYamlFileSync` and `loadYamlFileWithResult`
  // all route through `parseYaml` — so a per-caller check would be a rule each new caller could
  // forget. Warnings are refused alongside errors because for untrusted input "the parser
  // resolved something it was not sure about" is not a thing to continue past.
  //
  // SUBSUMED, NOT DEAD (measured 2026-09-21 on yaml 2.9.1 · flips when a warning code appears
  // that carries no explicit tag). The only warning this corpus can raise is TAG_RESOLVE_FAILED,
  // which always accompanies an explicit tag, so `findStrictnessViolation` already refuses every
  // document that reaches it — removing this clause leaves the strictness tests green. It is kept
  // as the conservative half of the pair, and stamped so its survival under mutation is not read
  // as a gap. KEY_OVER_1024_CHARS does not fire at 1,100 characters in this version, and js-yaml
  // accepted long keys, so nothing here narrows on that axis.
  const firstProblem = doc.errors[0] ?? doc.warnings[0];
  if (firstProblem !== undefined) {
    throw firstProblem;
  }

  const violation = findStrictnessViolation(doc);
  if (violation !== undefined) {
    // `IMPOSSIBLE` is the library's catch-all code; the message carries the real reason, and
    // reusing the library's error type keeps one failure shape for every caller.
    throw new YAML.YAMLParseError([0, 0], 'IMPOSSIBLE', violation);
  }

  // `maxAliasCount` is applied when the node tree is realised, not when it is composed, so it
  // belongs here rather than on `parseDocument`. Its default of 100 is what refuses a
  // billion-laughs document; js-yaml had no such limit and expanded one happily.
  return doc.toJS({ maxAliasCount: 100 }) as T;
}

export function parseYaml<T>(content: string, options?: YamlParseOptions): YamlParseResult<T> {
  try {
    const data = parseStrictly<T>(content);

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
