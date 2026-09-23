/**
 * P4.133 / P4.140 — the provider the live server reviews through carries what the gate file says.
 *
 * Two classes hand the pipeline a `LightweightGateDefinition`: `GateLoader` (what the P4.121
 * wiring test drives) and `GateManagerProvider` (what `PromptExecutor` wires into every stage).
 * Each used to hold its own conversion map, and the provider's drifted twice: it dropped
 * `evaluation` (every `mode: judge` gate reviewed as `self`) and then `sourceRoot` (a script
 * shipped beside `gate.yaml` resolved against the server's working directory). Both now call
 * `toGateDefinition`, so this file is a single-implementation guard: fed the SAME parsed
 * definitions, the two classes must produce byte-identical output — for every bundled gate and
 * for a fixture with every optional key populated plus an undeclared one. A provider that grows
 * its own map again fails here on the first key it spells differently.
 *
 * Classification: Unit. Real loader + real converters; the gate manager is a one-method stub.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { GateDefinitionLoader } from '../../../../src/engine/gates/core/gate-definition-loader.js';
import { GateLoader } from '../../../../src/engine/gates/core/gate-loader.js';
import { GateManagerProvider } from '../../../../src/engine/gates/registry/gate-provider-adapter.js';

import type { IGateManager } from '../../../../src/engine/gates/types.js';

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

const FULL_GATE_YAML = [
  'id: full-gate',
  'name: Full Gate',
  'type: validation',
  'description: every optional key populated',
  'subject: output',
  'severity: high',
  'enforcementMode: blocking',
  'guidance: FULL-GUIDANCE',
  'gate_type: custom',
  'pass_criteria:',
  '  - type: inline_guidance',
  'retry_config:',
  '  max_attempts: 4',
  'activation:',
  '  explicit_request: true',
  'evaluation:',
  '  mode: judge',
  '  model: haiku-full',
  '  strict: false',
  'blockResponseOnFail: true',
  'planted_extra: PLANTED',
  '',
].join('\n');

function providerOver(definitions: GateDefinitionLoader): GateManagerProvider {
  const gateManager = {
    get: (id: string) => {
      const definition = definitions.loadGate(id);
      return definition === undefined ? undefined : { getDefinition: () => definition };
    },
  } as unknown as IGateManager;
  return new GateManagerProvider(gateManager);
}

describe('GateManagerProvider carries the gate file (P4.133)', () => {
  let gatesDir: string;

  beforeEach(async () => {
    gatesDir = await mkdtemp(path.join(tmpdir(), 'cpm-provider-parity-'));
    await mkdir(path.join(gatesDir, 'full-gate'), { recursive: true });
    await writeFile(path.join(gatesDir, 'full-gate', 'gate.yaml'), FULL_GATE_YAML, 'utf8');
  });

  afterEach(async () => {
    await rm(gatesDir, { recursive: true, force: true });
  });

  test('a judge gate reaches the pipeline as a judge gate', async () => {
    const provider = providerOver(new GateDefinitionLoader({ gatesDir }));

    const gate = await provider.loadGate('full-gate');

    expect(gate?.evaluation).toEqual({ mode: 'judge', model: 'haiku-full', strict: false });
  });

  test('both classes produce byte-identical definitions from one parsed gate', async () => {
    const fromLoader = await new GateLoader(logger as never, gatesDir).loadGate('full-gate');
    const fromProvider = await providerOver(new GateDefinitionLoader({ gatesDir })).loadGate(
      'full-gate'
    );

    // Positive control: the loader side is populated, so a key missing on either side is a
    // real gap and not an empty fixture.
    expect(fromLoader?.evaluation?.mode).toBe('judge');
    expect(fromLoader?.sourceRoot).toBe(gatesDir);
    expect(fromLoader?.blockResponseOnFail).toBe(true);

    expect(JSON.stringify(fromProvider)).toBe(JSON.stringify(fromLoader));
  });

  test('every bundled gate converts identically through both classes', async () => {
    // Named explicitly: the default resolution honours MCP_RESOURCES_PATH, which a developer
    // shell may export, and this case is about what the package ships.
    const bundledDir = path.resolve(
      fileURLToPath(import.meta.url),
      '../../../../../resources/gates'
    );
    const definitions = new GateDefinitionLoader({ gatesDir: bundledDir });
    const ids = [...definitions.loadAllGates().keys()].sort();
    // Positive control: the bundle was found, so an empty comparison cannot pass vacuously.
    expect(ids.length).toBeGreaterThan(5);

    const loader = new GateLoader(logger as never, bundledDir);
    const provider = providerOver(definitions);
    for (const id of ids) {
      const fromLoader = await loader.loadGate(id);
      const fromProvider = await provider.loadGate(id);
      expect(fromLoader?.id).toBe(id);
      expect({ id, json: JSON.stringify(fromProvider) }).toEqual({
        id,
        json: JSON.stringify(fromLoader),
      });
    }
  });
});
