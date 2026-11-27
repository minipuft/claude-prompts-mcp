/**
 * When a retirement ledger entry has outlived its date, and whether that only warns or fails.
 *
 * An entry carries `forgetAfter`, the date after which its refusal is due for deletion. Before the
 * date nothing is reported. From the date every run warns, naming the entry. The warning becomes a
 * failure only when the package's major version is greater than the major of the entry's
 * `refusedIn`: a major release cut after the date is the boundary at which the refusal, its test
 * driver and the entry are deleted together. A date alone never fails an unrelated change.
 *
 * WHY PLAIN JS IN `scripts/lib`. Two readers: `validate-retirements.ts` (tsx) and the root
 * `scripts/warn-retirement-expiry.mjs`, which runs on a pull request before any install and
 * cannot import TypeScript. One file, typed for the TS side by `retirement-expiry.d.ts`, the same
 * arrangement as `dist-freshness.js`.
 */

/** The major of `MAJOR.MINOR.PATCH` (an optional leading `v`), or null when unparseable. */
function majorOf(version) {
  const match = /^v?(\d+)\.\d+\.\d+/.exec(String(version ?? '').trim());
  return match ? Number(match[1]) : null;
}

/** Today as the ISO date `YYYY-MM-DD`, in UTC, the form `forgetAfter` is written in. */
export function isoToday(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * Splits the entries past their `forgetAfter` into warnings and failures. `today` and
 * `packageVersion` are parameters so a test can plant both; an entry whose date is `today` is
 * not yet past it.
 *
 * @param {ReadonlyArray<{id: string, refusedIn: string, forgetAfter: string}>} entries
 * @param {{today: string, packageVersion: string}} context
 */
export function expiryOutcomes(entries, { today, packageVersion }) {
  const packageMajor = majorOf(packageVersion);
  if (packageMajor === null) {
    throw new Error(
      `retirement expiry: package version ${JSON.stringify(packageVersion)} is not MAJOR.MINOR.PATCH`
    );
  }
  const warnings = [];
  const failures = [];
  for (const entry of entries) {
    if (!(entry.forgetAfter < today)) continue;
    const refusedMajor = majorOf(entry.refusedIn);
    const pastMajor = refusedMajor !== null && packageMajor > refusedMajor;
    const outcome = {
      id: entry.id,
      message: pastMajor
        ? `${entry.id}: forgetAfter ${entry.forgetAfter} has passed and the package is ${packageVersion}, a major release after its refusal in ${entry.refusedIn}. Delete the entry, its refusal site, its test driver and its line on the upgrade page in one commit.`
        : `${entry.id}: forgetAfter ${entry.forgetAfter} has passed. Delete the entry, its refusal site and its test driver before the next major release; that release fails until they are gone.`,
    };
    (pastMajor ? failures : warnings).push(outcome);
  }
  return { warnings, failures };
}
