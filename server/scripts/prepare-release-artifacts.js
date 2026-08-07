#!/usr/bin/env node

/** Build the explicit CLI and diagnostic-map assets attached to a GitHub Release. */

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function sha256(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex');
}

function findViolations({ expectedVersion, cliVersion, cliFile, checksumFile, maps }) {
  const violations = [];
  if (!existsSync(cliFile)) violations.push(`CLI asset missing: ${cliFile}`);
  if (cliVersion !== expectedVersion) {
    violations.push(`CLI version ${cliVersion} does not match release ${expectedVersion}`);
  }
  for (const map of maps) {
    if (!existsSync(map)) violations.push(`source map missing: ${map}`);
  }
  if (existsSync(cliFile) && existsSync(checksumFile)) {
    const expected = `${sha256(cliFile)}  ${basename(cliFile)}`;
    const actual = readFileSync(checksumFile, 'utf8').trim();
    if (actual !== expected) violations.push(`checksum does not match ${basename(cliFile)}`);
  } else if (!existsSync(checksumFile)) {
    violations.push(`checksum missing: ${checksumFile}`);
  }
  return violations;
}

function runSelfTest() {
  const fixture = mkdtempSync(join(tmpdir(), 'release-artifacts-test-'));
  const cli = join(fixture, 'cpm-3.1.1.js');
  const checksum = `${cli}.sha256`;
  const map = join(fixture, 'cpm.js.map');
  try {
    writeFileSync(cli, 'cli');
    writeFileSync(map, 'map');
    writeFileSync(checksum, `${sha256(cli)}  ${basename(cli)}\n`);
    const healthy = {
      expectedVersion: '3.1.1',
      cliVersion: '3.1.1',
      cliFile: cli,
      checksumFile: checksum,
      maps: [map],
    };
    const cases = [
      ['version mismatch', { ...healthy, cliVersion: '0.1.0' }],
      ['missing CLI', { ...healthy, cliFile: join(fixture, 'missing.js') }],
      ['missing map', { ...healthy, maps: [join(fixture, 'missing.map')] }],
    ];
    let failures = 0;
    for (const [name, input] of cases) {
      const rejected = findViolations(input).length > 0;
      console.log(`  ${rejected ? 'ok  ' : 'FAIL'}  ${name}`);
      if (!rejected) failures += 1;
    }
    writeFileSync(checksum, `wrong  ${basename(cli)}\n`);
    const badChecksum = findViolations(healthy).length > 0;
    console.log(`  ${badChecksum ? 'ok  ' : 'FAIL'}  checksum mismatch`);
    if (!badChecksum) failures += 1;
    writeFileSync(checksum, `${sha256(cli)}  ${basename(cli)}\n`);
    const accepted = findViolations(healthy).length === 0;
    console.log(`  ${accepted ? 'ok  ' : 'FAIL'}  healthy assets`);
    if (!accepted) failures += 1;
    process.exitCode = failures === 0 ? 0 : 1;
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

function main() {
  if (process.argv.includes('--self-test')) return runSelfTest();
  const outputIndex = process.argv.indexOf('--output-dir');
  const outputArg = outputIndex === -1 ? undefined : process.argv[outputIndex + 1];
  if (!outputArg) throw new Error('--output-dir is required');

  const outputDir = resolve(outputArg);
  const pkg = JSON.parse(readFileSync(join(SERVER_DIR, 'package.json'), 'utf8'));
  const sourceCli = join(SERVER_DIR, 'dist', 'cpm.js');
  const maps = [join(SERVER_DIR, 'dist', 'index.js.map'), join(SERVER_DIR, 'dist', 'cpm.js.map')];
  const cliFile = join(outputDir, `cpm-${pkg.version}.js`);
  const checksumFile = `${cliFile}.sha256`;
  const mapsArchive = join(outputDir, `claude-prompts-${pkg.version}-sourcemaps.tar.gz`);

  mkdirSync(outputDir, { recursive: true });
  if (!existsSync(sourceCli)) throw new Error('dist/cpm.js is missing; build the server first');
  const versionResult = spawnSync(process.execPath, [sourceCli, '--version'], {
    cwd: SERVER_DIR,
    encoding: 'utf8',
    stdio: 'pipe',
  });
  if (versionResult.status !== 0) {
    throw new Error(`cpm --version failed (${versionResult.status})\n${versionResult.stderr}`);
  }
  const cliVersion = versionResult.stdout.trim();

  copyFileSync(sourceCli, cliFile);
  writeFileSync(checksumFile, `${sha256(cliFile)}  ${basename(cliFile)}\n`);

  const preArchiveViolations = findViolations({
    expectedVersion: pkg.version,
    cliVersion,
    cliFile,
    checksumFile,
    maps,
  });
  if (preArchiveViolations.length) throw new Error(preArchiveViolations.join('\n'));

  const archive = spawnSync(
    'tar',
    ['-czf', mapsArchive, '-C', SERVER_DIR, 'dist/index.js.map', 'dist/cpm.js.map'],
    { encoding: 'utf8', stdio: 'pipe' }
  );
  if (archive.status !== 0) {
    throw new Error(`source-map archive failed (${archive.status})\n${archive.stderr}`);
  }
  if (!existsSync(mapsArchive)) throw new Error(`source-map archive missing: ${mapsArchive}`);

  console.log(`Prepared ${basename(cliFile)}, ${basename(checksumFile)}, ${basename(mapsArchive)}`);
}

main();
