#!/usr/bin/env tsx

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  formatDescriptorProblems,
  loadSemanticModuleTree,
  type DescriptorTree,
} from './lib/semantic-module-descriptors.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

interface CliOptions {
  readonly repoRoot: string;
  readonly selfTest: boolean;
  readonly sourceRoot: string;
}

function parseArgs(args: readonly string[]): CliOptions {
  let repoRoot = REPO_ROOT;
  let sourceRoot = path.join(SERVER_ROOT, 'src');
  let selfTest = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--self-test') {
      selfTest = true;
    } else if (arg === '--repo-root') {
      repoRoot = path.resolve(args[++index] ?? '');
    } else if (arg === '--source-root') {
      sourceRoot = path.resolve(args[++index] ?? '');
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return { repoRoot, selfTest, sourceRoot };
}

function writeDescriptor(directory: string, body: string): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, 'module.yaml'), `${body.trim()}\n`, 'utf8');
}

const VALID_ROOT = `
schemaVersion: 1
id: fixture-root
kind: application
lifecycle: canonical
description: Fixture root.
children: semantic
`;

const VALID_CHILD = `
schemaVersion: 1
id: fixture-child
kind: domain
lifecycle: canonical
description: Fixture child.
children: internal
`;

function withFixture(run: (_root: string, _source: string) => void): void {
  const root = mkdtempSync(path.join(os.tmpdir(), 'semantic-module-descriptors-'));
  const source = path.join(root, 'src');
  try {
    run(root, source);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function inspectFixture(
  mutate?: (_root: string, _source: string) => void,
  childBody = VALID_CHILD
): DescriptorTree {
  let result: DescriptorTree | undefined;
  withFixture((root, source) => {
    writeDescriptor(source, VALID_ROOT);
    writeDescriptor(path.join(source, 'child'), childBody);
    mutate?.(root, source);
    result = loadSemanticModuleTree({ repoRoot: root, sourceRoot: source });
  });
  assert.ok(result);
  return result;
}

function selfTest(): void {
  const valid = inspectFixture();
  assert.equal(valid.problems.length, 0);
  assert.equal(valid.descriptors.length, 2);

  const missing = inspectFixture((_root, source) => mkdirSync(path.join(source, 'missing')));
  assert.match(formatDescriptorProblems(missing.problems), /required descriptor is missing/u);

  const malformed = inspectFixture(undefined, 'schemaVersion: [');
  assert.match(formatDescriptorProblems(malformed.problems), /invalid YAML/u);

  const duplicate = inspectFixture((_root, source) => {
    writeDescriptor(path.join(source, 'other'), VALID_CHILD);
  });
  assert.match(formatDescriptorProblems(duplicate.problems), /duplicate id 'fixture-child'/u);

  const missingDoc = inspectFixture(undefined, `${VALID_CHILD}\ndocs:\n  - docs/missing.md\n`);
  assert.match(formatDescriptorProblems(missingDoc.problems), /docs path does not exist/u);

  const missingEntry = inspectFixture(undefined, `${VALID_CHILD}\npublicEntry: index.ts\n`);
  assert.match(formatDescriptorProblems(missingEntry.problems), /publicEntry does not exist/u);

  const incompleteMigration = inspectFixture(
    undefined,
    VALID_CHILD.replace('lifecycle: canonical', 'lifecycle: migrating')
  );
  assert.match(
    formatDescriptorProblems(incompleteMigration.problems),
    /must name a replacement id/u
  );
  assert.match(
    formatDescriptorProblems(incompleteMigration.problems),
    /must name a removal condition/u
  );

  const missingReplacement = inspectFixture(
    undefined,
    VALID_CHILD.replace('lifecycle: canonical', 'lifecycle: legacy') +
      '\nreplacement: absent\nremoveWhen: Replacement ships.\n'
  );
  assert.match(
    formatDescriptorProblems(missingReplacement.problems),
    /replacement id does not exist/u
  );

  const unexpectedNested = inspectFixture((_root, source) => {
    writeDescriptor(
      path.join(source, 'child', 'nested'),
      VALID_CHILD.replace('fixture-child', 'nested')
    );
  });
  assert.match(
    formatDescriptorProblems(unexpectedNested.problems),
    /unexpected descriptor beneath internal/u
  );

  process.stdout.write('validate:module-descriptors self-test — 9/9 cases passed\n');
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    selfTest();
    return;
  }
  const tree = loadSemanticModuleTree(options);
  if (tree.problems.length > 0) {
    process.stderr.write(
      `validate:module-descriptors FAILED — ${tree.problems.length} problem(s)\n${formatDescriptorProblems(tree.problems)}\n`
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `validate:module-descriptors OK — ${tree.descriptors.length} semantic boundary descriptor(s)\n`
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(
    `validate:module-descriptors FAILED — ${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
