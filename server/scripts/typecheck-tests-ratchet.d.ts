/**
 * Hand-written declarations for `typecheck-tests-ratchet.js`.
 *
 * The module is `.js` because `node`-run scripts import it without a build step; `scripts/**` is
 * outside both tsconfigs, so the runtime never needs these. The Jest suite does, since
 * `tsconfig.test.json` includes `tests/**` and
 * `tests/unit/scripts/typecheck-tests-ratchet.test.ts` imports it. Same arrangement as
 * `scripts/lib/hermetic-server-env.d.ts`.
 *
 * `byCode` deliberately has no type here: it is informational only (see the comment on
 * `summarize()` in the `.js` file) and is never compared by `compare()` or
 * `findUnauthorizedIncreases()`, so there is nothing for a test to import for it.
 */

export type ByFile = Record<string, number>;

export interface FileIncrease {
  file: string;
  before: number;
  after: number;
}

export interface OverrideLogEntry {
  date: string;
  file: string;
  reason: string;
  before: number;
  after: number;
}

export interface FileRegression {
  file: string;
  baseline: number;
  current: number;
}

export interface VanishedFile {
  file: string;
  baseline: number;
}

export interface FileDecrease {
  file: string;
  baseline: number;
  current: number;
}

/** Parse repeatable `--allow-increase <file> <reason>` pairs from the argv tail. */
export declare function parseAllowIncreaseArgs(argv: string[]): Map<string, string>;

/** Files whose diagnostic count rose without a matching entry in `overrides`. */
export declare function findUnauthorizedIncreases(
  baselineByFile: ByFile | undefined,
  currentByFile: ByFile | undefined,
  overrides: Map<string, string>
): FileIncrease[];

/** Pure: the overrideLog to persist, given the overrides accepted this run. */
export declare function buildOverrideLog(
  previousOverrideLog: OverrideLogEntry[] | undefined,
  overrides: Map<string, string> | undefined,
  baselineByFile: ByFile | undefined,
  currentByFile: ByFile,
  generatedAt: string
): { overrideLog: OverrideLogEntry[]; unused: string[] };

/** `check()`'s comparison: per-file regressions, vanished files, and decreases (row B.67). */
export declare function compare(
  baseline: { byFile?: ByFile },
  current: { byFile?: ByFile }
): { regressions: FileRegression[]; vanished: VanishedFile[]; decreases: FileDecrease[] };
