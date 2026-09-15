import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GateDefinitionLoader } from '../../../../src/engine/gates/core/gate-definition-loader.js';
import { GateDefinitionSchema } from '../../../../src/engine/gates/core/gate-schema.js';
import { GateToolHandler } from '../../../../src/mcp/tools/gate-manager/core/manager.js';
import { GenericGateGuide } from '../../../../src/engine/gates/registry/generic-gate-guide.js';
import {
  GATE_YAML_EXCLUDED_KEYS,
  GATE_YAML_PROJECTED_KEYS,
  GateFileWriter,
  PRESERVED_GATE_YAML_KEYS,
} from '../../../../src/mcp/tools/gate-manager/services/gate-file-writer.js';
import { gateSnapshotContract } from '../../../../src/mcp/tools/gate-manager/services/gate-snapshot-contract.js';
import { loadYamlFileSync } from '../../../../src/shared/utils/yaml/index.js';

import type { GateManager } from '../../../../src/engine/gates/gate-manager.js';
import type { GateGuide } from '../../../../src/engine/gates/types/index.js';
import type { GateManagerInput } from '../../../../src/mcp/tools/gate-manager/core/types.js';
import type { ConfigManager, Logger } from '../../../../src/shared/types/index.js';

/**
 * Fake GateGuide standing in for the registry's live gate object during
 * `update` tests. Mirrors what `gate-lifecycle-processor.ts` reads off
 * `existingGate` — `.gateId/.name/.type/.description`, `getGuidance()`, and
 * `getDefinition()` for the raw on-disk `activation`/`retry_config`/
 * `pass_criteria` used as the update-time fallback source.
 */
function createFakeGate(
  overrides: {
    gateId?: string;
    name?: string;
    type?: 'validation' | 'guidance';
    description?: string;
    guidance?: string;
    pass_criteria?: GateManagerInput['pass_criteria'];
    activation?: GateManagerInput['activation'];
    retry_config?: GateManagerInput['retry_config'];
  } = {}
): GateGuide {
  const {
    gateId = 'existing-gate',
    name = 'Existing Gate',
    type = 'validation',
    description = 'Existing description',
    guidance = 'Existing guidance',
    pass_criteria,
    activation,
    retry_config,
  } = overrides;

  return {
    gateId,
    name,
    type,
    description,
    getGuidance: () => guidance,
    getDefinition: () => ({
      id: gateId,
      name,
      type,
      description,
      guidance,
      pass_criteria,
      activation,
      retry_config,
    }),
  } as unknown as GateGuide;
}

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

