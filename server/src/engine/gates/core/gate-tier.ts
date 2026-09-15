// @lifecycle canonical - Derives a gate's tier (check vs reminder) from its pass criteria.
/**
 * Gate Tier
 *
 * A gate is a `check` when at least one of its `pass_criteria` entries carries a real
 * runtime evaluator — `shell_verify` (exit-code ground truth) or `script_tool` (structured
 * verdict from a registered tool). Every other gate is a `reminder`, including a gate with
 * no `pass_criteria` at all, and a gate whose `pass_criteria` only sets pattern/length
 * fields (`required_patterns`, `regex_patterns`, `keyword_count`, `min_length`,
 * `max_length`, `forbidden_patterns`) — those fields never had an evaluator that flips a
 * verdict, and since row 1.5 they are refused at load rather than accepted and ignored
 * (ruling B9, ~/.claude/plans/gate-checks-and-reminders.md). They are still named here
 * because a gate.yaml predating that rejection is what someone reading this will be
 * holding.
 *
 * `server/scripts/generate-gate-index.js` carries a JS copy of this same rule so the
 * generated `_index.md` Tier column can be produced without a TS build step. The two
 * copies are kept in step by the registry cross-check in
 * `server/tests/unit/gates/core/gate-tier.test.ts`, which loads every `gate.yaml`, parses
 * `_index.md`'s Tier column, and asserts both rules agree for all gates.
 */

import type { GatePassCriteria } from '../types/gate-primitives.js';

/** A gate's tier: `check` has a runtime evaluator, `reminder` is guidance-only. */
export type GateTier = 'check' | 'reminder';

/** The only `pass_criteria[].type` values with a runtime pass/fail evaluator. */
const EVALUATED_PASS_CRITERIA_TYPES: ReadonlySet<GatePassCriteria['type']> = new Set([
  'shell_verify',
  'script_tool',
]);

/**
 * Structural shape this function actually reads. Both the loader's
 * `LightweightGateDefinition` and a bare parsed `gate.yaml` object satisfy it, so this stays
 * the parameter type instead of importing the loader's type — the narrowest type both the
 * loader output and the test can satisfy.
 */
export interface GateTierSource {
  pass_criteria?: Array<{ type?: string }>;
}

/**
 * Derive a gate's tier from its `pass_criteria`.
 *
 * `check` iff at least one criterion's `type` is `shell_verify` or `script_tool`.
 * A gate with no `pass_criteria` (or none matching) is a `reminder`.
 */
export function deriveGateTier(definition: GateTierSource): GateTier {
  const criteria = definition.pass_criteria ?? [];
  const hasEvaluator = criteria.some((criterion) =>
    EVALUATED_PASS_CRITERIA_TYPES.has(criterion.type as GatePassCriteria['type'])
  );
  return hasEvaluator ? 'check' : 'reminder';
}
