#!/usr/bin/env node

/** Refresh a downstream npm lock until it resolves the released package version exactly. */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value === undefined)
      throw new Error(`invalid argument: ${flag}`);
    options[flag.slice(2)] = value;
  }
  for (const required of ['workspace', 'package', 'version']) {
    if (!options[required]) throw new Error(`missing --${required}`);
  }
  if (!/^(?:@[^/]+\/)?[a-z0-9][a-z0-9._-]*$/i.test(options.package)) {
    throw new Error(`invalid package name: ${options.package}`);
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(options.version)) {
    throw new Error(`invalid version: ${options.version}`);
  }
  return {
    workspace: resolve(options.workspace),
    packageName: options.package,
    expectedVersion: options.version,
    attempts: Number(options.attempts ?? 6),
    delayMs: Number(options['delay-ms'] ?? 20_000),
  };
}

function installedLockVersion(workspace, packageName) {
  const lockPath = resolve(workspace, 'package-lock.json');
  if (!existsSync(lockPath)) throw new Error(`package lock is missing: ${lockPath}`);
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const version = lock.packages?.[`node_modules/${packageName}`]?.version;
  if (!version) throw new Error(`${packageName} is absent from ${lockPath}`);
  return version;
}

function refreshLock(workspace) {
  const result = spawnSync(
    'npm',
    [
      'install',
      '--package-lock-only',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--prefer-online',
    ],
    { cwd: workspace, encoding: 'utf8', stdio: 'inherit' }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm lock refresh exited ${result.status}`);
}

async function synchronizeVersion({ expectedVersion, attempts, delayMs, runAttempt, wait }) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) {
    throw new Error(`attempts must be an integer from 1 to 10, found ${attempts}`);
  }
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 120_000) {
    throw new Error(`delay-ms must be an integer from 0 to 120000, found ${delayMs}`);
  }
  let lastOutcome = 'no attempt completed';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const resolvedVersion = runAttempt(attempt);
      lastOutcome = `resolved ${resolvedVersion}`;
      if (resolvedVersion === expectedVersion) return attempt;
    } catch (error) {
      lastOutcome = error.message;
    }
    if (attempt < attempts) await wait(delayMs);
  }
  throw new Error(
    `registry propagation did not resolve ${expectedVersion} after ${attempts} attempts (${lastOutcome})`
  );
}

async function runSelfTest() {
  const attempts = [];
  const waits = [];
  const sequence = ['3.1.0', '3.1.0', '3.1.1'];
  const completed = await synchronizeVersion({
    expectedVersion: '3.1.1',
    attempts: 4,
    delayMs: 1,
    runAttempt: (attempt) => {
      attempts.push(attempt);
      return sequence.shift();
    },
    wait: async (delay) => waits.push(delay),
  });
  if (completed !== 3 || attempts.length !== 3 || waits.length !== 2) {
    throw new Error('bounded retry did not stop on the exact version');
  }
  let rejected = false;
  try {
    await synchronizeVersion({
      expectedVersion: '3.1.1',
      attempts: 2,
      delayMs: 0,
      runAttempt: () => '3.1.0',
      wait: async () => {},
    });
  } catch (error) {
    rejected = /after 2 attempts/.test(error.message);
  }
  if (!rejected) throw new Error('exhausted retry fixture passed');
  console.log('PASSED: bounded downstream lock synchronization fixtures');
}

async function main() {
  if (process.argv.includes('--self-test')) return runSelfTest();
  const options = parseArguments(process.argv.slice(2));
  const lockPath = resolve(options.workspace, 'package-lock.json');
  if (!existsSync(lockPath)) throw new Error(`package lock is missing: ${lockPath}`);
  const completed = await synchronizeVersion({
    ...options,
    runAttempt: (attempt) => {
      console.log(`Lock synchronization attempt ${attempt}/${options.attempts}`);
      refreshLock(options.workspace);
      return installedLockVersion(options.workspace, options.packageName);
    },
    wait: (delay) => new Promise((resolveWait) => setTimeout(resolveWait, delay)),
  });
  console.log(
    `Lock resolved ${options.packageName}@${options.expectedVersion} on attempt ${completed}`
  );
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
