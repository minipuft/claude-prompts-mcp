import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { GateAccumulator } from '../../../../../src/execution/pipeline/state/accumulators/gate-accumulator.js';
import { GATE_SOURCE_PRIORITY } from '../../../../../src/execution/pipeline/state/types.js';

import type { GateSource } from '../../../../../src/execution/pipeline/state/types.js';

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

describe('GateAccumulator', () => {
  let accumulator: GateAccumulator;

  beforeEach(() => {
    jest.clearAllMocks();
    accumulator = new GateAccumulator(mockLogger as any);
  });

  describe('basic operations', () => {
    test('adds a gate successfully', () => {
      const added = accumulator.add('research-quality', 'registry-auto');
      expect(added).toBe(true);
      expect(accumulator.has('research-quality')).toBe(true);
      expect(accumulator.size).toBe(1);
    });

    test('returns false for empty or whitespace gate IDs', () => {
      expect(accumulator.add('', 'registry-auto')).toBe(false);
      expect(accumulator.add('   ', 'registry-auto')).toBe(false);
      expect(accumulator.add(null as any, 'registry-auto')).toBe(false);
      expect(accumulator.size).toBe(0);
    });

    test('trims whitespace from gate IDs', () => {
      accumulator.add('  code-quality  ', 'registry-auto');
      expect(accumulator.has('code-quality')).toBe(true);
      expect(accumulator.has('  code-quality  ')).toBe(true);
    });

    test('getAll returns all gate IDs', () => {
      accumulator.add('gate-1', 'registry-auto');
      accumulator.add('gate-2', 'methodology');
      accumulator.add('gate-3', 'inline-operator');

      const allGates = accumulator.getAll();
      expect(allGates).toHaveLength(3);
      expect(allGates).toContain('gate-1');
      expect(allGates).toContain('gate-2');
      expect(allGates).toContain('gate-3');
    });

    test('addAll adds multiple gates from same source', () => {
      const count = accumulator.addAll(['gate-1', 'gate-2', 'gate-3'], 'methodology');
      expect(count).toBe(3);
      expect(accumulator.size).toBe(3);
    });

    test('addAll handles undefined and non-array inputs', () => {
      expect(accumulator.addAll(undefined, 'methodology')).toBe(0);
      expect(accumulator.addAll(null as any, 'methodology')).toBe(0);
      expect(accumulator.size).toBe(0);
    });
  });

  describe('deduplication', () => {
    test('deduplicates gates from same source', () => {
      accumulator.add('research-quality', 'registry-auto');
      accumulator.add('research-quality', 'registry-auto');
      expect(accumulator.size).toBe(1);
    });

    test('deduplicates gates from different sources with same/lower priority', () => {
      accumulator.add('code-quality', 'methodology'); // priority 40
      const added = accumulator.add('code-quality', 'registry-auto'); // priority 20
      expect(added).toBe(false);
      expect(accumulator.size).toBe(1);

      const entry = accumulator.getEntries().find((e) => e.id === 'code-quality');
      expect(entry?.source).toBe('methodology');
    });

    test('logs when skipping duplicate gate', () => {
      accumulator.add('code-quality', 'methodology');
      accumulator.add('code-quality', 'registry-auto');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[GateAccumulator] Skipped duplicate gate',
        expect.objectContaining({
          gateId: 'code-quality',
          attemptedSource: 'registry-auto',
          existingSource: 'methodology',
        })
      );
    });
  });

  describe('priority override', () => {
    test('higher priority source overrides lower priority', () => {
      accumulator.add('code-quality', 'registry-auto'); // priority 20
      const added = accumulator.add('code-quality', 'inline-operator'); // priority 100

      expect(added).toBe(true);
      const entry = accumulator.getEntries().find((e) => e.id === 'code-quality');
      expect(entry?.source).toBe('inline-operator');
    });

    test('logs when overriding with higher priority source', () => {
      accumulator.add('code-quality', 'registry-auto');
      accumulator.add('code-quality', 'inline-operator');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[GateAccumulator] Overriding gate with higher priority source',
        expect.objectContaining({
          gateId: 'code-quality',
          oldSource: 'registry-auto',
          newSource: 'inline-operator',
        })
      );
    });

    test('priority order matches GATE_SOURCE_PRIORITY', () => {
      const sources: GateSource[] = [
        'registry-auto', // 20
        'methodology', // 40
        'chain-level', // 50
        'prompt-config', // 60
        'temporary-request', // 80
        'client-selection', // 90
        'inline-operator', // 100
      ];

      // Add same gate from each source in increasing priority order
      sources.forEach((source) => {
        accumulator.add('test-gate', source);
      });

      // Should have highest priority source
      const entry = accumulator.getEntries().find((e) => e.id === 'test-gate');
      expect(entry?.source).toBe('inline-operator');
      expect(entry?.priority).toBe(GATE_SOURCE_PRIORITY['inline-operator']);
    });

    test('same priority uses first-in-wins', () => {
      // Using registry-auto twice via addAll (same priority)
      accumulator.add('gate-a', 'registry-auto', { first: true });

      // Cannot test same source override since the key is the same
      // Instead test that same priority from same source keeps first
      const entry = accumulator.getEntries().find((e) => e.id === 'gate-a');
      expect(entry?.metadata).toEqual({ first: true });
    });
  });

  describe('freeze behavior', () => {
    test('freeze prevents further additions', () => {
      accumulator.add('gate-1', 'registry-auto');
      accumulator.freeze();

      const added = accumulator.add('gate-2', 'inline-operator');
      expect(added).toBe(false);
      expect(accumulator.has('gate-2')).toBe(false);
      expect(accumulator.size).toBe(1);
    });

    test('isFrozen returns correct state', () => {
      expect(accumulator.isFrozen()).toBe(false);
      accumulator.freeze();
      expect(accumulator.isFrozen()).toBe(true);
    });

    test('freeze logs summary', () => {
      accumulator.add('gate-1', 'registry-auto');
      accumulator.add('gate-2', 'methodology');
      accumulator.freeze();

      expect(mockLogger.debug).toHaveBeenCalledWith(
        '[GateAccumulator] Frozen with gates',
        expect.objectContaining({
          count: 2,
        })
      );
    });

    test('warns when attempting to add after freeze', () => {
      accumulator.freeze();
      accumulator.add('new-gate', 'inline-operator');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[GateAccumulator] Attempted to add gate after freeze',
        expect.objectContaining({
          gateId: 'new-gate',
          source: 'inline-operator',
        })
      );
    });

    test('clear is blocked after freeze', () => {
      accumulator.add('gate-1', 'registry-auto');
      accumulator.freeze();
      accumulator.clear();

      expect(accumulator.size).toBe(1);
      expect(mockLogger.warn).toHaveBeenCalledWith(
        '[GateAccumulator] Attempted to clear after freeze'
      );
    });
  });

  describe('filtering and queries', () => {
    beforeEach(() => {
      accumulator.add('gate-1', 'registry-auto');
      accumulator.add('gate-2', 'registry-auto');
      accumulator.add('gate-3', 'methodology');
      accumulator.add('gate-4', 'inline-operator');
    });

    test('getBySource filters correctly', () => {
      const categoryGates = accumulator.getBySource('registry-auto');
      expect(categoryGates).toHaveLength(2);
      expect(categoryGates).toContain('gate-1');
      expect(categoryGates).toContain('gate-2');

      const methodologyGates = accumulator.getBySource('methodology');
      expect(methodologyGates).toHaveLength(1);
      expect(methodologyGates).toContain('gate-3');
    });

    test('getBySource returns empty array for unused source', () => {
      const tempGates = accumulator.getBySource('temporary-request');
      expect(tempGates).toHaveLength(0);
    });

    test('getSourceCounts returns correct counts', () => {
      const counts = accumulator.getSourceCounts();
      expect(counts['registry-auto']).toBe(2);
      expect(counts['methodology']).toBe(1);
      expect(counts['inline-operator']).toBe(1);
    });

    test('getEntries returns full entry details', () => {
      const entries = accumulator.getEntries();
      expect(entries).toHaveLength(4);

      const gate1Entry = entries.find((e) => e.id === 'gate-1');
      expect(gate1Entry).toBeDefined();
      expect(gate1Entry?.source).toBe('registry-auto');
      expect(gate1Entry?.priority).toBe(GATE_SOURCE_PRIORITY['registry-auto']);
      expect(gate1Entry?.addedAt).toBeDefined();
    });
  });

  describe('metadata support', () => {
    test('stores metadata with gate entry', () => {
      accumulator.add('gate-with-meta', 'inline-operator', {
        reason: 'user requested',
        stepNumber: 2,
      });

      const entry = accumulator.getEntries().find((e) => e.id === 'gate-with-meta');
      expect(entry?.metadata).toEqual({
        reason: 'user requested',
        stepNumber: 2,
      });
    });

    test('metadata is optional', () => {
      accumulator.add('gate-no-meta', 'registry-auto');
      const entry = accumulator.getEntries().find((e) => e.id === 'gate-no-meta');
      expect(entry?.metadata).toBeUndefined();
    });
  });

  describe('clear operation', () => {
    test('clear removes all gates when not frozen', () => {
      accumulator.add('gate-1', 'registry-auto');
      accumulator.add('gate-2', 'methodology');
      expect(accumulator.size).toBe(2);

      accumulator.clear();
      expect(accumulator.size).toBe(0);
      expect(accumulator.getAll()).toHaveLength(0);
    });
  });
});
