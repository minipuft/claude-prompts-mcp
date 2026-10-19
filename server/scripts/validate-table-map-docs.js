#!/usr/bin/env node

/**
 * Fails when the documented SQLite table map stops matching the table contracts.
 *
 * WHY THIS EXISTS
 * `docs/architecture/overview.md` carried a state table naming four SQLite tables that had been
 * merged into `kv_state` long before, plus `runtime-state/*.json` files nothing wrote any more.
 * Nothing reads docs, so nothing noticed. That section now links to the one table map in
 * `docs/architecture/sqlite-persistence.md`, and this script makes that map — and the hand-kept
 * subset in CLAUDE.md §Runtime State — fail CI when they drift from the code's own declarations.
 *
 * WHAT IT READS — the contracts are the source of truth, every other site is checked against them
 *   (a) `server/src/infra/database/table-contracts.ts`, as TEXT: each top-level entry of
 *       `TABLE_CONTRACTS` (opened by a two-space `{` line) yields its `table:`, `posture:` and
 *       `scope:` string properties at four-space indent; each entry of `VIEW_CONTRACTS` yields
 *       its `view:`. Commented lines never match, because the property must start the line.
 *   (b) `docs/architecture/sqlite-persistence.md`: the `## The Map (N declared tables + M views)`
 *       heading and the first markdown table under it, `| Table | Owner | Posture | Scope |`.
 *       The backticked names in the Table column must equal the contract tables in both
 *       directions; each row's Posture and Scope must equal the contract once `**` bold and a
 *       trailing `\*` footnote marker are stripped; N and M must equal the contract counts.
 *   (c) CLAUDE.md: the first table under the heading starting `## Runtime State`. Every
 *       backticked name in its first column must be a contract table or view. Completeness is
 *       not required — that table lists a subset on purpose.
 *   (d) Retired table names (RETIRED_TABLE_NAMES) written as backticked identifiers in
 *       docs/**\/*.md, CLAUDE.md, AGENTS.md, README.md, CONTRIBUTING.md and server/README.md.
 *       Each is a violation unless an entry in RETIRED_NAME_ALLOWLIST excuses that line, with a
 *       reason. An allowlist entry that no longer matches anything is itself a violation.
 *
 * REFUSES RATHER THAN PASSES
 * This is a text parser over a bounded shape, not a TypeScript parser. Fewer than MIN_TABLES
 * contract tables, a contract entry missing one of its three properties, no view contracts, a
 * missing Map heading or header row, a Map table with fewer than MIN_TABLES rows, or a missing
 * Runtime State table each exit 1 with a REFUSED message instead of comparing — a parser collapse
 * must never read as agreement.
 *
 * ZERO DEPENDENCIES, ON PURPOSE
 * A hand edit to the map classifies as `docs` (scripts/classify-validation-scope.js), and ci.yml
 * guards "Install dependencies" on `scope == 'full'`, so the lightweight routes have no
 * node_modules. Node builtins only, same posture as validate-pipeline-stage-table.js. Keep it
 * that way — which is also why the contracts file is read as text rather than imported.
 *
 * DECLARED BLIND SPOTS
 *   - The Owner column is prose (shortened paths) and is not read. An owner that moved passes.
 *   - Retention, readers and `rebuiltFrom` are not documented in the map and are not compared.
 *   - A retired name is seen only as an exact backticked identifier. Plain prose ("tenants"),
 *     `tenants.id`, or `CREATE TABLE tenants` inside a fenced block is not seen, and files outside
 *     the roots above (plans/, CHANGELOG.md, source comments) are not read.
 *   - A table renamed consistently in the contracts and the docs passes: this checks agreement,
 *     not that a name is apt.
 *   - A contract property written on a continuation line (`posture:` then the value below) is not
 *     parsed; the entry is refused rather than misread.
 *
 * Usage: node server/scripts/validate-table-map-docs.js [--self-test]
 * Exit: 0 = consistent, 1 = violations or refusal (or a failed self-test), 2 = invalid args
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import assert from 'node:assert';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');

const CONTRACTS_PATH = 'server/src/infra/database/table-contracts.ts';
const MAP_PATH = 'docs/architecture/sqlite-persistence.md';
const HANDBOOK_PATH = 'CLAUDE.md';
const RETIRED_ROOT_FILES = [
  'CLAUDE.md',
  'AGENTS.md',
  'README.md',
  'CONTRIBUTING.md',
  'server/README.md',
];
const RETIRED_DOCS_DIR = 'docs';

/** Below this many tables (contracts or Map rows) the parser is assumed to have collapsed. */
const MIN_TABLES = 8;

