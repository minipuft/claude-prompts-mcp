// @lifecycle canonical - Shared helpers for command parsing normalization.
import { OPERATOR_PATTERNS } from './operator-patterns.js';

/** Framework operator core match, from the operators.json registry (SSOT). */
const FRAMEWORK_OPERATOR_PATTERN = OPERATOR_PATTERNS.framework.pattern;

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

  const chainStepPattern = /-->\s*>>\s*/g;
  if (chainStepPattern.test(normalized)) {
    normalized = normalized.replace(chainStepPattern, '--> ');
    hadPrefixes = true;
  }

  const parallelPattern = /\+\s*>>\s*/g;
  if (parallelPattern.test(normalized)) {
    normalized = normalized.replace(parallelPattern, '+ ');
    hadPrefixes = true;
  }

  const conditionalPattern = /:\s*>>\s*/g;
  if (conditionalPattern.test(normalized)) {
    normalized = normalized.replace(conditionalPattern, ': ');
    hadPrefixes = true;
  }

  const frameworkPrefixPattern = /^>>\s*@/;
  if (frameworkPrefixPattern.test(normalized)) {
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
  return input
    .replace(/#style(?:[:=]|\()([A-Za-z0-9_-]+)\)?/gi, ' ')
    .replace(/(?:^|\s)#[A-Za-z][A-Za-z0-9_-]*(?=\s|$)/g, ' ')
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
    if ((char === '"' || char === "'") && prevChar !== '\\') {
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
  /** The framework ID (without @) */
  frameworkId: string;
  /** Position in the string where the match starts */
  position: number;
  /** The full matched string including @ and any leading whitespace */
  fullMatch: string;
}

/**
 * Find a framework operator (@word) outside of quoted strings.
 * Returns the first match found, or null if no framework operator exists outside quotes.
 *
 * Automatically skips @word patterns that look like file paths or references:
 * - Contains '/' (e.g., @docs/path, @src/file)
 * - Contains '.' (e.g., @file.md, @config.json)
 *
 * This makes detection robust regardless of whether content is quoted.
 *
 * @param str - The command string to search
 * @returns The match details, or null if not found outside quotes
 */
export function findFrameworkOperatorOutsideQuotes(str: string): FrameworkOperatorMatch | null {
  // Core match derives from the operators.json registry (SSOT) — this used to be a second,
  // hand-maintained copy, which is why relaxing the registry pattern alone changed nothing
  // observable (plan row D6) and why the registry then sat two revisions stale without any gate
  // noticing (row D9). The registry's trailing `(?![A-Za-z0-9_-])` is redundant against a greedy
  // `[A-Za-z0-9_-]+` but harmless, so the two are behaviourally identical on the match itself.
  //
  // What does NOT derive: the quote-awareness and the `@docs/` / `@file.ext` rejection below.
  // A single regex cannot express them, which is why this extractor still exists rather than
  // being replaced by the registry pattern outright.
  const pattern = new RegExp(FRAMEWORK_OPERATOR_PATTERN.source, 'g');
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(str)) !== null) {
    const position = match.index;
    const frameworkId = match[1];

    if (!frameworkId) continue;

    // Skip if inside quotes
    if (isPositionInsideQuotes(str, position)) continue;

    // Check what character follows the match (if any)
    const endPosition = position + match[0].length;
    const nextChar = str[endPosition];

    // Skip if followed by '/' or '.' - clearly a path/reference, not a framework
    // Examples: @docs/path, @file.md, @src/components
    if (nextChar === '/' || nextChar === '.') continue;

    // Valid framework operator must be followed by whitespace, end of string,
    // or certain punctuation that wouldn't be part of a path
    if (nextChar !== undefined && !/[\s,;:)\]}>]/.test(nextChar)) continue;

    return {
      frameworkId,
      position,
      fullMatch: match[0],
    };
  }

  return null;
}
