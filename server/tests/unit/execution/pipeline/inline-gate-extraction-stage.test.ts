import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/execution/context/execution-context.js';
import { InlineGateExtractionStage } from '../../../../src/execution/pipeline/stages/02-inline-gate-stage.js';

import type { TemporaryGateRegistry } from '../../../../src/gates/core/temporary-gate-registry.js';
import type { GateReferenceResolver } from '../../../../src/gates/services/gate-reference-resolver.js';
import type { Logger } from '../../../../src/logging/index.js';

const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const createRegistry = (overrides?: {
  createTemporaryGate?: jest.Mock;
  getTemporaryGate?: jest.Mock;
}) => {
  const createTemporaryGate =
    overrides?.createTemporaryGate ?? jest.fn().mockReturnValue('temp_gate');
  const getTemporaryGate = overrides?.getTemporaryGate ?? jest.fn();
  return {
    registry: { createTemporaryGate, getTemporaryGate } as unknown as TemporaryGateRegistry,
    createTemporaryGate,
    getTemporaryGate,
  };
};

const createResolver = (
  impl?: (
    ref: string
  ) => Promise<{ referenceType: 'inline' | 'registered'; criteria?: string; gateId?: string }>
) => {
  const resolve = jest
    .fn<(ref: string) => Promise<any>>()
    .mockImplementation((ref) =>
      impl ? impl(ref) : Promise.resolve({ referenceType: 'inline', criteria: ref })
    );
  return {
    resolver: { resolve } as unknown as GateReferenceResolver,
    resolve,
  };
};