/** Tables that were deleted or merged into `kv_state`; a doc naming one as live is stale. */
const RETIRED_TABLE_NAMES = [
  'framework_state',
  'gate_system_state',
  'argument_history',
  'resource_hash_cache',
  'chain_run_registry',
  'tenants',
];

/**
 * Lines that name a retired table as history, not as a live table.
 * Each entry: `file` (repo-relative), `name` (the retired table), `contains` (a substring of the
 * line), `reason`. One entry excuses one name on matching lines; a line naming two retired tables
 * needs two entries.
 */
const RETIRED_NAME_ALLOWLIST = [
  {
    file: 'docs/architecture/sqlite-persistence.md',
    name: 'tenants',
    contains: '`tenants` was deleted at v19',
    reason: 'The Map history sentence: records the deletion that explains the table count',
  },
  {
    file: 'docs/architecture/sqlite-persistence.md',
    name: 'chain_run_registry',
    contains: '`chain_run_registry` was deleted at v22',
    reason: 'The Map history sentence: records the deletion that explains the table count',
  },
  {
    file: 'CLAUDE.md',
    name: 'chain_run_registry',
    contains: 'replaces the retired `chain_run_registry` blob',
    reason: 'Runtime State `chain_runs` row: names the blob table this one replaced',
  },
  {
    file: 'CLAUDE.md',
    name: 'chain_run_registry',
    contains: 'together they are what `chain_run_registry` used to serialize',
    reason: 'Runtime State `chain_run_nodes` row: names the blob table the pair replaced',
  },
];

const ENTRY_OPEN = /^ {2}\{\s*$/;
const ENTRY_CLOSE = /^ {2}\},?\s*$/;
const MAP_HEADING = /^## The Map\b/;
const MAP_HEADING_SHAPE = /^## The Map \((\d+) declared tables \+ (\d+) views\)\s*$/;
const RUNTIME_HEADING = /^## Runtime State/;
const BACKTICKED = /`([^`]+)`/g;

class Refusal extends Error {}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The source text of `export const <name> ... = [ … ];`. Throws Refusal when absent. */
function arrayBlock(source, name) {
  const open = new RegExp(`^export const ${escapeRegExp(name)}\\b[^=]*=\\s*\\[\\s*$`, 'm').exec(
    source
  );
  if (open === null) {
    throw new Refusal(
      `${CONTRACTS_PATH}: no \`export const ${name} … = [\` block found — the contract moved or ` +
        'changed shape; update this validator, do not skip it'
    );
  }
  const start = open.index + open[0].length;
  const close = source.indexOf('\n];', start);
  if (close === -1) throw new Refusal(`${CONTRACTS_PATH}: \`${name}\` is never closed with \`];\``);
  return source.slice(start, close);
}

/** Top-level `{ … }` entries of an array block, each as its list of lines. */
function entries(block) {
  const out = [];
  let current = null;
  for (const line of block.split('\n')) {
    if (current === null) {
      if (ENTRY_OPEN.test(line)) current = [];
    } else if (ENTRY_CLOSE.test(line)) {
      out.push(current);
      current = null;
    } else {
      current.push(line);
    }
  }
  return out;
}

function property(lines, key) {
  const shape = new RegExp(`^ {4}${key}: '([^']+)',?\\s*$`);
  for (const line of lines) {
    const match = shape.exec(line);
    if (match !== null) return match[1];
  }
  return null;
}

