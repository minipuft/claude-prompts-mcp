/**
 * `validate:retirements` with a planted case per check (1 to 5), each asserting the failure
 * names the entry or the file it is about, then the live tree as the clean case. The checks are pure
 * functions over entries, sites and driver ids, so every planted case is data; the site and
 * driver scanners are driven over planted source text, including a commented-out call that must
 * not count as a site.
 */
import { describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderUpgradingPage, UPGRADING_PAGE } from '../../../scripts/generate-retirements-doc.js';
import { expiryOutcomes } from '../../../scripts/lib/retirement-expiry.js';
import { selectUserFacingFiles } from '../../../scripts/lib/user-facing-scope.js';
import {
  DRIVER_FILE,
  findDriverIds,
  findRetirementSites,
  runRetirementChecks,
  scanRefusalSites,
  scanUserFacingText,
} from '../../../scripts/validate-retirements.js';
import { listRetirements } from '../../../src/shared/utils/retirement-notice.js';

import type { RetirementCheckInput } from '../../../scripts/validate-retirements.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

const ENTRY = {
  id: 'planted-entry',
  refusedIn: '6.0.0',
  forgetAfter: '2027-06-01',
  docPattern: 'PLANTED_RETIRED_NAME',
};
const OTHER = {
  id: 'other-entry',
  refusedIn: '6.0.0',
  forgetAfter: '2027-06-01',
  docPattern: null,
};
const PAGE = '# Upgrading\n\nplanted page\n';

