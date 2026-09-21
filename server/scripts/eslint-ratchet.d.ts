/**
 * Hand-written declarations for `eslint-ratchet.js`.
 *
 * The module is `.js` because `node`-run scripts import it without a build step; `scripts/**` is
 * outside both tsconfigs, so the runtime never needs these. The Jest suite does, since
 * `tsconfig.test.json` includes `tests/**` and `tests/unit/scripts/eslint-ratchet.test.ts`
 * imports it. Same arrangement as `scripts/lib/hermetic-server-env.d.ts`.
 */

/** Per-rule finding counts, as ESLint's `severity` maps them: 2 -> errors, 1 -> warnings. */
export interface RuleCounts {
  errors: number;
  warnings: number;
}

export type ByRule = Record<string, RuleCounts>;

export interface RuleIncrease {
  ruleId: string;
  before: RuleCounts;
  after: RuleCounts;
}

export interface OverrideLogEntry {
  date: string;
  ruleId: string;
  reason: string;
  before: RuleCounts;
  after: RuleCounts;
}

export interface RuleRegression {
  ruleId: string;
  type: 'errors' | 'warnings';
  baseline: number;
  current: number;
}

export interface VanishedRule {
  ruleId: string;
  errors: number;
  warnings: number;
}

export interface RuleDecrease {
  ruleId: string;
  type: 'errors' | 'warnings';
  baseline: number;
  current: number;
}

/** Parse repeatable `--allow-increase <ruleId> <reason>` pairs from the argv tail. */
export declare function parseAllowIncreaseArgs(argv: string[]): Map<string, string>;

/** Rules whose errors or warnings rose without a matching entry in `overrides`. */
export declare function findUnauthorizedIncreases(
  baselineByRule: ByRule | undefined,
  currentByRule: ByRule | undefined,
  overrides: Map<string, string>
): RuleIncrease[];

/** Pure: the overrideLog to persist, given the overrides accepted this run. */
export declare function buildOverrideLog(
  previousOverrideLog: OverrideLogEntry[] | undefined,
  overrides: Map<string, string> | undefined,
  baselineByRule: ByRule | undefined,
  currentByRule: ByRule,
  generatedAt: string
): { overrideLog: OverrideLogEntry[]; unused: string[] };

/** `check()`'s comparison: per-rule regressions, vanished rules, and decreases (row B.67). */
export declare function compareSummaries(
  baseline: { byRule?: ByRule },
  current: { byRule?: ByRule }
): { regressions: RuleRegression[]; vanished: VanishedRule[]; decreases: RuleDecrease[] };