/** `{ tables: Map<name, {posture, scope}>, views: string[] }`. Throws Refusal on any collapse. */
function parseContracts(source) {
  const tables = new Map();
  entries(arrayBlock(source, 'TABLE_CONTRACTS')).forEach((lines, i) => {
    const table = property(lines, 'table');
    const posture = property(lines, 'posture');
    const scope = property(lines, 'scope');
    if (table === null || posture === null || scope === null) {
      throw new Refusal(
        `${CONTRACTS_PATH}: TABLE_CONTRACTS entry ${i + 1}${table ? ` (\`${table}\`)` : ''} has ` +
          'no single-line `table:`, `posture:` and `scope:` string — refusing to guess'
      );
    }
    if (tables.has(table)) {
      throw new Refusal(`${CONTRACTS_PATH}: TABLE_CONTRACTS declares \`${table}\` twice`);
    }
    tables.set(table, { posture, scope });
  });
  if (tables.size < MIN_TABLES) {
    throw new Refusal(
      `${CONTRACTS_PATH}: parser collapse suspected — TABLE_CONTRACTS yielded ${tables.size} ` +
        `table(s), fewer than ${MIN_TABLES}. Refusing to compare rather than report a vacuous pass`
    );
  }
  const views = entries(arrayBlock(source, 'VIEW_CONTRACTS')).map((lines, i) => {
    const view = property(lines, 'view');
    if (view === null) {
      throw new Refusal(`${CONTRACTS_PATH}: VIEW_CONTRACTS entry ${i + 1} has no \`view:\` string`);
    }
    return view;
  });
  if (views.length === 0) {
    throw new Refusal(
      `${CONTRACTS_PATH}: VIEW_CONTRACTS yielded no views — parser collapse suspected`
    );
  }
  return { tables, views };
}

const cellsOf = (line) =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

/**
 * The first markdown table after `headingLine` and before the next `## ` heading:
 * `{ header, rows: [{ line, cells }] }`, or null when there is none.
 */
