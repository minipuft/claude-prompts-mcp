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

/** The one thing the stub decides: which root a write lands in. */
function stubConfig(overrides: Record<string, unknown>): ConfigManager {
  return {
    getVersioningConfig: () => ({ enabled: false, auto_version: false, max_versions: 10 }),
    getConfig: () => ({}),
    ...overrides,
  } as unknown as ConfigManager;
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

    writeGate(writable, 'healthy-gate', gateYaml('healthy-gate', { valid: true }));
    brokenPath = writeGate(writable, 'broken-gate', gateYaml('broken-gate', { valid: false }));
    // Same id in both roots: broken in the nearer one, valid in the one that trails it. This is
    // the "does not take its id dark" half.
    writeGate(writable, 'shared-gate', gateYaml('shared-gate', { valid: false }));
    writeGate(bundled, 'shared-gate', gateYaml('shared-gate', { valid: true }));
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
      }),
    });
  }, 30_000);

  afterAll(() => {
    errorSpy.mockRestore();
    rmSync(writable, { recursive: true, force: true });
    rmSync(bundled, { recursive: true, force: true });
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

  it('FALSIFIER — a broken file does not take its id dark when another root defines it', async () => {
    const result = await call({ action: 'inspect', id: 'shared-gate' });

    // Still served, from the root that trails the broken one…
    expect(result.isError).toBe(false);
    expect(result.body).toContain('shared-gate gate');
    // …and the shadow is ANNOUNCED rather than silently substituted (owner ruling 2026-09-09).
    expect(result.body).toContain('A nearer file for this id failed to load');
    expect(result.body).toContain(join(writable, 'shared-gate', 'gate.yaml'));
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
  }, 30_000);

  afterAll(() => {
    resetDefaultRuntimeLoader();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    // Only the temp root is removed. `bundled` is the repository's own resources tree.
    rmSync(writable, { recursive: true, force: true });
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
  });

  it('lists the refused files with id, path and error', async () => {
    const result = await call({ action: 'list', enabled_only: false });

    expect(result.body).toContain('Quarantined');
    expect(result.body).toContain(brokenPath);
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
});
