// @lifecycle canonical - Integration: a refused gate/framework file is repairable through the tool (P4.15)
/**
 * THE ROW'S FALSIFIER, at the join where the defect lives.
 *
 * > a schema-invalid gate and a schema-invalid framework are each repaired through
 * > `resource_manager`, and neither takes its id dark when a valid definition exists in another
 * > root.
 *
 * Integration rather than unit, because both halves live in the seam between two modules that each
 * typecheck perfectly on their own: the loader drops a file, and the tool resolves its target
 * through the catalog the loader built. A unit test of either side sees nothing — which is exactly
 * how the prompt-side twin of this defect survived until P4.9. So the loaders here are REAL
 * (`createGateManager`, `createFrameworkManager` over temp roots), and only `ConfigManager` is a
 * stub, because the one thing it contributes is which directory a write goes to.
 *
 * EVERY REFUSAL CLAIM HAS A POSITIVE CONTROL. "The broken one is quarantined" is satisfied just as
 * well by a server that quarantines everything, so each case also asserts that a valid sibling in
 * the SAME root is absent from the quarantine, still inspects normally, and still serves.
 */

import { describe, expect, it, beforeAll, afterAll, jest } from '@jest/globals';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SqliteEngine } from '../../../src/infra/database/index.js';
import {
  getDefaultRuntimeLoader,
  resetDefaultRuntimeLoader,
} from '../../../src/engine/frameworks/definitions/runtime-framework-loader.js';
import { createFrameworkManager } from '../../../src/engine/frameworks/framework-manager.js';
import { createGateManager } from '../../../src/engine/gates/gate-manager.js';
import { FrameworkToolHandler } from '../../../src/mcp/tools/framework-manager/core/manager.js';
import { GateToolHandler } from '../../../src/mcp/tools/gate-manager/core/manager.js';

import type { Logger } from '../../../src/infra/logging/index.js';
import type { ConfigManager } from '../../../src/shared/types/index.js';
import type { FrameworkManagerInput } from '../../../src/mcp/tools/framework-manager/core/types.js';
import type { GateManagerInput } from '../../../src/mcp/tools/gate-manager/core/types.js';

const silentLogger = (): Logger =>
  ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }) as unknown as Logger;

/**
 * The two things the stub decides: which root a write lands in, and whether versioning is on.
 *
 * Versioning is ON in both suites below, unlike the P4.15 original. P4.20's falsifier is a ROW
 * COUNT, so a stub that disabled versioning would have made every assertion about it vacuously
 * true — the repair would write nothing and `history` would legitimately report nothing.
 */
function stubConfig(overrides: Record<string, unknown>): ConfigManager {
  return {
    getVersioningConfig: () => ({ enabled: true, auto_version: true, max_versions: 10 }),
    getConfig: () => ({}),
    ...overrides,
  } as unknown as ConfigManager;
}

/** Row count for one resource's version history — the measurement P4.20's falsifier is about. */
function countVersionRows(db: SqliteEngine, resourceType: string, resourceId: string): number {
  const row = db.queryOne<{ cnt: number }>(
    `SELECT COUNT(*) as cnt FROM version_history WHERE resource_type = ? AND resource_id = ?`,
    [resourceType, resourceId]
  );
  return row?.cnt ?? 0;
}

function text(result: { content: Array<{ text?: string }> }): string {
  return result.content[0]?.text ?? '';
}

const SERVER_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

// ============================================================================
// Gates
// ============================================================================

const GATE_GUIDANCE_MARKER = 'GATE_BODY_THAT_NEVER_LOADED';

function gateYaml(id: string, opts: { valid: boolean }): string {
  return [
    `id: ${id}`,
    `name: ${id} gate`,
    `type: ${opts.valid ? 'validation' : 'not-a-gate-type'}`,
    `description: ${opts.valid ? 'a healthy gate' : GATE_GUIDANCE_MARKER}`,
    `guidance: ${GATE_GUIDANCE_MARKER}`,
    '',
  ].join('\n');
}

