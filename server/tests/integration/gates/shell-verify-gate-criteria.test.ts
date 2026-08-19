/**
 * Integration tests for shell_verify as GatePassCriteria type.
 *
 * Tests the GateValidator's ability to execute shell_verify criteria
 * as part of the unified gate system (Phase 2 integration).
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';

import {
  GateValidator,
  createGateValidator,
} from '../../../src/engine/gates/core/gate-validator.js';
import type { GateDefinitionProvider } from '../../../src/engine/gates/core/gate-loader.js';
import type {
  LightweightGateDefinition,
  ValidationContext,
  GatePassCriteria,
} from '../../../src/engine/gates/types.js';
import type { Logger } from '../../../src/infra/logging/index.js';

describe('Shell Verify Gate Criteria Integration', () => {
  let mockLogger: Logger;
  let validator: GateValidator;

  // Mock gate loader that returns gates with shell_verify criteria
  const createMockLoader = (
    gates: Record<string, LightweightGateDefinition>
  ): GateDefinitionProvider =>
    ({
      loadGate: jest.fn(async (id: string) => gates[id] ?? null),
      discoverGates: jest.fn(async () => Object.keys(gates)),
      getLoadedGates: jest.fn(() => Object.values(gates)),
      reload: jest.fn(async () => {}),
      isLoaded: jest.fn((id: string) => id in gates),
      getCacheStats: jest.fn(() => ({ hits: 0, misses: 0, size: Object.keys(gates).length })),
    }) as unknown as GateDefinitionProvider;

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
            type: 'inline_guidance',
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
      const shellCheck = result?.checks?.find((c) => c.type === 'shell_verify');
      expect(shellCheck?.passed).toBe(true);

      // Content check auto-passes (string-based validation removed)
      const contentCheck = result?.checks?.find((c) => c.type === 'inline_guidance');
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
            type: 'inline_guidance',
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
      const shellCheck = result?.checks?.find((c) => c.type === 'shell_verify');
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

  /**
   * Retry hints survive the removal of the retry API.
   *
   * `shouldRetry` and `getRetryHints` were public methods with no callers, and deleting them is a
   * surface removal — but `generateRetryHints` is private, live, and reached from `validateGate`,
   * so hints are still produced and returned on every failing gate. Nothing asserted that before;
   * without it the deletion is unobserved, and a green suite would say nothing about whether the
   * surviving path still works.
   *
   * These pass identically before and after the removal. That invariance IS the property.
   */
  describe('retry hints on a failing gate', () => {
    const failingGate: LightweightGateDefinition = {
      id: 'hint-gate',
      name: 'Hint Gate',
      type: 'validation',
      description: 'Fails so the hint path runs',
      guidance: 'Keep the response structured and cite sources.',
      pass_criteria: [{ type: 'shell_verify', shell_command: 'exit 1', shell_timeout: 5000 }],
    };

    test('validateGate still returns hints when a gate fails', async () => {
      const loader = createMockLoader({ 'hint-gate': failingGate });
      validator = createGateValidator(mockLogger, loader);

      const result = await validator.validateGate('hint-gate', { content: 'anything' });

      expect(result?.passed).toBe(false);
      // The hints ship inside ValidationResult — this is the channel that survives, and the only
      // one that ever reached a caller.
      expect(result?.retryHints?.length).toBeGreaterThan(0);
      expect(result?.retryHints?.join('\n')).toContain('Keep the response structured');
    });

    test('a passing gate carries no hints', async () => {
      const loader = createMockLoader({
        'ok-gate': {
          ...failingGate,
          id: 'ok-gate',
          pass_criteria: [{ type: 'shell_verify', shell_command: 'exit 0', shell_timeout: 5000 }],
        },
      });
      validator = createGateValidator(mockLogger, loader);

      const result = await validator.validateGate('ok-gate', { content: 'anything' });

      expect(result?.passed).toBe(true);
      expect(result?.retryHints).toEqual([]);
    });
  });

  /**
   * `llm_self_check` is a reserved criteria type: declared in gate YAML (contract surface per
   * CLAUDE.md §Public API Contract) and documented as having no runner. It used to branch on
   * `config.analysis.semanticAnalysis.llmIntegration`, whose readers have all been retired —
   * so the branch is gone and the type keeps its documented behavior with no config input.
   *
   * These pin the decoupling as behavior, not just as a missing constructor argument: the
   * verdict must be identical no matter what a deployment's config once said, because the
   * validator can no longer be told anything about it.
   */
  describe('llm_self_check reserved criteria type', () => {
    const llmGate: LightweightGateDefinition = {
      id: 'reserved-llm-gate',
      name: 'Reserved LLM Gate',
      type: 'validation',
      description: 'Gate declaring the reserved llm_self_check type',
      pass_criteria: [{ type: 'llm_self_check', prompt_template: 'Assess depth' }],
    };

    test('still accepts a gate declaring the type', async () => {
      const loader = createMockLoader({ 'reserved-llm-gate': llmGate });
      validator = createGateValidator(mockLogger, loader);

      const result = await validator.validateGate('reserved-llm-gate', { content: 'anything' });

      // Deleting the type would break existing gate files; T0.5 chose to keep it and decouple
      // the stub instead, so a gate that declares it must still resolve rather than error.
      expect(result).not.toBeNull();
      expect(result?.checks).toHaveLength(1);
      expect(result?.checks?.[0]?.type).toBe('llm_self_check');
    });

    test('auto-passes so a reserved type cannot fail the gate that declares it', async () => {
      const loader = createMockLoader({ 'reserved-llm-gate': llmGate });
      validator = createGateValidator(mockLogger, loader);

      const result = await validator.validateGate('reserved-llm-gate', { content: 'anything' });

      expect(result?.passed).toBe(true);
      expect(result?.checks?.[0]?.passed).toBe(true);
      expect(result?.checks?.[0]?.details?.['skipped']).toBe(true);
    });

    test('points at the live replacement instead of a retired config key', async () => {
      const loader = createMockLoader({ 'reserved-llm-gate': llmGate });
      validator = createGateValidator(mockLogger, loader);

      const result = await validator.validateGate('reserved-llm-gate', { content: 'anything' });
      const check = result?.checks?.[0];

      // The old message told the reader to set
      // `analysis.semanticAnalysis.llmIntegration.enabled=true` — a key neither tool surface
      // accepts any more, so following the instruction now fails. The skip has to name something
      // a user can actually do.
      expect(check?.message).toContain('%judge');
      expect(check?.message).not.toContain('llmIntegration');
      expect(check?.details?.['configPath']).toBeUndefined();
    });

    test('takes no configuration input at all', async () => {
      // Structural half of the decoupling: the retired `llmConfig` parameter is gone from both
      // the factory and the constructor, so there is no longer a path by which config could
      // reach this verdict.
      //
      // Arity USED to carry that claim, back when the validator took exactly two arguments. It
      // stopped being able to once Tier 6 added a third — an injected script-tool runtime, which
      // has nothing to do with `llm_self_check`. A count cannot distinguish "the config argument
      // came back" from "some unrelated argument was added", so it would have failed here for a
      // change that does not touch what this test is about. Assert the behavior instead: whatever
      // is injected, the reserved type still skips and still reports no config path.
      const loader = createMockLoader({ 'reserved-llm-gate': llmGate });
      const withRuntime = createGateValidator(mockLogger, loader, () => {
        throw new Error('llm_self_check must not reach the script-tool runtime');
      });

      const result = await withRuntime.validateGate('reserved-llm-gate', { content: 'anything' });
      const check = result?.checks?.[0];

      expect(check?.details?.['configPath']).toBeUndefined();
      expect(check?.message).toContain('%judge');
      expect(new GateValidator(mockLogger, loader)).toBeInstanceOf(GateValidator);
    });
  });
});
