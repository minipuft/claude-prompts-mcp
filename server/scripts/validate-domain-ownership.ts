#!/usr/bin/env tsx

/**
 * The Domain Ownership Matrix in the root CLAUDE.md is a contract, checked both ways.
 *
 * Prose that nothing reads drifts silently. Two of the matrix's fourteen rows were already wrong
 * when this gate was written: `CommandParser` named no exported symbol (the class is
 * `UnifiedCommandParser`), and `StyleManager` was filed under `styles/` after it moved to
 * `modules/formatting/`. A stage author following either row lands nowhere, and nothing failed.
 *
 * Each owning module declares its rows in its own `module.yaml` (`owns:`). This gate checks:
 *
 *   A. every declared symbol is exported by exactly one file, inside the declaring module
 *   B. no symbol is owned by two modules
 *   C. every matrix row has one declaration and every declaration has a row — and the row's own
 *      owner cell names the symbol and points at the path the symbol is actually defined in
 *
 * C is the half that a one-directional check omits, and the half the drift lived in.
 *
 * MECHANISM: script — relation — compares module.yaml declarations against a markdown table and
 * against the exporting source file; no linter sees more than one of the three.
 */

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  auditOwnership,
  formatOwnershipProblems,
  type OwnershipAudit,
} from './lib/domain-ownership.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

interface CliOptions {
  readonly repoRoot: string;
  readonly sourceRoot: string;
  readonly claudeMdPath: string;
  readonly selfTest: boolean;
}

function parseArgs(args: readonly string[]): CliOptions {
  let repoRoot = REPO_ROOT;
  let sourceRoot = path.join(SERVER_ROOT, 'src');
  let claudeMdPath: string | null = null;
  let selfTest = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--self-test') {
      selfTest = true;
    } else if (arg === '--repo-root') {
      repoRoot = path.resolve(args[++index] ?? '');
    } else if (arg === '--source-root') {
      sourceRoot = path.resolve(args[++index] ?? '');
    } else if (arg === '--claude-md') {
      claudeMdPath = path.resolve(args[++index] ?? '');
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return {
    repoRoot,
    sourceRoot,
    claudeMdPath: claudeMdPath ?? path.join(repoRoot, 'CLAUDE.md'),
    selfTest,
  };
}

// ---------------------------------------------------------------------------
// Self-test fixture. Positive control first: the valid tree must report nothing, or every
// assertion below would pass against a gate that reports everything.
// ---------------------------------------------------------------------------

const ROOT_DESCRIPTOR = `
schemaVersion: 1
id: fixture-root
kind: application
lifecycle: canonical
description: Fixture root.
children: semantic
`;

const ALPHA_DESCRIPTOR = `
schemaVersion: 1
id: fixture-alpha
kind: domain
lifecycle: canonical
description: Fixture alpha.
children: internal
owns:
  - capability: Capability one
    symbol: AlphaService
`;

const BETA_DESCRIPTOR = `
schemaVersion: 1
id: fixture-beta
kind: domain
lifecycle: canonical
description: Fixture beta.
children: internal
`;

const ALPHA_SOURCE = 'export class AlphaService {}\n';

const FIXTURE_CLAUDE_MD = [
  '# Fixture handbook',
  '',
  '## Domain Ownership Matrix (ENFORCED)',
  '',
  '**Stages are thin orchestration.**',
  '',
  '| If you need... | Owner Service | Stage May Only |',
  '| --- | --- | --- |',
  '| Capability one | AlphaService (`alpha/alpha-service.ts`) | Call `alpha.one()` |',
  '',
  '## Next section',
  '',
].join('\n');

function writeDescriptor(directory: string, body: string): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'module.yaml'), `${body.trim()}\n`, 'utf8');
}

function writeSource(file: string, body: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body, 'utf8');
}

