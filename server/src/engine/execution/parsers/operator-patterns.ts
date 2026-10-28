// @lifecycle canonical - Loads operator patterns from SSOT registry at import time.
/**
 * Operator patterns loaded from tooling/contracts/registries/operators.json (SSOT).
 *
 * Replaces the previous codegen approach (generate-operators.ts) with runtime loading.
 * JSON is imported directly — esbuild inlines it into the bundle, no file I/O needed.
 */

// JSON import — esbuild inlines, tsc resolves via resolveJsonModule
import contract from '../../../../tooling/contracts/registries/operators.json' with { type: 'json' };

interface OperatorEntry {
  pattern: RegExp;
  symbol: string;
  role: 'delimiter' | 'modifier' | 'prefix';
  status: 'implemented' | 'reserved' | 'deprecated';
}

type KnownOperators = {
  chain: OperatorEntry;
  delegation: OperatorEntry;
  gate: OperatorEntry;
  framework: OperatorEntry;
  style: OperatorEntry;
  repetition: OperatorEntry;
  parallel: OperatorEntry;
  conditional: OperatorEntry;
  [key: string]: OperatorEntry;
};

export const OPERATOR_PATTERNS: KnownOperators = Object.fromEntries(
  contract.operators.map((op) => [
    op.id,
    {
      pattern: new RegExp(op.pattern.typescript, op.pattern.flags ?? ''),
      symbol: op.symbol,
      role: op['role'] as OperatorEntry['role'],
      status: op.status,
    },
  ])
) as KnownOperators;

export type OperatorId = keyof typeof OPERATOR_PATTERNS;

export const IMPLEMENTED_OPERATORS = contract.operators
  .filter((op) => op.status === 'implemented')
  .map((op) => op.id);

/**
 * Operator id → symbol, for every operator the registry declares `reserved`.
 *
 * `status: reserved` is a published claim: the symbol is documented and deliberately NOT
 * executable. Keyed by id because the tokenizer emits operator ids, so enforcement can consume
 * this directly rather than re-deriving which symbols are off-limits.
 */
export const RESERVED_OPERATORS: ReadonlyMap<string, string> = new Map(
  contract.operators.filter((op) => op.status === 'reserved').map((op) => [op.id, op.symbol])
);

/** The framework operator's canonical sigil (`^`), from the registry. */
export const FRAMEWORK_SIGIL: string = OPERATOR_PATTERNS.framework.symbol;

/**
 * Spellings of the framework operator that still parse but are no longer canonical (`@`),
 * from the registry's `deprecatedSymbols`. An alias is accepted, never refused.
 */
export const DEPRECATED_FRAMEWORK_SIGILS: readonly string[] = contract.operators.flatMap((op) =>
  op.id === 'framework' && 'deprecatedSymbols' in op ? (op.deprecatedSymbols ?? []) : []
);

/**
 * Regex character class matching every accepted framework sigil, canonical and deprecated, for
 * the sites that strip a framework prefix from a command or chain step. Derived rather than
 * written as `[@^]`, so a spelling the registry adds or retires reaches those sites too.
 */
export const FRAMEWORK_SIGIL_CLASS = `[${[FRAMEWORK_SIGIL, ...DEPRECATED_FRAMEWORK_SIGILS]
  .map((sigil) => sigil.replace(/[\\\]^-]/g, '\\$&'))
  .join('')}]`;

/**
 * The one advisory line a command owes its caller when it spelled the framework operator with a
 * deprecated sigil, or `null` when the sigil is canonical (or not a framework sigil at all).
 *
 * Pure so the wording lives beside the registry that names the spellings. `frameworkId` is the id
 * as typed, so the line shows the exact replacement to paste.
 */
export function deprecatedFrameworkSigilNote(sigil: string, frameworkId: string): string | null {
  if (!DEPRECATED_FRAMEWORK_SIGILS.includes(sigil)) return null;
  return (
    `Deprecated spelling: \`${sigil}${frameworkId}\` still works, but the framework operator is ` +
    `\`${FRAMEWORK_SIGIL}${frameworkId}\`; \`${sigil}\` is removed at the next major.`
  );
}
