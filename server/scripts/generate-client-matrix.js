#!/usr/bin/env node
/**
 * Client Matrix Generator
 *
 * Reads docs/reference/clients.json and writes every place that states a client's install kind,
 * hook coverage, config file or setup steps. The data file is the only place those facts are
 * written; the generated regions are derived, never edited by hand.
 *
 *   README.md                          client-matrix:table    all-clients table + hooks definition
 *                                      client-matrix:details  one folded <details> per non-featured client
 *   docs/reference/client-capabilities.md
 *                                      client-matrix:hooks    hook coverage table
 *                                      client-matrix:config   config shape table
 *
 * Usage:
 *   node scripts/generate-client-matrix.js [--check]
 *
 * Options:
 *   --check   Verify the regions are up to date without writing (exit 1 and name each stale file)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA_PATH = join(REPO_ROOT, 'docs', 'reference', 'clients.json');
const README_PATH = join(REPO_ROOT, 'README.md');
const CAPABILITIES_PATH = join(REPO_ROOT, 'docs', 'reference', 'client-capabilities.md');

const HOOK_LABELS = Object.freeze({
  full: 'Full',
  partial: 'Partial',
  experimental: 'Experimental',
  none: 'MCP tools only',
});

const REGENERATE_HINT =
  '(generated from docs/reference/clients.json: edit that file, run npm --prefix server run generate:client-matrix)';

// ============================================
// DATA
// ============================================
export function validateClients(data) {
  const errors = [];
  const clients = data?.clients;
  if (!Array.isArray(clients) || clients.length === 0) return ['clients must be a non-empty array'];
  const ids = new Set();
  const anchors = new Set();
  for (const client of clients) {
    const label = client?.id ?? '(no id)';
    for (const field of ['id', 'name', 'install', 'hooks', 'anchor']) {
      if (typeof client?.[field] !== 'string' || client[field] === '') {
        errors.push(`${label}: "${field}" must be a non-empty string`);
      }
    }
    if (!(client?.hooks in HOOK_LABELS)) {
      errors.push(`${label}: hooks "${client?.hooks}" is not one of ${Object.keys(HOOK_LABELS)}`);
    }
    if (!client?.featured && !(Array.isArray(client?.steps) && client.steps.length > 0)) {
      errors.push(`${label}: a non-featured client needs "steps"`);
    }
    if (ids.has(client?.id)) errors.push(`${label}: duplicate id`);
    if (anchors.has(client?.anchor)) errors.push(`${label}: duplicate anchor "${client.anchor}"`);
    ids.add(client?.id);
    anchors.add(client?.anchor);
  }
  return errors;
}

// ============================================
// RENDERING (pure; tables are padded the way Prettier pads them so validate:format agrees)
// ============================================
function renderTable(header, rows) {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length), 3));
  const line = (cells) => `| ${cells.map((c, i) => c.padEnd(widths[i])).join(' | ')} |`;
  return [
    line(header),
    `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`,
    ...rows.map(line),
  ].join('\n');
}

export function renderReadmeTable(clients) {
  const rows = clients.map((c) => [
    c.name,
    c.install,
    HOOK_LABELS[c.hooks],
    `[Steps](#${c.anchor})`,
  ]);
  return [
    '',
    renderTable(['Client', 'Install', 'Hooks', 'Steps'], rows),
    '',
    '**Hooks** are what make `>>`, `-->`, and `::` work in conversation; "MCP tools only" means the three MCP tools without them. See [With Hooks](#with-hooks). Config locations and `--client` presets: [Client Capabilities Reference](docs/reference/client-capabilities.md).',
  ].join('\n');
}

export function renderReadmeDetails(clients) {
  const blocks = clients
    .filter((c) => !c.featured)
    .map((c) =>
      [
        `<details><summary><a id="${c.anchor}"></a><strong>${c.name}</strong></summary>`,
        '',
        c.steps.join('\n'),
        '</details>',
      ].join('\n')
    );
  return blocks.join('\n');
}

export function renderHooksTable(clients) {
  const rows = clients.map((c) => {
    const companion = c.companion
      ? c.companion.url
        ? `[${c.companion.name}](${c.companion.url})`
        : c.companion.name
      : 'none';
    return [c.name, companion, HOOK_LABELS[c.hooks], c.hooksNote ?? ''];
  });
  return [
    '',
    renderTable(['Client', 'Companion package in ecosystem', 'Coverage', 'Notes'], rows),
    '',
  ].join('\n');
}

export function renderConfigTable(clients) {
  const rows = clients
    .filter((c) => c.configFile)
    .map((c) => [c.name, c.configFile, c.configFormat ?? '']);
  return ['', renderTable(['Client', 'Typical config file', 'Config format'], rows), ''].join('\n');
}

// ============================================
// REGIONS
// ============================================
const beginPattern = (name) =>
  new RegExp(
    `<!-- BEGIN GENERATED: client-matrix:${name} [^\\n]*?-->|<!-- BEGIN GENERATED: client-matrix:${name} -->`
  );
const beginMarker = (name) => `<!-- BEGIN GENERATED: client-matrix:${name} ${REGENERATE_HINT} -->`;
const endMarker = (name) => `<!-- END GENERATED: client-matrix:${name} -->`;

export function replaceRegion(text, name, body) {
  const opening = beginPattern(name).exec(text);
  const end = endMarker(name);
  const to = text.indexOf(end);
  if (!opening || to === -1 || to < opening.index) {
    throw new Error(`markers for client-matrix:${name} are missing or out of order`);
  }
  return `${text.slice(0, opening.index)}${beginMarker(name)}\n${body}\n${text.slice(to)}`;
}

function targets(clients) {
  return [
    {
      path: README_PATH,
      regions: [
        ['table', renderReadmeTable(clients)],
        ['details', renderReadmeDetails(clients)],
      ],
    },
    {
      path: CAPABILITIES_PATH,
      regions: [
        ['hooks', renderHooksTable(clients)],
        ['config', renderConfigTable(clients)],
      ],
    },
  ];
}

function applyRegions(text, regions) {
  return regions.reduce((acc, [name, body]) => replaceRegion(acc, name, body), text);
}

// ============================================
// MAIN
// ============================================
function main() {
  const checkMode = process.argv.includes('--check');
  const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
  const errors = validateClients(data);
  if (errors.length > 0) {
    console.error(`✗ ${relative(REPO_ROOT, DATA_PATH)} is invalid:\n  ${errors.join('\n  ')}`);
    process.exit(1);
  }

  const stale = [];
  for (const { path, regions } of targets(data.clients)) {
    const current = existsSync(path) ? readFileSync(path, 'utf-8') : '';
    const next = applyRegions(current, regions);
    if (next === current) continue;
    stale.push(relative(REPO_ROOT, path));
    if (!checkMode) writeFileSync(path, next, 'utf-8');
  }

  if (checkMode) {
    if (stale.length > 0) {
      console.error(
        `✗ Client matrix is stale in: ${stale.join(', ')}. Run: npm --prefix server run generate:client-matrix`
      );
      process.exit(1);
    }
    console.log('✓ Client matrix is up-to-date');
    return;
  }
  console.log(
    stale.length > 0 ? `✓ Updated ${stale.join(', ')}` : '✓ Client matrix already current'
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
}
