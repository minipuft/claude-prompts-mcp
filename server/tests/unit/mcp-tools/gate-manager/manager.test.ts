import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GateDefinitionLoader } from '../../../../src/engine/gates/core/gate-definition-loader.js';
import { GateDefinitionSchema } from '../../../../src/engine/gates/core/gate-schema.js';
import { GateToolHandler } from '../../../../src/mcp/tools/gate-manager/core/manager.js';
import { GenericGateGuide } from '../../../../src/engine/gates/registry/generic-gate-guide.js';
import {
  GATE_YAML_EXCLUDED_KEYS,
  GATE_YAML_PROJECTED_KEYS,
  PRESERVED_GATE_YAML_KEYS,
} from '../../../../src/engine/gates/core/gate-yaml-keys.js';
import { GateFileWriter } from '../../../../src/mcp/tools/gate-manager/services/gate-file-writer.js';
import {
  EMPTY_QUARANTINE_VIEW,
  ResourceQuarantine,
} from '../../../../src/shared/utils/resource-quarantine.js';
import { gateSnapshotContract } from '../../../../src/mcp/tools/gate-manager/services/gate-snapshot-contract.js';
import { loadYamlFileSync } from '../../../../src/shared/utils/yaml/index.js';

import type { GateManager } from '../../../../src/engine/gates/gate-manager.js';
import type { GateGuide } from '../../../../src/engine/gates/types/index.js';
import type { GateManagerInput } from '../../../../src/mcp/tools/gate-manager/core/types.js';
import type { DatabasePort } from '../../../../src/shared/types/persistence.js';
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
    Pick<
      GateManager,
      'has' | 'unregister' | 'reload' | 'list' | 'getStats' | 'get' | 'getQuarantine'
    >
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
      // P4.19 — `create` and `update` both consult the quarantine on the branch where `has(id)`
      // is false. This fixture has no loader and therefore no refused files; the empty view is
      // the honest answer, and NOT a stored production wiring (see `lazyQuarantineView`).
      getQuarantine: jest.fn(() => EMPTY_QUARANTINE_VIEW),
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

  describe('gate.yaml key names (P4.10)', () => {
    // `type` and `gate_type` are two DIFFERENT gate.yaml keys. Until P4.10 the tool published
    // one parameter named `gate_type` that wrote the key `type`, so the real `gate_type` key —
    // the framework/category/custom classification `gate-loader.ts` filters framework gates on —
    // had no parameter at all. Both of these assert the KEY IN THE WRITTEN FILE, not that the
    // call returned ok: a handler that accepted the argument and dropped it would return ok.

    function readWrittenGateYaml(id: string): Record<string, unknown> {
      const yamlPath = join(gatesDir, id, 'gate.yaml');
      return loadYamlFileSync(yamlPath) as Record<string, unknown>;
    }

    // KILLED BY: removing `gate_type` from the `gateData` object literal in
    // `GateLifecycleProcessor.handleCreate` — `resolvePreservedGateYamlFields` then finds no
    // supplied value, no existing file to fall back to, and writes no `gate_type` key.
    test("create with gate_type: 'framework' writes gate_type: framework to gate.yaml", async () => {
      const result = await manager.handleAction(
        {
          action: 'create',
          id: 'classified-gate',
          name: 'Classified Gate',
          type: 'validation',
          gate_type: 'framework',
          description: 'A framework-scoped gate',
          guidance: 'Framework guidance',
        },
        {}
      );

      expect(result.isError).toBe(false);
      const written = readWrittenGateYaml('classified-gate');
      expect(written['gate_type']).toBe('framework');
      // 'framework' is non-default: the loader resolves an absent key to 'custom', so a write
      // that dropped the value would leave the key absent rather than produce this string.
      expect(written['type']).toBe('validation');
    });

    // KILLED BY: hardcoding `type: 'validation'` in `GateFileWriter.buildGateYaml` (or dropping
    // `type` from the `handleCreate` gateData literal, which makes the processor's
    // `type || 'validation'` fallback write 'validation').
    test("create with type: 'guidance' writes type: guidance to gate.yaml", async () => {
      const result = await manager.handleAction(
        {
          action: 'create',
          id: 'advisory-gate',
          name: 'Advisory Gate',
          type: 'guidance',
          description: 'An advisory gate',
          guidance: 'Advisory guidance',
        },
        {}
      );

      expect(result.isError).toBe(false);
      const written = readWrittenGateYaml('advisory-gate');
      expect(written['type']).toBe('guidance');
      // The other half of the pair stays absent when nobody set it — proving the two keys are
      // independent rather than one value written twice.
      expect(written['gate_type']).toBeUndefined();
    });
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
    //
    // All three are settable now (P4.4, P4.10), which does NOT make this redundant: preservation
    // is the OMITTED-value branch, and the update below supplies none of them.
    test('update omitting severity/enforcementMode/gate_type preserves the on-disk values', async () => {
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

// What a `resource_manager` gate caller is told when the request is incomplete, the target is
// missing or protected, or a step fails. Driven through the real `GateToolHandler` and its
// processors over a temp directory; the doubles are the registry's answers, the version store's
// `DatabasePort` and, for write failures, a path the filesystem refuses.
describe('GateToolHandler — refusals and failure reports', () => {
  const text = (result: { content: unknown[] }): string =>
    (result.content[0] as { text: string }).text;

  // Permission-based failures cannot be provoked by a superuser.
  const runsAsRoot = typeof process.getuid === 'function' && process.getuid() === 0;

  let root: string;
  let gatesDir: string;
  let bundledDir: string | undefined;
  let versioning: { enabled: boolean; autoVersion: boolean; maxVersions: number };
  let quarantine: ResourceQuarantine;
  let registry: jest.Mocked<
    Pick<GateManager, 'has' | 'unregister' | 'reload' | 'list' | 'getStats' | 'get'>
  >;
  let onRefresh: jest.Mock<() => Promise<void>>;
  let handler: GateToolHandler;

  function buildHandler(): GateToolHandler {
    const configManager = {
      getGatesDirectory: () => gatesDir,
      getBundledResourceDirectory: () => bundledDir,
      getVersioningConfig: () => versioning,
      getServerRoot: () => root,
    } as unknown as ConfigManager;
    return new GateToolHandler({
      logger: createLogger(),
      gateManager: {
        ...registry,
        getQuarantine: () => quarantine,
      } as unknown as GateManager,
      configManager,
      onRefresh,
    });
  }

  function refuse(id: string, error = 'schema: name is required'): string {
    const filePath = join(gatesDir, id, 'gate.yaml');
    quarantine.sinkFor('gate', gatesDir).record({ id, path: filePath, error });
    return filePath;
  }

  /** A `DatabasePort` whose version_history count is `rows`, or whose transaction throws. */
  function versionDb(outcome: { rows: number } | { failure: string }): DatabasePort {
    return {
      isInitialized: () => true,
      initialize: async () => undefined,
      query: () => [],
      queryOne: (sql: string) =>
        'rows' in outcome && sql.includes('version_history') ? { cnt: outcome.rows } : null,
      run: () => undefined,
      transaction: async <T>(fn: () => T | Promise<T>): Promise<T> => {
        if ('failure' in outcome) throw new Error(outcome.failure);
        return fn();
      },
      beginTransaction: () => undefined,
      commit: () => undefined,
      rollback: () => undefined,
    } as unknown as DatabasePort;
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'cpm-gate-refusals-'));
    gatesDir = join(root, 'gates');
    mkdirSync(gatesDir, { recursive: true });
    bundledDir = undefined;
    versioning = { enabled: false, autoVersion: false, maxVersions: 50 };
    quarantine = new ResourceQuarantine();
    onRefresh = jest.fn(async () => undefined);
    registry = {
      has: jest.fn(() => false),
      unregister: jest.fn(() => true),
      reload: jest.fn(async () => true),
      list: jest.fn(() => []),
      get: jest.fn(() => undefined),
      getStats: jest.fn(() => ({ totalGates: 0, enabledGates: 0, disabledGates: 0 })),
    } as never;
    handler = buildHandler();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  describe('required fields', () => {
    const complete = {
      action: 'create' as const,
      id: 'needs-fields',
      name: 'Needs Fields',
      description: 'Has a description',
      guidance: 'Has guidance',
    };

    test.each([
      ['id', 'Gate ID is required for create action'],
      ['name', 'Gate name is required for create action'],
      ['description', 'Gate description is required for create action'],
      ['guidance', 'Gate guidance is required for create action'],
    ] as const)('create without %s is refused and writes nothing', async (field, message) => {
      const { [field]: _omitted, ...incomplete } = complete;

      const result = await handler.handleAction(incomplete, {});

      expect(result.isError).toBe(true);
      expect(text(result)).toBe(`❌ ${message}`);
      expect(readdirSync(gatesDir)).toEqual([]);
      expect(onRefresh).not.toHaveBeenCalled();
    });

    test('create with all four present succeeds (control for the refusals above)', async () => {
      const result = await handler.handleAction(complete, {});

      expect(result.isError).toBe(false);
      expect(readdirSync(gatesDir)).toEqual(['needs-fields']);
    });

    test.each(['update', 'delete', 'reload'] as const)(
      '%s without an id is refused',
      async (action) => {
        const result = await handler.handleAction({ action }, {});

        expect(result.isError).toBe(true);
        expect(text(result)).toBe(`❌ Gate ID is required for ${action} action`);
        expect(registry.reload).not.toHaveBeenCalled();
        expect(registry.unregister).not.toHaveBeenCalled();
      }
    );
  });

  describe('update', () => {
    test('names `create` when neither the registry nor the quarantine knows the id', async () => {
      refuse('some-other-gate');

      const result = await handler.handleAction({ action: 'update', id: 'ghost-gate' }, {});

      expect(result.isError).toBe(true);
      expect(text(result)).toBe(
        "❌ Gate 'ghost-gate' not found. Use create action to add new gate."
      );
      expect(readdirSync(gatesDir)).toEqual([]);
    });

    test('reports a registry that lists the id but cannot return the gate', async () => {
      registry.has.mockReturnValue(true);
      registry.get.mockReturnValue(undefined);

      const result = await handler.handleAction({ action: 'update', id: 'half-gate' }, {});

      expect(result.isError).toBe(true);
      expect(text(result)).toBe("❌ Failed to retrieve gate 'half-gate'");
    });

    test('a gate with no declared type is written back as `validation`', async () => {
      registry.has.mockReturnValue(true);
      registry.get.mockReturnValue({
        ...createFakeGate({ gateId: 'untyped-gate' }),
        type: undefined,
      } as unknown as GateGuide);

      const result = await handler.handleAction(
        { action: 'update', id: 'untyped-gate', description: 'now described' },
        {}
      );

      expect(result.isError).toBe(false);
      const written = loadYamlFileSync(join(gatesDir, 'untyped-gate', 'gate.yaml')) as Record<
        string,
        unknown
      >;
      expect(written['type']).toBe('validation');
      expect(written['description']).toBe('now described');
    });

    test.each([
      [true, '🔄 Gate reloaded'],
      [false, 'could not be reloaded into this process'],
    ])('reload outcome %s is reported as written, not assumed', async (reloaded, expected) => {
      registry.has.mockReturnValue(true);
      registry.get.mockReturnValue(createFakeGate({ gateId: 'reload-gate' }));
      registry.reload.mockResolvedValue(reloaded);

      const result = await handler.handleAction(
        { action: 'update', id: 'reload-gate', description: 'changed' },
        {}
      );

      // Not an error either way: the files ARE written.
      expect(result.isError).toBe(false);
      expect(text(result)).toContain("Gate 'reload-gate' updated successfully");
      expect(text(result)).toContain(expected);
      if (!reloaded) expect(text(result)).not.toContain('🔄 Gate reloaded');
      expect(existsSync(join(gatesDir, 'reload-gate', 'gate.yaml'))).toBe(true);
    });

    test('an update that changes nothing carries no diff block', async () => {
      const created = await handler.handleAction(
        {
          action: 'create',
          id: 'steady-gate',
          name: 'Steady',
          description: 'Same description',
          guidance: 'Same guidance\n',
        },
        {}
      );
      expect(created.isError).toBe(false);
      registry.has.mockReturnValue(true);
      registry.get.mockReturnValue(
        createFakeGate({
          gateId: 'steady-gate',
          name: 'Steady',
          description: 'Same description',
          guidance: 'Same guidance\n',
        })
      );

      const unchanged = await handler.handleAction(
        { action: 'update', id: 'steady-gate', description: 'Same description' },
        {}
      );
      const changed = await handler.handleAction(
        { action: 'update', id: 'steady-gate', description: 'Different description' },
        {}
      );

      expect(unchanged.isError).toBe(false);
      expect(text(changed)).toContain('Different description');
      // The control: the diff block exists when something changed, so its absence is meaningful.
      expect(text(unchanged)).not.toContain('Different description');
      expect(text(unchanged).length).toBeLessThan(text(changed).length);
    });
  });

  describe('create', () => {
    const body = {
      action: 'create' as const,
      id: 'fresh-gate',
      name: 'Fresh',
      description: 'Fresh description',
      guidance: 'Fresh guidance',
    };

    test('says the gate is on disk but NOT active when the registry could not load it', async () => {
      registry.reload.mockResolvedValue(false);

      const result = await handler.handleAction(body, {});

      // Files are written, so this is not an error — but it must not claim "ready to use now".
      expect(result.isError).toBe(false);
      expect(text(result)).toContain('NOT active in this server process');
      expect(text(result)).toContain('action: "reload"');
      expect(text(result)).not.toContain('ready to use now');
      expect(existsSync(join(gatesDir, 'fresh-gate', 'gate.yaml'))).toBe(true);
    });

    test('redirects an id whose file the loader refused to `update` instead of overwriting it', async () => {
      const refusedPath = refuse('fresh-gate', 'schema: name is required');

      const result = await handler.handleAction(body, {});

      expect(result.isError).toBe(true);
      expect(text(result)).toContain("Gate 'fresh-gate' already exists on disk");
      expect(text(result)).toContain(refusedPath);
      expect(text(result)).toContain('schema: name is required');
      expect(text(result)).toContain('action: "update"');
      expect(existsSync(join(gatesDir, 'fresh-gate'))).toBe(false);
    });

    (runsAsRoot ? test.skip : test)('reports a failed write and registers nothing', async () => {
      chmodSync(gatesDir, 0o555);
      try {
        const result = await handler.handleAction(body, {});

        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/^❌ Failed to create gate: /);
        expect(readdirSync(gatesDir)).toEqual([]);
        expect(registry.reload).not.toHaveBeenCalled();
        expect(onRefresh).not.toHaveBeenCalled();
      } finally {
        chmodSync(gatesDir, 0o755);
      }
    });
  });

  describe('repairing a refused gate through update', () => {
    test.each([
      [{}, 'name, description, guidance'],
      [{ name: 'Only A Name' }, 'description, guidance'],
      [{ name: 'N', description: 'D' }, 'guidance'],
    ])('a partial body %j is refused naming what is missing', async (supplied, missing) => {
      const refusedPath = refuse('broken-gate');

      const result = await handler.handleAction(
        { action: 'update', id: 'broken-gate', ...supplied },
        {}
      );

      expect(result.isError).toBe(true);
      expect(text(result)).toContain("Gate 'broken-gate' is quarantined");
      expect(text(result)).toContain(refusedPath);
      expect(text(result)).toContain(`Missing: ${missing}.`);
      expect(existsSync(join(gatesDir, 'broken-gate'))).toBe(false);
      expect(registry.reload).not.toHaveBeenCalled();
    });

    const wholeBody = {
      action: 'update' as const,
      id: 'broken-gate',
      name: 'Repaired',
      description: 'Repaired description',
      guidance: 'Repaired guidance',
    };

    test('reports "Still quarantined" when the reload leaves the refused file refused', async () => {
      const refusedPath = refuse('broken-gate');

      const result = await handler.handleAction(wholeBody, {});

      expect(result.isError).toBe(false);
      expect(text(result)).toContain("Repair written for quarantined gate 'broken-gate'");
      expect(text(result)).toContain('**Still quarantined**');
      expect(text(result)).toContain(refusedPath);
      expect(text(result)).toContain('No version was recorded');
      expect(registry.reload).toHaveBeenCalledWith('broken-gate');
    });

    test('reports "Repaired" once the quarantine record is gone after the reload', async () => {
      refuse('broken-gate');
      registry.reload.mockImplementation(async () => {
        quarantine.sinkFor('gate', gatesDir).forget(join(gatesDir, 'broken-gate', 'gate.yaml'));
        return true;
      });

      const result = await handler.handleAction(wholeBody, {});

      expect(result.isError).toBe(false);
      expect(text(result)).toContain('**Repaired**');
      expect(text(result)).not.toContain('Still quarantined');
    });

    (runsAsRoot ? test.skip : test)('reports a failed repair write', async () => {
      refuse('broken-gate');
      chmodSync(gatesDir, 0o555);
      try {
        const result = await handler.handleAction(wholeBody, {});

        expect(result.isError).toBe(true);
        expect(text(result)).toMatch(/^❌ Failed to repair gate: /);
        expect(registry.reload).not.toHaveBeenCalled();
      } finally {
        chmodSync(gatesDir, 0o755);
      }
    });
  });

  describe('delete', () => {
    test('refuses an id that resolves outside the gates root and removes nothing', async () => {
      const outside = join(root, 'precious');
      mkdirSync(outside);
      writeFileSync(join(outside, 'keep.txt'), 'must survive');

      const result = await handler.handleAction(
        { action: 'delete', id: '../precious', confirm: true },
        {}
      );

      expect(result.isError).toBe(true);
      expect(text(result)).toContain('Refusing to write outside the resource root');
      expect(readFileSync(join(outside, 'keep.txt'), 'utf8')).toBe('must survive');
      expect(registry.unregister).not.toHaveBeenCalled();
    });

    test('a contained id is deleted in the same setup (control for the traversal refusal)', async () => {
      mkdirSync(join(gatesDir, 'contained-gate'));

      const result = await handler.handleAction(
        { action: 'delete', id: 'contained-gate', confirm: true },
        {}
      );

      expect(result.isError).toBe(false);
      expect(existsSync(join(gatesDir, 'contained-gate'))).toBe(false);
    });

    describe('a gate served only from the bundled tree', () => {
      beforeEach(() => {
        bundledDir = join(root, 'bundled-gates');
        mkdirSync(join(bundledDir, 'shipped-gate'), { recursive: true });
        handler = buildHandler();
      });

      test('is refused as read-only, naming the bundled path and the update route', async () => {
        const result = await handler.handleAction(
          { action: 'delete', id: 'shipped-gate', confirm: true },
          {}
        );

        expect(result.isError).toBe(true);
        expect(text(result)).toContain("'shipped-gate' ships with the server");
        expect(text(result)).toContain(join(bundledDir!, 'shipped-gate'));
        expect(text(result)).toContain(`Your resources root is ${gatesDir}`);
        expect(existsSync(join(bundledDir!, 'shipped-gate'))).toBe(true);
        expect(registry.unregister).not.toHaveBeenCalled();
      });

      test('an id absent from the bundled tree too still reads as "not found"', async () => {
        const result = await handler.handleAction(
          { action: 'delete', id: 'nowhere-gate', confirm: true },
          {}
        );

        expect(text(result)).toBe("❌ Gate not found: 'nowhere-gate'. Nothing was removed.");
      });

      test('a bundled root that IS the gates root is not reported as read-only', async () => {
        bundledDir = gatesDir;
        handler = buildHandler();

        const result = await handler.handleAction(
          { action: 'delete', id: 'shipped-gate', confirm: true },
          {}
        );

        expect(text(result)).toBe("❌ Gate not found: 'shipped-gate'. Nothing was removed.");
      });
    });

    test('a preview names the directory and the purge but removes nothing', async () => {
      const gateDir = join(gatesDir, 'previewed-gate');
      mkdirSync(gateDir);
      versioning = { enabled: true, autoVersion: false, maxVersions: 50 };
      handler = buildHandler();
      const db = versionDb({ rows: 3 });
      const run = jest.spyOn(db, 'run');
      handler.setDatabasePort(db);

      const result = await handler.handleAction(
        { action: 'preview', preview_action: 'delete', id: 'previewed-gate' },
        {}
      );

      expect(result.isError).toBe(false);
      expect(text(result)).toContain("**Preview** — deletion of gate 'previewed-gate'");
      expect(text(result)).toContain(`Would remove the directory: ${gateDir}`);
      expect(text(result)).toContain('Nothing was removed');
      expect(existsSync(gateDir)).toBe(true);
      expect(run).not.toHaveBeenCalled();
      expect(registry.unregister).not.toHaveBeenCalled();
      expect(onRefresh).not.toHaveBeenCalled();
    });

    describe('version-history purge', () => {
      beforeEach(() => {
        mkdirSync(join(gatesDir, 'history-gate'));
        versioning = { enabled: true, autoVersion: false, maxVersions: 50 };
        handler = buildHandler();
      });

      test('reports the number of rows purged', async () => {
        handler.setDatabasePort(versionDb({ rows: 4 }));

        const result = await handler.handleAction(
          { action: 'delete', id: 'history-gate', confirm: true },
          {}
        );

        expect(result.isError).toBe(false);
        expect(text(result)).toContain('Version history purged: 4 row(s)');
        expect(registry.unregister).toHaveBeenCalledWith('history-gate');
      });

      test('a purge that throws is an error saying the files are gone and the rows remain', async () => {
        handler.setDatabasePort(versionDb({ failure: 'disk I/O error' }));

        const result = await handler.handleAction(
          { action: 'delete', id: 'history-gate', confirm: true },
          {}
        );

        expect(result.isError).toBe(true);
        expect(text(result)).toContain("gate 'history-gate' was deleted");
        expect(text(result)).toContain('could NOT be purged');
        expect(text(result)).toContain('disk I/O error');
        // The directory removal already happened; the registry and refresh are not told it did.
        expect(existsSync(join(gatesDir, 'history-gate'))).toBe(false);
        expect(registry.unregister).not.toHaveBeenCalled();
        expect(onRefresh).not.toHaveBeenCalled();
      });
    });

    (runsAsRoot ? test.skip : test)(
      'a directory the filesystem refuses to remove is reported and its history is left alone',
      async () => {
        const gateDir = join(gatesDir, 'locked-gate');
        const inner = join(gateDir, 'inner');
        mkdirSync(inner, { recursive: true });
        writeFileSync(join(inner, 'gate.yaml'), 'id: locked-gate\n');
        versioning = { enabled: true, autoVersion: false, maxVersions: 50 };
        handler = buildHandler();
        const db = versionDb({ rows: 2 });
        const run = jest.spyOn(db, 'run');
        handler.setDatabasePort(db);
        chmodSync(inner, 0o555);
        try {
          const result = await handler.handleAction(
            { action: 'delete', id: 'locked-gate', confirm: true },
            {}
          );

          expect(result.isError).toBe(true);
          expect(text(result)).toMatch(/^❌ Failed to delete gate directory: /);
          expect(existsSync(join(inner, 'gate.yaml'))).toBe(true);
          // Rows are purged only after the removal succeeded.
          expect(run).not.toHaveBeenCalled();
          expect(registry.unregister).not.toHaveBeenCalled();
        } finally {
          chmodSync(inner, 0o755);
        }
      }
    );
  });

  describe('reload', () => {
    test('names every refused file and its reason when the loader read and refused it', async () => {
      registry.reload.mockResolvedValue(false);
      const first = refuse('stuck-gate', 'schema: severity must be one of low|medium|high');
      quarantine
        .sinkFor('gate', join(root, 'overlay'))
        .record({ id: 'stuck-gate', path: '/overlay/stuck-gate/gate.yaml', error: 'bad yaml' });

      const result = await handler.handleAction({ action: 'reload', id: 'Stuck-Gate' }, {});

      expect(result.isError).toBe(true);
      expect(text(result)).toContain(
        "Failed to reload gate 'Stuck-Gate' — the file was read and refused:"
      );
      expect(text(result)).toContain(
        `  - ${first}: schema: severity must be one of low|medium|high`
      );
      expect(text(result)).toContain('  - /overlay/stuck-gate/gate.yaml: bad yaml');
    });

    test('names the expected gate.yaml path when nothing loaded and nothing was refused', async () => {
      registry.reload.mockResolvedValue(false);

      const result = await handler.handleAction({ action: 'reload', id: 'absent-gate' }, {});

      expect(result.isError).toBe(true);
      expect(text(result)).toContain('no gate definition could be loaded from disk');
      expect(text(result)).toContain(join(gatesDir, 'absent-gate', 'gate.yaml'));
      expect(text(result)).not.toContain('read and refused');
    });

    test('appends the reason only when one was given', async () => {
      const withReason = await handler.handleAction(
        { action: 'reload', id: 'ok-gate', reason: 'edited by hand' },
        {}
      );
      const without = await handler.handleAction({ action: 'reload', id: 'ok-gate' }, {});

      expect(withReason.isError).toBe(false);
      expect(text(withReason)).toBe(
        "🔄 Gate 'ok-gate' reloaded successfully (reason: edited by hand)"
      );
      expect(text(without)).toBe("🔄 Gate 'ok-gate' reloaded successfully");
    });
  });
});
