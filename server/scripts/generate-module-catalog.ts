#!/usr/bin/env tsx

import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  runDependencyCruiser,
  type DependencyCruiserGraph,
} from './lib/dependency-cruiser-graph.js';
import {
  TABLE_CONTRACTS,
  VIEW_CONTRACTS,
  type Retention,
  type TableContract,
  type ViewContract,
} from '../src/infra/database/table-contracts.js';
import { collectOwnershipRecords, resolveOwnershipDefinitions } from './lib/domain-ownership.js';
import {
  loadSemanticModuleTree,
  nearestSemanticDescriptor,
  type SemanticModuleDescriptor,
} from './lib/semantic-module-descriptors.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = path.resolve(SERVER_ROOT, '..');
const SOURCE_ROOT = path.join(SERVER_ROOT, 'src');
const OUTPUT_PATH = path.join(REPO_ROOT, 'docs', 'reference', 'module-catalog.md');

export interface BoundaryEdge {
  readonly from: string;
  readonly to: string;
  readonly typeOnly: boolean;
}

/** One `owns` declaration, resolved to the file that actually exports the symbol. */
export interface OwnershipCatalogRow {
  readonly capability: string;
  readonly symbol: string;
  readonly moduleId: string;
  /** Definition path relative to `server/src`, or `—` when no single file exports the symbol. */
  readonly definedIn: string;
}

/** One `state.db` table or view, as `table-contracts.ts` declares it. */
export interface RuntimeStateRow {
  readonly name: string;
  readonly kind: 'table' | 'view';
  /** Nearest semantic module to the owner path; a view takes its source table's owner. `—` when none resolves. */
  readonly ownerModuleId: string;
  /** `—` for a view: it holds no rows of its own. */
  readonly posture: string;
  readonly scope: string;
  readonly retention: string;
  /** The table a view projects; `—` for a table. */
  readonly projects: string;
}

export interface ModuleCatalogModel {
  readonly descriptors: readonly SemanticModuleDescriptor[];
  readonly edges: readonly BoundaryEdge[];
  readonly ownership: readonly OwnershipCatalogRow[];
  readonly state: readonly RuntimeStateRow[];
}

function sourceModulePath(modulePath: string): boolean {
  return modulePath === 'src' || modulePath.startsWith('src/');
}

export function aggregateBoundaryEdges(
  graph: DependencyCruiserGraph,
  descriptors: readonly SemanticModuleDescriptor[],
  serverRoot: string
): BoundaryEdge[] {
  const aggregated = new Map<string, BoundaryEdge>();
  for (const module of graph.modules) {
    if (!sourceModulePath(module.source)) continue;
    const from = nearestSemanticDescriptor(module.source, descriptors, serverRoot);
    if (from === null) continue;
    for (const dependency of module.dependencies) {
      if (!sourceModulePath(dependency.resolved)) continue;
      const to = nearestSemanticDescriptor(dependency.resolved, descriptors, serverRoot);
      if (to === null || from.id === to.id) continue;
      const key = `${from.id}\u0000${to.id}`;
      const typeOnly = dependency.dependencyTypes.includes('type-only');
      const previous = aggregated.get(key);
      aggregated.set(key, {
        from: from.id,
        to: to.id,
        typeOnly: (previous?.typeOnly ?? true) && typeOnly,
      });
    }
  }
  return [...aggregated.values()].sort(
    (left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to)
  );
}

/**
 * The declarations `validate:domain-ownership` checks, resolved to where each symbol lives.
 *
 * Sorted by module then capability so the section is stable regardless of descriptor order.
 */
export function collectOwnershipRows(
  descriptors: readonly SemanticModuleDescriptor[],
  repoRoot: string,
  sourceRoot: string
): OwnershipCatalogRow[] {
  const records = collectOwnershipRecords(descriptors, repoRoot);
  const definitions = resolveOwnershipDefinitions(
    sourceRoot,
    records.map((record) => record.symbol)
  );
  return records
    .map((record) => {
      const paths = definitions.get(record.symbol) ?? [];
      return {
        capability: record.capability,
        symbol: record.symbol,
        moduleId: record.moduleId,
        definedIn: paths.length === 1 ? (paths[0] as string) : '—',
      };
    })
    .sort(
      (left, right) =>
        left.moduleId.localeCompare(right.moduleId) ||
        left.capability.localeCompare(right.capability)
    );
}

