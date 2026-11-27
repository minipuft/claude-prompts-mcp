/**
 * Hand-written declarations for `retirement-expiry.js`, which stays plain JS so the root
 * `scripts/warn-retirement-expiry.mjs` can import it before any install. Same arrangement as
 * `dist-freshness.d.ts`.
 */

export interface RetirementExpiryInput {
  readonly id: string;
  readonly refusedIn: string;
  readonly forgetAfter: string;
}

export interface RetirementExpiryOutcome {
  readonly id: string;
  readonly message: string;
}

export declare function isoToday(now?: Date): string;

export declare function expiryOutcomes(
  entries: ReadonlyArray<RetirementExpiryInput>,
  context: { today: string; packageVersion: string }
): { warnings: RetirementExpiryOutcome[]; failures: RetirementExpiryOutcome[] };
