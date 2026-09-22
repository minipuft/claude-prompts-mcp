import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, test, expect, jest } from '@jest/globals';

import { GateLoader } from '../../../../src/engine/gates/core/gate-loader.js';

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

describe('GateLoader temporary gate integration', () => {
  test('returns temporary gate when available in registry', async () => {
    const tempGate = {
      id: 'temp_gate_',
      name: 'Inline Criteria',
      type: 'validation',
      description: 'Inline gate',
      guidance: 'Check inline criteria',
    } as any;

    const temporaryGateRegistry = {
      getTemporaryGate: jest.fn(() => ({ id: 'temp_gate_' })),
      convertToLightweightGate: jest.fn(() => tempGate),
    } as any;

    const gateLoader = new GateLoader(mockLogger as any, undefined, temporaryGateRegistry);
    const result = await gateLoader.loadGate('temp_gate_');

    expect(temporaryGateRegistry.getTemporaryGate).toHaveBeenCalledWith('temp_gate_');
    expect(temporaryGateRegistry.convertToLightweightGate).toHaveBeenCalled();
    expect(result).toEqual(tempGate);
  });
});

describe('GateLoader provenance (P4.105)', () => {
  let gatesDir: string;

  beforeEach(async () => {
    gatesDir = await mkdtemp(path.join(tmpdir(), 'gate-loader-provenance-'));
    await mkdir(path.join(gatesDir, 'shipped'), { recursive: true });
    await writeFile(
      path.join(gatesDir, 'shipped', 'gate.yaml'),
      [
        'id: shipped',
        'name: Shipped',
        'type: validation',
        'description: runs a script that ships with it',
        'pass_criteria:',
        '  - type: shell_verify',
        "    shell_command: ['node', 'check.js']",
        '',
      ].join('\n'),
      'utf8'
    );
    await writeFile(path.join(gatesDir, 'shipped', 'check.js'), 'process.exit(0)\n', 'utf8');
  });

  afterEach(async () => {
    await rm(gatesDir, { recursive: true, force: true });
  });

  // The runner resolves a gate-shipped script against `{sourceRoot}/{id}`, so the lightweight
  // shape the pipeline actually receives has to carry the root. Asserted through the real loader
  // rather than a hand-built gate object: a test that supplies `sourceRoot` itself cannot tell
  // whether anything ever sets it.
  test('a loaded gate carries the root it was served from', async () => {
    const loader = new GateLoader(mockLogger as any, gatesDir);

    const gate = await loader.loadGate('shipped');

    expect(gate?.sourceRoot).toBe(gatesDir);
  });
});
