/**
 * `validate:retirements` with a planted case per check (1 to 6), each asserting the failure
 * names the entry or the file it is about, then the live tree as the clean case. The checks are pure
 * functions over entries, sites and driver ids, so every planted case is data; the site and
 * driver scanners are driven over planted source text, including a commented-out call that must
 * not count as a site. Check 6's code scanner is driven over a planted git repository holding
 * TypeScript and Python sources, tests and comments, through the real Python parser.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderUpgradingPage, UPGRADING_PAGE } from '../../../scripts/generate-retirements-doc.js';
import { expiryOutcomes } from '../../../scripts/lib/retirement-expiry.js';
import { listRetirements } from '../../../scripts/lib/retirement-ledger.js';
import {
  isProjected,
  projectionMember,
  renderRetirementProjection,
  RETIREMENT_PROJECTION,
} from '../../../scripts/lib/retirement-projection.js';
import {
  findTypeScriptStrings,
  loadWordingRules,
  scanCodeStrings,
} from '../../../scripts/lib/third-state-wording.js';
import { selectUserFacingFiles } from '../../../scripts/lib/user-facing-scope.js';
import {
  DRIVER_FILE,
  findDriverIds,
  findRetirementSites,
  readDeclaredSiteFiles,
  runRetirementChecks,
  scanArchitectureText,
  scanRefusalSites,
  scanUserFacingText,
} from '../../../scripts/validate-retirements.js';

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
const PROJECTION = 'export const plantedEntry = {};\n';
const PROJECTION_FILE = `server/${RETIREMENT_PROJECTION}`;
const PHRASES = loadWordingRules(REPO_ROOT).phrases;
const TWO_STATES = 'The product has two states for a spelling, accepted or refused';
const DESCRIBE_TODAY = 'Describe what the product does today; a planned change lives in a plan';
const PROMISE =
  'Inline definitions run only when the key is on; the default flips in the next release.';

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

/** A clean planted input: two entries, each with a site and a driver, before any date. */
function clean(overrides: Partial<RetirementCheckInput> = {}): RetirementCheckInput {
  return {
    entries: [ENTRY, OTHER],
    sites: [
      { member: 'plantedEntry', file: 'server/src/a.ts', line: 3 },
      { member: 'otherEntry', file: 'cli/src/b.ts', line: 9 },
    ],
    declaredFiles: {},
    driverIds: [ENTRY.id, OTHER.id],
    texts: [
      { file: 'docs/guides/clean.md', lines: [{ line: 1, text: 'Describe the current form.' }] },
    ],
    codeStrings: [],
    wording: { phrases: PHRASES, exemptions: [] },
    expectedPage: PAGE,
    upgradingPage: PAGE,
    expectedProjection: PROJECTION,
    projection: PROJECTION,
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
        clean({ sites: [{ member: 'otherEntry', file: 'cli/src/b.ts', line: 9 }] })
      ).failures;

      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ check: 1, subject: ENTRY.id });
      expect(failures[0]?.message).toContain('no refusal site reads plantedEntry');
    });

    it('fails a site whose member names no entry, naming the member and the site', () => {
      const sites = [
        ...clean().sites,
        { member: 'unknownEntry', file: 'server/src/c.ts', line: 12 },
      ];
      const messages = failureMessages(clean({ sites }));

      expect(messages).toEqual([
        'server/src/c.ts:12: unknownEntry names no entry in retirements.json.',
      ]);
    });

    describe('an entry refused outside TypeScript declares its sites', () => {
      const SCRIPT = 'server/resources/prompts/probe/script.py';
      const SCHEMA = 'server/resources/prompts/probe/schema.json';
      const DECLARED = {
        ...OTHER,
        id: 'declared-entry',
        refusalSites: [
          { file: SCRIPT, marker: 'is not an argument of probe' },
          { file: SCHEMA, marker: 'Refused; send old_name instead.' },
        ],
      };
      const FILES = {
        [SCRIPT]: "errors = [f\"'{name}' is not an argument of probe; send '{new}'.\"]\n",
        [SCHEMA]: '{ "description": "Refused; send old_name instead." }\n',
      };
      const declared = (declaredFiles: Record<string, string | null>): RetirementCheckInput =>
        clean({
          entries: [ENTRY, OTHER, DECLARED],
          driverIds: [ENTRY.id, OTHER.id, DECLARED.id],
          declaredFiles,
        });

      it('passes when every declared file is present and holds its marker, with no TypeScript site', () => {
        expect(runRetirementChecks(declared(FILES)).failures).toEqual([]);
      });

      it('fails a declared file that is not tracked, naming the entry and the file', () => {
        const failures = runRetirementChecks(declared({ ...FILES, [SCHEMA]: null })).failures;

        expect(failures).toEqual([
          {
            check: 1,
            subject: 'declared-entry',
            message: `declared-entry: declares a refusal site in ${SCHEMA}, which is not a tracked file. Point refusalSites at the file that refuses the spelling, or delete the entry.`,
          },
        ]);
      });

      it('fails a declared file the scan never read, as not tracked', () => {
        const failures = runRetirementChecks(declared({ [SCRIPT]: FILES[SCRIPT] })).failures;

        expect(failures).toMatchObject([{ check: 1, subject: 'declared-entry' }]);
        expect(failures[0]?.message).toContain(SCHEMA);
      });

      it('fails a declared file that no longer holds its marker, naming the entry and the file', () => {
        const failures = runRetirementChecks(
          declared({ ...FILES, [SCRIPT]: 'errors = []\n' })
        ).failures;

        expect(failures).toEqual([
          {
            check: 1,
            subject: 'declared-entry',
            message: `declared-entry: ${SCRIPT} does not hold the marker "is not an argument of probe" its refusalSites declares. Restore the refusal, correct the marker, or delete the entry.`,
          },
        ]);
      });

      it('reads declared files from the index: a tracked file has its text, an untracked one is null', () => {
        const root = mkdtempSync(path.join(tmpdir(), 'retirement-declared-'));
        try {
          git(root, 'init', '-q');
          plant(root, SCRIPT, FILES[SCRIPT] as string);
          plant(root, SCHEMA, FILES[SCHEMA] as string);
          git(root, 'add', SCRIPT);
          const files = readDeclaredSiteFiles([DECLARED], root);

          expect(files).toEqual({ [SCRIPT]: FILES[SCRIPT], [SCHEMA]: null });
          expect(runRetirementChecks(declared(files)).failures).toMatchObject([
            { check: 1, subject: 'declared-entry' },
          ]);
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      });
    });

    it('fails a site that names no member', () => {
      const sites = [...clean().sites, { member: null, file: 'server/src/d.ts', line: 4 }];

      expect(failureMessages(clean({ sites }))).toEqual([
        'server/src/d.ts:4: the retirement projection is used without naming one member, which no entry can be joined to. Import it as a namespace and read the entry by name.',
      ]);
    });

    it('reads uses from the syntax tree: a commented-out read and a quoted name are not sites', () => {
      const text = [
        "import * as notices from '#shared/utils/_generated/retirement-notices.js';",
        '// notices.inALineComment;',
        '/* notices.inABlockComment; */',
        'const prose = "read notices.inAString at the boundary";',
        'const notice = notices.liveRead;',
        'const dynamic = notices[idFromSomewhere];',
        "const quoted = notices['quotedRead'];",
        'const whole = describe(notices);',
        "import { namedImport } from './_generated/retirement-notices.js';",
        "export * from '../utils/_generated/retirement-notices.js';",
        'const unrelated = other.liveRead;',
      ].join('\n');

      expect(findRetirementSites('server/src/x.ts', text)).toEqual([
        { member: 'liveRead', file: 'server/src/x.ts', line: 5 },
        { member: null, file: 'server/src/x.ts', line: 6 },
        { member: 'quotedRead', file: 'server/src/x.ts', line: 7 },
        { member: null, file: 'server/src/x.ts', line: 8 },
        { member: null, file: 'server/src/x.ts', line: 9 },
        { member: null, file: 'server/src/x.ts', line: 10 },
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

    it('fails a hand-edited runtime projection, naming the file and the command to run', () => {
      const failures = runRetirementChecks(
        clean({ projection: PROJECTION.replace('plantedEntry', 'handEdited') })
      ).failures;

      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ check: 5, subject: PROJECTION_FILE });
      expect(failures[0]?.message).toContain('npm --prefix server run generate:retirements-doc');
    });

    it('fails a missing runtime projection', () => {
      expect(runRetirementChecks(clean({ projection: null })).failures).toMatchObject([
        { check: 5, subject: PROJECTION_FILE },
      ]);
    });

    it('fails a projection that lacks a ledger entry, or holds one the ledger does not', () => {
      const entries = listRetirements();
      const current = renderRetirementProjection(entries);
      const missing = renderRetirementProjection(entries.slice(1));
      const extra = renderRetirementProjection([
        ...entries,
        { ...entries[0]!, id: 'not-in-the-ledger' },
      ]);

      for (const onDisk of [missing, extra]) {
        expect(
          runRetirementChecks(clean({ expectedProjection: current, projection: onDisk })).failures
        ).toMatchObject([{ check: 5, subject: PROJECTION_FILE }]);
      }
    });

    it('renders one exported constant per entry refused in TypeScript, named after its id', () => {
      const projection = renderRetirementProjection(listRetirements());
      const exported = [...projection.matchAll(/^export const (\w+): RetirementNotice/gm)].map(
        (match) => match[1]
      );

      expect(exported).toHaveLength(listRetirements().filter(isProjected).length);
      expect(exported).toContain('configFileUnversioned');
      expect(exported).not.toContain('createGateCamelCaseArgument');
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

  describe('the generated page', () => {
    const PAGE_ENTRY = {
      id: 'page-entry',
      kind: 'config-key' as const,
      retired: 'old.key',
      replacement: 'new.key',
      refusedIn: '6.0.0',
      forgetAfter: '2027-06-01',
      docPattern: null,
      docPatternReason: 'planted',
    };

    it('shows a described spelling as prose and never nests one code span in another', () => {
      const described = {
        ...PAGE_ENTRY,
        retired: 'the top-level `exports` key (`all`, or a `user`/`project` map)',
        replacement:
          'lists of `prompt:<category>/<id>` keys under <client>, in <workspace>/resources/<type>/',
      };
      const row = renderUpgradingPage([described])
        .split('\n')
        .find((line) => line.includes('exports'));

      expect(row).toContain('| the top-level `exports` key (`all`, or a `user`/`project` map) ');
      expect(row).toContain('`prompt:<category>/<id>`');
      expect(row).toContain('under `<client>`, in `<workspace>/resources/<type>/`');
    });

    it('shows a bare identifier of a literal kind as code', () => {
      const bare = { ...PAGE_ENTRY, retired: 'prompts.directory' };

      expect(renderUpgradingPage([bare])).toContain('| `prompts.directory` ');
    });

    it('is already formatted the way the format gate formats it', async () => {
      const prettier = await import('prettier');
      const pagePath = path.join(REPO_ROOT, UPGRADING_PAGE);
      const page = renderUpgradingPage(listRetirements());
      const options = await prettier.resolveConfig(pagePath);

      expect(await prettier.format(page, { ...options, filepath: pagePath })).toBe(page);
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

  describe('check 6: third-state wording', () => {
    const OLD_FLAG = {
      file: 'docs/guides/flags.md',
      lines: [
        { line: 1, text: 'Pass `--new-flag` to choose the folder.' },
        { line: 2, text: 'The old flag still works.' },
      ],
    };

    it('fails a guide line saying the old flag still works, naming the file, the line and the phrase', () => {
      const failures = runRetirementChecks(clean({ texts: [OLD_FLAG] })).failures;

      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatchObject({ check: 6, subject: 'docs/guides/flags.md:2' });
      expect(failures[0]?.message).toContain(
        'docs/guides/flags.md:2: "still works" (still-accepted)'
      );
      expect(failures[0]?.message).toContain(TWO_STATES);
      expect(failures[0]?.message).toContain('CONTRIBUTING.md, Retiring a Spelling');
    });

    it('reads string literals and template text from TypeScript, never comments, keys, imports or literal types', () => {
      const text = [
        "import { x } from './deprecated-module.js';",
        '// the --old-flag is deprecated',
        '/* deprecated */',
        "type Status = 'deprecated' | 'working';",
        "const keyed = { 'deprecated': 1 };",
        "throw new Error('--old-flag is deprecated; use --new-flag');",
        'const shown = `first line',
        'the old name is legacy`;',
      ].join('\n');

      expect(findTypeScriptStrings('server/src/flags.ts', text)).toEqual([
        { line: 6, text: '--old-flag is deprecated; use --new-flag' },
        { line: 7, text: 'first line' },
        { line: 8, text: 'the old name is legacy' },
      ]);
    });

    describe('over a planted repository', () => {
      let root = '';
      let failures: { check: number; subject: string; message: string }[] = [];

      beforeAll(() => {
        root = mkdtempSync(path.join(tmpdir(), 'retirement-wording-'));
        const deprecated = "export const note = '--old-flag is deprecated';\n";
        plant(root, 'server/src/flags.ts', `${deprecated}// a comment: deprecated\n`);
        plant(
          root,
          'server/src/commented.ts',
          '// --old-flag is deprecated\nexport const x = 1;\n'
        );
        plant(root, 'server/tests/unit/flags.test.ts', deprecated);
        plant(root, 'server/src/flags.test.ts', deprecated);
        plant(
          root,
          'hooks/lib/flags.py',
          '"""Module docstring: deprecated."""\n# the old flag is deprecated\nNOTE = "--old-flag is deprecated"\n'
        );
        plant(root, 'hooks/lib/commented.py', '# deprecated\nVALUE = 1\n');
        plant(root, 'hooks/tests/test_flags.py', 'NOTE = "--old-flag is deprecated"\n');
        git(root, 'init', '-q');
        git(root, 'add', '-A');
        failures = runRetirementChecks(clean({ codeStrings: scanCodeStrings(root) })).failures;
      });

      afterAll(() => {
        rmSync(root, { recursive: true, force: true });
      });

      it('fails a string literal in src and in a hook, each naming file, line and phrase', () => {
        expect(failures.map((finding) => finding.subject).sort()).toEqual([
          'hooks/lib/flags.py:3',
          'server/src/flags.ts:1',
        ]);
        expect(failures.every((finding) => finding.check === 6)).toBe(true);
        expect(failures.map((finding) => finding.message)).toEqual(
          expect.arrayContaining([
            expect.stringContaining('server/src/flags.ts:1: "deprecated" (deprecated)'),
            expect.stringContaining('hooks/lib/flags.py:3: "deprecated" (deprecated)'),
          ])
        );
      });

      it('passes the same word in a comment, a docstring and a test file', () => {
        const subjects = failures.map((finding) => finding.subject);

        expect(subjects).not.toContain('server/src/flags.ts:2');
        expect(subjects.some((subject) => subject.startsWith('server/src/commented.ts'))).toBe(
          false
        );
        expect(subjects.some((subject) => subject.startsWith('hooks/lib/commented.py'))).toBe(
          false
        );
        expect(subjects).not.toContain('hooks/lib/flags.py:1');
        expect(subjects).not.toContain('hooks/lib/flags.py:2');
        expect(
          subjects.some((subject) => /tests?\//.test(subject) || subject.includes('.test.'))
        ).toBe(false);
      });
    });

    describe('promise wording', () => {
      it('fails a guide line promising the next release, naming the file, the line and the phrase', () => {
        const texts = [{ file: 'docs/guides/gates.md', lines: [{ line: 4, text: PROMISE }] }];

        const failures = runRetirementChecks(clean({ texts })).failures;

        expect(failures.map((finding) => finding.subject)).toEqual([
          'docs/guides/gates.md:4',
          'docs/guides/gates.md:4',
        ]);
        expect(failures.map((finding) => finding.message)).toEqual([
          expect.stringContaining('docs/guides/gates.md:4: "next release" (future-release)'),
          expect.stringContaining('docs/guides/gates.md:4: "default flips" (default-flips)'),
        ]);
        expect(failures.every((finding) => finding.check === 6)).toBe(true);
        expect(failures.every((finding) => finding.message.includes(DESCRIBE_TODAY))).toBe(true);
        expect(failures.some((finding) => finding.message.includes(TWO_STATES))).toBe(false);
      });

      describe('over a planted repository', () => {
        let root = '';
        let subjects: string[] = [];

        beforeAll(() => {
          root = mkdtempSync(path.join(tmpdir(), 'retirement-promise-'));
          plant(root, 'docs/guides/gates.md', `${PROMISE}\n`);
          plant(root, 'docs/adr/0001-gates.md', `${PROMISE}\n`);
          plant(root, 'docs/architecture/overview.md', `${PROMISE}\n`);
          plant(root, 'docs/concepts/runs.md', 'After an abort the run is no longer active.\n');
          plant(
            root,
            'server/src/notice.ts',
            "export const promise = 'the default flips in the next release';\nexport const old = '--old-flag is deprecated';\n"
          );
          git(root, 'init', '-q');
          git(root, 'add', '-A');
          subjects = runRetirementChecks(
            clean({
              texts: scanUserFacingText(root),
              architectureTexts: scanArchitectureText(root),
              codeStrings: scanCodeStrings(root),
            })
          ).failures.map((finding) => finding.subject);
        });

        afterAll(() => {
          rmSync(root, { recursive: true, force: true });
        });

        it('fails the promise in a guide and in an architecture page', () => {
          expect(subjects).toContain('docs/guides/gates.md:1');
          expect(subjects).toContain('docs/architecture/overview.md:1');
        });

        it('passes the same sentence in docs/adr and an honest neighbour that only says no longer', () => {
          expect(subjects.some((subject) => subject.startsWith('docs/adr/'))).toBe(false);
          expect(subjects.some((subject) => subject.startsWith('docs/concepts/runs.md'))).toBe(
            false
          );
        });

        it('fails a promise in a code string as well as third-state wording there', () => {
          expect(subjects).toContain('server/src/notice.ts:1');
          expect(subjects).toContain('server/src/notice.ts:2');
        });

        it('fails nothing else', () => {
          expect([...new Set(subjects)].sort()).toEqual([
            'docs/architecture/overview.md:1',
            'docs/guides/gates.md:1',
            'server/src/notice.ts:1',
            'server/src/notice.ts:2',
          ]);
        });
      });
    });

    describe('exemptions', () => {
      const exemption = {
        id: 'old-flag-not-yet-retired',
        phrase: 'still-accepted',
        sites: [{ file: 'docs/guides/flags.md', lines: 1 }],
        reason: 'planted',
        asOf: '2026-11-27',
        removeWhen: 'planted',
      };

      it('passes an exempted line', () => {
        const wording = { phrases: PHRASES, exemptions: [exemption] };

        expect(runRetirementChecks(clean({ texts: [OLD_FLAG], wording })).failures).toEqual([]);
      });

      it('fails an exemption whose line is gone, naming the exemption', () => {
        const wording = { phrases: PHRASES, exemptions: [exemption] };
        const gone = { ...OLD_FLAG, lines: OLD_FLAG.lines.slice(0, 1) };

        const failures = runRetirementChecks(clean({ texts: [gone], wording })).failures;

        expect(failures).toHaveLength(1);
        expect(failures[0]).toMatchObject({ check: 6, subject: exemption.id });
        expect(failures[0]?.message).toContain(
          `exemption ${exemption.id} covers 1 line(s) of docs/guides/flags.md`
        );
        expect(failures[0]?.message).toContain('no line matches any more');
      });

      it('fails an exemption that covers fewer lines than the file holds', () => {
        const wording = { phrases: PHRASES, exemptions: [exemption] };
        const grown = {
          ...OLD_FLAG,
          lines: [...OLD_FLAG.lines, { line: 3, text: 'The old name still works too.' }],
        };

        expect(runRetirementChecks(clean({ texts: [grown], wording })).failures).toMatchObject([
          { check: 6, subject: exemption.id },
        ]);
      });
    });
  });

  it('passes the live tree: a site and a driver per entry, no retired name in user-facing text, the page and the projection current', () => {
    const entries = listRetirements();
    const sites = scanRefusalSites();
    const driverIds = findDriverIds(readFileSync(path.join(REPO_ROOT, DRIVER_FILE), 'utf8'));
    const texts = scanUserFacingText(REPO_ROOT);
    const architectureTexts = scanArchitectureText(REPO_ROOT);
    const codeStrings = scanCodeStrings(REPO_ROOT);

    const declaredFiles = readDeclaredSiteFiles(entries);

    // The scans observed something: a site per entry refused in TypeScript, the declared files of
    // the others, and one driver per entry.
    expect(new Set(sites.map((site) => site.member))).toEqual(
      new Set(entries.filter(isProjected).map((entry) => projectionMember(entry.id)))
    );
    expect(Object.values(declaredFiles).length).toBeGreaterThan(0);
    expect(Object.values(declaredFiles)).not.toContain(null);
    expect(texts.map((text) => text.file)).toEqual(
      expect.arrayContaining(['README.md', 'docs/reference/configuration.md'])
    );
    expect(architectureTexts.map((text) => text.file)).toEqual(
      expect.arrayContaining(['docs/architecture/overview.md'])
    );
    expect([...(driverIds ?? [])].sort()).toEqual(entries.map((entry) => entry.id).sort());
    expect(codeStrings.map((source) => source.file)).toEqual(
      expect.arrayContaining(['server/src/index.ts', 'cli/src/index.ts', 'hooks/gate-enforce.py'])
    );
    expect(
      runRetirementChecks({
        entries,
        sites,
        declaredFiles,
        driverIds,
        texts,
        codeStrings,
        architectureTexts,
        wording: loadWordingRules(REPO_ROOT),
        expectedPage: renderUpgradingPage(entries),
        upgradingPage: readFileSync(path.join(REPO_ROOT, UPGRADING_PAGE), 'utf8'),
        expectedProjection: renderRetirementProjection(entries),
        projection: readFileSync(path.join(REPO_ROOT, 'server', RETIREMENT_PROJECTION), 'utf8'),
        today: '2026-11-27',
        packageVersion: '5.1.1',
      }).failures
    ).toEqual([]);
  });
});
