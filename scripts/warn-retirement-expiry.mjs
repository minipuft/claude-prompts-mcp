#!/usr/bin/env node
/**
 * Warns, on a pull request, when a retirement ledger entry is past its `forgetAfter` date. Never
 * fails.
 *
 * WHY IT EXISTS. `server/tooling/contracts/registries/retirements.json` records each spelling the
 * product refuses and the date after which that refusal is due for deletion. `npm run
 * validate:retirements` prints the same warning on every local run and fails only when a major
 * release is cut after the date; this step puts the warning where a reviewer looks. A date passing
 * changes nothing a pull request controls, so failing here would turn every open pull request red
 * on that day, and the fix (deleting the entry, its refusal site and its test driver) is its own
 * change.
 *
 * WHAT IT DOES. Reads the ledger and `server/package.json`, and hands both to `expiryOutcomes`
 * (`server/scripts/lib/retirement-expiry.js`), the rule the gate applies. Each entry past its date
 * prints one warning naming it; under GitHub Actions the warning is a `::warning::` annotation,
 * elsewhere it starts with `warning: `, the convention `warn-contract-lag.mjs` uses. A missing or
 * unreadable file prints one plain line saying the comparison was skipped.
 *
 * EXIT STATUS IS ALWAYS 0, including on an unexpected exception. The workflow step also carries
 * `continue-on-error: true`, so not even a crash before `main` runs can fail the job.
 *
 * ZERO-DEPENDENCY: Node built-ins and one plain-JS module from this repository, so it runs before
 * any install.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  expiryOutcomes,
  isoToday,
} from "../server/scripts/lib/retirement-expiry.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * The entries past their date, as warning text, or a `skipped` reason when the ledger or the
 * package version cannot be read. `today` is a parameter so a probe can plant it.
 */
export function retirementExpiryWarnings({
  ledgerPath = path.join(
    REPO_ROOT,
    "server/tooling/contracts/registries/retirements.json",
  ),
  packagePath = path.join(REPO_ROOT, "server/package.json"),
  today = isoToday(),
} = {}) {
  let entries;
  let packageVersion;
  try {
    entries = JSON.parse(readFileSync(ledgerPath, "utf8")).retirements;
    packageVersion = JSON.parse(readFileSync(packagePath, "utf8")).version;
  } catch (error) {
    return {
      skipped: `the ledger or the package version is unreadable: ${error.message}`,
    };
  }
  if (!Array.isArray(entries)) {
    return { skipped: `${ledgerPath} holds no "retirements" array` };
  }
  const { warnings, failures } = expiryOutcomes(entries, {
    today,
    packageVersion,
  });
  return {
    warnings: [...failures, ...warnings].map((outcome) => outcome.message),
  };
}

function main() {
  const outcome = retirementExpiryWarnings();
  if (outcome.skipped) {
    console.log(`Retirement expiry not compared: ${outcome.skipped}.`);
    return;
  }
  const prefix = process.env.GITHUB_ACTIONS
    ? "::warning title=A retired spelling is past its forgetAfter date::"
    : "warning: ";
  for (const warning of outcome.warnings) console.log(`${prefix}${warning}`);
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  try {
    main();
  } catch (error) {
    console.log(`Retirement expiry not compared: ${error.message}.`);
  }
  process.exitCode = 0;
}
