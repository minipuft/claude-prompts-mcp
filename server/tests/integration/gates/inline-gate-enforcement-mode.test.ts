// @lifecycle test - Row 1.5: an inline gate's declared enforcement_mode reaches the mode the step resolves.
/**
 * An inline gate (`gateConfiguration.inline_gate_definitions` in prompt.yaml) is registered as a
 * temporary gate and read back through `GateManagerProvider`, the provider the live pipeline uses.
 * Before row 1.5 its `enforcement_mode` was dropped four times on the way — by the loader's
 * normalizer, by the registrar, by `createTemporaryGate`'s rebuild of the record, and by the
 * temporary gate's conversion — so every inline gate resolved as undeclared.
 *
 * Twins differ ONLY in that one key. Each is loaded from disk by the real prompt loader,
 * registered by the real registrar into a real `TemporaryGateRegistry`, read back through the
 * real provider, and resolved by `resolveEnforcementMode` exactly as stage 11 publishes it.
 *
 * Classification: Integration. Real loader, registrar, registry, provider and resolver; the gate
 * manager behind the provider is empty, because an inline gate never reaches it.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, jest, test } from '@jest/globals';

import { resolveEnforcementMode } from '../../../src/engine/execution/pipeline/decisions/gates/enforcement-mode.js';
import { TemporaryGateRegistry } from '../../../src/engine/gates/core/temporary-gate-registry.js';
import { GateManagerProvider } from '../../../src/engine/gates/registry/gate-provider-adapter.js';
import { TemporaryGateRegistrar } from '../../../src/engine/gates/services/temporary-gate-registrar.js';
import { loadYamlPrompt } from '../../../src/modules/prompts/yaml-prompt-loader.js';

import type { IGateManager } from '../../../src/engine/gates/types.js';

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

/** Write a prompt whose one inline gate carries `modeLine` (or nothing) and load it from disk. */
function loadPromptWithInlineGate(dir: string, gateId: string, modeLine: string | undefined) {
  const file = path.join(dir, `${gateId}.yaml`);
  writeFileSync(
    file,
    [
      `id: ${gateId}`,
      `name: ${gateId}`,
      'category: general',
      'description: carries one inline gate',
      'userMessageTemplate: body',
      'gateConfiguration:',
      '  inline_gate_definitions:',
      `    - id: ${gateId}`,
      '      name: Inline Gate',
      '      type: validation',
      '      scope: execution',
      '      description: an inline gate',
      '      guidance: check it',
      ...(modeLine === undefined ? [] : [`      ${modeLine}`]),
      '',
    ].join('\n'),
    'utf8'
  );
  const loaded = loadYamlPrompt(file, undefined, {
    logger: logger as never,
    cache: new Map(),
    stats: { cacheHits: 0, cacheMisses: 0, loadErrors: 0 },
    enableCache: false,
    debug: false,
  });
  if (loaded === null) throw new Error(`prompt ${gateId} did not load`);
  return loaded.loadedContent;
}

describe('an inline gate declares its own enforcement mode (row 1.5)', () => {
  let dir: string;
  let registry: TemporaryGateRegistry;
  const registered: string[] = [];

  afterEach(() => {
    for (const id of registered.splice(0)) registry.removeTemporaryGate(id);
    rmSync(dir, { recursive: true, force: true });
  });

  /** Load, register and read back one twin; return its definition and the step's mode. */
  async function resolveTwin(gateId: string, modeLine: string | undefined) {
    dir = mkdtempSync(path.join(tmpdir(), 'inline-gate-mode-'));
    registry = new TemporaryGateRegistry(logger as never);
    const prompt = loadPromptWithInlineGate(dir, gateId, modeLine);
    const context = {
      state: { gates: {} },
      mcpRequest: {},
      getSessionId: () => 'session-1',
    };
    const registrar = new TemporaryGateRegistrar(registry, undefined, logger as never);

    const ids = registrar.registerInlineGateDefinitions(context as never, [prompt], true);
    registered.push(...ids);
    const provider = new GateManagerProvider({} as IGateManager, registry);
    const gate = await provider.loadGate(gateId);

    const stepEnforcement = {
      declared: new Map([[gateId, gate?.enforcementMode]] as const),
      undeclared: 'blocking' as const,
    };
    return { ids, gate, mode: resolveEnforcementMode(undefined, stepEnforcement, [gateId]) };
  }

  test('a declared advisory mode resolves as advisory', async () => {
    const { ids, gate, mode } = await resolveTwin('inline-advisory', 'enforcement_mode: advisory');

    // Positive control: the gate registered and reads back, so the mode below is its own.
    expect(ids).toEqual(['inline-advisory']);
    expect(gate?.name).toBe('Inline Gate');
    expect(gate?.enforcementMode).toBe('advisory');
    expect(mode).toBe('advisory');
  });

  test('the twin with no mode falls back to the undeclared default', async () => {
    const { ids, gate, mode } = await resolveTwin('inline-undeclared', undefined);

    expect(ids).toEqual(['inline-undeclared']);
    expect(gate?.name).toBe('Inline Gate');
    expect(gate).not.toHaveProperty('enforcementMode');
    // A temporary gate declares no severity or gate_type either: nothing derives a mode from them.
    expect(gate).not.toHaveProperty('severity');
    expect(mode).toBe('blocking');
  });

  test('an unknown mode refuses the prompt at load, naming the key', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'inline-gate-mode-'));
    registry = new TemporaryGateRegistry(logger as never);
    logger.error.mockClear();
    logger.warn.mockClear();

    expect(() =>
      loadPromptWithInlineGate(dir, 'inline-typo', 'enforcement_mode: advisorry')
    ).toThrow();
    const logged = [...logger.error.mock.calls, ...logger.warn.mock.calls].flat().map(String);
    expect(logged.join('\n')).toContain('enforcement_mode');
  });
});
