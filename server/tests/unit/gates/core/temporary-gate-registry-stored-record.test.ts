// @lifecycle test - A stored temporary gate keeps every field its definition declares (row 1.6).
import { describe, expect, jest, test } from '@jest/globals';

import {
  TemporaryGateRegistry,
  type TemporaryGateDefinition,
} from '../../../../src/engine/gates/core/temporary-gate-registry.js';

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

/**
 * Every field the interface declares, each set to a value nothing defaults to. `Required` makes a
 * new `TemporaryGateDefinition` field a type error here until the fixture carries it, so the round
 * trip below covers it the day it is added.
 */
const everyField: Required<Omit<TemporaryGateDefinition, 'created_at'>> = {
  id: 'stored-record',
  name: 'Stored record',
  type: 'guidance',
  scope: 'step',
  description: 'carries every declared field',
  guidance: 'keep every field',
  pass_criteria: [{ type: 'content_check', min_length: 3 }],
  expires_at: 4_102_444_800_000,
  source: 'analysis',
  context: { reason: 'round trip' },
  scope_id: 'run-stored',
  target_step_number: 2,
  target_step_id: 'node-2',
  apply_to_steps: [2, 3],
  enforcement_mode: 'advisory',
  origin: 'request',
  declared_key: 'declared-stored',
};

describe('TemporaryGateRegistry stored record', () => {
  test('a gate read back carries every field its definition declared', () => {
    const registry = new TemporaryGateRegistry(createLogger() as never);

    const gateId = registry.createTemporaryGate(everyField);

    expect(gateId).toBe(everyField.id);
    expect(registry.getTemporaryGate(gateId)).toEqual({
      ...everyField,
      created_at: expect.any(Number),
    });
  });
});
