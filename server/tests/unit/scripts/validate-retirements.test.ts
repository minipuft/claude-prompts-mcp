/**
 * `validate:retirements` with a planted case per check (1, 2 and 4), each asserting the failure
 * names the entry it is about, then the live tree as the clean case. The checks are pure
 * functions over entries, sites and driver ids, so every planted case is data; the site and
 * driver scanners are driven over planted source text, including a commented-out call that must
 * not count as a site.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expiryOutcomes } from '../../../scripts/lib/retirement-expiry.js';
import {
  DRIVER_FILE,
  findDriverIds,
  findRetirementSites,
  runRetirementChecks,
  scanRefusalSites,
} from '../../../scripts/validate-retirements.js';
import { listRetirements } from '../../../src/shared/utils/retirement-notice.js';

import type { RetirementCheckInput } from '../../../scripts/validate-retirements.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const ENTRY = { id: 'planted-entry', refusedIn: '6.0.0', forgetAfter: '2027-06-01' };
const OTHER = { id: 'other-entry', refusedIn: '6.0.0', forgetAfter: '2027-06-01' };

/** A clean planted input: two entries, each with a site and a driver, before any date. */
function clean(overrides: Partial<RetirementCheckInput> = {}): RetirementCheckInput {
  return {
    entries: [ENTRY, OTHER],
    sites: [
      { id: ENTRY.id, file: 'server/src/a.ts', line: 3 },
      { id: OTHER.id, file: 'cli/src/b.ts', line: 9 },
    ],
    driverIds: [ENTRY.id, OTHER.id],
    today: '2026-11-27',
    packageVersion: '6.0.0',
    ...overrides,
  };
}

function failureMessages(input: RetirementCheckInput): string[] {
  return runRetirementChecks(input).failures.map((finding) => finding.message);
}

describe('validate:retirements', () => {
  it('passes the planted clean input (control for every case below)', () => {
    expect(runRetirementChecks(clean())).toEqual({ failures: [], warnings: [] });
  });

  describe('check 1: entries and refusal sites', () => {
    it('fails an entry no site refuses, naming it', () => {
      const failures = runRetirementChecks(
        clean({ sites: [{ id: OTHER.id, file: 'cli/src/b.ts', line: 9 }] })
      ).failures;

      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ check: 1, subject: ENTRY.id });
      expect(failures[0]?.message).toContain(`retirementNotice('${ENTRY.id}')`);
    });

    it('fails a site whose id names no entry, naming the id and the site', () => {
      const sites = [...clean().sites, { id: 'unknown-entry', file: 'server/src/c.ts', line: 12 }];
      const messages = failureMessages(clean({ sites }));

      expect(messages).toEqual([
        "server/src/c.ts:12: retirementNotice('unknown-entry') names no entry in retirements.json.",
      ]);
    });

    it('fails a site that passes a non-literal id', () => {
      const sites = [...clean().sites, { id: null, file: 'server/src/d.ts', line: 4 }];

      expect(failureMessages(clean({ sites }))).toEqual([
        'server/src/d.ts:4: retirementNotice() is called without a string-literal id, which no entry can be joined to.',
      ]);
    });

    it('reads calls from the syntax tree: a commented-out call and a quoted id are not sites', () => {
      const text = [
        "import { retirementNotice } from '#shared/utils/retirement-notice.js';",
        "// retirementNotice('in-a-line-comment');",
        "/* retirementNotice('in-a-block-comment'); */",
        'const prose = "call retirementNotice(\'in-a-string\') at the boundary";',
        "const notice = retirementNotice('live-call');",
        'const dynamic = retirementNotice(idFromSomewhere);',
        "const viaNamespace = ledger.retirementNotice('namespaced-call');",
      ].join('\n');

      expect(findRetirementSites('server/src/x.ts', text)).toEqual([
        { id: 'live-call', file: 'server/src/x.ts', line: 5 },
        { id: null, file: 'server/src/x.ts', line: 6 },
        { id: 'namespaced-call', file: 'server/src/x.ts', line: 7 },
      ]);
    });
  });

  describe('check 2: drivers', () => {
    it('fails an entry with no driver, naming it', () => {
      const failures = runRetirementChecks(clean({ driverIds: [OTHER.id] })).failures;

      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ check: 2, subject: ENTRY.id });
      expect(failures[0]?.message).toContain(`${ENTRY.id}: no driver in ${DRIVER_FILE}`);
    });

    it('fails a driver for an id the ledger does not hold', () => {
      const failures = runRetirementChecks(
        clean({ driverIds: [ENTRY.id, OTHER.id, 'stray-driver'] })
      ).failures;

      expect(failures).toMatchObject([{ check: 2, subject: 'stray-driver' }]);
    });

    it('fails when the driver table cannot be found, rather than reading it as empty', () => {
      expect(runRetirementChecks(clean({ driverIds: null })).failures).toMatchObject([
        { check: 2, subject: DRIVER_FILE },
      ]);
      expect(findDriverIds('const drivers = {};')).toBeNull();
    });

    it('reads the DRIVERS keys, quoted or bare, through a type annotation or satisfies', () => {
      const annotated =
        "const DRIVERS: Record<string, Driver> = { 'planted-entry': () => '', bare: () => '' };";
      const satisfied =
        "const DRIVERS = { 'other-entry': () => '' } satisfies Record<string, Driver>;";

      expect(findDriverIds(annotated)).toEqual(['planted-entry', 'bare']);
      expect(findDriverIds(satisfied)).toEqual(['other-entry']);
    });
  });

  describe('check 4: expiry', () => {
    const expired = { ...ENTRY, refusedIn: '5.0.0', forgetAfter: '2026-11-01' };

    it('fails an entry past its date once the package is a major release after its refusal', () => {
      const result = runRetirementChecks(
        clean({ entries: [expired, OTHER], packageVersion: '6.0.0' })
      );

      expect(result.warnings).toEqual([]);
      expect(result.failures).toHaveLength(1);
      expect(result.failures[0]).toMatchObject({ check: 4, subject: ENTRY.id });
      expect(result.failures[0]?.message).toContain(
        `${ENTRY.id}: forgetAfter 2026-11-01 has passed`
      );
    });

    it('only warns for an entry past its date under the same major, and the gate passes', () => {
      const result = runRetirementChecks(
        clean({ entries: [expired, OTHER], packageVersion: '5.4.0' })
      );

      expect(result.failures).toEqual([]);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatchObject({ check: 4, subject: ENTRY.id });
    });

    it('reports nothing on the date itself or before it, whatever the major', () => {
      const onTheDay = { ...expired, forgetAfter: '2026-11-27' };

      expect(expiryOutcomes([onTheDay], { today: '2026-11-27', packageVersion: '9.0.0' })).toEqual({
        warnings: [],
        failures: [],
      });
    });
  });

  it('passes the live tree: every ledger entry has a site and a driver', () => {
    const entries = listRetirements();
    const sites = scanRefusalSites();
    const driverIds = findDriverIds(readFileSync(path.join(REPO_ROOT, DRIVER_FILE), 'utf8'));

    // The scans observed something: a site per entry and one driver per entry.
    expect(new Set(sites.map((site) => site.id))).toEqual(
      new Set(entries.map((entry) => entry.id))
    );
    expect([...(driverIds ?? [])].sort()).toEqual(entries.map((entry) => entry.id).sort());
    expect(
      runRetirementChecks({
        entries,
        sites,
        driverIds,
        today: '2026-11-27',
        packageVersion: '5.1.1',
      }).failures
    ).toEqual([]);
  });
});
