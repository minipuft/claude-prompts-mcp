/**
 * Hand-written declarations for `exception-hygiene.js`.
 *
 * The module is `.js` because it is imported by `node`-run guards AND by `tsx`-run validators; a
 * `.ts` module would not be importable by the first group without a build step. `scripts/**` is
 * outside both tsconfigs, so the runtime never needs these — the Jest suite does, since
 * `tsconfig.test.json` includes `tests/**` and would otherwise report an untyped import.
 * Same arrangement as `eslint-rules/claude-plugin.d.ts`.
 */

export type Verdict =
  'load-bearing' | 'satisfied' | 'subject-missing' | 'unreachable' | 'redundant';

export declare const VERDICT: {
  readonly LOAD_BEARING: 'load-bearing';
  readonly SATISFIED: 'satisfied';
  readonly SUBJECT_MISSING: 'subject-missing';
  readonly UNREACHABLE: 'unreachable';
  readonly REDUNDANT: 'redundant';
};

export interface ExceptionProblem {
  readonly subject: string;
  readonly message: string;
}

export interface ExceptionAudit {
  readonly problems: ExceptionProblem[];
  readonly counts: Record<string, number>;
}

export declare function auditExceptions<T>(input: {
  gate: string;
  entries: readonly T[];
  describe: (entry: T) => string;
  closedBy?: (entry: T) => string | undefined;
  classify: (entry: T) => { verdict: Verdict; detail?: string };
}): ExceptionAudit;

export declare function reportExceptionAudit(gate: string, audit: ExceptionAudit): number;