describe('InlineGateExtractionStage', () => {
  test('creates temporary inline gate for single prompt criteria', async () => {
    const { registry, createTemporaryGate } = createRegistry();
    const { resolver } = createResolver();
    const stage = new InlineGateExtractionStage(registry, resolver, createLogger());

    const context = new ExecutionContext({ command: '>>demo :: "Be concise"' });
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>demo',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      inlineGateCriteria: ['Be concise'],
    };

    await stage.execute(context);

    expect(createTemporaryGate).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'execution',
        guidance: expect.stringContaining('Be concise'),
      }),
      expect.stringContaining('command')
    );
    expect(context.parsedCommand.inlineGateIds).toContain('temp_gate');
    expect(context.state.gates.temporaryGateIds).toEqual(['temp_gate']);
  });

  test('registers chain step gates with step scope and merges resolver output', async () => {
    const { registry, createTemporaryGate } = createRegistry();
    const { resolver, resolve } = createResolver(async (ref) => {
      if (ref === 'research-quality') {
        return { referenceType: 'registered', gateId: 'research-quality' };
      }
      return { referenceType: 'inline', criteria: ref };
    });
    const stage = new InlineGateExtractionStage(registry, resolver, createLogger());

    const context = new ExecutionContext({ command: '>>chain' });
    context.parsedCommand = {
      promptId: 'chain',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>chain',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      commandType: 'chain',
      steps: [
        {
          stepNumber: 1,
          promptId: 'step_one',
          args: {},
          inlineGateCriteria: ['research-quality', 'Check dependencies'],
        },
      ],
    };

    await stage.execute(context);

    expect(resolve).toHaveBeenCalledWith('research-quality');
    expect(createTemporaryGate).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'step',
        description: expect.stringContaining('step 1'),
      }),
      expect.stringContaining('step_1')
    );
    const stepGates = context.parsedCommand?.steps?.[0].inlineGateIds ?? [];
    expect(stepGates).toEqual(expect.arrayContaining(['research-quality', 'temp_gate']));
    expect(context.state.gates.registeredInlineGateIds).toEqual(['research-quality']);
  });

  test('reuses registered temporary gate definitions when inline criteria matches gate ID', async () => {
    const gateDefinition = {
      id: 'custom_quality_gate',
      name: 'Custom Quality Gate',
      type: 'quality' as const,
      scope: 'execution' as const,
      description: 'Ensure bespoke structure',
      guidance: 'Follow the custom gate guidance',
      created_at: Date.now(),
      source: 'manual' as const,
    };

    const { registry, getTemporaryGate } = createRegistry({
      getTemporaryGate: jest.fn().mockReturnValue(gateDefinition),
    });
    const { resolver, resolve } = createResolver();
    const stage = new InlineGateExtractionStage(registry, resolver, createLogger());

    const context = new ExecutionContext({ command: '>>demo :: custom_quality_gate' });
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>demo',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      inlineGateCriteria: ['custom_quality_gate'],
    };

    await stage.execute(context);

    expect(getTemporaryGate).toHaveBeenCalledWith('custom_quality_gate');
    expect(resolve).not.toHaveBeenCalled();
    expect(context.state.gates.registeredInlineGateIds).toEqual(['custom_quality_gate']);
    expect(context.parsedCommand?.inlineGateIds).toContain('custom_quality_gate');
  });

  test('skips string gate IDs from unified gates parameter (handled in gate-enhancement stage)', async () => {
    const { registry, createTemporaryGate } = createRegistry();
    const { resolver } = createResolver();
    const stage = new InlineGateExtractionStage(registry, resolver, createLogger());

    const context = new ExecutionContext({ command: '>>demo' });
    context.state.gates.requestedOverrides = {
      gates: ['toxicity', 'code-quality'],
    };
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>demo',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
    };

    await stage.execute(context);

    // String IDs are skipped in this stage (handled in gate-enhancement-stage)
    expect(createTemporaryGate).not.toHaveBeenCalled();
    expect(context.state.gates.temporaryGateIds).toEqual([]);
  });

  test('skips CustomCheck objects from unified gates parameter (converted in gate-enhancement stage)', async () => {
    const { registry, createTemporaryGate } = createRegistry();
    const { resolver } = createResolver();
    const stage = new InlineGateExtractionStage(registry, resolver, createLogger());

    const context = new ExecutionContext({ command: '>>demo' });
    context.state.gates.requestedOverrides = {
      gates: [{ name: 'red-team', description: 'Confirm exfil path' }],
    };
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>demo',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
    };

    await stage.execute(context);

    // CustomCheck objects are skipped in this stage (converted to temp gates in gate-enhancement-stage)
    expect(createTemporaryGate).not.toHaveBeenCalled();
    expect(context.state.gates.temporaryGateIds).toEqual([]);
  });

  test('skips TemporaryGateInput objects from unified gates parameter (now handled in gate-enhancement stage)', async () => {
    const { registry, createTemporaryGate } = createRegistry();
    const { resolver } = createResolver();
    const stage = new InlineGateExtractionStage(registry, resolver, createLogger());

    const context = new ExecutionContext({ command: '>>demo' });
    context.state.gates.requestedOverrides = {
      gates: [{ id: 'gdpr-check', criteria: ['no PII'], severity: 'high' }],
    };
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>demo',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
    };

    await stage.execute(context);

    // Stage 02 now focuses only on inline :: gates
    // All gates from the 'gates' parameter are handled by Stage 05 (GateEnhancementStage)
    expect(createTemporaryGate).not.toHaveBeenCalled();
    expect(context.state.gates.temporaryGateIds).toEqual([]);
  });

  test('skips all gate types from unified gates parameter (all handled in gate-enhancement stage)', async () => {
    const { registry, createTemporaryGate } = createRegistry();
    const { resolver } = createResolver();
    const stage = new InlineGateExtractionStage(registry, resolver, createLogger());

    const context = new ExecutionContext({ command: '>>demo' });
    context.state.gates.requestedOverrides = {
      gates: [
        'toxicity', // String ID
        { name: 'red-team', description: 'Confirm exfil path' }, // CustomCheck
        { id: 'gdpr-check', criteria: ['no PII'], severity: 'high' }, // TemporaryGateInput
      ],
    };
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>demo',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
    };

    await stage.execute(context);

    // Stage 02 now focuses only on inline :: gates
    // ALL gates from the 'gates' parameter (strings, CustomChecks, and TemporaryGateInputs)
    // are handled by Stage 05 (GateEnhancementStage) for unified processing
    expect(createTemporaryGate).not.toHaveBeenCalled();
    expect(context.state.gates.temporaryGateIds).toEqual([]);
  });

  // NOTE: Tests for canonical gate handling from 'gates' parameter were removed.
  // This functionality is now consolidated in Stage 05 (GateEnhancementStage).
  // Stage 02 focuses solely on extracting inline gates from the :: operator.
  // See tests/unit/execution/pipeline/gate-enhancement-stage.test.ts for canonical gate tests.

  test('creates named inline gates with explicit IDs from symbolic syntax', async () => {
    const { registry, createTemporaryGate } = createRegistry();
    const { resolver } = createResolver();
    const stage = new InlineGateExtractionStage(registry, resolver, createLogger());

    const context = new ExecutionContext({ command: '>>demo :: security:"no secrets"' });
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>demo :: security:"no secrets"',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      namedInlineGates: [
        { gateId: 'security', criteria: ['no secrets'] },
        { gateId: 'perf', criteria: ['efficient algorithms'] },
      ],
    };

    await stage.execute(context);

    expect(createTemporaryGate).toHaveBeenCalledTimes(2);
    expect(createTemporaryGate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'security',
        name: 'security',
        pass_criteria: ['no secrets'],
      }),
      expect.any(String)
    );
    expect(context.parsedCommand?.inlineGateIds).toContain('temp_gate');
    expect(context.state.gates.temporaryGateIds?.length).toBeGreaterThan(0);
  });

  test('sets up shell verification state for verify gates (Ralph Wiggum loops)', async () => {
    const { registry, createTemporaryGate } = createRegistry();
    const { resolver } = createResolver();
    const stage = new InlineGateExtractionStage(registry, resolver, createLogger());

    const context = new ExecutionContext({ command: '>>demo :: verify:"npm test"' });
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>demo :: verify:"npm test"',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      namedInlineGates: [
        {
          gateId: 'shell-verify-12345',
          criteria: ['Shell verification: npm test'],
          shellVerify: {
            command: 'npm test',
            timeout: 60000,
          },
        },
      ],
    };

    await stage.execute(context);

    // Shell verification gates should NOT create regular inline gates
    expect(createTemporaryGate).not.toHaveBeenCalled();
    expect(context.parsedCommand?.inlineGateIds ?? []).toHaveLength(0);

    // Instead, they should set up pendingShellVerification state
    const pending = context.state.gates.pendingShellVerification;
    expect(pending).toBeDefined();
    expect(pending?.gateId).toBe('shell-verify-12345');
    expect(pending?.shellVerify.command).toBe('npm test');
    expect(pending?.shellVerify.timeout).toBe(60000);
    expect(pending?.attemptCount).toBe(0);
    expect(pending?.maxAttempts).toBe(5);
  });

  test('skips shell verification setup when shellVerify is missing', async () => {
    const { registry, createTemporaryGate } = createRegistry();
    const { resolver } = createResolver();
    const stage = new InlineGateExtractionStage(registry, resolver, createLogger());

    const context = new ExecutionContext({ command: '>>demo :: verify:"test"' });
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>demo :: verify:"test"',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      // Note: namedInlineGates has gateId but NO shellVerify - should create regular gate
      namedInlineGates: [
        {
          gateId: 'verify',
          criteria: ['test'],
          // shellVerify is NOT present
        },
      ],
    };

    await stage.execute(context);

    // Should create a regular inline gate since shellVerify is missing
    expect(createTemporaryGate).toHaveBeenCalledTimes(1);
    expect(createTemporaryGate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'verify',
        name: 'verify',
      }),
      expect.any(String)
    );

    // Should NOT set up shell verification
    expect(context.state.gates.pendingShellVerification).toBeUndefined();
  });
});
