/**
 * P4.137 — a gate's declared `enforcementMode` reaches the enforcement decision on every path.
 *
 * The mode travels loader → guide → provider → `resolveEnforcementMode`, and a guide is built on
 * two paths: the registry's startup load and the hot-reload coordinator, which runs the first
 * time the gate's file changes on disk (every `resource_manager` create or update). The
 * coordinator used to rebuild the definition by hand and wrote `'informational'` for a gate that
 * declared nothing — after one edit, an undeclared gate stopped holding the run.
 *
 * Each walk below is fed one gate file per declared mode, plus one that declares none, and must
 * carry the file's value unchanged through every hop. `undefined` is a value here: an undeclared
 * gate has to reach the resolver as undeclared, so the resolver can apply the run's default.
 *
 * Classification: Unit. Real loader, real guide factory, real coordinator, real provider; the
 * registry and the gate manager are one-method stubs.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { resolveEnforcementMode } from '../../../../src/engine/execution/pipeline/decisions/index.js';
import { GateDefinitionLoader } from '../../../../src/engine/gates/core/gate-definition-loader.js';
import { GateLoader } from '../../../../src/engine/gates/core/gate-loader.js';
import { GateHotReloadCoordinator } from '../../../../src/engine/gates/hot-reload/gate-hot-reload.js';
import { GateManagerProvider } from '../../../../src/engine/gates/registry/gate-provider-adapter.js';
import { createGenericGateGuide } from '../../../../src/engine/gates/registry/generic-gate-guide.js';

import type { GateGuide } from '../../../../src/engine/gates/types/index.js';
import type { IGateManager } from '../../../../src/engine/gates/types.js';

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

type Mode = 'blocking' | 'advisory' | 'informational';
const DECLARED: ReadonlyArray<readonly [string, Mode | undefined]> = [
  ['gate-blocking', 'blocking'],
  ['gate-advisory', 'advisory'],
  ['gate-informational', 'informational'],
  ['gate-undeclared', undefined],
];

const gateYaml = (id: string, mode: Mode | undefined): string =>
  [
    `id: ${id}`,
    `name: ${id}`,
    'type: validation',
    `description: declares ${mode ?? 'no mode'}`,
    'severity: high',
    ...(mode === undefined ? [] : [`enforcementMode: ${mode}`]),
    `guidance: GUIDANCE-${id}`,
    'evaluation:',
    '  mode: judge',
    '  model: haiku-walk',
    '',
  ].join('\n');

const providerOver = (guides: Map<string, GateGuide>): GateManagerProvider =>
  new GateManagerProvider({ get: (id: string) => guides.get(id) } as unknown as IGateManager);

/** The guide the hot-reload coordinator registers for `id` after its file changes. */
async function hotReloadedGuide(gatesDir: string, id: string): Promise<GateGuide> {
  let registered: GateGuide | undefined;
  const registry = {
    registerGuide: jest.fn(async (guide: GateGuide) => {
      registered = guide;
      return true;
    }),
  };
  const coordinator = new GateHotReloadCoordinator(
    logger as never,
    registry as never,
    new GateDefinitionLoader({ gatesDir })
  );
  await coordinator.handleGateChange({
    type: 'gate_changed',
    reason: 'file modified',
    affectedFiles: [path.join(gatesDir, id, 'gate.yaml')],
    gateId: id,
    changeType: 'modified',
    timestamp: Date.now(),
    requiresFullReload: false,
  });
  if (registered === undefined) throw new Error(`hot reload registered no guide for ${id}`);
  return registered;
}

describe('a gate declared enforcementMode reaches the resolver unchanged (P4.137)', () => {
  let gatesDir: string;

  beforeEach(async () => {
    gatesDir = await mkdtemp(path.join(tmpdir(), 'cpm-declared-mode-'));
    for (const [id, mode] of DECLARED) {
      await mkdir(path.join(gatesDir, id), { recursive: true });
      await writeFile(path.join(gatesDir, id, 'gate.yaml'), gateYaml(id, mode), 'utf8');
    }
  });

  afterEach(async () => {
    await rm(gatesDir, { recursive: true, force: true });
  });

  test.each(DECLARED)(
    '%s: loader, startup guide, hot-reloaded guide, provider',
    async (id, mode) => {
      const definitions = new GateDefinitionLoader({ gatesDir });
      const loaded = definitions.loadGate(id);
      // Positive control: the file parsed, so an `undefined` mode below is the file's, not a miss.
      expect(loaded?.guidance).toBe(`GUIDANCE-${id}`);
      expect(loaded?.enforcementMode).toBe(mode);

      const fromLoader = await new GateLoader(logger as never, gatesDir).loadGate(id);
      expect(fromLoader?.enforcementMode).toBe(mode);

      const startup = createGenericGateGuide(loaded!);
      const reloaded = await hotReloadedGuide(gatesDir, id);
      for (const guide of [startup, reloaded]) {
        const provided = await providerOver(new Map([[id, guide]])).loadGate(id);
        expect(provided?.enforcementMode).toBe(mode);
        expect(
          resolveEnforcementMode(undefined, {
            declared: new Map([[id, provided?.enforcementMode]]),
            undeclared: 'blocking',
          })
        ).toBe(mode ?? 'blocking');
      }
    }
  );

  test('the hot-reloaded guide holds the definition the loader parsed, key for key', async () => {
    const [id] = DECLARED[1]!;
    const loaded = new GateDefinitionLoader({ gatesDir }).loadGate(id);
    const reloaded = await hotReloadedGuide(gatesDir, id);

    // Positive control: `evaluation` is a key the old hand-copy dropped.
    expect(loaded?.evaluation?.mode).toBe('judge');
    expect(reloaded.getDefinition()).toEqual(loaded);
  });
});
