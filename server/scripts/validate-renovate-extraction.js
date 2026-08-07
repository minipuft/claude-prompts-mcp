#!/usr/bin/env node
/** Validate Renovate's resolved policy and dependency extraction JSONL. */

import { readFileSync } from 'node:fs';

const ACTION_FILES = [
  '.github/actions/setup-node-install/action.yml',
  '.github/workflows/ci.yml',
  '.github/workflows/downstream-sync.yml',
  '.github/workflows/extension-publish.yml',
  '.github/workflows/npm-publish.yml',
  '.github/workflows/registry-publish.yml',
  '.github/workflows/release-please.yml',
  '.github/workflows/renovate-config-validator.yml',
];
const PACKAGE_FILES = ['cli/package.json', 'package.json', 'server/package.json'];
const EXPECTED_COUNTS = { 'github-actions': 8, nodenv: 1, npm: 3, regex: 5 };
const EXPECTED_REGEX_IDENTITIES = [
  ['PyYAML', '.github/workflows/ci.yml'],
  ['pyrefly', '.github/workflows/ci.yml'],
  ['pytest', '.github/workflows/ci.yml'],
  ['renovate', '.github/workflows/renovate-config-validator.yml'],
  ['ruff', '.github/workflows/ci.yml'],
];
const RULES = [
  ['Default dependency PRs remain maintenance-only', { semanticCommitType: 'chore' }],
  [
    'Server runtime dependencies trigger patch releases',
    { semanticCommitType: 'fix', automerge: false },
  ],
  [
    'Automerge stable nonmajor development updates after a 14-day soak',
    {
      automerge: true,
      matchCurrentVersion: '!/^0/',
      matchDepTypes: ['devDependencies'],
      matchUpdateTypes: ['minor', 'patch', 'pin', 'digest'],
      minimumReleaseAge: '14 days',
    },
  ],
  ['Isolate major updates for manual review', { groupName: null, automerge: false }],
  [
    'TypeScript - require manual review',
    { groupName: 'TypeScript', allowedVersions: '<7.0.0', automerge: false },
  ],
  [
    'CLI TypeScript 6 requires a dedicated migration',
    {
      groupName: 'CLI TypeScript',
      matchFileNames: ['cli/package.json'],
      allowedVersions: '<6.0.0',
      automerge: false,
    },
  ],
  ['MCP SDK - critical dependency', { groupName: 'MCP SDK', automerge: false }],
  ['Testing frameworks - require validation', { automerge: false }],
  ['ESLint and Prettier - require validation', { automerge: false }],
  ['Build, packaging, and developer-hook tools require manual review', { automerge: false }],
  [
    'GitHub Actions - one executable supply-chain boundary',
    { groupName: 'GitHub Actions', automerge: false },
  ],
  ['Pinned Python validation tools', { groupName: 'Python validation tools', automerge: false }],
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
  if (
    config.automerge !== false ||
    config.platformAutomerge !== false ||
    config.automergeType !== 'pr'
  ) {
    errors.push('resolved global automerge policy must be fail-closed and use Renovate PR merge');
  }
  if (!same(config.schedule, ['* 0-5 * * 1'])) errors.push('resolved maintenance schedule changed');
  if (config.lockFileMaintenance?.automerge !== true) {
    errors.push('lock-file maintenance must be eligible for automerge');
  }
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
  const eligibleIndex = indexes.get(
    'Automerge stable nonmajor development updates after a 14-day soak'
  );
  for (const description of [
    'Isolate major updates for manual review',
    'TypeScript - require manual review',
    'CLI TypeScript 6 requires a dedicated migration',
    'MCP SDK - critical dependency',
    'Testing frameworks - require validation',
    'ESLint and Prettier - require validation',
    'Build, packaging, and developer-hook tools require manual review',
    'GitHub Actions - one executable supply-chain boundary',
    'Pinned Python validation tools',
  ]) {
    if (eligibleIndex >= indexes.get(description)) {
      errors.push(`manual exclusion must follow eligible automerge rule: ${description}`);
    }
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
    .map((dependency) => `${dependency.file}:${dependency.depName}`)
    .sort();
  const expectedRegexDeps = EXPECTED_REGEX_IDENTITIES.map(
    ([depName, file]) => `${file}:${depName}`
  ).sort();
  if (!same(regexDeps, expectedRegexDeps)) {
    errors.push(`custom-manager identities changed: [${regexDeps}]`);
  }
  for (const dependency of dependencies.filter(({ manager }) => manager === 'regex')) {
    if (
      typeof dependency.currentValue !== 'string' ||
      !/^[0-9][^\s"'=]*$/.test(dependency.currentValue)
    ) {
      errors.push(`custom-manager value is invalid: ${dependency.depName}`);
    }
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
  const versions = {
    PyYAML: '6.0.3',
    pyrefly: '1.1.1',
    pytest: '9.1.1',
    renovate: '44.6.0',
    ruff: '0.16.0',
  };
  const regex = EXPECTED_REGEX_IDENTITIES.map(([depName, packageFile]) => ({
    packageFile,
    deps: [{ depName, currentValue: versions[depName] }],
  }));
  const config = {
    labels: ['dependencies'],
    automerge: false,
    platformAutomerge: false,
    automergeType: 'pr',
    schedule: ['* 0-5 * * 1'],
    lockFileMaintenance: { automerge: true },
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
    const updatedDependency = fixtureRows();
    updatedDependency[2].packageFiles.regex[2].deps[0].currentValue = '0.16.1';
    if (validateRows(updatedDependency).length) throw new Error('valid dependency update failed');
    const missingMcpb = fixtureRows();
    missingMcpb[2].packageFiles.npm[1].deps = [];
    if (!validateRows(missingMcpb).length) throw new Error('missing MCPB passed');
    const invalidRegexValue = fixtureRows();
    invalidRegexValue[2].packageFiles.regex[0].deps[0].currentValue = '';
    if (!validateRows(invalidRegexValue).length) throw new Error('invalid regex value passed');
    const broadAutomerge = fixtureRows();
    broadAutomerge[0].config.automerge = true;
    if (!validateRows(broadAutomerge).length) throw new Error('broad automerge passed');
    const platformAutomerge = fixtureRows();
    platformAutomerge[0].config.platformAutomerge = true;
    if (!validateRows(platformAutomerge).length)
      throw new Error('platform automerge bypass passed');
    const missingExclusion = fixtureRows();
    const typescriptRule = missingExclusion[0].config.packageRules.find((rule) =>
      rule.description.includes('TypeScript - require manual review')
    );
    typescriptRule.automerge = true;
    if (!validateRows(missingExclusion).length) throw new Error('missing exclusion passed');
    const missingTypescriptHold = fixtureRows();
    const heldTypescriptRule = missingTypescriptHold[0].config.packageRules.find((rule) =>
      rule.description.includes('TypeScript - require manual review')
    );
    delete heldTypescriptRule.allowedVersions;
    if (!validateRows(missingTypescriptHold).length)
      throw new Error('missing TypeScript 7 hold passed');
    const missingCliTypescriptHold = fixtureRows();
    const heldCliTypescriptRule = missingCliTypescriptHold[0].config.packageRules.find((rule) =>
      rule.description.includes('CLI TypeScript 6 requires a dedicated migration')
    );
    delete heldCliTypescriptRule.allowedVersions;
    if (!validateRows(missingCliTypescriptHold).length)
      throw new Error('missing CLI TypeScript 6 hold passed');
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
