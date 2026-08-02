#!/usr/bin/env node
/** Validate the dependency contract used to assemble the MCPB artifact. */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT_DIR = join(SERVER_DIR, '..');
const POLICY = {
  required: [
    '@modelcontextprotocol/sdk',
    '@opentelemetry/api',
    '@opentelemetry/exporter-trace-otlp-http',
    '@opentelemetry/resources',
    '@opentelemetry/sdk-node',
    '@opentelemetry/sdk-trace-node',
    '@opentelemetry/semantic-conventions',
    'ajv',
    'diff',
    'express',
    'js-yaml',
    'nunjucks',
    'zod',
  ],
  excluded: ['chokidar', 'ulid'],
};

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const sameNames = (actual, expected) =>
  actual.length === expected.length && actual.every((name, index) => name === expected[index]);

function buildExclusions(script) {
  const match = script.match(/MCPB_EXCLUDED_DEPS=\(([^)]*)\)/);
  if (!match) throw new Error('build-extension.sh does not declare MCPB_EXCLUDED_DEPS');
  return [...match[1].matchAll(/["']([^"']+)["']/g)].map((item) => item[1]).sort();
}

function validateContract({ packageJson, packageLock, buildScript, stagedDir, policy = POLICY }) {
  const errors = [];
  const dependencies = packageJson.dependencies ?? {};
  const declared = Object.keys(dependencies).sort();
  const classified = [...policy.required, ...policy.excluded].sort();
  if (!sameNames(declared, classified)) {
    errors.push(
      `dependency classification mismatch: declared=[${declared}] classified=[${classified}]`
    );
  }

  let exclusions = [];
  try {
    exclusions = buildExclusions(buildScript);
  } catch (error) {
    errors.push(error.message);
  }
  if (!sameNames(exclusions, [...policy.excluded].sort())) {
    errors.push(`build exclusions mismatch: actual=[${exclusions}] expected=[${policy.excluded}]`);
  }

  const lockedRoot = packageLock.packages?.['']?.dependencies ?? {};
  for (const [name, range] of Object.entries(dependencies)) {
    if (lockedRoot[name] !== range)
      errors.push(`lock root mismatch for ${name}: ${lockedRoot[name]}`);
    if (!packageLock.packages?.[`node_modules/${name}`])
      errors.push(`lock entry missing for ${name}`);
  }

  if (stagedDir) {
    const stagedServer = join(stagedDir, 'server');
    const stagedPackage = readJson(join(stagedServer, 'package.json'));
    const bundle = readFileSync(join(stagedServer, 'dist', 'index.js'), 'utf8');
    const expectedNames = [...policy.required].sort();
    const stagedNames = Object.keys(stagedPackage.dependencies ?? {}).sort();
    if (!sameNames(stagedNames, expectedNames)) {
      errors.push(
        `staged dependencies mismatch: actual=[${stagedNames}] expected=[${expectedNames}]`
      );
    }
    for (const name of policy.required) {
      if (stagedPackage.dependencies?.[name] !== dependencies[name]) {
        errors.push(`staged range mismatch for ${name}: ${stagedPackage.dependencies?.[name]}`);
      }
      if (!existsSync(join(stagedServer, 'node_modules', name))) {
        errors.push(`staged module missing for ${name}`);
      }
    }
    for (const name of policy.excluded) {
      if (existsSync(join(stagedServer, 'node_modules', name))) {
        errors.push(`excluded module present in stage: ${name}`);
      }
      if (!bundle.includes(`node_modules/${name}/`)) {
        errors.push(`excluded module is not proven bundled: ${name}`);
      }
    }
  }
  return errors;
}

function runSelfTest() {
  const fixture = mkdtempSync(join(tmpdir(), 'extension-deps-test-'));
  const stage = join(fixture, 'stage', 'server');
  const policy = { required: ['runtime'], excluded: ['bundled'] };
  const packageJson = { dependencies: { runtime: '^1.0.0', bundled: '^2.0.0' } };
  const packageLock = {
    packages: {
      '': { dependencies: packageJson.dependencies },
      'node_modules/runtime': {},
      'node_modules/bundled': {},
    },
  };
  const buildScript = 'MCPB_EXCLUDED_DEPS=("bundled")';
  mkdirSync(join(stage, 'node_modules', 'runtime'), { recursive: true });
  mkdirSync(join(stage, 'dist'), { recursive: true });
  writeFileSync(join(stage, 'dist', 'index.js'), '// node_modules/bundled/index.js');
  writeFileSync(
    join(stage, 'package.json'),
    JSON.stringify({ dependencies: { runtime: '^1.0.0' } })
  );
  const validate = (overrides = {}) =>
    validateContract({
      packageJson,
      packageLock,
      buildScript,
      stagedDir: join(fixture, 'stage'),
      policy,
      ...overrides,
    });
  try {
    if (validate().length) throw new Error('healthy fixture failed');
    if (!validate({ packageLock: { packages: {} } }).length) throw new Error('bad lock passed');
    if (!validate({ buildScript: 'MCPB_EXCLUDED_DEPS=("other")' }).length) {
      throw new Error('bad exclusion passed');
    }
    rmSync(join(stage, 'node_modules', 'runtime'), { recursive: true });
    if (!validate().length) throw new Error('bad stage passed');
    console.log('PASSED: extension dependency validator self-test');
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
}

function main() {
  if (process.argv.includes('--self-test')) return runSelfTest();
  const stageIndex = process.argv.indexOf('--staging-dir');
  const stagedDir = stageIndex === -1 ? undefined : process.argv[stageIndex + 1];
  if (stageIndex !== -1 && !stagedDir) throw new Error('--staging-dir requires a path');
  const errors = validateContract({
    packageJson: readJson(join(SERVER_DIR, 'package.json')),
    packageLock: readJson(join(SERVER_DIR, 'package-lock.json')),
    buildScript: readFileSync(join(ROOT_DIR, 'scripts/build-extension.sh'), 'utf8'),
    stagedDir,
  });
  if (errors.length) {
    for (const error of errors) console.error(`ERROR: ${error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`PASSED: MCPB dependency contract${stagedDir ? ' and staged tree' : ''}`);
}

main();
