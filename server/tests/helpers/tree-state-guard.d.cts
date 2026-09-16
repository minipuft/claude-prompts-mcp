/**
 * Hand-written declarations for `tree-state-guard.cjs`.
 *
 * The guard is CommonJS because jest loads `globalSetup`/`globalTeardown` outside the ESM
 * transform. `tests/unit/scripts/tree-state-guard.test.ts` imports it statically — a runtime
 * `createRequire` would hide every export from `knip` — so the test typecheck needs these.
 * Same arrangement as `scripts/lib/hermetic-server-env.d.ts`.
 */

/** A path a run legitimately creates, and the generator that creates it. */
export interface DeclaredPath {
  prefix: string;
  reason: string;
}

/** A path a run creates because of an unfixed defect, with the source line that causes it. */
export interface KnownLeak {
  prefix: string;
  file: string;
  anchor: string;
  defect: string;
  asOf: string;
  flipsWhen: string;
}

export interface TreeStateVerdict {
  /** Why the run could not be measured, or `null` when it was. */
  unreadable: string | null;
  leaked: string[];
  declared?: string[];
  knownLeaks?: string[];
}

export declare const REPO_ROOT: string;
export declare const DECLARED: readonly DeclaredPath[];
export declare const KNOWN_LEAKS: readonly KnownLeak[];
export declare function capture(): void;
export declare function added(): TreeStateVerdict;
export declare function classify(before: string[] | null, after: string[] | null): TreeStateVerdict;
export declare function listEntries(cwd?: string): string[] | null;
export declare function entryPath(line: string): string;
export declare function declarationFor(entryPath: string): DeclaredPath | undefined;
