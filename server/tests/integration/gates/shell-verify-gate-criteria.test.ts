/**
 * Integration tests for shell_verify as GatePassCriteria type.
 *
 * Tests the GateValidator's ability to execute shell_verify criteria
 * as part of the unified gate system (Phase 2 integration).
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';

import { GateValidator, createGateValidator } from '../../../src/gates/core/gate-validator.js';
import type { GateDefinitionProvider } from '../../../src/gates/core/gate-loader.js';
import type { LightweightGateDefinition, ValidationContext, GatePassCriteria } from '../../../src/gates/types.js';
import type { Logger } from '../../../src/logging/index.js';

describe('Shell Verify Gate Criteria Integration', () => {
  let mockLogger: Logger;
  let validator: GateValidator;

  // Mock gate loader that returns gates with shell_verify criteria
  const createMockLoader = (gates: Record<string, LightweightGateDefinition>): GateDefinitionProvider => ({
    loadGate: jest.fn(async (id: string) => gates[id] ?? null),
    discoverGates: jest.fn(async () => Object.keys(gates)),
    getLoadedGates: jest.fn(() => Object.values(gates)),
    reload: jest.fn(async () => {}),
    isLoaded: jest.fn((id: string) => id in gates),
    getCacheStats: jest.fn(() => ({ hits: 0, misses: 0, size: Object.keys(gates).length })),
  } as unknown as GateDefinitionProvider);

  beforeEach(() => {
    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };
  });

  describe('shell_verify criteria execution', () => {
    test('passes when shell command exits with code 0', async () => {
      const testGate: LightweightGateDefinition = {
        id: 'test-shell-gate',
        name: 'Test Shell Gate',
        type: 'validation',
        description: 'Test gate with shell verification',
        pass_criteria: [
          {
            type: 'shell_verify',
            shell_command: 'echo "test passed"',
            shell_timeout: 5000,
          },
        ],
      };

      const loader = createMockLoader({ 'test-shell-gate': testGate });
      validator = createGateValidator(mockLogger, loader);

      const context: ValidationContext = {
        content: 'test content',
      };

      const result = await validator.validateGate('test-shell-gate', context);

      expect(result).not.toBeNull();
      expect(result?.passed).toBe(true);
      expect(result?.checks).toHaveLength(1);
      expect(result?.checks?.[0]?.type).toBe('shell_verify');
      expect(result?.checks?.[0]?.passed).toBe(true);
    });

    test('fails when shell command exits with non-zero code', async () => {
      const testGate: LightweightGateDefinition = {
        id: 'failing-shell-gate',
        name: 'Failing Shell Gate',
        type: 'validation',
        description: 'Test gate with failing shell verification',
        pass_criteria: [
          {
            type: 'shell_verify',
            shell_command: 'exit 1',
            shell_timeout: 5000,
          },
        ],
      };

      const loader = createMockLoader({ 'failing-shell-gate': testGate });
      validator = createGateValidator(mockLogger, loader);

      const context: ValidationContext = {
        content: 'test content',
      };

      const result = await validator.validateGate('failing-shell-gate', context);

      expect(result).not.toBeNull();
      expect(result?.passed).toBe(false);
      expect(result?.checks).toHaveLength(1);
      expect(result?.checks?.[0]?.type).toBe('shell_verify');
      expect(result?.checks?.[0]?.passed).toBe(false);
      expect(result?.checks?.[0]?.details?.exitCode).toBe(1);
    });

    test('auto-passes when no shell_command is specified', async () => {
      const testGate: LightweightGateDefinition = {
        id: 'missing-command-gate',
        name: 'Missing Command Gate',
        type: 'validation',
        description: 'Test gate with missing shell command',
        pass_criteria: [
          {
            type: 'shell_verify',
            // No shell_command specified
          },
        ],
      };

      const loader = createMockLoader({ 'missing-command-gate': testGate });
      validator = createGateValidator(mockLogger, loader);

      const context: ValidationContext = {
        content: 'test content',
      };

      const result = await validator.validateGate('missing-command-gate', context);

      expect(result).not.toBeNull();
      expect(result?.passed).toBe(true);
      expect(result?.checks?.[0]?.details?.skipped).toBe(true);
    });

    test('applies preset values for shell verification', async () => {
      const testGate: LightweightGateDefinition = {
        id: 'preset-gate',
        name: 'Preset Gate',
        type: 'validation',
        description: 'Test gate with preset',
        pass_criteria: [
          {
            type: 'shell_verify',
            shell_command: 'echo "preset test"',
            shell_preset: 'fast',
          },
        ],
      };

      const loader = createMockLoader({ 'preset-gate': testGate });
      validator = createGateValidator(mockLogger, loader);

      const context: ValidationContext = {
        content: 'test content',
      };

      const result = await validator.validateGate('preset-gate', context);

      expect(result).not.toBeNull();
      expect(result?.passed).toBe(true);
    });

    test('captures stdout from successful command', async () => {
      const testGate: LightweightGateDefinition = {
        id: 'output-gate',
        name: 'Output Gate',
        type: 'validation',
        description: 'Test gate that captures output',
        pass_criteria: [
          {
            type: 'shell_verify',
            shell_command: 'echo "hello from shell"',
            shell_timeout: 5000,
          },
        ],
      };

      const loader = createMockLoader({ 'output-gate': testGate });
      validator = createGateValidator(mockLogger, loader);

      const context: ValidationContext = {
        content: 'test content',
      };

      const result = await validator.validateGate('output-gate', context);

      expect(result).not.toBeNull();
      expect(result?.passed).toBe(true);
      expect(result?.checks?.[0]?.details?.stdout).toContain('hello from shell');
    });

    test('captures stderr from failing command', async () => {
      const testGate: LightweightGateDefinition = {
        id: 'stderr-gate',
        name: 'Stderr Gate',
        type: 'validation',
        description: 'Test gate that captures stderr',
        pass_criteria: [
          {
            type: 'shell_verify',
            shell_command: 'echo "error output" >&2 && exit 1',
            shell_timeout: 5000,
          },
        ],
      };

      const loader = createMockLoader({ 'stderr-gate': testGate });
      validator = createGateValidator(mockLogger, loader);

      const context: ValidationContext = {
        content: 'test content',
      };

      const result = await validator.validateGate('stderr-gate', context);

      expect(result).not.toBeNull();
      expect(result?.passed).toBe(false);
      expect(result?.checks?.[0]?.details?.stderr).toContain('error output');
    });
  });

  describe('mixed criteria types', () => {
    test('validates gate with both shell_verify and other criteria', async () => {
      const testGate: LightweightGateDefinition = {
        id: 'mixed-gate',
        name: 'Mixed Gate',
        type: 'validation',
        description: 'Test gate with mixed criteria types',
        pass_criteria: [
          {
            type: 'shell_verify',
            shell_command: 'echo "shell check passed"',
            shell_timeout: 5000,
          },
          {
            type: 'content_check',
            min_length: 5,
          },
        ],
      };

      const loader = createMockLoader({ 'mixed-gate': testGate });
      validator = createGateValidator(mockLogger, loader);

      const context: ValidationContext = {
        content: 'test content that is long enough',
      };

      const result = await validator.validateGate('mixed-gate', context);

      expect(result).not.toBeNull();
      expect(result?.passed).toBe(true);
      expect(result?.checks).toHaveLength(2);

      // Shell verify should pass
      const shellCheck = result?.checks?.find(c => c.type === 'shell_verify');
      expect(shellCheck?.passed).toBe(true);

      // Content check auto-passes (string-based validation removed)
      const contentCheck = result?.checks?.find(c => c.type === 'content_check');
      expect(contentCheck?.passed).toBe(true);
    });

    test('fails if shell_verify fails in mixed criteria', async () => {
      const testGate: LightweightGateDefinition = {
        id: 'mixed-fail-gate',
        name: 'Mixed Fail Gate',
        type: 'validation',
        description: 'Test gate where shell verify fails',
        pass_criteria: [
          {
            type: 'shell_verify',
            shell_command: 'exit 1',
            shell_timeout: 5000,
          },
          {
            type: 'content_check',
            min_length: 5,
          },
        ],
      };

      const loader = createMockLoader({ 'mixed-fail-gate': testGate });
      validator = createGateValidator(mockLogger, loader);

      const context: ValidationContext = {
        content: 'test content',
      };

      const result = await validator.validateGate('mixed-fail-gate', context);

      expect(result).not.toBeNull();
      expect(result?.passed).toBe(false);

      // Shell verify should fail
      const shellCheck = result?.checks?.find(c => c.type === 'shell_verify');
      expect(shellCheck?.passed).toBe(false);
    });
  });

  describe('gate statistics', () => {
    test('tracks shell verification in statistics', async () => {
      const testGate: LightweightGateDefinition = {
        id: 'stats-gate',
        name: 'Stats Gate',
        type: 'validation',
        description: 'Test gate for statistics tracking',
        pass_criteria: [
          {
            type: 'shell_verify',
            shell_command: 'echo "stats test"',
            shell_timeout: 5000,
          },
        ],
      };

      const loader = createMockLoader({ 'stats-gate': testGate });
      validator = createGateValidator(mockLogger, loader);

      // Reset statistics
      validator.resetStatistics();

      const context: ValidationContext = {
        content: 'test content',
      };

      // Run validation multiple times
      await validator.validateGates(['stats-gate'], context);
      await validator.validateGates(['stats-gate'], context);

      const stats = validator.getStatistics();
      expect(stats.totalValidations).toBe(2);
      expect(stats.successfulValidations).toBe(2);
    });
  });
});