function inspectFixture(mutate?: (_root: string, _source: string) => void): OwnershipAudit {
  const root = mkdtempSync(path.join(os.tmpdir(), 'domain-ownership-'));
  const source = path.join(root, 'src');
  try {
    writeDescriptor(source, ROOT_DESCRIPTOR);
    writeDescriptor(path.join(source, 'alpha'), ALPHA_DESCRIPTOR);
    writeDescriptor(path.join(source, 'beta'), BETA_DESCRIPTOR);
    writeSource(path.join(source, 'alpha', 'alpha-service.ts'), ALPHA_SOURCE);
    writeFileSync(path.join(root, 'CLAUDE.md'), FIXTURE_CLAUDE_MD, 'utf8');
    mutate?.(root, source);
    return auditOwnership({
      repoRoot: root,
      sourceRoot: source,
      claudeMdPath: path.join(root, 'CLAUDE.md'),
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function problemsOf(mutate?: (_root: string, _source: string) => void): string {
  return formatOwnershipProblems(inspectFixture(mutate).problems);
}

function withMatrixRow(row: string): string {
  return FIXTURE_CLAUDE_MD.replace('\n\n## Next section', `\n${row}\n\n## Next section`);
}

const SELF_TEST_CASES: ReadonlyArray<{ readonly run: () => void }> = [
  {
    run: () => {
      const valid = inspectFixture();
      assert.equal(formatOwnershipProblems(valid.problems), '');
      assert.equal(valid.records.length, 1);
    },
  },
  {
    run: () =>
      assert.match(
        problemsOf((_root, source) =>
          writeSource(path.join(source, 'alpha', 'alpha-service.ts'), 'export class Other {}\n')
        ),
        /names AlphaService, which no file under server\/src exports/u
      ),
  },
  {
    run: () =>
      assert.match(
        problemsOf((_root, source) =>
          writeSource(path.join(source, 'alpha', 'copy.ts'), ALPHA_SOURCE)
        ),
        /which 2 files export/u
      ),
  },
  {
    run: () =>
      assert.match(
        problemsOf((_root, source) => {
          rmSync(path.join(source, 'alpha', 'alpha-service.ts'));
          writeSource(path.join(source, 'beta', 'alpha-service.ts'), ALPHA_SOURCE);
        }),
        /defined outside module 'fixture-alpha' at src\/beta\/alpha-service\.ts/u
      ),
  },
  {
    run: () =>
      assert.match(
        problemsOf((root, source) => {
          writeDescriptor(
            path.join(source, 'beta'),
            `${BETA_DESCRIPTOR}owns:\n  - capability: Capability two\n    symbol: AlphaService\n`
          );
          writeFileSync(
            path.join(root, 'CLAUDE.md'),
            withMatrixRow('| Capability two | AlphaService | Call `alpha.two()` |'),
            'utf8'
          );
        }),
        /AlphaService is already owned by src\/alpha\/module\.yaml/u
      ),
  },
  {
    run: () =>
      assert.match(
        problemsOf((root) =>
          writeFileSync(
            path.join(root, 'CLAUDE.md'),
            withMatrixRow('| Capability two | BetaService | Call `beta.two()` |'),
            'utf8'
          )
        ),
        /has no owns entry in any module\.yaml/u
      ),
  },
  {
    run: () =>
      assert.match(
        problemsOf((_root, source) => {
          writeDescriptor(
            path.join(source, 'beta'),
            `${BETA_DESCRIPTOR}owns:\n  - capability: Capability two\n    symbol: BetaService\n`
          );
          writeSource(
            path.join(source, 'beta', 'beta-service.ts'),
            'export class BetaService {}\n'
          );
        }),
        /owns 'Capability two' \(BetaService\) has no row in the Domain Ownership Matrix/u
      ),
  },
  {
    run: () =>
      assert.match(
        problemsOf((root) =>
          writeFileSync(
            path.join(root, 'CLAUDE.md'),
            FIXTURE_CLAUDE_MD.replace('alpha/alpha-service.ts', 'gamma/alpha-service.ts'),
            'utf8'
          )
        ),
        /points at 'gamma\/alpha-service\.ts', but AlphaService is defined at src\/alpha\/alpha-service\.ts/u
      ),
  },
];

function selfTest(): void {
  for (const testCase of SELF_TEST_CASES) testCase.run();
  process.stdout.write(
    `validate:domain-ownership self-test — ${SELF_TEST_CASES.length}/${SELF_TEST_CASES.length} cases passed\n`
  );
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    selfTest();
    return;
  }
  const audit = auditOwnership(options);
  if (audit.problems.length > 0) {
    process.stderr.write(
      `validate:domain-ownership FAILED — ${audit.problems.length} problem(s)\n${formatOwnershipProblems(audit.problems)}\n`
    );
    process.exitCode = 1;
    return;
  }
  const modules = new Set(audit.records.map((record) => record.moduleId));
  process.stdout.write(
    `validate:domain-ownership OK — ${audit.records.length} capabilities across ${modules.size} modules\n`
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `validate:domain-ownership FAILED — ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