function tableAfter(lines, headingLine) {
  let i = headingLine + 1;
  while (i < lines.length && !lines[i].startsWith('|')) {
    if (/^## /.test(lines[i])) return null;
    i++;
  }
  if (i >= lines.length) return null;
  const header = cellsOf(lines[i]);
  const rows = [];
  for (let j = i + 2; j < lines.length && lines[j].startsWith('|'); j++) {
    rows.push({ line: j + 1, cells: cellsOf(lines[j]) });
  }
  return { header, headerLine: i + 1, rows };
}

const namesIn = (cell) => [...cell.matchAll(BACKTICKED)].map((m) => m[1]);
const plainCell = (cell) => cell.replace(/\*\*/g, '').replace(/\\\*$/, '').trim();

/** Check (b): the Map against the contracts. */
function checkMap(mapSource, contracts) {
  const lines = mapSource.split('\n');
  const headingLine = lines.findIndex((l) => MAP_HEADING.test(l));
  if (headingLine === -1) throw new Refusal(`${MAP_PATH}: no \`## The Map\` heading`);
  const shape = MAP_HEADING_SHAPE.exec(lines[headingLine]);
  if (shape === null) {
    throw new Refusal(
      `${MAP_PATH}:${headingLine + 1}: the heading is not \`## The Map (N declared tables + M ` +
        'views)` — refusing to read counts from another shape'
    );
  }
  const table = tableAfter(lines, headingLine);
  if (table === null) throw new Refusal(`${MAP_PATH}: no markdown table under \`## The Map\``);
  if (table.header.join('|') !== 'Table|Owner|Posture|Scope') {
    throw new Refusal(
      `${MAP_PATH}:${table.headerLine}: the Map table header is \`| ${table.header.join(' | ')} |\`, ` +
        'not `| Table | Owner | Posture | Scope |`'
    );
  }
  if (table.rows.length < MIN_TABLES) {
    throw new Refusal(
      `${MAP_PATH}: parser collapse suspected — the Map table yielded ${table.rows.length} ` +
        `row(s), fewer than ${MIN_TABLES}`
    );
  }

  const violations = [];
  const where = (line) => `${MAP_PATH}:${line}`;
  const [, n, m] = shape.map(Number);
  if (n !== contracts.tables.size) {
    violations.push({
      where: where(headingLine + 1),
      category: 'map-count',
      detail: `the heading says ${n} declared tables; TABLE_CONTRACTS declares ${contracts.tables.size}`,
    });
  }
  if (m !== contracts.views.length) {
    violations.push({
      where: where(headingLine + 1),
      category: 'map-count',
      detail: `the heading says ${m} views; VIEW_CONTRACTS declares ${contracts.views.length}`,
    });
  }

  const documented = new Set();
  for (const row of table.rows) {
    const names = namesIn(row.cells[0] ?? '');
    if (names.length !== 1) {
      violations.push({
        where: where(row.line),
        category: 'map-row',
        detail: `the Table cell names ${names.length} backticked table(s); exactly one expected`,
      });
      continue;
    }
    const [name] = names;
    if (documented.has(name)) {
      violations.push({
        where: where(row.line),
        category: 'map-row',
        detail: `\`${name}\` is listed twice`,
      });
      continue;
    }
    documented.add(name);
    const contract = contracts.tables.get(name);
    if (contract === undefined) {
      violations.push({
        where: where(row.line),
        category: 'map-extra',
        detail: `\`${name}\` is in the Map but TABLE_CONTRACTS declares no such table`,
      });
      continue;
    }
    for (const [column, index] of [
      ['posture', 2],
      ['scope', 3],
    ]) {
      const documentedValue = plainCell(row.cells[index] ?? '');
      if (documentedValue !== contract[column]) {
        violations.push({
          where: where(row.line),
          category: `map-${column}`,
          detail: `\`${name}\` ${column} is "${documentedValue}" in the Map; the contract says "${contract[column]}"`,
        });
      }
    }
  }
  for (const name of contracts.tables.keys()) {
    if (!documented.has(name)) {
      violations.push({
        where: where(table.headerLine),
        category: 'map-missing',
        detail: `\`${name}\` is declared in TABLE_CONTRACTS but has no row in the Map`,
      });
    }
  }
  return violations;
}

/** Check (c): every first-column name of CLAUDE.md §Runtime State is a contract table or view. */
function checkHandbook(handbookSource, contracts) {
  const lines = handbookSource.split('\n');
  const headingLine = lines.findIndex((l) => RUNTIME_HEADING.test(l));
  if (headingLine === -1)
    throw new Refusal(`${HANDBOOK_PATH}: no heading starting \`## Runtime State\``);
  const table = tableAfter(lines, headingLine);
  if (table === null || table.rows.length === 0) {
    throw new Refusal(`${HANDBOOK_PATH}: no table rows under \`## Runtime State\``);
  }
  const known = new Set([...contracts.tables.keys(), ...contracts.views]);
  const violations = [];
  for (const row of table.rows) {
    for (const name of namesIn(row.cells[0] ?? '')) {
      if (known.has(name)) continue;
      violations.push({
        where: `${HANDBOOK_PATH}:${row.line}`,
        category: 'handbook-unknown',
        detail: `\`${name}\` is neither a TABLE_CONTRACTS table nor a VIEW_CONTRACTS view`,
      });
    }
  }
  return violations;
}

/** Check (d): retired names as backticked identifiers, outside the allowlist. */
function checkRetired(docs, allowlist) {
  const violations = [];
  const used = new Set();
  for (const { file, text } of docs) {
    text.split('\n').forEach((line, i) => {
      for (const name of RETIRED_TABLE_NAMES) {
        if (!line.includes(`\`${name}\``)) continue;
        const excuse = allowlist.findIndex(
          (a) => a.file === file && a.name === name && line.includes(a.contains)
        );
        if (excuse !== -1) {
          used.add(excuse);
          continue;
        }
        violations.push({
          where: `${file}:${i + 1}`,
          category: 'retired-name',
          detail: `\`${name}\` is a retired table — name a live one, or allowlist the line with a reason if it is history`,
        });
      }
    });
  }
  allowlist.forEach((entry, i) => {
    if (used.has(i)) return;
    violations.push({
      where: entry.file,
      category: 'retired-name',
      detail: `stale allowlist entry (\`${entry.name}\`, "${entry.contains}") excuses nothing any more — delete it`,
    });
  });
  return violations;
}

/** Everything the script checks, from sources handed in — the self-test drives this directly. */
function validate({ contractsSource, mapSource, handbookSource, docs, allowlist }) {
  const contracts = parseContracts(contractsSource);
  return {
    contracts,
    violations: [
      ...checkMap(mapSource, contracts),
      ...checkHandbook(handbookSource, contracts),
      ...checkRetired(docs, allowlist),
    ],
  };
}

function readRepo(relative) {
  return fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');
}

function markdownUnder(relativeDir) {
  const out = [];
  const visit = (rel) => {
    for (const entry of fs.readdirSync(path.join(REPO_ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) visit(child);
      else if (entry.name.endsWith('.md')) out.push(child);
    }
  };
  visit(relativeDir);
  return out.sort();
}

function retiredDocs() {
  const files = [
    ...RETIRED_ROOT_FILES.filter((f) => fs.existsSync(path.join(REPO_ROOT, f))),
    ...markdownUnder(RETIRED_DOCS_DIR),
  ];
  return files.map((file) => ({ file, text: readRepo(file) }));
}

// --- self-test --------------------------------------------------------------------------------

const FIXTURE_TABLES = [
  ['alpha', 'derived', 'none'],
  ['bravo', 'derived', 'run-owner-pid'],
  ['charlie', 'ephemeral', 'workspace'],
  ['delta', 'durable', 'client-scope'],
  ['echo', 'durable', 'workspace'],
  ['foxtrot', 'ephemeral', 'run-owner-pid'],
  ['golf', 'derived', 'workspace'],
  ['hotel', 'ephemeral', 'workspace'],
  ['india', 'durable', 'workspace'],
];
const FIXTURE_VIEWS = ['v_one', 'v_two'];

function fixture() {
  const contractsSource = [
    'export const TABLE_CONTRACTS: readonly TableContract[] = [',
    "  // `tenants` was deleted; table: 'ghost' in a comment is not an entry.",
    ...FIXTURE_TABLES.flatMap(([table, posture, scope], i) => [
      '  {',
      `    table: '${table}',`,
      "    owner: 'src/x.ts',",
      ...(i === 0 ? ["    // posture: 'durable' — a comment, not the property"] : []),
      `    posture: '${posture}',`,
      ...(i === 1 ? ["    rebuiltFrom: 'elsewhere',"] : []),
      `    scope: '${scope}',`,
      "    retention: 'unbounded-justified',",
      '    acceptedForeignWriters: [',
      "      { subject: 'src/y.ts', reason: 'r', closedBy: 'c' },",
      '    ],',
      '  },',
    ]),
    '];',
    '',
    'export const VIEW_CONTRACTS: readonly ViewContract[] = [',
    ...FIXTURE_VIEWS.flatMap((view) => [
      '  {',
      `    view: '${view}',`,
      "    sourceTable: 'alpha',",
      '  },',
    ]),
    '];',
  ].join('\n');
  const mapSource = [
    '# SQLite Persistence',
    '',
    `## The Map (${FIXTURE_TABLES.length} declared tables + ${FIXTURE_VIEWS.length} views)`,
    '',
    'History: `tenants` was deleted at v19.',
    '',
    '| Table | Owner | Posture | Scope |',
    '| ----- | ----- | ------- | ----- |',
    ...FIXTURE_TABLES.map(([table, posture, scope], i) => {
      const p = posture === 'durable' ? `**${posture}**` : posture;
      const s = i === 5 ? `${scope}\\*` : scope;
      return `| \`${table}\` | \`x.ts\` | ${p} | ${s} |`;
    }),
    '',
    '## Next',
  ].join('\n');
  const handbookSource = [
    '## Runtime State (SQLite -- never commit `state.db`)',
    '',
    '| Table | Purpose |',
    '| ----- | ------- |',
    "| `charlie` | key-value (`key='x'`) |",
    '| `v_one` | a view |',
    '',
    'Prose naming `whatever` after the table is not read.',
  ].join('\n');
  const docs = [
    { file: 'docs/map.md', text: mapSource },
    { file: 'docs/prose.md', text: 'Multiple tenants share one file; plain words do not trip.' },
  ];
  const allowlist = [
    { file: 'docs/map.md', name: 'tenants', contains: 'was deleted at v19', reason: 'x' },
  ];
  return { contractsSource, mapSource, handbookSource, docs, allowlist };
}

function runSelfTest() {
  const outcome = (input) => {
    try {
      return { ...validate(input), refused: null };
    } catch (error) {
      if (error instanceof Refusal) return { violations: [], refused: error.message };
      throw error;
    }
  };
  const has = (r, category, pattern) =>
    assert.ok(
      r.violations.some((v) => v.category === category && pattern.test(v.detail)),
      `expected a ${category} violation matching ${pattern}; got ${JSON.stringify(r.violations)}${r.refused ? ` / refused: ${r.refused}` : ''}`
    );
  const edit = (key, from, to) => {
    const f = fixture();
    assert.ok(f[key].includes(from), `fixture edit anchor missing: ${from}`);
    return { ...f, [key]: f[key].replace(from, to) };
  };
  const cases = [
    {
      label: 'consistent fixture passes (negative control; bold, footnote and comments tolerated)',
      input: fixture(),
      expect: (r) => {
        assert.strictEqual(r.refused, null);
        assert.deepStrictEqual(r.violations, []);
        assert.strictEqual(r.contracts.tables.size, FIXTURE_TABLES.length);
        assert.strictEqual(r.contracts.tables.get('alpha').posture, 'derived');
      },
    },
    {
      label: 'a Map row deleted fails, naming the missing table',
      input: edit('mapSource', '| `golf` | `x.ts` | derived | workspace |\n', ''),
      expect: (r) => has(r, 'map-missing', /`golf` is declared/),
    },
    {
      label: 'a Map row with no contract fails, naming the extra table',
      input: edit('mapSource', '\n\n## Next', '\n| `zulu` | `x.ts` | derived | none |\n\n## Next'),
      expect: (r) => has(r, 'map-extra', /`zulu` is in the Map/),
    },
    {
      label: 'a posture flip fails',
      input: edit(
        'mapSource',
        '| `charlie` | `x.ts` | ephemeral |',
        '| `charlie` | `x.ts` | **durable** |'
      ),
      expect: (r) => has(r, 'map-posture', /`charlie` posture is "durable"/),
    },
    {
      label: 'a scope flip fails',
      input: edit(
        'mapSource',
        '| `hotel` | `x.ts` | ephemeral | workspace |',
        '| `hotel` | `x.ts` | ephemeral | none |'
      ),
      expect: (r) => has(r, 'map-scope', /`hotel` scope is "none"/),
    },
    {
      label: 'a wrong table count in the heading fails',
      input: edit('mapSource', '(9 declared tables', '(10 declared tables'),
      expect: (r) => has(r, 'map-count', /says 10 declared tables; TABLE_CONTRACTS declares 9/),
    },
    {
      label: 'a wrong view count in the heading fails',
      input: edit('mapSource', '+ 2 views)', '+ 3 views)'),
      expect: (r) => has(r, 'map-count', /says 3 views; VIEW_CONTRACTS declares 2/),
    },
    {
      label: 'an unknown name in the CLAUDE.md Runtime State table fails',
      input: edit(
        'handbookSource',
        '| `v_one` | a view |',
        '| `v_one` | a view |\n| `framework_state` | gone |'
      ),
      expect: (r) => has(r, 'handbook-unknown', /`framework_state` is neither/),
    },
    {
      label: 'a retired name outside the allowlist fails, naming file:line',
      input: (() => {
        const f = fixture();
        return {
          ...f,
          docs: [
            ...f.docs,
            { file: 'docs/overview.md', text: 'x\nState lives in `gate_system_state`.' },
          ],
        };
      })(),
      expect: (r) =>
        assert.ok(
          r.violations.some(
            (v) => v.category === 'retired-name' && v.where === 'docs/overview.md:2'
          )
        ),
    },
    {
      label: 'a stale allowlist entry fails',
      input: (() => {
        const f = fixture();
        return {
          ...f,
          allowlist: [
            ...f.allowlist,
            { file: 'docs/map.md', name: 'tenants', contains: 'gone', reason: 'x' },
          ],
        };
      })(),
      expect: (r) => has(r, 'retired-name', /stale allowlist entry/),
    },
    {
      label: 'parser collapse (3 contract tables) is refused, not passed',
      input: (() => {
        const f = fixture();
        const kept = f.contractsSource.split('\n  {\n').slice(0, 4).join('\n  {\n');
        const views = f.contractsSource.slice(f.contractsSource.indexOf('\n];'));
        return { ...f, contractsSource: kept + views };
      })(),
      expect: (r) => assert.match(r.refused ?? '', /TABLE_CONTRACTS yielded 3 table\(s\)/),
    },
    {
      label: 'a contract entry with a multi-line posture is refused, not misread',
      input: edit(
        'contractsSource',
        "    posture: 'durable',\n    scope: 'client-scope',",
        "    posture:\n      'durable',\n    scope: 'client-scope',"
      ),
      expect: (r) => assert.match(r.refused ?? '', /entry 4 \(`delta`\)/),
    },
    {
      label: 'a missing Map heading is refused',
      input: edit('mapSource', '## The Map (9', '## Table Map (9'),
      expect: (r) => assert.match(r.refused ?? '', /no `## The Map` heading/),
    },
    {
      label: 'a Map heading in another shape is refused',
      input: edit('mapSource', '(9 declared tables + 2 views)', '(nine tables)'),
      expect: (r) => assert.match(r.refused ?? '', /is not `## The Map \(N declared tables/),
    },
    {
      label: 'a Map table with fewer than 8 rows is refused',
      input: (() => {
        const f = fixture();
        const lines = f.mapSource.split('\n').filter((l) => !/^\| `(alpha|bravo|charlie)`/.test(l));
        return { ...f, mapSource: lines.join('\n') };
      })(),
      expect: (r) => assert.match(r.refused ?? '', /the Map table yielded 6 row\(s\)/),
    },
    {
      label: 'a missing Runtime State table is refused',
      input: { ...fixture(), handbookSource: '## Runtime State\n\nprose only\n' },
      expect: (r) => assert.match(r.refused ?? '', /no table rows under `## Runtime State`/),
    },
  ];

  let failures = 0;
  console.log('\nvalidate:table-map-docs self-test\n');
  for (const testCase of cases) {
    try {
      testCase.expect(outcome(testCase.input));
      console.log(`  PASS  ${testCase.label}`);
    } catch (error) {
      failures++;
      console.log(`  FAIL  ${testCase.label} — ${error.message.split('\n')[0]}`);
    }
  }
  const passed = cases.length - failures;
  console.log(`\n${passed}/${cases.length} cases passed\n`);
  process.exit(failures === 0 ? 0 : 1);
}

// --- main -------------------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== '--self-test');
  if (unknown.length > 0) {
    process.stderr.write(`Unknown argument(s): ${unknown.join(' ')}. Usage: [--self-test]\n`);
    process.exit(2);
  }
  if (args.includes('--self-test')) {
    runSelfTest();
    return;
  }

  let result;
  try {
    result = validate({
      contractsSource: readRepo(CONTRACTS_PATH),
      mapSource: readRepo(MAP_PATH),
      handbookSource: readRepo(HANDBOOK_PATH),
      docs: retiredDocs(),
      allowlist: RETIRED_NAME_ALLOWLIST,
    });
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    process.stderr.write(`[validate-table-map-docs] REFUSED: ${error.message}\n`);
    process.exit(1);
  }

  const { contracts, violations } = result;
  if (violations.length === 0) {
    process.stdout.write(
      `[validate-table-map-docs] OK: ${contracts.tables.size} tables and ` +
        `${contracts.views.length} views agree across table-contracts.ts, the Map in ` +
        `${MAP_PATH}, ${HANDBOOK_PATH} §Runtime State, and every retired-name mention\n`
    );
    process.exit(0);
  }
  for (const v of violations) process.stderr.write(`${v.where}: ${v.category}: ${v.detail}\n`);
  process.stderr.write(
    `\n${violations.length} violation(s). ${CONTRACTS_PATH} is the contract — move the doc to it.\n`
  );
  process.exit(1);
}

main();
