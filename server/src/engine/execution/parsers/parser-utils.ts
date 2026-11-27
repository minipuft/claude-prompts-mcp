// @lifecycle canonical - Shared helpers for command parsing normalization.
import { FRAMEWORK_SIGIL_SOURCE, OPERATOR_PATTERNS } from './operator-patterns.js';

import { isAcceptedPromptReference } from '#shared/utils/resource-ids.js';

/** Framework operator core match, from the operators.json registry (SSOT). */
const FRAMEWORK_OPERATOR_PATTERN = OPERATOR_PATTERNS.framework.pattern;

/** A leading `>>` that precedes a framework operator (`>> ^CAGEERF …`), sigil from the registry. */
const FRAMEWORK_PREFIX_AFTER_MARKER = new RegExp(`^>>\\s*${FRAMEWORK_SIGIL_SOURCE}`);

export const PROMPT_INVOCATION_MARKER_PATTERN = /(?<!>)>>/g;
export const PROMPT_SELECTOR_PREFIX_PATTERN = /^\s*(?:>>|\/)?\s*/;
export const PROMPT_SELECTOR_WHITESPACE_PATTERN = /\s/;
const PROMPT_SELECTOR_DELIMITER_SYMBOLS = [
  OPERATOR_PATTERNS.chain.symbol,
  OPERATOR_PATTERNS.delegation.symbol,
  OPERATOR_PATTERNS.parallel.symbol,
];
export const PROMPT_QUOTE_CHARACTERS: readonly string[] = ['"', "'"];
export const PROMPT_QUOTE_ESCAPE = '\\';

export interface PromptSelectorMatch {
  promptId: string;
  /** Unmodified bytes following the selector, including its separator. */
  remainder: string;
  /** Selector span in the original input, excluding any command marker. */
  start: number;
  end: number;
}

/** Read one complete reference; DSL delimiters separate tokens, malformed suffixes do not. */
export function readPromptSelector(input: string): PromptSelectorMatch | null {
  const start = input.match(PROMPT_SELECTOR_PREFIX_PATTERN)?.[0].length ?? 0;
  let end = start;
  while (end < input.length && !PROMPT_SELECTOR_WHITESPACE_PATTERN.test(input[end] ?? '')) {
    if (
      PROMPT_SELECTOR_DELIMITER_SYMBOLS.some((symbol) => input.startsWith(symbol, end)) ||
      (input[end] === '?' &&
        OPERATOR_PATTERNS.conditional.pattern.exec(input.slice(end))?.index === 0)
    ) {
      break;
    }
    end++;
  }
  const promptId = input.slice(start, end);
  if (!isAcceptedPromptReference(promptId)) return null;
  return { promptId, remainder: input.slice(end), start, end };
}

/**
 * Normalize >> prefixes in symbolic commands for consistent parsing.
 *
 * The >> prefix serves as a hint to LLMs that this is an MCP tool command,
 * but it should not interfere with symbolic operator detection.
 */
export function normalizeSymbolicPrefixes(command: string): {
  normalized: string;
  hadPrefixes: boolean;
  originalCommand: string;
} {
  const original = command;
  let normalized = command;
  let hadPrefixes = false;

  for (const [pattern, replacement] of [
    [/-->\s*>>\s*/g, '--> '],
    [/\+\s*>>\s*/g, '+ '],
    [/:\s*>>\s*/g, ': '],
  ] as const) {
    normalized = normalized.replace(pattern, (match, offset: number) => {
      if (isPositionInsideQuotes(normalized, offset)) return match;
      hadPrefixes = true;
      return replacement;
    });
  }

  if (FRAMEWORK_PREFIX_AFTER_MARKER.test(normalized)) {
    normalized = normalized.replace(/^>>\s*/, '');
    hadPrefixes = true;
  }

  return { normalized, hadPrefixes, originalCommand: original };
}

/**
 * Remove style operators from a command segment to avoid polluting prompt args.
 * Handles new #styleid syntax (e.g., #analytical, #procedural)
 */
export function stripStyleOperators(input: string): string {
  if (!input) {
    return input;
  }
  // Match #styleid where styleid starts with a letter
  // Also handle legacy #style(id) syntax for backward compatibility
  const withoutLegacy = input.replace(
    /#style(?:[:=]|\()([A-Za-z0-9_-]+)\)?/gi,
    (match, _styleId: string, offset: number) =>
      isPositionInsideQuotes(input, offset) ? match : ' '
  );
  return withoutLegacy
    .replace(/(?:^|\s)#[A-Za-z][A-Za-z0-9_-]*(?=\s|$)/g, (match, offset: number) =>
      isPositionInsideQuotes(withoutLegacy, offset) ? match : ' '
    )
    .trim();
}

// ============================================================================
// Quote-Aware Framework Operator Detection
// ============================================================================

/**
 * Check if a position in a string is inside a quoted section.
 * Handles both single and double quotes, respects escape sequences.
 *
 * @param str - The string to check
 * @param position - The character position to check
 * @returns true if the position is inside quotes
 */
export function isPositionInsideQuotes(str: string, position: number): boolean {
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < position && i < str.length; i++) {
    const char = str[i];
    const prevChar = i > 0 ? str[i - 1] : undefined;

    // Skip escaped quotes
    if (
      char !== undefined &&
      PROMPT_QUOTE_CHARACTERS.includes(char) &&
      prevChar !== PROMPT_QUOTE_ESCAPE
    ) {
      if (!inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar) {
        inQuotes = false;
        quoteChar = '';
      }
    }
  }

  return inQuotes;
}

/**
 * Result of finding a framework operator outside quotes.
 */
export interface FrameworkOperatorMatch {
  /** The framework ID (without its sigil) */
  frameworkId: string;
  /** Position in the string where the match starts */
  position: number;
  /** The full matched string including the sigil and any leading whitespace */
  fullMatch: string;
}

/**
 * Every sigil-word match of `pattern` (a sigil followed by a captured id) that stands in operator
 * position, in order. Operator position means outside quoted strings, and an id followed by
 * whitespace, the end of the string, or one of `, ; : ) ] } >`. An id followed by `/` or `.` is a
 * path or file reference (`@docs/path`, `^file.md`), never an operator.
 *
 * The pattern decides where the sigil may start: the registry's framework pattern admits the
 * start of the string or a preceding whitespace character, so `a^b` and `me@home` never match.
 */
export function findSigilOperatorsOutsideQuotes(
  str: string,
  pattern: RegExp
): FrameworkOperatorMatch[] {
  const global = new RegExp(
    pattern.source,
    pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  );
  const found: FrameworkOperatorMatch[] = [];
  for (const match of str.matchAll(global)) {
    const frameworkId = match[1];
    if (!frameworkId || isPositionInsideQuotes(str, match.index)) continue;
    const nextChar = str[match.index + match[0].length];
    if (nextChar !== undefined && !/[\s,;:)\]}>]/.test(nextChar)) continue;
    found.push({ frameworkId, position: match.index, fullMatch: match[0] });
  }
  return found;
}

/**
 * Find the first framework operator (`^word`) in operator position, or null when there is none.
 *
 * The core match is the operators.json registry pattern (SSOT); the quote-awareness and the
 * path/reference rejection are {@link findSigilOperatorsOutsideQuotes}', which a single regular
 * expression cannot express.
 */
export function findFrameworkOperatorOutsideQuotes(str: string): FrameworkOperatorMatch | null {
  return findSigilOperatorsOutsideQuotes(str, FRAMEWORK_OPERATOR_PATTERN)[0] ?? null;
}
