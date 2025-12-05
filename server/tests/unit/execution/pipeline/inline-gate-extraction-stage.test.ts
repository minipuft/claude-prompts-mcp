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

  test('registers full TemporaryGateInput objects from unified gates parameter', async () => {
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

    // Full TemporaryGateInput objects (with id) are registered in the temporary gate registry
    expect(createTemporaryGate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'gdpr-check',
        pass_criteria: ['no PII'], // Normalized to pass_criteria internally
        scope: 'execution',
      }),
      expect.any(String)
    );

    // Note: temporaryGateIds metadata is not populated here - gates are registered in the registry
    // and will be discovered by gate-enhancement-stage when it queries the registry
  });

  test('registers gates from unified gates parameter with mixed specification types', async () => {
    const { registry, createTemporaryGate } = createRegistry();
    const { resolver } = createResolver();
    const stage = new InlineGateExtractionStage(registry, resolver, createLogger());

    const context = new ExecutionContext({ command: '>>demo' });
    context.state.gates.requestedOverrides = {
      gates: [
        'toxicity', // String ID - skipped (handled in gate-enhancement stage)
        { name: 'red-team', description: 'Confirm exfil path' }, // CustomCheck - skipped (converted to temp gate in gate-enhancement stage)
        { id: 'gdpr-check', criteria: ['no PII'], severity: 'high' }, // TemporaryGateInput - registered here
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

    // Only full TemporaryGateInput objects (with id) are registered in this stage
    // String IDs and CustomCheck objects are handled in gate-enhancement-stage
    expect(createTemporaryGate).toHaveBeenCalledTimes(1);
    expect(createTemporaryGate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'gdpr-check',
        pass_criteria: ['no PII'],
      }),
      expect.any(String)
    );
  });
});
