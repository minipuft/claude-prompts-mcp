import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GateDefinitionSchema } from '../../../../src/engine/gates/core/gate-schema.js';
import { GateToolHandler } from '../../../../src/mcp/tools/gate-manager/core/manager.js';
import {
  GATE_YAML_EXCLUDED_KEYS,
  GATE_YAML_PROJECTED_KEYS,
  PRESERVED_GATE_YAML_KEYS,
} from '../../../../src/mcp/tools/gate-manager/services/gate-file-writer.js';
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
        guidance: 'Gate guidance',
      },
      {}
    );

    const gateDir = join(gatesDir, 'new-gate');
    expect(result.isError).toBe(false);
    expect(existsSync(join(gateDir, 'gate.yaml'))).toBe(true);
    expect(existsSync(join(gateDir, 'guidance.md'))).toBe(true);
    expect(readFileSync(join(gateDir, 'guidance.md'), 'utf8')).toBe('Gate guidance');
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
    expect(text).toContain('Gate directory not found');
    expect(text).toContain('missing-gate');
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
          pass_criteria: [{ type: 'inline_guidance', min_length: 120 }],
        })
      );

      const result = await manager.handleAction(
        { action: 'update', id: 'gate-c', description: 'new description' },
        {}
      );

      expect(result.isError).toBe(false);
      const written = readWrittenGateYaml('gate-c');
      expect(written['pass_criteria']).toEqual([{ type: 'inline_guidance', min_length: 120 }]);
    });

    test('update explicitly supplying activation/retry_config/pass_criteria overrides the existing value', async () => {
      gateManager.has.mockReturnValue(true);
      gateManager.get.mockReturnValue(
        createFakeGate({
          gateId: 'gate-d',
          activation: { prompt_categories: ['docs'] },
          retry_config: { max_attempts: 5 },
          pass_criteria: [{ type: 'inline_guidance', min_length: 120 }],
        })
      );

      const result = await manager.handleAction(
        {
          action: 'update',
          id: 'gate-d',
          activation: { prompt_categories: ['code'], explicit_request: true },
          retry_config: { max_attempts: 1 },
          pass_criteria: [{ type: 'inline_guidance', min_length: 50 }],
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
      expect(written['pass_criteria']).toEqual([{ type: 'inline_guidance', min_length: 50 }]);
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
    // (one never added to the Zod object shape) — see the `evaluation`/`blockResponseOnFail`
    // note on `PRESERVED_GATE_YAML_KEYS` in gate-file-writer.ts for that residual gap.
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
});
