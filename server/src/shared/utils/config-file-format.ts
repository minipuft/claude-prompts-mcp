// @lifecycle canonical - The one owner of which file is the user's config and how its text parses.
/**
 * Config File Format
 *
 * Single source of truth for two questions every config reader/writer otherwise answers
 * on its own: which filename is the user's workspace config, and how does its text parse.
 * Without it, every call site runs its own bare `JSON.parse` — independent format decisions
 * that drift from each other. Consumers span `infra/config`, `runtime`, `cli-shared`, and the
 * CLI bundle, which is why this lives in `shared`, not `infra`.
 *
 * `.jsonc` accepts line/block comments and trailing commas and nothing else beyond JSON — no
 * unquoted keys, no single-quoted strings. `.json` stays strict `JSON.parse`. `json5`, already
 * a dependency elsewhere in this repo, was rejected for this role: it accepts a wider language
 * than an editor's JSONC mode and cannot edit in place, which the write side needs.
 * `jsonc-parser` covers both halves.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { parse as parseJsonc, printParseErrorCode, type ParseError } from 'jsonc-parser';

/** The two config text dialects this module understands. */
export type ConfigFileFormat = 'jsonc' | 'json';

/** Workspace config names, in precedence order (first existing wins). */
export const USER_CONFIG_FILENAMES = ['config.jsonc', 'config.json'] as const;

/**
 * Decide a file's config dialect from its extension.
 *
 * `.jsonc` (case-insensitive) is the only trigger for the comment-tolerant reader; every
 * other extension, including no extension at all, is strict JSON.
 *
 * @param filePath - Path (absolute or relative) to a config file; only the extension is read
 * @returns `'jsonc'` for a `.jsonc` path, `'json'` otherwise
 */
export function configFileFormat(filePath: string): ConfigFileFormat {
  return path.extname(filePath).toLowerCase() === '.jsonc' ? 'jsonc' : 'json';
}

/**
 * Parse config text according to its format.
 *
 * `'json'` is strict `JSON.parse` — its own thrown `SyntaxError` propagates unchanged.
 * `'jsonc'` goes through `jsonc-parser`'s fault-tolerant `parse`, which returns a partial
 * value even on malformed input — so the returned `errors` array is always checked, and a
 * non-empty array throws naming the first error's 1-based line and column, rather than
 * silently handing back a partial document.
 *
 * @param text - Raw file contents
 * @param format - Dialect to parse as, from {@link configFileFormat}
 * @returns The parsed value
 * @throws {Error} On invalid JSON (`'json'`) or the first JSONC syntax error (`'jsonc'`)
 */
export function parseConfigText(text: string, format: ConfigFileFormat): unknown {
  if (format === 'json') {
    return JSON.parse(text);
  }

  const errors: ParseError[] = [];
  const value: unknown = parseJsonc(text, errors, {
    disallowComments: false,
    allowTrailingComma: true,
    // An empty file has no config in it; treat that as a syntax error rather than
    // silently returning `undefined` as a parsed workspace config.
    allowEmptyContent: false,
  });

  if (errors.length > 0) {
    const firstError = errors[0] as ParseError;
    const { line, column } = offsetToLineColumn(text, firstError.offset);
    throw new Error(
      `Invalid JSONC at line ${line}, column ${column}: ${printParseErrorCode(firstError.error)}`
    );
  }

  return value;
}

/**
 * Convert a 0-based character offset into a 1-based line and column.
 *
 * @param text - The full text the offset was measured against
 * @param offset - 0-based character offset, as reported by `jsonc-parser`
 * @returns 1-based line and column of that offset
 */
function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
  const consumed = text.slice(0, offset);
  const lines = consumed.split('\n');
  const line = lines.length;
  const column = (lines[lines.length - 1] as string).length + 1;
  return { line, column };
}

/**
 * Find which of {@link USER_CONFIG_FILENAMES} exist directly inside `dir`.
 *
 * @param dir - Directory to check (absolute or relative)
 * @returns Absolute paths of the existing names, in precedence order
 */
export function findWorkspaceConfigFiles(dir: string): string[] {
  return USER_CONFIG_FILENAMES.map((name) => path.resolve(dir, name)).filter((candidate) =>
    fs.existsSync(candidate)
  );
}
