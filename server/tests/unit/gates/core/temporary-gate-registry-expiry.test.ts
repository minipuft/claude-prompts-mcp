// @lifecycle test - A temporary gate expires by its own `expires_at`; a scope carries no expiry (P6.173).
import { afterEach, describe, expect, jest, test } from '@jest/globals';

import { TemporaryGateRegistry } from '../../../../src/engine/gates/core/temporary-gate-registry.js';

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const gate = (id: string, expires_at?: number) => ({
  id,
  name: id,
  type: 'validation' as const,
  scope: 'chain' as const,
  description: id,
  guidance: id,
  source: 'manual' as const,
  ...(expires_at !== undefined ? { expires_at } : {}),
});

describe('TemporaryGateRegistry expiry', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('cleanupExpiredGates removes a gate whose own expiry passed, and leaves its scope sibling', () => {
    const registry = new TemporaryGateRegistry(createLogger() as never);
    const start = Date.now();
    const timed = registry.createTemporaryGate(gate('timed', start + 1_000), 'run-a');
    const kept = registry.createTemporaryGate(gate('kept', start + 60_000), 'run-a');

    jest.spyOn(Date, 'now').mockReturnValue(start + 2_000);

    expect(registry.cleanupExpiredGates()).toBe(1);
    expect(registry.getTemporaryGate(timed)).toBeUndefined();
    expect(registry.getTemporaryGatesForScope('chain', 'run-a').map((g) => g.id)).toEqual([kept]);
  });
});
