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
