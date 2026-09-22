/**
 * P4.133 — the provider the live server reviews through carries what the gate file says.
 *
 * Two classes turn a parsed `gate.yaml` into the `LightweightGateDefinition` the pipeline reads:
 * `GateLoader` (what the P4.121 wiring test drives) and `GateManagerProvider` (what
 * `PromptExecutor` wires into every stage). The provider dropped `evaluation`, so every
 * `mode: judge` gate the running server loaded was reviewed as `self`, while the test that
 * proved judge routing went through the other class and stayed green.
 *
 * The parity case below is the check that fails when a new key lands in one converter and not
 * the other: both are fed the SAME parsed definition, with every optional key populated.
 *
 * Classification: Unit. Real loader + real converters; the gate manager is a one-method stub.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { GateDefinitionLoader } from '../../../../src/engine/gates/core/gate-definition-loader.js';
import { GateLoader } from '../../../../src/engine/gates/core/gate-loader.js';
import { GateManagerProvider } from '../../../../src/engine/gates/registry/gate-provider-adapter.js';

import type { IGateManager } from '../../../../src/engine/gates/types.js';

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

/**
 * Keys `GateLoader` carries and the provider does not, each a known open divergence.
 * `sourceRoot` (as of 2026-09-22 · flips when `GateManagerProvider.toLightweight` carries it):
 * without it a `shell_verify` script shipped beside `gate.yaml` cannot be resolved on the live
 * path. Reported, not fixed, by the P4.133 worker. The assertion is exact, so fixing it fails
 * this test until the entry is deleted.
 */
const KNOWN_PROVIDER_GAPS = ['sourceRoot'];

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

  test('both converters carry the same keys from one parsed definition', async () => {
    const fromLoader = await new GateLoader(logger as never, gatesDir).loadGate('full-gate');
    const fromProvider = await providerOver(new GateDefinitionLoader({ gatesDir })).loadGate(
      'full-gate'
    );

    // Positive control: the loader side is populated, so a missing key is a real gap.
    expect(fromLoader?.evaluation?.mode).toBe('judge');

    const loaderKeys = Object.keys(fromLoader ?? {}).sort();
    const providerKeys = Object.keys(fromProvider ?? {}).sort();
    expect(loaderKeys.filter((key) => !providerKeys.includes(key))).toEqual(KNOWN_PROVIDER_GAPS);
    expect(providerKeys.filter((key) => !loaderKeys.includes(key))).toEqual([]);
  });
});