function writeGate(root: string, id: string, body: string): string {
  mkdirSync(join(root, id), { recursive: true });
  const path = join(root, id, 'gate.yaml');
  writeFileSync(path, body);
  return path;
}

describe('a gate file the loader refused is reachable and repairable (P4.15)', () => {
  let writable: string;
  let bundled: string;
  let dbRoot: string;
  let dbManager: SqliteEngine;
  let handler: GateToolHandler;
  let brokenPath: string;
  let errorSpy: ReturnType<typeof jest.spyOn>;

  const call = async (args: GateManagerInput): Promise<{ isError: boolean; body: string }> => {
    const result = await handler.handleAction(args, {});
    return { isError: result.isError === true, body: text(result) };
  };

  beforeAll(async () => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    writable = mkdtempSync(join(tmpdir(), 'gate-repair-writable-'));
    bundled = mkdtempSync(join(tmpdir(), 'gate-repair-bundled-'));
    dbRoot = mkdtempSync(join(tmpdir(), 'gate-repair-db-'));

    writeGate(writable, 'healthy-gate', gateYaml('healthy-gate', { valid: true }));
    brokenPath = writeGate(writable, 'broken-gate', gateYaml('broken-gate', { valid: false }));
    // Same id in both roots: broken in the nearer one, valid in the one that trails it. This is
    // the "does not take its id dark" half.
    writeGate(writable, 'shared-gate', gateYaml('shared-gate', { valid: false }));
    writeGate(bundled, 'shared-gate', gateYaml('shared-gate', { valid: true }));
    // The same shadow, with the id DECLARED in mixed case. `validateGateSchema` compares the
    // declared id to the directory name case-insensitively, so this file loads and the guide's
    // `gateId` is `Case-Gate` while its refusal record's id is the directory name `case-gate`.
    // Pairing the two therefore has to normalize, which is what the `list` surface now does.
    writeGate(writable, 'case-gate', gateYaml('Case-Gate', { valid: false }));
    writeGate(bundled, 'case-gate', gateYaml('Case-Gate', { valid: true }));
    // Broken in the writable root ONLY, and never repaired: the subject of the partial-repair
    // refusal below. `shared-gate` cannot serve that role — it IS in the registry, from the other
    // root, so an update on it is an ordinary update and not a repair at all.
    writeGate(writable, 'partial-gate', gateYaml('partial-gate', { valid: false }));

    const gateManager = await createGateManager(silentLogger(), {
      registryConfig: {
        loaderConfig: { gatesDir: writable, additionalGatesDirs: [bundled] },
      },
    });

    handler = new GateToolHandler({
      logger: silentLogger(),
      gateManager,
      configManager: stubConfig({
        getGatesDirectory: () => writable,
        getBundledResourceDirectory: () => bundled,
        getServerRoot: () => dbRoot,
      }),
    });

    // A REAL `version_history` table, because P4.20's claim is that a row lands in a durable table
    // nothing regenerates. A stub store would assert that the code called something.
    dbManager = await SqliteEngine.getInstance(dbRoot, silentLogger());
    await dbManager.initialize();
    handler.setDatabasePort(dbManager);
  }, 30_000);

  afterAll(async () => {
    await dbManager.shutdown();
    errorSpy.mockRestore();
    rmSync(writable, { recursive: true, force: true });
    rmSync(bundled, { recursive: true, force: true });
    rmSync(dbRoot, { recursive: true, force: true });
  });

  it('inspect names the file and the reason instead of "Gate not found"', async () => {
    const result = await call({ action: 'inspect', id: 'broken-gate' });

    expect(result.body).toContain('Quarantined');
    expect(result.body).toContain(brokenPath);
    expect(result.body).toContain('type');
    expect(result.body).not.toContain("Gate 'broken-gate' not found");
  });

  it('POSITIVE CONTROL — a valid gate in the same root inspects normally', async () => {
    const result = await call({ action: 'inspect', id: 'healthy-gate' });

    expect(result.isError).toBe(false);
    expect(result.body).toContain('healthy-gate gate');
    expect(result.body).not.toContain('Quarantined');
  });

  it('never returns the guidance of a file that failed validation', async () => {
    const inspected = await call({ action: 'inspect', id: 'broken-gate' });
    const listed = await call({ action: 'list', enabled_only: false });

    // The broken gate's own `guidance` and `description` carry the marker. A gate's guidance is
    // instruction delivered to the client LLM, and this is the file whose content was not checked.
    expect(inspected.body).not.toContain(GATE_GUIDANCE_MARKER);
    expect(listed.body.split('🚧')[1] ?? '').not.toContain(GATE_GUIDANCE_MARKER);
  });

  it('lists the refused files with id, path and error', async () => {
    const result = await call({ action: 'list', enabled_only: false });

    expect(result.body).toContain('Quarantined');
    expect(result.body).toContain(brokenPath);
    expect(result.body).toContain(join(writable, 'shared-gate', 'gate.yaml'));
  });

  it('FALSIFIER (P4.18) — the list quarantine section names the serving root by path', async () => {
    const result = await call({ action: 'list', enabled_only: false });

    // The serving root, by path. `toContain(bundled)` alone would pass on the refused file's own
    // path too, so the assertion carries the clause that says which root is ANSWERING.
    expect(result.body).toContain(`is currently served from ${bundled}`);
    // The unnamed-origin rendering this row removed. Kept as the assertion that fails if the
    // served summaries stop carrying `sourceRoot` — `formatQuarantineSection` falls back to this
    // string silently, so nothing else here would notice.
    expect(result.body).not.toContain('served from another root');

    // POSITIVE CONTROL — `broken-gate` is refused in the SAME root and nothing serves its id, so
    // it must carry no shadow line at all. A renderer that announced a shadow for every record
    // would satisfy the two assertions above for free.
    const brokenEntry = result.body.slice(result.body.indexOf(brokenPath));
    expect(brokenEntry.split('\n- ')[0]).not.toContain('currently served from');

    // …and the same claim for a gate whose file DECLARES a mixed-case id: served id `Case-Gate`,
    // record id `case-gate`. Unnormalized, this pair never matches and the shadow goes unannounced
    // — which is the defect the framework surface had for every framework.
    const caseEntry = result.body.slice(
      result.body.indexOf(join(writable, 'case-gate', 'gate.yaml'))
    );
    expect(caseEntry.split('\n- ')[0]).toContain(`is currently served from ${bundled}`);
  });

  it('FALSIFIER — a broken file does not take its id dark when another root defines it', async () => {
    const result = await call({ action: 'inspect', id: 'shared-gate' });

    // Still served, from the root that trails the broken one…
    expect(result.isError).toBe(false);
    expect(result.body).toContain('shared-gate gate');
    // …and the shadow is ANNOUNCED rather than silently substituted (owner ruling 2026-09-09).
    expect(result.body).toContain('A nearer file for this id failed to load');
    expect(result.body).toContain(join(writable, 'shared-gate', 'gate.yaml'));
    // …naming the root that is answering, not just "another root" (P4.18). `bundled` is a
    // different temp directory from `writable`, so this fails if the note names the refused
    // file's root instead of the serving one.
    expect(result.body).toContain(`served from ${bundled}`);
    expect(result.body).not.toContain('served from another root');
  });

  it('FALSIFIER — update repairs the refused file in place and says it now loads', async () => {
    const result = await call({
      action: 'update',
      id: 'broken-gate',
      name: 'Repaired Gate',
      description: 'repaired through the tool',
      guidance: 'Repaired guidance body',
    });

    expect(result.isError).toBe(false);
    expect(result.body).toContain('Repaired');
    expect(result.body).toContain(brokenPath);

    // P4.20 — the response says what was recorded. The old wording said the opposite in so many
    // words, and a version line is the one place an operator checks before trusting `rollback`.
    expect(result.body).toContain('**Version 1** recorded');
    expect(result.body).not.toContain('No version was recorded');

    // The write landed on the file that was broken, not beside it.
    const onDisk = readFileSync(brokenPath, 'utf8');
    expect(onDisk).toContain('repaired through the tool');
    expect(onDisk).not.toContain('not-a-gate-type');
  });

  it('POSITIVE CONTROL — the repaired gate is now served, and inspects as an ordinary gate', async () => {
    const result = await call({ action: 'inspect', id: 'broken-gate' });

    expect(result.isError).toBe(false);
    expect(result.body).toContain('Repaired Gate');
    expect(result.body).not.toContain('Quarantined');
  });

  it('drops the repaired record and keeps the one that is still broken', async () => {
    const result = await call({ action: 'list', enabled_only: false });

    expect(result.body).not.toContain(brokenPath);
    expect(result.body).toContain(join(writable, 'shared-gate', 'gate.yaml'));
  });

  it('still refuses an id nothing on disk claims, so repair did not become a create', async () => {
    const result = await call({ action: 'update', id: 'no-such-gate', name: 'x' });

    expect(result.isError).toBe(true);
    expect(result.body).toContain('not found');
    expect(result.body).toContain('create');
  });

  it('refuses a repair that does not supply the whole gate, and names what is missing', async () => {
    const result = await call({ action: 'update', id: 'partial-gate', name: 'Partial' });

    expect(result.isError).toBe(true);
    expect(result.body).toContain('quarantined');
    expect(result.body).toContain('description');
    expect(result.body).toContain('guidance');
  });

  // ==========================================================================
  // P4.19 — `create` is no longer the silent overwrite path
  // ==========================================================================

  it('FALSIFIER — create on a quarantined id is refused, naming the refused file and `update`', async () => {
    const partialPath = join(writable, 'partial-gate', 'gate.yaml');
    const before = readFileSync(partialPath, 'utf8');

    const result = await call({
      action: 'create',
      id: 'partial-gate',
      name: 'Overwriting Create',
      description: 'this create must not land',
      guidance: 'this guidance must not land',
    });

    expect(result.isError).toBe(true);
    expect(result.body).toContain(partialPath);
    expect(result.body).toContain('update');

    // The refusal is a refusal, not a warning attached to a write that happened anyway.
    expect(readFileSync(partialPath, 'utf8')).toBe(before);
    expect(readFileSync(partialPath, 'utf8')).not.toContain('this create must not land');
  });

  it('POSITIVE CONTROL — create on a genuinely unused id still succeeds', async () => {
    const result = await call({
      action: 'create',
      id: 'fresh-gate',
      name: 'Fresh Gate',
      description: 'a gate nothing on disk claimed',
      guidance: 'fresh guidance body',
    });

    expect(result.isError).toBe(false);
    expect(result.body).toContain('created successfully');
    expect(readFileSync(join(writable, 'fresh-gate', 'gate.yaml'), 'utf8')).toContain(
      'a gate nothing on disk claimed'
    );
  });

  it('POSITIVE CONTROL — create on a REGISTERED id still refuses with its own message', async () => {
    const result = await call({
      action: 'create',
      id: 'healthy-gate',
      name: 'Clobber',
      description: 'should not land either',
      guidance: 'should not land either',
    });

    expect(result.isError).toBe(true);
    // The registry branch, not the quarantine branch: a registered gate is never redirected by a
    // quarantined namesake, and its refusal is the pre-existing one word for word.
    expect(result.body).toContain('already exists. Use update action to modify.');
    expect(result.body).not.toContain('failed to load');
  });

  // ==========================================================================
  // P4.20 — a repair writes version 1
  // ==========================================================================

  it('FALSIFIER — history on the just-repaired gate returns exactly one row', async () => {
    expect(countVersionRows(dbManager, 'gate', 'broken-gate')).toBe(1);

    const result = await call({ action: 'history', id: 'broken-gate' });

    expect(result.isError).toBe(false);
    expect(result.body).toContain('(1 versions)');
    expect(result.body).toContain('| 1 (latest) |');
    expect(result.body).toContain('Repair of quarantined gate via resource_manager');
  });

  it('POSITIVE CONTROL — the row count discriminates: a gate nobody repaired has none', async () => {
    // Without this, `toBe(1)` above is satisfied by a query that returns 1 for everything, and by
    // a suite whose temp database happens to hold one stray row.
    expect(countVersionRows(dbManager, 'gate', 'healthy-gate')).toBe(0);
    expect(countVersionRows(dbManager, 'gate', 'fresh-gate')).toBe(0);

    const result = await call({ action: 'history', id: 'healthy-gate' });
    expect(result.body).toContain('No version history');
  });

  it('records the repaired state, so the version is restorable rather than a marker', async () => {
    const row = dbManager.queryOne<{ snapshot: string }>(
      `SELECT snapshot FROM version_history WHERE resource_type = ? AND resource_id = ? AND version = ?`,
      ['gate', 'broken-gate', 1]
    );
    const snapshot = JSON.parse(row!.snapshot) as Record<string, unknown>;

    // The snapshot holds the content the repair PRODUCED — not the bytes that failed validation,
    // and not a blank stand-in for a prior state that never loaded. `recordEditResult`'s bridge
    // would have written one of those two as an extra row underneath this one.
    expect(snapshot['description']).toBe('repaired through the tool');
    expect(snapshot['guidance']).toBe('Repaired guidance body');
    expect(snapshot['type']).not.toBe('not-a-gate-type');
  });
});

