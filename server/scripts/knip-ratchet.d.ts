/**
 * Hand-written declarations for `knip-ratchet.js`.
 *
 * The module is `.js` because `node`-run scripts import it without a build step; `scripts/**` is
 * outside both tsconfigs, so the runtime never needs these. The Jest suite does, since
 * `tsconfig.test.json` includes `tests/**` and `tests/unit/scripts/knip-ratchet.test.ts` imports
 * it. Same arrangement as `scripts/lib/hermetic-server-env.d.ts`.
 */

export type ByCategory = Record<string, number>;

export interface CategoryIncrease {
  category: string;
  before: number;
  after: number;
}

export interface OverrideLogEntry {
  date: string;
  category: string;
  reason: string;
  before: number;
  after: number;
}

export interface CategoryRegression {
  category: string;
  baseline: number;
  current: number;
}

export interface VanishedCategory {
  category: string;
  baseline: number;
}

export interface CategoryDecrease {
  category: string;
  baseline: number;
  current: number;
}

/** Parse repeatable `--allow-increase <category> <reason>` pairs from the argv tail. */
export declare function parseAllowIncreaseArgs(argv: string[]): Map<string, string>;

/** Categories whose count rose without a matching entry in `overrides`. */
export declare function findUnauthorizedIncreases(
  baselineByCategory: ByCategory | undefined,
  currentByCategory: ByCategory | undefined,
  overrides: Map<string, string>
): CategoryIncrease[];

/** Pure: the overrideLog to persist, given the overrides accepted this run. */
export declare function buildOverrideLog(
  previousOverrideLog: OverrideLogEntry[] | undefined,
  overrides: Map<string, string> | undefined,
  baselineByCategory: ByCategory | undefined,
  currentByCategory: ByCategory,
  generatedAt: string
): { overrideLog: OverrideLogEntry[]; unused: string[] };

/** The pre-existing `check()` comparison: per-category regressions, vanished, and decreases. */
export declare function compareSummaries(
  baseline: { byCategory?: ByCategory },
  current: { byCategory?: ByCategory }
): {
  regressions: CategoryRegression[];
  vanished: VanishedCategory[];
  decreases: CategoryDecrease[];
};
