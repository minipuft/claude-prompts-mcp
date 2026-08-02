#!/usr/bin/env node
/** Validate Renovate's resolved policy and dependency extraction JSONL. */

import { readFileSync } from 'node:fs';

const ACTION_FILES = [
  '.github/actions/setup-node-install/action.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/downstream-sync.yml',
  '.github/workflows/extension-publish.yml',
  '.github/workflows/npm-publish.yml',
  '.github/workflows/release-please.yml',
  '.github/workflows/renovate-config-validator.yml',
];
const PACKAGE_FILES = ['cli/package.json', 'package.json', 'server/package.json'];
const EXPECTED_COUNTS = { 'github-actions': 7, nodenv: 1, npm: 3, regex: 3 };
const RULES = [
  ['Default dependency PRs remain maintenance-only', { semanticCommitType: 'chore' }],
  ['Server runtime dependencies trigger patch releases', { semanticCommitType: 'fix' }],
  ['Isolate major updates for manual review', { groupName: null }],
  ['TypeScript - require manual review', { groupName: 'TypeScript' }],
  ['MCP SDK - critical dependency', { groupName: 'MCP SDK' }],
  ['GitHub Actions - one executable supply-chain boundary', { groupName: 'GitHub Actions' }],
  ['Pinned Python validation tools', { groupName: 'Python validation tools' }],
];

const same = (actual, expected) => JSON.stringify(actual) === JSON.stringify(expected);
const sorted = (values) => [...values].sort();

function parseJsonLines(input) {
  const lines = input.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) throw new Error('Renovate emitted no JSONL records');
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`Renovate emitted non-JSON output on line ${index + 1}`);
    }
  });
}

function onlyRecord(rows, message, errors) {
  const matches = rows.filter((row) => row.msg === message);
  if (matches.length !== 1)
    errors.push(`expected one '${message}' record, found ${matches.length}`);
  return matches[0];
}

function validateConfig(config, errors) {
  if (!same(config.labels, ['dependencies'])) errors.push('resolved labels must be [dependencies]');
  if (config.automerge !== false || config.platformAutomerge !== false) {
    errors.push('resolved automerge policy must remain disabled');
  }
  if (!same(config.schedule, ['* 0-5 * * 1'])) errors.push('resolved maintenance schedule changed');
  const alerts = config.vulnerabilityAlerts ?? {};
  if (!same(alerts.addLabels, ['security', 'vulnerability']) || alerts.automerge !== false) {
    errors.push('resolved vulnerability label/automerge policy changed');
  }
  const rules = config.packageRules ?? [];
  const indexes = new Map();
  for (const [description, expected] of RULES) {
    const index = rules.findIndex((rule) => rule.description?.includes(description));
    indexes.set(description, index);
    if (index === -1) {
      errors.push(`resolved rule missing: ${description}`);
      continue;
    }
    for (const [field, value] of Object.entries(expected)) {
      if (!same(rules[index][field], value)) errors.push(`${description} has unexpected ${field}`);
    }
  }
  if (indexes.get(RULES[0][0]) >= indexes.get(RULES[1][0])) {
    errors.push('default semantic rule must precede the server runtime override');
  }
}

function validateExtraction(stats, extracted, errors) {
  for (const [manager, count] of Object.entries(EXPECTED_COUNTS)) {
    if (stats.managers?.[manager]?.fileCount !== count) {
      errors.push(`${manager} fileCount must be ${count}`);
    }
  }
  const managerNames = Object.keys(stats.managers ?? {}).sort();
  if (!same(managerNames, Object.keys(EXPECTED_COUNTS).sort()))
    errors.push('unexpected extracted manager set');

  const files = (manager) => sorted((extracted[manager] ?? []).map((entry) => entry.packageFile));
  if (!same(files('github-actions'), sorted(ACTION_FILES)))
    errors.push('GitHub Actions file inventory changed');
  if (!same(files('npm'), sorted(PACKAGE_FILES))) errors.push('npm package file inventory changed');
  if (!same(files('nodenv'), ['.node-version'])) errors.push('Node version source changed');

  const dependencies = Object.entries(extracted)
    .filter(([, entries]) => Array.isArray(entries))
    .flatMap(([manager, entries]) =>
      entries.flatMap((entry) =>
        entry.deps.map((dependency) => ({ manager, file: entry.packageFile, ...dependency }))
      )
    );
  const mcpb = dependencies.filter((dependency) => dependency.depName === '@anthropic-ai/mcpb');
  if (
    mcpb.length !== 1 ||
    mcpb[0].manager !== 'npm' ||
    mcpb[0].file !== 'package.json' ||
    mcpb[0].currentValue !== '2.1.2'
  ) {
    errors.push('MCPB must be extracted exactly once from root package.json at 2.1.2');
  }
  const regexDeps = dependencies
    .filter((dependency) => dependency.manager === 'regex')
    .map((dependency) => `${dependency.depName}@${dependency.currentValue}`)
    .sort();
  if (!same(regexDeps, ['pyrefly@1.1.1', 'renovate@44.6.0', 'ruff@0.16.0'])) {
    errors.push(`custom-manager identities changed: [${regexDeps}]`);
  }
}

