import { describe, test, expect, jest } from '@jest/globals';

import { GateLoader } from '../../../../dist/gates/core/gate-loader.js';

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
