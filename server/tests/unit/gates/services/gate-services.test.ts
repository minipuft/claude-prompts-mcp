import { describe, expect, jest, test } from '@jest/globals';

import { CompositionalGateService } from '../../../../src/engine/gates/services/compositional-gate-service.js';
import { GateServiceFactory } from '../../../../src/engine/gates/services/gate-service-factory.js';

import type { GateGuidanceRenderer } from '../../../../src/engine/gates/guidance/GateGuidanceRenderer.js';
import type { GateService } from '../../../../src/engine/gates/services/gate-service-interface.js';
import type { ConvertedPrompt } from '../../../../src/shared/types/index.js';

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const createConfigLoader = (llmEnabled: boolean) =>
  ({
    getConfig: () => ({
      analysis: {
        semanticAnalysis: {
          llmIntegration: { enabled: llmEnabled },
        },
      },
    }),
    loadConfig: jest.fn(async () => ({})),
  }) as any;

const fakeRenderer: GateGuidanceRenderer = {
  renderGuidance: jest.fn().mockResolvedValue('Guidance'),
} as any;

const samplePrompt: ConvertedPrompt = {
  id: 'prompt-',
  name: 'Sample',
  description: 'test',
  category: 'general',
  userMessageTemplate: 'Hello',
  arguments: [],
};

describe('GateServiceFactory', () => {
  // Selection is unconditional. Both cases assert the same outcome on purpose: feeding the
  // llm-enabled config shape is the point, because that is the input that would divert if a
  // second service were ever wired back in, and this is the case that would fail.
  test('returns the compositional service when the retired llm flag is off', () => {
    const factory = new GateServiceFactory(createLogger(), createConfigLoader(false), fakeRenderer);

    expect(factory.createGateService()).toBeInstanceOf(CompositionalGateService);
  });

  test('returns the compositional service even when the retired llm flag is on', () => {
    const factory = new GateServiceFactory(createLogger(), createConfigLoader(true), fakeRenderer);

    expect(factory.createGateService()).toBeInstanceOf(CompositionalGateService);
  });

  test('hotReload rereads config and returns a fresh compositional service', async () => {
    const configLoader = createConfigLoader(true);
    const factory = new GateServiceFactory(createLogger(), configLoader, fakeRenderer);

    const first = factory.createGateService();
    const reloaded = await factory.hotReload();

    expect(configLoader.loadConfig).toHaveBeenCalledTimes(1);
    expect(reloaded).toBeInstanceOf(CompositionalGateService);
    expect(reloaded).not.toBe(first);
  });
});

describe('CompositionalGateService', () => {
  test('injects gate instructions without validation', async () => {
    const service: GateService = new CompositionalGateService(createLogger(), fakeRenderer);

    const result = await service.enhancePrompt(samplePrompt, ['quality'], {
      promptId: 'prompt-',
    });

    expect(result.injectedGateIds).toEqual(['quality']);
    expect(result.gateInstructionsInjected).toBe(true);
    expect(service.supportsValidation()).toBe(false);
  });

  // The enhancement result carries injection facts only — no verdict field. Pinning the exact
  // key set is what catches a validation channel being reintroduced here instead of through
  // `gate_verdict`, which is where evaluation results are supposed to arrive.
  test('returns injection facts only, with no verdict channel', async () => {
    const service: GateService = new CompositionalGateService(createLogger(), fakeRenderer);

    const result = await service.enhancePrompt(samplePrompt, ['gate'], {
      promptId: 'prompt-',
    });

    expect(Object.keys(result).sort()).toEqual([
      'enhancedPrompt',
      'gateInstructionsInjected',
      'injectedGateIds',
      'instructionLength',
    ]);
  });
});