function validateRows(rows) {
  const errors = rows
    .filter((row) => Number(row.level) >= 40)
    .map((row) => `Renovate warning/error: ${row.msg ?? 'unknown message'}`);
  const configRow = onlyRecord(
    rows,
    'Full resolved config and hostRules including presets',
    errors
  );
  const statsRow = onlyRecord(rows, 'Dependency extraction complete', errors);
  const extractionRow = onlyRecord(rows, 'Extracted dependencies', errors);
  if (configRow) validateConfig(configRow.config ?? {}, errors);
  if (statsRow && extractionRow) {
    validateExtraction(statsRow.stats ?? {}, extractionRow.packageFiles ?? {}, errors);
  }
  return errors;
}

function fixtureRows() {
  const emptyEntries = (files) => files.map((packageFile) => ({ packageFile, deps: [] }));
  const packageEntries = emptyEntries(PACKAGE_FILES);
  packageEntries[1].deps.push({ depName: '@anthropic-ai/mcpb', currentValue: '2.1.2' });
  const regex = ['ruff@0.16.0', 'pyrefly@1.1.1', 'renovate@44.6.0'].map((value) => {
    const [depName, currentValue] = value.split('@');
    return { packageFile: 'fixture', deps: [{ depName, currentValue }] };
  });
  const config = {
    labels: ['dependencies'],
    automerge: false,
    platformAutomerge: false,
    schedule: ['* 0-5 * * 1'],
    vulnerabilityAlerts: { addLabels: ['security', 'vulnerability'], automerge: false },
    packageRules: RULES.map(([description, expected]) => ({
      description: [description],
      ...expected,
    })),
  };
  const managers = Object.fromEntries(
    Object.entries(EXPECTED_COUNTS).map(([manager, fileCount]) => [manager, { fileCount }])
  );
  return [
    { msg: 'Full resolved config and hostRules including presets', config },
    { msg: 'Dependency extraction complete', stats: { managers } },
    {
      msg: 'Extracted dependencies',
      packageFiles: {
        'github-actions': emptyEntries(ACTION_FILES),
        nodenv: emptyEntries(['.node-version']),
        npm: packageEntries,
        regex,
      },
    },
  ];
}

function main() {
  if (process.argv.includes('--self-test')) {
    const fixture = fixtureRows();
    for (const input of ['', '{']) {
      try {
        parseJsonLines(input);
        throw new Error('invalid JSONL passed');
      } catch (error) {
        if (error.message === 'invalid JSONL passed') throw error;
      }
    }
    if (validateRows(fixture).length) throw new Error('healthy extraction fixture failed');
    if (!validateRows([...fixture, { level: 40, msg: 'warning' }]).length)
      throw new Error('warning passed');
    fixture[2].packageFiles.npm[1].deps = [];
    if (!validateRows(fixture).length) throw new Error('missing MCPB passed');
    console.log('PASSED: Renovate extraction validator self-test');
    return;
  }
  const errors = validateRows(parseJsonLines(readFileSync(0, 'utf8')));
  if (errors.length) {
    for (const error of errors) console.error(`ERROR: ${error}`);
    process.exitCode = 1;
  } else console.log('PASSED: Renovate policy and extraction contract');
}

main();