function firstSentence(text: string): string {
  const match = /^(.*?\.)(?:\s|$)/su.exec(text.trim());
  return match?.[1] ?? text.trim();
}

/** Every `Retention` variant, rendered deterministically as short text. */
export function renderRetention(retention: Retention, rationale?: string): string {
  if (retention === 'unbounded-justified') {
    return rationale === undefined
      ? 'unbounded (justified)'
      : `unbounded (justified: ${firstSentence(rationale)})`;
  }
  if ('maxRows' in retention) return `maxRows: ${retention.maxRows}`;
  if ('maxRowsPerResource' in retention) {
    return `maxRowsPerResource: ${retention.maxRowsPerResource}`;
  }
  return `maxAgeDays: ${retention.maxAgeDays}`;
}

/**
 * The declarations `validate:table-contracts` checks, one row per table then per view, in
 * declaration order — that order is the durable-restore order, so it is kept rather than sorted.
 */
export function collectRuntimeStateRows(
  tables: readonly TableContract[],
  views: readonly ViewContract[],
  descriptors: readonly SemanticModuleDescriptor[],
  serverRoot: string
): RuntimeStateRow[] {
  const ownerModuleId = (owner: string | undefined): string =>
    owner === undefined
      ? '—'
      : (nearestSemanticDescriptor(owner, descriptors, serverRoot)?.id ?? '—');
  const ownerByTable = new Map(tables.map((contract) => [contract.table, contract.owner]));
  return [
    ...tables.map((contract) => ({
      name: contract.table,
      kind: 'table' as const,
      ownerModuleId: ownerModuleId(contract.owner),
      posture: contract.posture,
      scope: contract.scope,
      retention: renderRetention(contract.retention, contract.retentionRationale),
      projects: '—',
    })),
    ...views.map((contract) => ({
      name: contract.view,
      kind: 'view' as const,
      ownerModuleId: ownerModuleId(ownerByTable.get(contract.sourceTable)),
      posture: '—',
      scope: '—',
      retention: '—',
      projects: contract.sourceTable,
    })),
  ];
}

function escapeTableCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function mermaidId(id: string): string {
  return `module_${id.replaceAll('-', '_')}`;
}

export function renderModuleCatalog(model: ModuleCatalogModel): string {
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const edge of model.edges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge.to]);
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge.from]);
  }

  const rows = model.descriptors.map((descriptor) => {
    const docs = (descriptor.docs ?? []).map((doc) => `\`${doc}\``).join('<br>') || '—';
    const publicEntry = descriptor.publicEntry ? `\`${descriptor.publicEntry}\`` : '—';
    const dependencies = [...new Set(outgoing.get(descriptor.id) ?? [])].sort().join('<br>') || '—';
    const importedBy = [...new Set(incoming.get(descriptor.id) ?? [])].sort().join('<br>') || '—';
    const sourcePath = descriptor.sourcePath === '.' ? 'src' : `src/${descriptor.sourcePath}`;
    return (
      `| \`${descriptor.id}\` | \`${sourcePath}\` | ${descriptor.kind} | ${descriptor.lifecycle} | ` +
      `${escapeTableCell(descriptor.description)} | ${docs} | ${publicEntry} | ${dependencies} | ${importedBy} |`
    );
  });

  const ownershipRows = model.ownership.map(
    (row) =>
      `| ${escapeTableCell(row.capability)} | \`${row.symbol}\` | \`${row.moduleId}\` | \`${row.definedIn}\` |`
  );

  const stateRows = model.state.map((row) => {
    const owner = row.ownerModuleId === '—' ? '—' : `\`${row.ownerModuleId}\``;
    const projects = row.projects === '—' ? '—' : `\`${row.projects}\``;
    return (
      `| \`${row.name}\` | ${row.kind} | ${owner} | ${row.posture} | ${row.scope} | ` +
      `${escapeTableCell(row.retention)} | ${projects} |`
    );
  });

  const nodes = model.descriptors.map(
    (descriptor) => `  ${mermaidId(descriptor.id)}["${descriptor.id}"]`
  );
  const edges = model.edges.map((edge) => {
    const arrow = edge.typeOnly ? '-. type .->' : '-->';
    return `  ${mermaidId(edge.from)} ${arrow} ${mermaidId(edge.to)}`;
  });

  return `<!-- Generated by server/scripts/generate-module-catalog.ts — do not edit manually. -->

# Semantic Module Catalog

This catalog combines authored boundary meaning from colocated \`module.yaml\` files with
observed imports from dependency-cruiser. It describes current dependencies; permission policy
remains in \`server/.dependency-cruiser.cjs\`.

## Boundaries

| Module | Source path | Kind | Lifecycle | Description | Docs | Public entry | Observed dependencies | Imported by |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows.join('\n')}

## Domain ownership

Generated from each module's \`module.yaml\` \`owns:\` block. \`validate:domain-ownership\` checks
these rows against the Domain Ownership Matrix in the root \`CLAUDE.md\` in both directions, so a
capability listed here and a row there cannot diverge. "Defined in" is relative to \`server/src\`.

| Capability | Owner | Module | Defined in |
| --- | --- | --- | --- |
${ownershipRows.join('\n')}

## Runtime state

Generated from \`server/src/infra/database/table-contracts.ts\`, which \`validate:table-contracts\`
checks against the schema DDL so no \`state.db\` table exists without a declared single owner,
posture, scope and retention; a view is owned by the owner of the table it projects. Posture says
whether rows survive a \`SCHEMA_VERSION\` recreate: \`durable\` rows exist nowhere else and are
carried across it, while \`derived\` rows are rebuilt from a source outside the database and
\`ephemeral\` rows are dropped because losing them is accepted.

| Name | Kind | Owner module | Posture | Scope | Retention | Projects |
| --- | --- | --- | --- | --- | --- | --- |
${stateRows.join('\n')}

## Observed boundary graph

Solid arrows include at least one value import. Dotted arrows contain only type imports.

\`\`\`mermaid
flowchart LR
${[...nodes, ...edges].join('\n')}
\`\`\`
`;
}

