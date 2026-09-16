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
 *
 * This module also carries `formatCheckLine`: the runtime guidance renderer and the skills
 * export used to format a check's line independently, and drifted to two different
 * phrasings (`check: runs \`...\`` vs `Passes \`...\``) describing the same criterion. Export
 * asserts an outcome ("Passes") that it cannot know — it writes a static file once, at
 * export time, and has no way to know whether a rerun of the command will still pass. Both
 * surfaces now read the same function, phrased as what the engine actually does: run the
 * command and record its exit code.
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

/**
 * One `pass_criteria` entry, as read by `formatCheckLine` — the fields it actually inspects,
 * not the full gate schema. `shell_command` accepts a bare string alongside the argv array the
 * current schema requires: a gate.yaml written before the 2026-08-29 argv migration is refused
 * at load, but the export path reads `gate.yaml` files directly off disk (not through the
 * loader), so a legacy string is still a shape it must render rather than silently drop.
 */
export interface GateTierCriterion {
  type?: string;
  shell_command?: ReadonlyArray<string> | string;
  script_tool_id?: string;
}

/**
 * One check's guidance line, naming the command or tool that produces its verdict — never its
 * guidance prose. Shared by the runtime guidance renderer (`GatePassCriteria[]`, argv-only) and
 * the skills export (`unknown[]` off a raw parsed `gate.yaml`, legacy string still possible) —
 * see the module doc for why one function replaced two drifted phrasings.
 */
export function formatCheckLine(
  name: string,
  passCriteria: ReadonlyArray<GateTierCriterion | Record<string, unknown> | null | undefined>
): string {
  const criteria = passCriteria.map((entry) => (entry ?? {}) as GateTierCriterion);
  const criterion = criteria.find(
    (entry) => entry.type === 'shell_verify' || entry.type === 'script_tool'
  );

  if (criterion?.type === 'shell_verify') {
    const { shell_command: shellCommand } = criterion;
    if (Array.isArray(shellCommand) && shellCommand.length > 0) {
      return `- **${name}** — check: runs \`${shellCommand.join(' ')}\``;
    }
    if (typeof shellCommand === 'string' && shellCommand.length > 0) {
      return `- **${name}** — check: runs \`${shellCommand}\``;
    }
  }
  if (criterion?.type === 'script_tool' && criterion.script_tool_id) {
    return `- **${name}** — check: runs tool \`${criterion.script_tool_id}\``;
  }

  // A check whose criterion names neither a command nor a tool id cannot run; still list it,
  // so an operator sees the gate rather than silently losing it.
  return `- **${name}** — check`;
}
