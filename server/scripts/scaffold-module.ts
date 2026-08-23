#!/usr/bin/env tsx

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import * as yaml from 'js-yaml';

import { writeModuleCatalog } from './generate-module-catalog.js';
import {
  loadSemanticModuleTree,
  ModuleDescriptorDocumentSchema,
  type ModuleDescriptorDocument,
} from './lib/semantic-module-descriptors.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');

interface ScaffoldOptions {
  readonly afterWrite?: () => void;
  readonly descriptor: ModuleDescriptorDocument;
  readonly relativePath: string;
  readonly repoRoot: string;
  readonly sourceRoot: string;
}

interface CliOptions extends ScaffoldOptions {
  readonly selfTest: boolean;
}

const USAGE = `Usage: npm run scaffold:module -- \\
  --path <relative-source-path> \\
  --id <kebab-case-id> \\
  --kind <application|layer|domain|protocol|adapter|runtime|shared> \\
  --lifecycle <canonical|migrating|legacy> \\
  --description <text> \\
  --children <semantic|internal> \\
  [--replacement <module-id> --remove-when <condition>] \\
  [--repo-root <path> --source-root <path>]

Creates a new semantic source boundary. Migrating and legacy modules require both
--replacement and --remove-when. The target must not exist, and its parent descriptor must
declare children: semantic.
`;

function required(values: ReadonlyMap<string, string>, name: string): string {
  const value = values.get(name);
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required option --${name}`);
  }
  return value;
}

function parseArgs(args: readonly string[]): CliOptions {
  if (args.includes('--self-test')) {
    return {
      selfTest: true,
      repoRoot: REPO_ROOT,
      sourceRoot: path.join(SERVER_ROOT, 'src'),
      relativePath: 'unused',
      descriptor: ModuleDescriptorDocumentSchema.parse({
        schemaVersion: 1,
        id: 'unused',
        kind: 'domain',
        lifecycle: 'canonical',
        description: 'Unused self-test descriptor.',
        children: 'internal',
      }),
    };
  }

  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index];
    const value = args[index + 1];
    if (option === undefined || !option.startsWith('--') || value === undefined) {
      throw new Error(`Options must be supplied as --name value pairs`);
    }
    values.set(option.slice(2), value);
  }

  const lifecycle = required(values, 'lifecycle');
  const candidate = {
    schemaVersion: 1,
    id: required(values, 'id'),
    kind: required(values, 'kind'),
    lifecycle,
    description: required(values, 'description'),
    children: required(values, 'children'),
    replacement: values.get('replacement'),
    removeWhen: values.get('remove-when'),
  };
  const descriptor = ModuleDescriptorDocumentSchema.parse(candidate);
  return {
    selfTest: false,
    repoRoot: path.resolve(values.get('repo-root') ?? REPO_ROOT),
    sourceRoot: path.resolve(values.get('source-root') ?? path.join(SERVER_ROOT, 'src')),
    relativePath: required(values, 'path'),
    descriptor,
    afterWrite: writeModuleCatalog,
  };
}

function targetDirectory(sourceRoot: string, relativePath: string): string {
  if (path.isAbsolute(relativePath) || relativePath.trim().length === 0) {
    throw new Error(`Module path must be a non-empty path relative to the source root`);
  }
  const target = path.resolve(sourceRoot, relativePath);
  const relative = path.relative(sourceRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Module path escapes the source root: ${relativePath}`);
  }
  return target;
}

export function scaffoldSemanticModule(options: ScaffoldOptions): string {
  const sourceRoot = path.resolve(options.sourceRoot);
  const repoRoot = path.resolve(options.repoRoot);
  const target = targetDirectory(sourceRoot, options.relativePath);
  if (existsSync(target)) throw new Error(`Target already exists: ${options.relativePath}`);

  const before = loadSemanticModuleTree({ repoRoot, sourceRoot });
  if (before.problems.length > 0) {
    throw new Error(`Existing semantic descriptor tree must validate before scaffolding`);
  }
  const parent = before.descriptors.find(
    (descriptor) => path.resolve(descriptor.absoluteDirectory) === path.dirname(target)
  );
  if (parent === undefined || parent.children !== 'semantic') {
    throw new Error(
      `Parent boundary does not permit semantic children: ${path.relative(sourceRoot, path.dirname(target)) || '.'}`
    );
  }

  mkdirSync(target);
  try {
    writeFileSync(
      path.join(target, 'module.yaml'),
      yaml.dump(options.descriptor, { lineWidth: -1, noRefs: true }),
      'utf8'
    );
    const after = loadSemanticModuleTree({ repoRoot, sourceRoot });
    if (after.problems.length > 0) {
      throw new Error(`Scaffolded descriptor failed validation: ${after.problems[0]?.message}`);
    }
    options.afterWrite?.();
  } catch (error) {
    rmSync(target, { recursive: true, force: true });
    throw error;
  }
  return target;
}

function rootDescriptor(children: 'semantic' | 'internal'): string {
  return yaml.dump({
    schemaVersion: 1,
    id: 'fixture-root',
    kind: 'application',
    lifecycle: 'canonical',
    description: 'Fixture root.',
    children,
  });
}

function fixtureDescriptor(): ModuleDescriptorDocument {
  return ModuleDescriptorDocumentSchema.parse({
    schemaVersion: 1,
    id: 'fixture-child',
    kind: 'domain',
    lifecycle: 'canonical',
    description: 'Fixture child.',
    children: 'internal',
  });
}

function withFixture(
  children: 'semantic' | 'internal',
  run: (_root: string, _source: string) => void
) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'scaffold-semantic-module-'));
  const source = path.join(root, 'src');
  mkdirSync(source);
  writeFileSync(path.join(source, 'module.yaml'), rootDescriptor(children));
  try {
    run(root, source);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function selfTest(): void {
  assert.match(USAGE, /--description <text>/u);

  withFixture('semantic', (root, source) => {
    let callbackCount = 0;
    const options = {
      repoRoot: root,
      sourceRoot: source,
      relativePath: 'child',
      descriptor: fixtureDescriptor(),
      afterWrite: () => {
        callbackCount += 1;
      },
    };
    const target = scaffoldSemanticModule(options);
    assert.equal(existsSync(path.join(target, 'module.yaml')), true);
    assert.equal(callbackCount, 1);
    assert.throws(() => scaffoldSemanticModule(options), /already exists/u);
  });

  withFixture('internal', (root, source) => {
    assert.throws(
      () =>
        scaffoldSemanticModule({
          repoRoot: root,
          sourceRoot: source,
          relativePath: 'child',
          descriptor: fixtureDescriptor(),
        }),
      /does not permit semantic children/u
    );
    assert.equal(existsSync(path.join(source, 'child')), false);
  });

  withFixture('semantic', (root, source) => {
    assert.throws(
      () =>
        scaffoldSemanticModule({
          repoRoot: root,
          sourceRoot: source,
          relativePath: '../escape',
          descriptor: fixtureDescriptor(),
        }),
      /escapes the source root/u
    );
  });

  assert.throws(() => parseArgs(['--id', 'missing-most-inputs']), /Missing required option/u);
  process.stdout.write('scaffold:module self-test — 7/7 cases passed\n');
}

function main(): void {
  if (process.argv.slice(2).includes('--help')) {
    process.stdout.write(USAGE);
    return;
  }
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    selfTest();
    return;
  }
  const created = scaffoldSemanticModule(options);
  process.stdout.write(`scaffold:module created ${path.relative(options.repoRoot, created)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `scaffold:module FAILED — ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
