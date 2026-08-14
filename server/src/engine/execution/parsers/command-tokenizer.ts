// @lifecycle canonical - Single-pass quote-aware command tokenizer.
/**
 * Command Tokenizer
 *
 * Centralizes operator detection that was previously duplicated across
 * 3 parsing strategies. Pure function — no side effects, no logger.
 *
 * Strategies consume TokenizedCommand instead of re-detecting operators.
 */

import { RESERVED_OPERATORS } from './operator-patterns.js';
import { isPositionInsideQuotes, findFrameworkOperatorOutsideQuotes } from './parser-utils.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TokenizedOperator {
  type:
    | 'chain'
    | 'delegation'
    | 'gate'
    | 'parallel'
    | 'repetition'
    | 'conditional'
    | 'framework'
    | 'style';
  /** Raw matched text (may include leading whitespace from regex) */
  raw: string;
  /** Position in the trimmed command string */
  position: number;
  /** Operator-specific value (framework ID, style ID, gate criteria, count, etc.) */
  value?: string;
}

export interface TokenizedCommand {
  /** Original command string (unmodified) */
  raw: string;
  /** Detected format */
  format: 'json' | 'symbolic' | 'simple';
  /** Extracted prompt ID (null for JSON format) */
  promptId: string | null;
  /** Raw argument string (operators stripped) */
  rawArgs: string;
  /** All operators found outside quoted strings */
  operators: TokenizedOperator[];
  /** Whether any symbolic operators were found */
  hasSymbolicOperators: boolean;
  /** Command with modifier operators stripped (quote-aware). Delimiters preserved. */
  cleanedCommand: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Find all matches of a global regex that occur outside quoted strings.
 * Pattern MUST have the `g` flag.
 */
function findMatchesOutsideQuotes(str: string, pattern: RegExp): RegExpExecArray[] {
  const matches: RegExpExecArray[] = [];
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(str)) !== null) {
    if (!isPositionInsideQuotes(str, match.index)) {
      matches.push(match);
    }
  }
  return matches;
}

/**
 * Check if a match at [position, position+length) overlaps any range in `ranges`.
 */
function overlapsRanges(
  position: number,
  length: number,
  ranges: ReadonlyArray<readonly [number, number]>
): boolean {
  for (const [start, end] of ranges) {
    if (position < end && position + length > start) return true;
  }
  return false;
}

/**
 * Strip modifier operators (framework, gate, style, repetition) from command.
 * Delimiter operators (chain, delegation, parallel, conditional) are preserved
 * because strategies need them for structural splitting.
 */
function buildCleanedCommand(command: string, operators: TokenizedOperator[]): string {
  if (operators.length === 0) return command;

  const modifiers = operators.filter(
    (op) =>
      op.type === 'framework' ||
      op.type === 'gate' ||
      op.type === 'style' ||
      op.type === 'repetition'
  );

  // Sort descending by position so removals don't shift earlier positions
  const sorted = [...modifiers].sort((a, b) => b.position - a.position);

  let result = command;
  for (const op of sorted) {
    const before = result.slice(0, op.position);
    const after = result.slice(op.position + op.raw.length);
    result = before + ' ' + after;
  }

  // Strip trailing verify options (:fast, :full, :extended, loop:true/false, max:N, timeout:N)
  result = result.replace(
    /\s+(?::(fast|full|extended)\b|loop:(true|false)\b|max:\d+\b|timeout:\d+\b)/gi,
    ''
  );

  return result.replace(/\s+/g, ' ').trim();
}

/**
 * Extract prompt ID and raw args from the base segment of a cleaned command.
 * Only splits by delimiters when delimiter operators were actually detected
 * (prevents splitting on +, ?, etc. that appear inside quoted argument values).
 */