export function buildModuleCatalog(): ModuleCatalogModel {
  const tree = loadSemanticModuleTree({ repoRoot: REPO_ROOT, sourceRoot: SOURCE_ROOT });
  if (tree.problems.length > 0) {
    throw new Error(`semantic descriptors must validate before catalog generation`);
  }
  const graph = runDependencyCruiser({ cwd: SERVER_ROOT }).graph;
  return {
    descriptors: tree.descriptors,
    edges: aggregateBoundaryEdges(graph, tree.descriptors, SERVER_ROOT),
    ownership: collectOwnershipRows(tree.descriptors, REPO_ROOT, SOURCE_ROOT),
    state: collectRuntimeStateRows(TABLE_CONTRACTS, VIEW_CONTRACTS, tree.descriptors, SERVER_ROOT),
  };
}

export function writeModuleCatalog(): string {
  const rendered = renderModuleCatalog(buildModuleCatalog());
  writeFileSync(OUTPUT_PATH, rendered, 'utf8');
  return rendered;
}

function checkModuleCatalog(): void {
  const model = buildModuleCatalog();
  const expected = renderModuleCatalog(model);
  if (!existsSync(OUTPUT_PATH)) throw new Error('docs/reference/module-catalog.md is missing');
  const actual = readFileSync(OUTPUT_PATH, 'utf8');
  if (actual !== expected) {
    throw new Error('module catalog drifted; run npm run generate:module-catalog');
  }
  process.stdout.write(
    `generate:module-catalog --check OK — ${model.descriptors.length} boundaries, ` +
      `${model.state.length} state rows\n`
  );
}