/** A clean planted input: two entries, each with a site and a driver, before any date. */
function clean(overrides: Partial<RetirementCheckInput> = {}): RetirementCheckInput {
  return {
    entries: [ENTRY, OTHER],
    sites: [
      { id: ENTRY.id, file: 'server/src/a.ts', line: 3 },
      { id: OTHER.id, file: 'cli/src/b.ts', line: 9 },
    ],
    driverIds: [ENTRY.id, OTHER.id],
    texts: [
      { file: 'docs/guides/clean.md', lines: [{ line: 1, text: 'Describe the current form.' }] },
    ],
    expectedPage: PAGE,
    upgradingPage: PAGE,
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

  describe('check 3: retired spellings in user-facing text', () => {
    const git = (cwd: string, ...args: string[]): void => {
      const env = Object.fromEntries(
        Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))
      );
      execFileSync('git', args, { cwd, env, stdio: 'ignore' });
    };
    const plant = (root: string, file: string, text: string): void => {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), text);
    };

    it('fails a guide that names a retired spelling, naming the file, the line and the entry', () => {
      const texts = [
        {
          file: 'docs/guides/setup.md',
          lines: [
            { line: 1, text: 'Describe the profile.' },
            { line: 2, text: 'Set PLANTED_RETIRED_NAME to a folder.' },
          ],
        },
      ];

      const failures = runRetirementChecks(clean({ texts })).failures;

      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ check: 3, subject: ENTRY.id });
      expect(failures[0]?.message).toContain('docs/guides/setup.md:2');
      expect(failures[0]?.message).toContain(ENTRY.id);
      expect(failures[0]?.message).toContain(
        'Describe the current form; the old spelling lives on docs/reference/upgrading.md'
      );
    });

    it('skips an entry whose docPattern is null, whatever the text says', () => {
      const texts = [{ file: 'docs/guides/setup.md', lines: [{ line: 1, text: 'other-entry' }] }];

      expect(runRetirementChecks(clean({ texts })).failures).toEqual([]);
    });

    it('reads a planted tracked tree: guides, resources and contract descriptions fail; adr, architecture, the changelog, the page and a registry do not', () => {
      const root = mkdtempSync(path.join(tmpdir(), 'retirement-scope-'));
      try {
        const naming = 'Set PLANTED_RETIRED_NAME here.\n';
        plant(root, 'docs/guides/bad.md', `# Bad\n\n${naming}`);
        plant(root, 'docs/adr/0001-old.md', naming);
        plant(root, 'docs/architecture/overview.md', naming);
        plant(root, 'CHANGELOG.md', naming);
        plant(root, UPGRADING_PAGE, naming);
        plant(root, 'server/resources/prompts/p/prompt.yaml', `description: ${naming}`);
        plant(
          root,
          'server/tooling/contracts/tool.json',
          '{\n  "parameters": [\n    {\n      "name": "x",\n      "description": "uses PLANTED_RETIRED_NAME"\n    }\n  ]\n}\n'
        );
        plant(
          root,
          'server/tooling/contracts/registries/ledger.json',
          '{\n  "description": "PLANTED_RETIRED_NAME"\n}\n'
        );
        plant(
          root,
          'server/tooling/contracts/other.json',
          '{\n  "name": "PLANTED_RETIRED_NAME",\n  "description": "clean"\n}\n'
        );
        git(root, 'init', '-q');
        git(root, 'add', '-A');

        const failures = runRetirementChecks(clean({ texts: scanUserFacingText(root) })).failures;

        expect(failures.map((finding) => finding.message.split(':').slice(0, 2).join(':'))).toEqual(
          [
            'docs/guides/bad.md:3',
            'server/resources/prompts/p/prompt.yaml:1',
            'server/tooling/contracts/tool.json:5',
          ]
        );
        expect(failures.every((finding) => finding.subject === ENTRY.id)).toBe(true);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });

    it('selects by tracked path: exempt and out-of-scope files are left out', () => {
      const selected = selectUserFacingFiles([
        'README.md',
        'docs/guides/a.md',
        'docs/adr/0001.md',
        'docs/architecture/overview.md',
        'docs/reference/upgrading.md',
        'CHANGELOG.md',
        'docs/reference/clients.json',
        'server/resources/gates/g/guidance.md',
        'server/resources/scripts/tool.py',
        'server/tooling/contracts/prompt-engine.json',
        'server/tooling/contracts/registries/operators.json',
      ]);

      expect(selected).toEqual([
        { file: 'README.md', kind: 'text' },
        { file: 'docs/guides/a.md', kind: 'text' },
        { file: 'server/resources/gates/g/guidance.md', kind: 'text' },
        { file: 'server/tooling/contracts/prompt-engine.json', kind: 'contract' },
      ]);
    });
  });

  describe('check 5: the generated upgrade page', () => {
    it('fails a hand-edited page, naming the page and the command to run', () => {
      const failures = runRetirementChecks(
        clean({ upgradingPage: `${PAGE}a hand edit\n` })
      ).failures;

      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ check: 5, subject: UPGRADING_PAGE });
      expect(failures[0]?.message).toContain('npm --prefix server run generate:retirements-doc');
    });

    it('fails a missing page', () => {
      expect(runRetirementChecks(clean({ upgradingPage: null })).failures).toMatchObject([
        { check: 5, subject: UPGRADING_PAGE },
      ]);
    });

    it('renders newest refusal first, then by spelling, with one row per entry', () => {
      const page = renderUpgradingPage(listRetirements());
      const rows = page
        .split('\n')
        .filter((line) => line.startsWith('| ') && !line.includes('---'));

      expect(rows).toHaveLength(listRetirements().length + 1);
      expect(rows[1]).toContain('6.0.0');
      expect(rows[rows.length - 1]).toContain('3.2.0');
      expect(page).toContain('npm --prefix server run generate:retirements-doc');
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

  it('passes the live tree: a site and a driver per entry, no retired name in user-facing text, the page current', () => {
    const entries = listRetirements();
    const sites = scanRefusalSites();
    const driverIds = findDriverIds(readFileSync(path.join(REPO_ROOT, DRIVER_FILE), 'utf8'));
    const texts = scanUserFacingText(REPO_ROOT);

    // The scans observed something: a site per entry and one driver per entry.
    expect(new Set(sites.map((site) => site.id))).toEqual(
      new Set(entries.map((entry) => entry.id))
    );
    expect(texts.map((text) => text.file)).toEqual(
      expect.arrayContaining(['README.md', 'docs/reference/configuration.md'])
    );
    expect([...(driverIds ?? [])].sort()).toEqual(entries.map((entry) => entry.id).sort());
    expect(
      runRetirementChecks({
        entries,
        sites,
        driverIds,
        texts,
        expectedPage: renderUpgradingPage(entries),
        upgradingPage: readFileSync(path.join(REPO_ROOT, UPGRADING_PAGE), 'utf8'),
        today: '2026-11-27',
        packageVersion: '5.1.1',
      }).failures
    ).toEqual([]);
  });
});