// ============================================================================
// Frameworks
// ============================================================================

const FRAMEWORK_GUIDANCE_MARKER = 'FRAMEWORK_BODY_THAT_NEVER_LOADED';

/** A SHIPPED framework id a workspace file can shadow. Present in `server/resources/frameworks`. */
const SHADOWED_ID = 'cageerf';

function frameworkYaml(id: string, opts: { valid: boolean }): string {
  return [
    `id: ${id}`,
    `name: ${id} framework`,
    `type: ${id.toUpperCase()}`,
    `version: 1.0.0`,
    `enabled: ${opts.valid ? 'true' : '"definitely"'}`,
    `description: ${opts.valid ? 'a healthy framework' : FRAMEWORK_GUIDANCE_MARKER}`,
    `systemPromptGuidance: ${FRAMEWORK_GUIDANCE_MARKER}`,
    '',
  ].join('\n');
}

function writeFramework(root: string, id: string, body: string): string {
  mkdirSync(join(root, id), { recursive: true });
  const path = join(root, id, 'framework.yaml');
  writeFileSync(path, body);
  return path;
}

describe('a framework file the loader refused is reachable and repairable (P4.15)', () => {
  let writable: string;
  let bundled: string;
  let dbRoot: string;
  let dbManager: SqliteEngine;
  let handler: FrameworkToolHandler;
  let brokenPath: string;
  let errorSpy: ReturnType<typeof jest.spyOn>;
  let warnSpy: ReturnType<typeof jest.spyOn>;

  const call = async (args: FrameworkManagerInput): Promise<{ isError: boolean; body: string }> => {
    const result = await handler.handleAction(args, {});
    return { isError: result.isError === true, body: text(result) };
  };

  beforeAll(async () => {
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    writable = mkdtempSync(join(tmpdir(), 'fw-repair-writable-'));
    // The REAL bundled tree, read-only for this test: `FrameworkRegistry.loadBuiltInGuides` throws
    // `FATAL: Framework '<id>' not found` unless every shipped id resolves, so a synthetic bundled
    // root cannot stand in for it. That constraint is also what makes the shadow case below the
    // real-world one — a broken personal copy of a SHIPPED framework.
    bundled = join(SERVER_ROOT, 'resources', 'frameworks');

    writeFramework(writable, 'healthyfw', frameworkYaml('healthyfw', { valid: true }));
    brokenPath = writeFramework(writable, 'brokenfw', frameworkYaml('brokenfw', { valid: false }));
    writeFramework(writable, 'partialfw', frameworkYaml('partialfw', { valid: false }));
    writeFramework(writable, SHADOWED_ID, frameworkYaml(SHADOWED_ID, { valid: false }));

    // `FrameworkManager` builds its registry with no loader config, so the registry falls through
    // to the process-default runtime loader — which is exactly how `module-initializer` points it
    // at the resolved roots. Seeding it here is that same call, not a test-only hook.
    getDefaultRuntimeLoader({
      frameworksDir: writable,
      additionalFrameworksDirs: [bundled],
    });

    const frameworkManager = await createFrameworkManager(silentLogger());

    handler = new FrameworkToolHandler({
      logger: silentLogger(),
      frameworkManager,
      configManager: stubConfig({
        getFrameworksDirectory: () => writable,
        getBundledResourceDirectory: () => bundled,
        getServerRoot: () => writable,
      }),
    });

    // A REAL `version_history` table — see the gate suite's twin for why a stub will not do.
    dbRoot = mkdtempSync(join(tmpdir(), 'fw-repair-db-'));
    dbManager = await SqliteEngine.getInstance(dbRoot, silentLogger());
    await dbManager.initialize();
    handler.setDatabasePort(dbManager);
  }, 30_000);

  afterAll(async () => {
    await dbManager.shutdown();
    resetDefaultRuntimeLoader();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    // Only the temp roots are removed. `bundled` is the repository's own resources tree.
    rmSync(writable, { recursive: true, force: true });
    rmSync(dbRoot, { recursive: true, force: true });
  });

  it('inspect names the file and the reason instead of "Framework not found"', async () => {
    const result = await call({ action: 'inspect', id: 'brokenfw' });

    expect(result.body).toContain('Quarantined');
    expect(result.body).toContain(brokenPath);
    expect(result.body).toContain('enabled');
    expect(result.body).not.toContain("Framework 'brokenfw' not found");
  });

  it('POSITIVE CONTROL — a valid framework in the same root inspects normally', async () => {
    const result = await call({ action: 'inspect', id: 'healthyfw' });

    expect(result.isError).toBe(false);
    expect(result.body).toContain('healthyfw framework');
    expect(result.body).not.toContain('Quarantined');
  });

  it('never returns the guidance of a file that failed validation', async () => {
    const inspected = await call({ action: 'inspect', id: 'brokenfw' });

    expect(inspected.body).not.toContain(FRAMEWORK_GUIDANCE_MARKER);
  });

  it('FALSIFIER — a broken file does not take its id dark when another root defines it', async () => {
    const result = await call({ action: 'inspect', id: SHADOWED_ID });

    // The shipped definition still answers — a typo in a personal copy does not cost the framework.
    expect(result.isError).toBe(false);
    expect(result.body).not.toContain(FRAMEWORK_GUIDANCE_MARKER);
    // …and the shadow is ANNOUNCED rather than silently substituted (owner ruling 2026-09-09).
    expect(result.body).toContain('A nearer file for this id failed to load');
    expect(result.body).toContain(join(writable, SHADOWED_ID, 'framework.yaml'));
    // …naming the root that is answering, which for a shadowed SHIPPED framework is the bundled
    // tree (P4.18). Distinct from `writable`, so this fails if the note names the refused root.
    expect(result.body).toContain(`served from ${bundled}`);
    expect(result.body).not.toContain('served from another root');
  });

  it('lists the refused files with id, path and error', async () => {
    const result = await call({ action: 'list', enabled_only: false });

    expect(result.body).toContain('Quarantined');
    expect(result.body).toContain(brokenPath);
  });

  it('FALSIFIER (P4.18) — the list quarantine section names the serving root by path', async () => {
    const result = await call({ action: 'list', enabled_only: false });

    // Before P4.18 this surface announced NO shadow for a framework at all: served ids are
    // upper-cased by `generateSingleFrameworkDefinition` while a quarantine record's id is the
    // lower-cased directory name, so `summarizeQuarantine` never paired them.
    expect(result.body).toContain(`is currently served from ${bundled}`);
    expect(result.body).not.toContain('served from another root');

    // POSITIVE CONTROL — `brokenfw` is refused and nothing serves its id, so it carries no shadow
    // line. A renderer that announced one for every record would pass the two lines above anyway.
    const brokenEntry = result.body.slice(result.body.indexOf(brokenPath));
    expect(brokenEntry.split('\n- ')[0]).not.toContain('currently served from');
  });

  it('FALSIFIER — update repairs the refused file in place and says it now loads', async () => {
    const result = await call({
      action: 'update',
      id: 'brokenfw',
      name: 'Repaired Framework',
      description: 'repaired through the tool',
      system_prompt_guidance: 'Repaired guidance body',
    });

    expect(result.isError).toBe(false);
    expect(result.body).toContain('Repaired');
    expect(result.body).toContain(brokenPath);

    // P4.20 — the response says what was recorded, where it used to say the opposite.
    expect(result.body).toContain('**Version 1** recorded');
    expect(result.body).not.toContain('No version was recorded');

    const onDisk = readFileSync(brokenPath, 'utf8');
    expect(onDisk).toContain('repaired through the tool');
    expect(onDisk).not.toContain('definitely');
  });

  it('POSITIVE CONTROL — the repaired framework is now served, and inspects as an ordinary one', async () => {
    const result = await call({ action: 'inspect', id: 'brokenfw' });

    expect(result.isError).toBe(false);
    expect(result.body).toContain('Repaired Framework');
    expect(result.body).not.toContain('Quarantined');
  });

  it('still refuses an id nothing on disk claims, so repair did not become a create', async () => {
    const result = await call({ action: 'update', id: 'nosuchfw', name: 'x' });

    expect(result.isError).toBe(true);
    expect(result.body).toContain('not found');
    expect(result.body).toContain('create');
  });

  it('refuses a repair that does not supply the whole framework, and names what is missing', async () => {
    const result = await call({ action: 'update', id: 'partialfw', description: 'partial' });

    expect(result.isError).toBe(true);
    expect(result.body).toContain('quarantined');
    expect(result.body).toContain('Missing: name');
  });

  // ==========================================================================
  // P4.19 — the framework premise, pinned rather than assumed
  // ==========================================================================

  it('PREMISE — create on a quarantined framework already refuses, via the directory check', async () => {
    // P4.19 changed the GATE path only, on the stated premise that `checkFrameworkExists`
    // consults the filesystem rather than the registry and therefore already refuses here. A
    // premise nothing asserts is the kind that quietly stops holding.
    const partialPath = join(writable, 'partialfw', 'framework.yaml');
    const before = readFileSync(partialPath, 'utf8');

    const result = await call({ action: 'create', id: 'partialfw', name: 'Overwriting Create' });

    expect(result.isError).toBe(true);
    expect(result.body).toContain('already exists');
    expect(result.body).toContain('filesystem');
    expect(readFileSync(partialPath, 'utf8')).toBe(before);
  });

  // ==========================================================================
  // P4.20 — a repair writes version 1
  // ==========================================================================

  it('FALSIFIER — history on the just-repaired framework returns exactly one row', async () => {
    expect(countVersionRows(dbManager, 'framework', 'brokenfw')).toBe(1);

    const result = await call({ action: 'history', id: 'brokenfw' });

    expect(result.isError).toBe(false);
    expect(result.body).toContain('(1 versions)');
    expect(result.body).toContain('| 1 (latest) |');
    expect(result.body).toContain('Repair of quarantined framework via resource_manager');
  });

  it('POSITIVE CONTROL — the row count discriminates: a framework nobody repaired has none', async () => {
    expect(countVersionRows(dbManager, 'framework', 'healthyfw')).toBe(0);
  });

  it('records the repaired state, so the version is restorable rather than a marker', async () => {
    const row = dbManager.queryOne<{ snapshot: string }>(
      `SELECT snapshot FROM version_history WHERE resource_type = ? AND resource_id = ? AND version = ?`,
      ['framework', 'brokenfw', 1]
    );
    const snapshot = JSON.parse(row!.snapshot) as Record<string, unknown>;

    expect(snapshot['description']).toBe('repaired through the tool');
    expect(snapshot['systemPromptGuidance'] ?? snapshot['system_prompt_guidance']).toBe(
      'Repaired guidance body'
    );
  });
});
