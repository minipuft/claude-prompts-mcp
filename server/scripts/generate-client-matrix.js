#!/usr/bin/env node
/**
 * Client Matrix Generator
 *
 * Reads docs/reference/clients.json and writes every place that states a client's install kind,
 * hook coverage, config file or setup steps. The data file is the only place those facts are
 * written; the generated regions are derived, never edited by hand.
 *
 *   README.md                          client-matrix:setup    one dropdown: hooks definition + a row per client
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

// GitHub strips `style` and `class`, so a hook level can only carry colour through an image.
const HOOK_BADGE_COLORS = Object.freeze({
  full: '2A8F83',
  partial: 'B7892B',
  experimental: 'D97757',
  none: '555E5A',
});

const SUMMARY_ORDER = Object.freeze(['full', 'experimental', 'partial', 'none']);

const REGENERATE_HINT =
  '(generated from docs/reference/clients.json: edit that file, run npm --prefix server run generate:client-matrix)';

// ============================================
// DATA
// ============================================
const isFilledString = (value) => typeof value === 'string' && value !== '';
const hasSteps = (entry) => Array.isArray(entry?.steps) && entry.steps.length > 0;

function missingFields(label, entry, fields) {
  return fields
    .filter((field) => !isFilledString(entry?.[field]))
    .map((field) => `${label}: "${field}" must be a non-empty string`);
}

function validateClient(client, sharedMemberIds) {
  const label = client?.id ?? '(no id)';
  const errors = missingFields(label, client, ['id', 'name', 'hooks']);
  if (!(client?.hooks in HOOK_LABELS)) {
    errors.push(`${label}: hooks "${client?.hooks}" is not one of ${Object.keys(HOOK_LABELS)}`);
  }
  if (sharedMemberIds.has(client?.id)) {
    if (client?.steps || client?.install) {
      errors.push(
        `${label}: a client in a shared setup carries no "steps" or "install" of its own`
      );
    }
    return errors;
  }
  errors.push(...missingFields(label, client, ['install']));
  if (!hasSteps(client)) errors.push(`${label}: needs "steps" or a place in a shared setup`);
  return errors;
}

function validateSharedSetup(shared, clientsById) {
  const label = shared?.id ?? '(no id)';
  const errors = missingFields(label, shared, ['id', 'name', 'install']);
  if (!hasSteps(shared)) errors.push(`${label}: needs "steps"`);
  const memberIds = Array.isArray(shared?.clients) ? shared.clients : [];
  if (memberIds.length < 2) errors.push(`${label}: a shared setup needs at least two clients`);
  const members = memberIds.map((id) => clientsById.get(id));
  memberIds
    .filter((id) => !clientsById.has(id))
    .forEach((id) => errors.push(`${label}: unknown client "${id}"`));
  const hookLevels = new Set(members.filter(Boolean).map((client) => client.hooks));
  if (hookLevels.size > 1) {
    errors.push(`${label}: its clients differ in hook coverage, so one row would misstate them`);
  }
  return errors;
}

function duplicates(values) {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

export function validateClients(data) {
  const clients = data?.clients;
  if (!Array.isArray(clients) || clients.length === 0) return ['clients must be a non-empty array'];
  const sharedSetups = data.sharedSetups ?? [];
  const memberIds = sharedSetups.flatMap((shared) => shared?.clients ?? []);
  const sharedMemberIds = new Set(memberIds);
  const clientsById = new Map(clients.map((client) => [client?.id, client]));
  return [
    ...clients.flatMap((client) => validateClient(client, sharedMemberIds)),
    ...sharedSetups.flatMap((shared) => validateSharedSetup(shared, clientsById)),
    ...duplicates(clients.map((client) => client?.id)).map((id) => `${id}: duplicate id`),
    ...duplicates(memberIds).map((id) => `${id}: listed in more than one shared setup`),
  ];
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

// A bare <img> in a <summary> gets wrapped in a link to the image, so a click on the badge would
// open it instead of the row. GitHub leaves an image inside <picture> unwrapped.
function renderHookBadge(hooks) {
  const label = HOOK_LABELS[hooks];
  const src = `https://img.shields.io/badge/Hooks-${label.replaceAll(' ', '_')}-${HOOK_BADGE_COLORS[hooks]}?style=flat-square&amp;labelColor=111715`;
  return `<picture><img src="${src}" alt="Hooks: ${label}" height="20"></picture>`;
}

function setupRows(clients, sharedSetups) {
  const clientsById = new Map(clients.map((client) => [client.id, client]));
  const emitted = new Set();
  const rows = [];
  for (const client of clients) {
    const shared = sharedSetups.find((setup) => setup.clients.includes(client.id));
    if (!shared) {
      rows.push(client);
    } else if (!emitted.has(shared.id)) {
      emitted.add(shared.id);
      rows.push({ ...shared, hooks: clientsById.get(shared.clients[0]).hooks });
    }
  }
  return rows;
}

function renderHookCounts(clients) {
  return SUMMARY_ORDER.map((hooks) => {
    const count = clients.filter((client) => client.hooks === hooks).length;
    const label = hooks === 'none' ? HOOK_LABELS[hooks] : HOOK_LABELS[hooks].toLowerCase();
    return count > 0 ? `${count} ${label}` : null;
  })
    .filter(Boolean)
    .join(' · ');
}

export function renderReadmeSetup(clients, sharedSetups = []) {
  const rows = setupRows(clients, sharedSetups).map((row) =>
    [
      `<details name="clients"><summary>${renderHookBadge(row.hooks)} <strong>${row.name}</strong> <sub>${row.install}</sub></summary>`,
      '',
      row.steps.join('\n'),
      '',
      '</details>',
    ].join('\n')
  );
  return [
    '',
    '<details>',
    `<summary><strong>All ${clients.length} clients: setup and hook coverage</strong><br><sub>${renderHookCounts(clients)}</sub></summary>`,
    '',
    '**Hooks** are what make `>>`, `-->`, and `::` work in conversation; "MCP tools only" means the three MCP tools without them. See [With Hooks](#with-hooks). Config locations and `--client` presets: [Client Capabilities Reference](docs/reference/client-capabilities.md).',
    '',
    ...rows,
    '',
    '</details>',
    '',
  ].join('\n');
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

function targets({ clients, sharedSetups }) {
  return [
    {
      path: README_PATH,
      regions: [['setup', renderReadmeSetup(clients, sharedSetups)]],
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
  for (const { path, regions } of targets(data)) {
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
