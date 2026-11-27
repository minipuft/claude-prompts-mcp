// @lifecycle canonical - The text a refusal site reads from the retirement ledger's projection.
/**
 * The retirement ledger, `tooling/contracts/registries/retirements.json`: one entry per spelling
 * the product once accepted and now refuses. A refusal site reads its entry from the generated
 * projection (`./_generated/retirement-notices.ts`) and composes the text under its own prefix
 * (`Refusing to start:`, a schema issue, a notice), so the replacement sentence is written once,
 * in the ledger:
 *
 *   import * as retirementNotices from '#shared/utils/_generated/retirement-notices.js';
 *   const notice = retirementNotices.configFileUnversioned; // entry `config-file-unversioned`
 *
 * The namespace import and the read by name are what let a bundle keep only the entries its code
 * reaches. A member that names no entry is a type error; `npm run validate:retirements` joins
 * every entry to the sites that read it and reports expired entries.
 */

/** The text a refusal site composes under its own prefix. */
export interface RetirementNotice {
  readonly retired: string;
  readonly replacement: string;
  readonly refusedIn: string;
}
