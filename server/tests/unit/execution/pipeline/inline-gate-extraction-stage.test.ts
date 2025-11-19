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

const createRegistry = () => {
  const createTemporaryGate = jest.fn().mockReturnValue('temp_gate');
  return {
    registry: { createTemporaryGate } as unknown as TemporaryGateRegistry,
    createTemporaryGate,
  };
};

const createResolver = (impl?: (ref: string) => Promise<{ referenceType: 'inline' | 'registered'; criteria?: string; gateId?: string }>) => {
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
    expect(context.metadata['temporaryGateIds']).toEqual(['temp_gate']);
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
    expect(context.metadata['registeredInlineGateIds']).toEqual(['research-quality']);
  });
});