function selfTest(): void {
  const root = path.resolve('/fixture/server');
  const descriptors: SemanticModuleDescriptor[] = [
    {
      schemaVersion: 1,
      id: 'fixture-root',
      kind: 'application',
      lifecycle: 'canonical',
      description: 'Fixture root.',
      children: 'semantic',
      absoluteDirectory: path.join(root, 'src'),
      descriptorPath: path.join(root, 'src', 'module.yaml'),
      sourcePath: '.',
    },
    {
      schemaVersion: 1,
      id: 'alpha',
      kind: 'domain',
      lifecycle: 'canonical',
      description: 'Alpha.',
      children: 'internal',
      owns: [{ capability: 'Alpha capability', symbol: 'AlphaService' }],
      absoluteDirectory: path.join(root, 'src', 'alpha'),
      descriptorPath: path.join(root, 'src', 'alpha', 'module.yaml'),
      sourcePath: 'alpha',
    },
    {
      schemaVersion: 1,
      id: 'beta',
      kind: 'domain',
      lifecycle: 'canonical',
      description: 'Beta.',
      children: 'internal',
      absoluteDirectory: path.join(root, 'src', 'beta'),
      descriptorPath: path.join(root, 'src', 'beta', 'module.yaml'),
      sourcePath: 'beta',
    },
  ];
  const graph: DependencyCruiserGraph = {
    modules: [
      {
        source: 'src/alpha/index.ts',
        dependencies: [
          { resolved: 'src/beta/types.ts', dependencyTypes: ['local', 'type-only', 'import'] },
          { resolved: 'src/beta/value.ts', dependencyTypes: ['local', 'import'] },
          { resolved: 'node:path', dependencyTypes: ['core', 'import'] },
        ],
      },
    ],
    summary: {
      violations: [],
      error: 0,
      warn: 0,
      info: 0,
      totalCruised: 2,
      totalDependenciesCruised: 3,
    },
  };
  const edges = aggregateBoundaryEdges(graph, descriptors, root);
  assert.deepEqual(edges, [{ from: 'alpha', to: 'beta', typeOnly: false }]);
  const ownership: OwnershipCatalogRow[] = [
    {
      capability: 'Alpha capability',
      symbol: 'AlphaService',
      moduleId: 'alpha',
      definedIn: 'alpha/alpha-service.ts',
    },
  ];
  const state = collectRuntimeStateRows(
    [
      {
        table: 'alpha_runs',
        owner: 'src/alpha/store.ts',
        posture: 'durable',
        scope: 'workspace',
        retention: 'unbounded-justified',
        retentionRationale: 'One row per alpha. Bounded by the alpha tree.',
        readers: [],
      },
    ],
    [{ view: 'v_alpha', sourceTable: 'alpha_runs', readers: [] }],
    descriptors,
    root
  );
  assert.equal(state.length, 2);
  assert.equal(renderRetention({ maxRows: 1 }), 'maxRows: 1');
  assert.equal(renderRetention({ maxRowsPerResource: 50 }), 'maxRowsPerResource: 50');
  assert.equal(renderRetention({ maxAgeDays: 7 }), 'maxAgeDays: 7');
  assert.equal(renderRetention('unbounded-justified'), 'unbounded (justified)');
  const rendered = renderModuleCatalog({ descriptors, edges, ownership, state });
  assert.match(rendered, /alpha --> module_beta/u);
  assert.doesNotMatch(rendered, /node:path/u);
  assert.match(rendered, /## Domain ownership/u);
  assert.match(
    rendered,
    /\| Alpha capability \| `AlphaService` \| `alpha` \| `alpha\/alpha-service\.ts` \|/u
  );
  assert.match(
    rendered,
    /\| `alpha_runs` \| table \| `alpha` \| durable \| workspace \| unbounded \(justified: One row per alpha\.\) \| — \|/u
  );
  assert.match(rendered, /\| `v_alpha` \| view \| `alpha` \| — \| — \| — \| `alpha_runs` \|/u);
  assert.ok(
    rendered.indexOf('## Domain ownership') < rendered.indexOf('## Runtime state') &&
      rendered.indexOf('## Runtime state') < rendered.indexOf('## Observed boundary graph')
  );
  assert.equal(rendered, renderModuleCatalog({ descriptors, edges, ownership, state }));
  process.stdout.write('generate:module-catalog self-test — 14/14 cases passed\n');
}

function main(): void {
  const args = new Set(process.argv.slice(2));
  const unknown = [...args].filter((arg) => !['--check', '--self-test'].includes(arg));
  if (unknown.length > 0) throw new Error(`Unknown option(s): ${unknown.join(', ')}`);
  if (args.has('--self-test')) {
    selfTest();
  } else if (args.has('--check')) {
    checkModuleCatalog();
  } else {
    const rendered = writeModuleCatalog();
    process.stdout.write(
      `generate:module-catalog wrote docs/reference/module-catalog.md (${Buffer.byteLength(rendered)} bytes)\n`
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `generate:module-catalog FAILED — ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