describe('GateToolHandler', () => {
  let workspaceDir: string;
  let gatesDir: string;
  let logger: Logger;
  let gateManager: jest.Mocked<
    Pick<GateManager, 'has' | 'unregister' | 'reload' | 'list' | 'getStats' | 'get'>
  >;
  let manager: GateToolHandler;
  let onRefresh: jest.Mock<() => Promise<void>>;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'cpm-gate-manager-'));
    gatesDir = join(workspaceDir, 'gates');
    mkdirSync(gatesDir, { recursive: true });

    logger = createLogger();
    onRefresh = jest.fn(async () => undefined);

    gateManager = {
      has: jest.fn(() => false),
      unregister: jest.fn(() => true),
      reload: jest.fn(async () => true),
      list: jest.fn(() => []),
      get: jest.fn(() => undefined),
      getStats: jest.fn(() => ({
        totalGates: 0,
        enabledGates: 0,
        disabledGates: 0,
        cacheHitRate: 1,
      })),
    };

    const configManager = {
      getGatesDirectory: () => gatesDir,
      // No bundled tree in this fixture: the stub answers "no distinct bundled source".
      getBundledResourceDirectory: () => undefined,
      getVersioningConfig: () => ({ mode: 'off', maxVersions: 50 }),
    } as unknown as ConfigManager;

    manager = new GateToolHandler({
      logger,
      gateManager: gateManager as unknown as GateManager,
      configManager,
      onRefresh,
    });
  });

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  test('create writes gate files and triggers refresh', async () => {
    const result = await manager.handleAction(
      {
        action: 'create',
        id: 'new-gate',
        name: 'New Gate',
        description: 'Gate description',
        // No trailing newline on purpose: `GateFileWriter` appends exactly one for content that
        // lacks it, so this doubles as the "create" case of that contract.
        guidance: 'Gate guidance',
      },
      {}
    );

    const gateDir = join(gatesDir, 'new-gate');
    expect(result.isError).toBe(false);
    expect(existsSync(join(gateDir, 'gate.yaml'))).toBe(true);
    expect(existsSync(join(gateDir, 'guidance.md'))).toBe(true);
    // MUTATION KILLED: reverting `ensureTrailingNewline` to a no-op makes this fail — the file
    // would stay `'Gate guidance'` with no trailing `\n`.
    expect(readFileSync(join(gateDir, 'guidance.md'), 'utf8')).toBe('Gate guidance\n');
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect((result.content[0] as { text: string }).text).toContain('created successfully');
  });

  test('create fails when gate already exists in registry', async () => {
    gateManager.has.mockReturnValue(true);

    const result = await manager.handleAction(
      {
        action: 'create',
        id: 'new-gate',
        name: 'New Gate',
        description: 'Gate description',
        guidance: 'Gate guidance',
      },
      {}
    );

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain(
      "Gate 'new-gate' already exists"
    );
    expect(onRefresh).not.toHaveBeenCalled();
  });

  test('delete removes gate directory and unregisters from registry', async () => {
    const gateDir = join(gatesDir, 'existing-gate');
    mkdirSync(gateDir, { recursive: true });
    gateManager.has.mockReturnValue(true);

    const result = await manager.handleAction(
      {
        action: 'delete',
        id: 'existing-gate',
        confirm: true,
      },
      {}
    );

    expect(result.isError).toBe(false);
    expect(existsSync(gateDir)).toBe(false);
    expect(gateManager.unregister).toHaveBeenCalledWith('existing-gate');
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect((result.content[0] as { text: string }).text).toContain('deleted successfully');
  });

  test('delete fails cleanly when there is nothing on disk to delete', async () => {
    // This test previously asserted that delete refused on REGISTRY membership
    // (`Gate 'missing-gate' not found`). That guard is gone: delete removes a directory, so the
    // directory is its authority, and a registry check refused to delete a gate that existed on
    // disk but was never registered — exactly what a pre-F17-fix create produced, leaving orphans
    // that had to be removed by hand.
    //
    // The behaviour change is bounded and is the point: an id absent from BOTH still fails, and
    // now says which of the two it actually checked.
    gateManager.has.mockReturnValue(false);

    const result = await manager.handleAction(
      {
        action: 'delete',
        id: 'missing-gate',
        confirm: true,
      },
      {}
    );

    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    // Names the GATE, not a directory. The message used to be `Gate directory not found: <path>`,
    // which was wrong twice: it described a path that was never meant to exist, and it was also
    // returned for a gate that DOES exist in the bundled tree (P1.3) — so "not found" was false
    // in the case that reached it most often. It also put an absolute server path in a
    // client-facing error. This case is the genuinely-absent one, which still fails.
    expect(text).toContain('Gate not found');
    expect(text).toContain('missing-gate');
    expect(text).toContain('Nothing was removed');
  });

  test('delete removes a gate that is on disk but was never registered', async () => {
    // The regression this whole change exists to prevent. `has` is false while the directory is
    // real; before the guard moved, this returned "not found" and the files stayed forever.
    const gateDir = join(gatesDir, 'orphaned-gate');
    mkdirSync(gateDir, { recursive: true });
    writeFileSync(
      join(gateDir, 'gate.yaml'),
      'id: orphaned-gate\nname: Orphan\ntype: validation\n'
    );
    gateManager.has.mockReturnValue(false);
    gateManager.unregister.mockReturnValue(false);

    const result = await manager.handleAction(
      { action: 'delete', id: 'orphaned-gate', confirm: true },
      {}
    );

    expect(result.isError).toBe(false);
    expect(existsSync(gateDir)).toBe(false);
    expect((result.content[0] as { text: string }).text).toContain('not in the gate registry');
  });

  test('delete no longer enforces confirmation here — the router owns it', async () => {
    // This test previously asserted that GateToolHandler refused `delete` without `confirm`. That
    // guard was one of five hand-written copies in two idioms; it now lives once in
    // ResourceManagerRouter as DESTRUCTIVE_ACTIONS, checked ahead of dispatch.
    //
    // The behaviour change is real and bounded: a caller reaching this handler WITHOUT going
    // through the router now deletes unconfirmed. Measured 2026-08-17, no such caller exists —
    // `router.ts:266` is the sole entry point and `gate-manager/core/manager.ts:93` the sole
    // construction site. Should a second entry point ever appear, it must route through the
    // router or re-establish a guard; this test is the marker that says so.
    //
    // Confirmation coverage: tests/unit/mcp-tools/resource-manager/router.test.ts
    // §destructive-action guard, verified to red when the guard is disabled.
    gateManager.has.mockReturnValue(true);

    const result = await manager.handleAction({ action: 'delete', id: 'existing-gate' }, {});

    expect((result.content[0] as { text: string }).text).not.toContain('requires confirmation');
  });

  describe('update preservation', () => {
    // Regression coverage for resource-manager-settability-matrix-2026-08-13 §4 gap #1:
    // `activation`/`retry_config`/`pass_criteria` had no fallback to the existing gate on
    // update, so any update call omitting them silently deleted them from gate.yaml.

    function readWrittenGateYaml(id: string): Record<string, unknown> {
      const yamlPath = join(gatesDir, id, 'gate.yaml');
      return loadYamlFileSync(yamlPath) as Record<string, unknown>;
    }

    test('update omitting activation preserves the existing value', async () => {
      gateManager.has.mockReturnValue(true);
      gateManager.get.mockReturnValue(
        createFakeGate({
          gateId: 'gate-a',
          activation: { prompt_categories: ['docs'] },
        })
      );

      const result = await manager.handleAction(
        { action: 'update', id: 'gate-a', description: 'new description' },
        {}
      );

      expect(result.isError).toBe(false);
      const written = readWrittenGateYaml('gate-a');
      expect(written['description']).toBe('new description');
      expect(written['activation']).toEqual({ prompt_categories: ['docs'] });
    });

    test('update omitting retry_config preserves the existing value', async () => {
      gateManager.has.mockReturnValue(true);
      gateManager.get.mockReturnValue(
        createFakeGate({
          gateId: 'gate-b',
          retry_config: { max_attempts: 5, improvement_hints: false },
        })
      );

      const result = await manager.handleAction(
        { action: 'update', id: 'gate-b', description: 'new description' },
        {}
      );

      expect(result.isError).toBe(false);
      const written = readWrittenGateYaml('gate-b');
      expect(written['retry_config']).toEqual({ max_attempts: 5, improvement_hints: false });
    });

    test('update omitting pass_criteria preserves the existing value', async () => {
      gateManager.has.mockReturnValue(true);
      gateManager.get.mockReturnValue(
        createFakeGate({
          gateId: 'gate-c',
          pass_criteria: [{ type: 'inline_guidance' }],
        })
      );

      const result = await manager.handleAction(
        { action: 'update', id: 'gate-c', description: 'new description' },
        {}
      );

      expect(result.isError).toBe(false);
      const written = readWrittenGateYaml('gate-c');
      expect(written['pass_criteria']).toEqual([{ type: 'inline_guidance' }]);
    });

    test('update explicitly supplying activation/retry_config/pass_criteria overrides the existing value', async () => {
      gateManager.has.mockReturnValue(true);
      gateManager.get.mockReturnValue(
        createFakeGate({
          gateId: 'gate-d',
          activation: { prompt_categories: ['docs'] },
          retry_config: { max_attempts: 5 },
          pass_criteria: [{ type: 'inline_guidance' }],
        })
      );

      const result = await manager.handleAction(
        {
          action: 'update',
          id: 'gate-d',
          activation: { prompt_categories: ['code'], explicit_request: true },
          retry_config: { max_attempts: 1 },
          pass_criteria: [{ type: 'framework_compliance' }],
        },
        {}
      );

      expect(result.isError).toBe(false);
      const written = readWrittenGateYaml('gate-d');
      expect(written['activation']).toEqual({
        prompt_categories: ['code'],
        explicit_request: true,
      });
      expect(written['retry_config']).toEqual({ max_attempts: 1 });
      expect(written['pass_criteria']).toEqual([{ type: 'framework_compliance' }]);
    });

    // Regression coverage for the writer-side gap left after the above:
    // `GateFileWriter.buildGateYaml` never wrote `severity`/`enforcementMode`/`gate_type` at
    // all — not even conditionally — so no fallback in `gate-lifecycle-processor.ts` could have
    // saved them; the fix has to live in the writer, reading the on-disk file directly.
    test('update preserves severity/enforcementMode/gate_type not settable via GateManagerInput', async () => {
      gateManager.has.mockReturnValue(true);
      gateManager.get.mockReturnValue(
        createFakeGate({ gateId: 'gate-e', description: 'Existing description' })
      );

      const gateDir = join(gatesDir, 'gate-e');
      mkdirSync(gateDir, { recursive: true });
      writeFileSync(
        join(gateDir, 'gate.yaml'),
        [
          'id: gate-e',
          'name: Existing Gate',
          'type: validation',
          'description: Existing description',
          'severity: critical',
          'enforcementMode: blocking',
          'gate_type: category',
          'guidanceFile: guidance.md',
          '',
        ].join('\n'),
        'utf8'
      );
      writeFileSync(join(gateDir, 'guidance.md'), 'Existing guidance', 'utf8');

      const result = await manager.handleAction(
        { action: 'update', id: 'gate-e', description: 'new description' },
        {}
      );

      expect(result.isError).toBe(false);
      const written = readWrittenGateYaml('gate-e');
      // Proves merge, not clobber: the projected field changes to the new value in the SAME
      // write that preserves the three fields the projection never produces.
      expect(written['description']).toBe('new description');
      expect(written['severity']).toBe('critical');
      expect(written['enforcementMode']).toBe('blocking');
      expect(written['gate_type']).toBe('category');
    });

    // Guards the derivation itself: if `GateDefinitionSchema` gains a new declared field, it
    // must be classified into GATE_YAML_PROJECTED_KEYS, GATE_YAML_EXCLUDED_KEYS, or
    // PRESERVED_GATE_YAML_KEYS — silently falling through either bucket re-opens the data-loss
    // hole this describe block exists to close. Does NOT catch a new passthrough-ONLY field
    // (one never added to the Zod object shape at all) — a load-bearing key read at runtime but
    // never declared on the schema is invisible to `Object.keys(GateDefinitionSchema.shape)` and
    // so to this test too.
    test('projected + excluded + preserved keys cover every declared gate.yaml schema key', () => {
      const schemaKeys = Object.keys(GateDefinitionSchema.shape);
      const covered = new Set<string>([
        ...GATE_YAML_PROJECTED_KEYS,
        ...GATE_YAML_EXCLUDED_KEYS,
        ...PRESERVED_GATE_YAML_KEYS,
      ]);

      const uncovered = schemaKeys.filter((key) => !covered.has(key));
      expect(uncovered).toEqual([]);
    });
  });

  describe('update leaves omitted guidance.md byte-identical', () => {
    // Unlike `createFakeGate` above (a hand-written stub whose `getGuidance()` returns whatever
    // string the test passed it), this drives the REAL load path: `GateDefinitionLoader` reads
    // `guidance.md` off disk and `GenericGateGuide` wraps that definition exactly the way
    // production's `GateRegistry` does. That is load-bearing here — the defect this guards
    // lived in the loader's inlining step, not in `gate-lifecycle-processor.ts`'s fallback
    // expression, so a stub that never calls the loader could not have caught it.
    function writeRealGate(id: string, guidanceContent: string): string {
      const gateDir = join(gatesDir, id);
      mkdirSync(gateDir, { recursive: true });
      writeFileSync(
        join(gateDir, 'gate.yaml'),
        [
          `id: ${id}`,
          'name: Newline Gate',
          'type: validation',
          'description: Existing description',
          'guidanceFile: guidance.md',
          '',
        ].join('\n'),
        'utf8'
      );
      writeFileSync(join(gateDir, 'guidance.md'), guidanceContent, 'utf8');
      return gateDir;
    }

    test('update supplying only activation leaves guidance.md byte-identical', async () => {
      const gateId = 'newline-gate';
      const guidanceContent = 'Check the newline.\n';
      writeRealGate(gateId, guidanceContent);

      const loader = new GateDefinitionLoader({ gatesDir });
      const definition = loader.loadGate(gateId);
      expect(definition).toBeDefined();
      const realGuide = new GenericGateGuide(definition!);

      gateManager.has.mockReturnValue(true);
      gateManager.get.mockReturnValue(realGuide);

      const result = await manager.handleAction(
        {
          action: 'update',
          id: gateId,
          activation: { prompt_categories: ['docs'] },
        },
        {}
      );

      expect(result.isError).toBe(false);
      // MUTATION KILLED: re-introducing `.trim()` in `gate-definition-loader.ts`'s
      // `inlineReferencedFiles` makes this fail — the rewritten file loses its trailing `\n` and
      // no longer matches `guidanceContent`. Confirmed by applying that mutation, re-running this
      // file (red), and reverting (see tests/unit/gates/core/gate-definition-loader.test.ts for
      // the isolated repro of the same mutation).
      const rewritten = readFileSync(join(gatesDir, gateId, 'guidance.md'), 'utf8');
      expect(rewritten).toBe(guidanceContent);
    });

    test('update explicitly supplying guidance still rewrites it to the new value', async () => {
      const gateId = 'newline-gate-explicit';
      writeRealGate(gateId, 'Old guidance.\n');

      const loader = new GateDefinitionLoader({ gatesDir });
      const definition = loader.loadGate(gateId);
      const realGuide = new GenericGateGuide(definition!);

      gateManager.has.mockReturnValue(true);
      gateManager.get.mockReturnValue(realGuide);

      const result = await manager.handleAction(
        { action: 'update', id: gateId, guidance: 'New guidance.\n' },
        {}
      );

      expect(result.isError).toBe(false);
      const rewritten = readFileSync(join(gatesDir, gateId, 'guidance.md'), 'utf8');
      expect(rewritten).toBe('New guidance.\n');
    });
  });

  /**
   * tutorial-rework B.28 — `gate.yaml` and `guidance.md` are two independently-scoped writes, not one write
   * that always touches both. Before this fix, `buildGateYaml` unconditionally built (and
   * `planGateWrite` unconditionally wrote) `gate.yaml` on every update, so a guidance-only call
   * re-serialized it into the writer's own key order and dropped any hand-authored comment — a
   * bug invisible to `update supplying only activation leaves guidance.md byte-identical` above,
   * because that test's gate was ITSELF written by the writer, so re-serializing it produced the
   * same bytes back. A hand-authored `gate.yaml`, with a comment and a scrambled key order the
   * writer would never emit, is what makes the re-serialization visible.
   */
  describe('write-scope narrowing (tutorial-rework B.28): gate.yaml and guidance.md are rewritten independently', () => {
    const GATE_ID = 'scoped-write-gate';
    const HAND_AUTHORED_YAML = [
      '# Hand-authored — this comment and the scrambled key order below must survive any update',
      '# that does not touch a gate.yaml-resident field.',
      'name: Scoped Write Gate',
      'severity: high',
      `id: ${GATE_ID}`,
      'type: validation',
      'activation:',
      '  prompt_categories: [code]',
      'description: Proves gate.yaml write scope is narrowed to supplied fields.',
      'guidanceFile: guidance.md',
      'gate_type: custom',
      '',
    ].join('\n');

    function seedHandAuthoredGate(guidanceContent: string): string {
      const gateDir = join(gatesDir, GATE_ID);
      mkdirSync(gateDir, { recursive: true });
      writeFileSync(join(gateDir, 'gate.yaml'), HAND_AUTHORED_YAML, 'utf8');
      writeFileSync(join(gateDir, 'guidance.md'), guidanceContent, 'utf8');
      return gateDir;
    }

    // The real load path, like `writeRealGate` above — `existingDefinition` in
    // `gate-lifecycle-processor.ts` has to read the ACTUAL hand-authored values (not a test
    // double's arbitrary stub) for the omitted fields to merge back byte-for-byte.
    function loadRealGate(): GateGuide {
      const loader = new GateDefinitionLoader({ gatesDir });
      const definition = loader.loadGate(GATE_ID);
      expect(definition).toBeDefined();
      return new GenericGateGuide(definition!);
    }

    test('guidance-only update leaves a hand-authored gate.yaml byte-identical (comment and key order included), and its diff names only guidance.md', async () => {
      const gateDir = seedHandAuthoredGate('Original guidance.\n');
      const before = readFileSync(join(gateDir, 'gate.yaml'), 'utf8');

      gateManager.has.mockReturnValue(true);
      gateManager.get.mockReturnValue(loadRealGate());

      const result = await manager.handleAction(
        { action: 'update', id: GATE_ID, guidance: 'Updated guidance only.\n' },
        {}
      );

      expect(result.isError).toBe(false);
      // MUTATION KILLED: reverting `planGateWrite`'s `writesYaml` narrowing back to
      // unconditionally true (`buildGateYaml`'s pre-fix behaviour) makes this fail — `gate.yaml`
      // comes back re-serialized into the writer's own key order with the comment dropped, even
      // though this call named only `guidance`. Confirmed by making that revert, re-running this
      // file (red on this assertion), and restoring the narrowing.
      const after = readFileSync(join(gateDir, 'gate.yaml'), 'utf8');
      expect(after).toBe(before);

      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain(`${GATE_ID}/guidance.md`);
      expect(text).not.toContain(`${GATE_ID}/gate.yaml`);
    });

    test('activation-only update rewrites gate.yaml and leaves guidance.md byte-identical', async () => {
      const gateDir = seedHandAuthoredGate('Guidance stays put.\n');
      const guidanceBefore = readFileSync(join(gateDir, 'guidance.md'), 'utf8');

      gateManager.has.mockReturnValue(true);
      gateManager.get.mockReturnValue(loadRealGate());

      const result = await manager.handleAction(
        { action: 'update', id: GATE_ID, activation: { prompt_categories: ['docs'] } },
        {}
      );

      expect(result.isError).toBe(false);
      const guidanceAfter = readFileSync(join(gateDir, 'guidance.md'), 'utf8');
      expect(guidanceAfter).toBe(guidanceBefore);

      const yamlAfter = readFileSync(join(gateDir, 'gate.yaml'), 'utf8');
      expect(yamlAfter).not.toBe(HAND_AUTHORED_YAML);
      const parsed = loadYamlFileSync(join(gateDir, 'gate.yaml')) as Record<string, unknown>;
      expect(parsed['activation']).toEqual({ prompt_categories: ['docs'] });
      // The positive control's other half: fields the writer builds no value for (preserved, not
      // projected) still carry forward across a write that DOES touch gate.yaml.
      expect(parsed['severity']).toBe('high');
      expect(parsed['gate_type']).toBe('custom');

      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain(`${GATE_ID}/gate.yaml`);
      expect(text).not.toContain(`${GATE_ID}/guidance.md`);
    });
  });

  /**
   * Ruling on tutorial-rework B.18: a `version_history` snapshot
   * recorded BEFORE the guidance.md verbatim-load fix holds `.trim()`'d guidance — lossy, and not
   * invertible, since `.trim()` cannot say whether the original had zero, one, or more trailing
   * newlines. Every shipped, Prettier-formatted `guidance.md` ends in exactly one, so restoring
   * with one is the faithful reconstruction. Fixed once in `GateFileWriter.writeGateFiles` (via
   * `ensureTrailingNewline`), the single write path create, update, AND rollback all pass through
   * — tested here directly against the writer, the same way `gate-file-service.test.ts` does,
   * rather than through the full `GateVersioningProcessor.handleRollback` (which needs a
   * SQLite-backed `VersionHistoryService` this file's `configManager` stub deliberately disables).
   */
  describe('GateFileWriter appends exactly one trailing newline to unterminated guidance', () => {
    function gateFileWriterConfigManager(): ConfigManager {
      return {
        getGatesDirectory: () => gatesDir,
        getBundledResourceDirectory: () => undefined,
      } as unknown as ConfigManager;
    }

    test('rollback/restore of a pre-fix snapshot (no trailing newline) writes guidance.md ending with exactly one \\n', async () => {
      const gateId = 'rollback-newline-gate';
      mkdirSync(join(gatesDir, gateId), { recursive: true });

      // The pre-fix shape: `gateSnapshotContract.project()` recorded `.trim()`'d guidance before
      // this fix existed. `restore` is what `handleRollback` calls on a resolved version row.
      const preFixSnapshot = {
        id: gateId,
        name: 'Newline Gate',
        type: 'validation',
        description: 'Existing description',
        guidance: 'Check the thing.', // no trailing \n — the pre-fix, lossy, recorded value
      };
      const restore = gateSnapshotContract.restore(gateId, preFixSnapshot);
      expect(restore.ok).toBe(true);
      if (!restore.ok) return;

      const writer = new GateFileWriter({ logger, configManager: gateFileWriterConfigManager() });
      const writeResult = await writer.writeGateFiles(restore.writeModel);
      expect(writeResult.success).toBe(true);

      // MUTATION KILLED: reverting `ensureTrailingNewline` to `return guidance;` unconditionally
      // makes this fail — the restored file would stay `'Check the thing.'` with no `\n`.
      // Confirmed by applying that mutation, re-running this file (red), and reverting.
      const written = readFileSync(join(gatesDir, gateId, 'guidance.md'), 'utf8');
      expect(written).toBe('Check the thing.\n');
    });

    test('create with guidance lacking a trailing newline writes exactly one', async () => {
      const writer = new GateFileWriter({ logger, configManager: gateFileWriterConfigManager() });
      const writeResult = await writer.writeGateFiles({
        id: 'create-newline-gate',
        name: 'Create Newline Gate',
        type: 'validation',
        description: 'Existing description',
        guidance: 'No newline yet',
      });

      expect(writeResult.success).toBe(true);
      const written = readFileSync(join(gatesDir, 'create-newline-gate', 'guidance.md'), 'utf8');
      expect(written).toBe('No newline yet\n');
    });

    test('content already ending in a newline is written unchanged — no collapsing of extra trailing newlines', async () => {
      const writer = new GateFileWriter({ logger, configManager: gateFileWriterConfigManager() });
      const writeResult = await writer.writeGateFiles({
        id: 'multi-newline-gate',
        name: 'Multi Newline Gate',
        type: 'validation',
        description: 'Existing description',
        guidance: 'Already terminated.\n\n\n',
      });

      expect(writeResult.success).toBe(true);
      const written = readFileSync(join(gatesDir, 'multi-newline-gate', 'guidance.md'), 'utf8');
      expect(written).toBe('Already terminated.\n\n\n');
    });
  });
});