function extractPromptInfo(
  cleanedCommand: string,
  operators: TokenizedOperator[]
): { promptId: string | null; rawArgs: string } {
  const withoutDelegation = cleanedCommand.replace(/^\s*(?:==>\s*)+/, '');

  // Only split by delimiters if actual delimiter operators were detected outside quotes
  const hasDelimiters = operators.some(
    (op) =>
      op.type === 'chain' ||
      op.type === 'delegation' ||
      op.type === 'parallel' ||
      op.type === 'conditional'
  );

  const baseSegment = hasDelimiters
    ? (withoutDelegation.split(/-->|==>|\+|\?/)[0]?.trim() ?? '')
    : withoutDelegation.trim();

  const match = baseSegment.match(/^(?:>>)?([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/);
  const promptId = match?.[1];
  if (promptId === undefined) {
    return { promptId: null, rawArgs: '' };
  }

  return {
    promptId,
    rawArgs: (match?.[2] ?? '').trim(),
  };
}

// ---------------------------------------------------------------------------
// Per-operator detection (extracted to reduce tokenizeCommand complexity)
// ---------------------------------------------------------------------------

/** Detect chain (-->) and delegation (==>) delimiters. */
function detectDelimiters(trimmed: string, operators: TokenizedOperator[]): void {
  for (const m of findMatchesOutsideQuotes(trimmed, /-->/g)) {
    operators.push({ type: 'chain', raw: m[0], position: m.index });
  }
  for (const m of findMatchesOutsideQuotes(trimmed, /==>/g)) {
    operators.push({ type: 'delegation', raw: m[0], position: m.index });
  }
}

/** Detect gate operators (:: or = followed by criteria), skipping delimiter overlaps. */
function detectGates(
  trimmed: string,
  operators: TokenizedOperator[],
  delimiterRanges: ReadonlyArray<readonly [number, number]>
): void {
  const gatePattern =
    /\s+(::|=)\s*(?:([a-z][a-z0-9_-]*):["']([^"']+)["']|[a-z][a-z0-9_-]*\([^)]+\)|["']([^"']+)["']|([^\s"']+))/gi;
  for (const m of findMatchesOutsideQuotes(trimmed, gatePattern)) {
    if (overlapsRanges(m.index, m[0].length, delimiterRanges)) continue;
    const namedId = m[2];
    const namedText = m[3];
    const anonQuoted = m[4];
    const canonical = m[5];
    const value =
      namedId !== undefined && namedText !== undefined
        ? `${namedId}:${namedText}`
        : (anonQuoted ?? canonical);
    operators.push({ type: 'gate', raw: m[0], position: m.index, value });
  }
}

/** Detect framework (@word), style (#id), and repetition (*N) operators. */
function detectModifiers(trimmed: string, operators: TokenizedOperator[]): void {
  // Framework operators (@word) — quote-aware with path/reference exclusion
  const fwMatch = findFrameworkOperatorOutsideQuotes(trimmed);
  if (fwMatch !== null) {
    operators.push({
      type: 'framework',
      raw: fwMatch.fullMatch,
      position: fwMatch.position,
      value: fwMatch.frameworkId,
    });
  }

  // Style operators (#id)
  for (const m of findMatchesOutsideQuotes(trimmed, /(?:^|\s)#([A-Za-z][A-Za-z0-9_-]*)(?=\s|$)/g)) {
    const styleId = m[1];
    if (styleId !== undefined) {
      operators.push({ type: 'style', raw: m[0], position: m.index, value: styleId });
    }
  }

  // Repetition (*N)
  for (const m of findMatchesOutsideQuotes(trimmed, /\s*\*\s*(\d+)(?=\s|$|-->)/g)) {
    const count = m[1];
    if (count !== undefined) {
      operators.push({ type: 'repetition', raw: m[0], position: m.index, value: count });
    }
  }
}

/** Detect parallel (+) and conditional (? "cond" : branch) operators. */
function detectStructural(trimmed: string, operators: TokenizedOperator[]): void {
  // Parallel (+) — chains take precedence, EXCEPT while `+` is reserved.
  //
  // The precedence rule exists so a `+` inside a chain is not mis-parsed as a parallel execution
  // step. That reasoning only holds for an operator something can actually execute: `+` is
  // `status: reserved` in operators.json, so no strategy may consume the token — `rejectReserved-
  // Operators` throws before any of them run. Suppressing it therefore bought nothing and cost the
  // rejection: `>>a --> >>b + >>c` swallowed the `+` into argument text and ran a 2-step chain,
  // while the standalone form correctly errored and `?` was rejected in the same position
  // (measured 2026-08-11, plan row 0.5.15). Emitting it lets the reserved check see it.
  //
  // The moment `+` is implemented its registry status changes, this condition goes false, and the
  // original precedence rule applies again — which is why this is keyed on the registry rather
  // than deleted outright.
  const parallelIsReserved = RESERVED_OPERATORS.has('parallel');
  const hasChainOrDelegation = operators.some(
    (op) => op.type === 'chain' || op.type === 'delegation'
  );
  if (!hasChainOrDelegation || parallelIsReserved) {
    for (const m of findMatchesOutsideQuotes(trimmed, /\+/g)) {
      operators.push({ type: 'parallel', raw: m[0], position: m.index });
    }
  }

  // Conditional (? "condition" : branch) — full pattern required, bare ? ignored
  const condPattern = /\s*\?\s*["'](.+?)["']\s*:\s*(?:>>)?\s*([A-Za-z0-9_-]+)/g;
  for (const m of findMatchesOutsideQuotes(trimmed, condPattern)) {
    const condition = m[1];
    if (condition !== undefined) {
      operators.push({ type: 'conditional', raw: m[0], position: m.index, value: condition });
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

/**
 * Tokenize a command string into a structured result.
 *
 * Performs quote-aware operator detection in a single call, producing results
 * that parsing strategies can consume without re-detecting operators.
 *
 * @param command - The raw command string
 * @returns TokenizedCommand with detected format, operators, and cleaned command
 */
export function tokenizeCommand(command: string): TokenizedCommand {
  const raw = command;
  const trimmed = command.trim();

  // --- JSON format (early return — no operator scanning needed) ---
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return {
      raw,
      format: 'json',
      promptId: null,
      rawArgs: '',
      operators: [],
      hasSymbolicOperators: false,
      cleanedCommand: trimmed,
    };
  }

  const operators: TokenizedOperator[] = [];

  // Detect all operator types outside quoted strings
  detectDelimiters(trimmed, operators);

  const delimiterRanges: Array<readonly [number, number]> = operators
    .filter((op) => op.type === 'chain' || op.type === 'delegation')
    .map((op) => [op.position, op.position + op.raw.length] as const);

  detectGates(trimmed, operators, delimiterRanges);
  detectModifiers(trimmed, operators);
  detectStructural(trimmed, operators);

  // --- Derive format, cleaned command, and prompt info ---
  const hasSymbolicOperators = operators.length > 0;
  const format = hasSymbolicOperators ? 'symbolic' : 'simple';
  const cleanedCommand = buildCleanedCommand(trimmed, operators);
  const { promptId, rawArgs } = extractPromptInfo(cleanedCommand, operators);

  return { raw, format, promptId, rawArgs, operators, hasSymbolicOperators, cleanedCommand };
}
