#!/usr/bin/env node

/** Verify the npm tarball as an installed consumer sees it. */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Measured from the production release build on 2026-08-02:
// 1,952,004 packed and 8,223,607 unpacked bytes. Keep deterministic headroom rather than
// carrying forward the source-map-inflated 4.47 MB / 19.47 MB baseline.
const PACKED_SIZE_BUDGET = 2_500_000;
const UNPACKED_SIZE_BUDGET = 10_000_000;
const REQUIRED_BINS = ['claude-prompts', 'cpm'];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: SERVER_DIR,
    encoding: 'utf8',
    stdio: 'pipe',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status})\n${result.stdout}${result.stderr}`
    );
  }
  return result.stdout.trim();
}

function findInventoryViolations(pkg, pack) {
  const violations = [];
  const files = new Set(pack.files.map(({ path }) => path.replace(/^package\//, '')));
  const bins = pkg.bin ?? {};

  if (pack.version !== pkg.version) {
    violations.push(`tarball version ${pack.version} does not match package ${pkg.version}`);
  }

  for (const name of REQUIRED_BINS) {
    if (!bins[name]) violations.push(`required bin ${name} is not declared`);
  }
  for (const [name, target] of Object.entries(bins)) {
    const normalized = target.replace(/^\.\//, '');
    if (!files.has(normalized)) {
      violations.push(`bin ${name} points at ${target}, which is absent from the tarball`);
    }
  }
  for (const { path } of pack.files) {
    if (path.endsWith('.map')) violations.push(`source map shipped through npm: ${path}`);
  }
  if (pack.size > PACKED_SIZE_BUDGET) {
    violations.push(`packed size ${pack.size} exceeds ${PACKED_SIZE_BUDGET} bytes`);
  }
  if (pack.unpackedSize > UNPACKED_SIZE_BUDGET) {
    violations.push(`unpacked size ${pack.unpackedSize} exceeds ${UNPACKED_SIZE_BUDGET} bytes`);
  }
  return violations;
}

function findRuntimeViolations(expectedVersion, installedVersion, outputs) {
  const violations = [];
  if (installedVersion !== expectedVersion) {
    violations.push(
      `installed package version ${installedVersion} does not match ${expectedVersion}`
    );
  }
  if (outputs.cpm !== expectedVersion) {
    violations.push(`cpm --version returned ${outputs.cpm}, expected ${expectedVersion}`);
  }
  if (outputs['claude-prompts'].status !== 0) {
    violations.push(`claude-prompts --help exited ${outputs['claude-prompts'].status}`);
  }
  return violations;
}

function runSelfTest() {
  const pkg = {
    version: '3.1.1',
    bin: { 'claude-prompts': './dist/index.js', cpm: './dist/cpm.js' },
  };
  const healthyPack = {
    version: pkg.version,
    size: 2_000_000,
    unpackedSize: 8_000_000,
    files: [{ path: 'dist/index.js' }, { path: 'dist/cpm.js' }],
  };
  const cases = [
    ['missing declared bin', { ...healthyPack, files: [{ path: 'dist/index.js' }] }],
    [
      'source map included',
      { ...healthyPack, files: [...healthyPack.files, { path: 'dist/cpm.js.map' }] },
    ],
    ['packed budget exceeded', { ...healthyPack, size: PACKED_SIZE_BUDGET + 1 }],
    ['unpacked budget exceeded', { ...healthyPack, unpackedSize: UNPACKED_SIZE_BUDGET + 1 }],
    ['tarball version mismatch', { ...healthyPack, version: '0.1.0' }],
  ];
  let failures = 0;
  for (const [name, pack] of cases) {
    const rejected = findInventoryViolations(pkg, pack).length > 0;
    console.log(`  ${rejected ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!rejected) failures += 1;
  }
  const missingDeclaration = findInventoryViolations(
    { ...pkg, bin: { 'claude-prompts': './dist/index.js' } },
    healthyPack
  ).length;
  console.log(`  ${missingDeclaration ? 'ok  ' : 'FAIL'}  missing required declaration`);
  if (!missingDeclaration) failures += 1;

  const mismatch = findRuntimeViolations(pkg.version, pkg.version, {
    cpm: '0.1.0',
    'claude-prompts': { status: 0 },
  }).length;
  console.log(`  ${mismatch ? 'ok  ' : 'FAIL'}  CLI version mismatch`);
  if (!mismatch) failures += 1;

  const installedMismatch = findRuntimeViolations(pkg.version, '0.1.0', {
    cpm: pkg.version,
    'claude-prompts': { status: 0 },
  }).length;
  console.log(`  ${installedMismatch ? 'ok  ' : 'FAIL'}  installed version mismatch`);
  if (!installedMismatch) failures += 1;

  const healthy =
    findInventoryViolations(pkg, healthyPack).length === 0 &&
    findRuntimeViolations(pkg.version, pkg.version, {
      cpm: pkg.version,
      'claude-prompts': { status: 0 },
    }).length === 0;
  console.log(`  ${healthy ? 'ok  ' : 'FAIL'}  healthy package`);
  if (!healthy) failures += 1;

  process.exit(failures === 0 ? 0 : 1);
}

function main() {
  if (process.argv.includes('--self-test')) return runSelfTest();

  const outputIndex = process.argv.indexOf('--pack-destination');
  const requestedOutput = outputIndex === -1 ? undefined : process.argv[outputIndex + 1];
  if (outputIndex !== -1 && !requestedOutput) {
    throw new Error('--pack-destination requires a path');
  }

  const scratch = mkdtempSync(join(tmpdir(), 'claude-prompts-package-'));
  const packDestination = requestedOutput ? resolve(requestedOutput) : scratch;
  const consumer = join(scratch, 'consumer');
  try {
    mkdirSync(packDestination, { recursive: true });
    mkdirSync(consumer, { recursive: true });
    const packJson = run('npm', ['pack', '--json', '--pack-destination', packDestination]);
    const [pack] = JSON.parse(packJson);
    const tarball = join(packDestination, basename(pack.filename));
    if (!existsSync(tarball)) throw new Error(`npm pack did not create ${tarball}`);

    const sourcePackage = JSON.parse(readFileSync(join(SERVER_DIR, 'package.json'), 'utf8'));
    const inventoryViolations = findInventoryViolations(sourcePackage, pack);
    if (inventoryViolations.length) throw new Error(inventoryViolations.join('\n'));

    run('npm', ['init', '--yes'], { cwd: consumer });
    run(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', tarball],
      { cwd: consumer }
    );

    const installedRoot = join(consumer, 'node_modules', sourcePackage.name);
    const installedPackage = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'));
    const cpm = run(
      process.execPath,
      [join(installedRoot, installedPackage.bin.cpm), '--version'],
      { cwd: consumer }
    );
    const server = spawnSync(
      process.execPath,
      [join(installedRoot, installedPackage.bin['claude-prompts']), '--help'],
      { cwd: consumer, encoding: 'utf8', stdio: 'pipe' }
    );
    const runtimeViolations = findRuntimeViolations(
      sourcePackage.version,
      installedPackage.version,
      {
        cpm,
        'claude-prompts': server,
      }
    );
    if (runtimeViolations.length) throw new Error(runtimeViolations.join('\n'));

    console.log(
      `Verified ${pack.filename}: ${pack.size} bytes packed, ${pack.unpackedSize} bytes unpacked, ` +
        `${pack.entryCount} files, cpm ${cpm}`
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

main();
