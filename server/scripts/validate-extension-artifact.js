#!/usr/bin/env node

/** Validate the self-contained runtime contract used by MCPB/plugin artifacts. */

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_DIR = join(SERVER_DIR, '..');
const REQUIRED_RUNTIME_FILES = [
  'server/dist/index.js',
  'server/dist/index.js.map',
  'server/package.json',
  'server/config.json',
];
const FORBIDDEN_RUNTIME_FILES = [
  'server/dist/cpm.js',
  'server/dist/cpm.js.map',
  'server/node_modules',
  'server/runtime-state',
];

function findViolations({ buildScript, stagedDir }) {
  const errors = [];
  if (!buildScript.includes('stage-server-runtime.sh')) {
    errors.push('build-extension.sh does not use the canonical runtime staging allowlist');
  }
  for (const legacy of ['MCPB_EXCLUDED_DEPS', 'INSTALL_DIR/node_modules']) {
    if (buildScript.includes(legacy)) errors.push(`legacy dependency staging remains: ${legacy}`);
  }

  if (stagedDir) {
    for (const file of REQUIRED_RUNTIME_FILES) {
      if (!existsSync(join(stagedDir, file))) errors.push(`staged runtime missing: ${file}`);
    }
    for (const file of FORBIDDEN_RUNTIME_FILES) {
      if (existsSync(join(stagedDir, file)))
        errors.push(`forbidden staged artifact present: ${file}`);
    }
    const stagedPackage = JSON.parse(
      readFileSync(join(stagedDir, 'server', 'package.json'), 'utf8')
    );
    if (Object.keys(stagedPackage.dependencies ?? {}).length > 0) {
      errors.push('self-contained extension package declares runtime dependencies');
    }
  }
  return errors;
}

function runSelfTest() {
  const fixture = mkdtempSync(join(tmpdir(), 'extension-artifact-test-'));
  const stage = join(fixture, 'stage');
  const healthyScript = 'bash scripts/stage-server-runtime.sh source target';
  for (const file of REQUIRED_RUNTIME_FILES) {
    const path = join(stage, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.endsWith('package.json') ? '{}\n' : 'fixture');
  }
  const validate = (overrides = {}) =>
    findViolations({ buildScript: healthyScript, stagedDir: stage, ...overrides });
  try {
    if (validate().length) throw new Error('healthy fixture failed');
    if (!validate({ buildScript: 'cp -R "$INSTALL_DIR/node_modules" target' }).length) {
      throw new Error('legacy dependency staging passed');
    }
    writeFileSync(join(stage, 'server', 'dist', 'cpm.js'), '#!/usr/bin/env node');
    if (!validate().length) throw new Error('unregistered CLI artifact passed');
    rmSync(join(stage, 'server', 'dist', 'cpm.js'));
    mkdirSync(join(stage, 'server', 'node_modules'));
    if (!validate().length) throw new Error('node_modules stage passed');
    rmSync(join(stage, 'server', 'node_modules'), { recursive: true });
    mkdirSync(join(stage, 'server', 'runtime-state'));
    if (!validate().length) throw new Error('generated runtime state passed');
    const runtimeSource = join(fixture, 'runtime-source');
    const runtimeTarget = join(fixture, 'runtime-target');
    mkdirSync(join(runtimeTarget, 'stale-directory'), { recursive: true });
    mkdirSync(runtimeSource);
    writeFileSync(join(runtimeSource, 'index.js'), 'server');
    writeFileSync(join(runtimeSource, 'index.js.map'), 'map');
    writeFileSync(join(runtimeTarget, 'cpm.js'), 'cli');
    writeFileSync(join(runtimeTarget, 'old-chunk.js'), 'stale');
    const staging = spawnSync(
      'bash',
      [join(ROOT_DIR, 'scripts', 'stage-server-runtime.sh'), runtimeSource, runtimeTarget],
      { encoding: 'utf8', stdio: 'pipe' }
    );
    if (staging.status !== 0) {
      throw new Error(`runtime staging failed (${staging.status})\n${staging.stderr}`);
    }
    const inventory = readdirSync(runtimeTarget).sort();
    if (inventory.join('\n') !== 'index.js\nindex.js.map') {
      throw new Error(`runtime allowlist retained stale files: ${inventory.join(', ')}`);
    }
    console.log('PASSED: extension artifact validator self-test');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

function main() {
  if (process.argv.includes('--self-test')) return runSelfTest();
  const stageIndex = process.argv.indexOf('--staging-dir');
  const stagedDir = stageIndex === -1 ? undefined : process.argv[stageIndex + 1];
  if (stageIndex !== -1 && !stagedDir) throw new Error('--staging-dir requires a path');
  const errors = findViolations({
    buildScript: readFileSync(join(ROOT_DIR, 'scripts', 'build-extension.sh'), 'utf8'),
    stagedDir,
  });
  if (errors.length) {
    for (const error of errors) console.error(`ERROR: ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASSED: extension artifact contract${stagedDir ? ' and staged tree' : ''}`);
}

main();
