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

const createConfigLoader = () =>
  ({
    getConfig: () => ({}),
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
  // Selection is unconditional: the factory takes no config-driven branch any more, since the
  // retired llm-integration flag it used to read is gone from Config entirely.
  //
  // `hotReload()` used to be tested here too, but nothing outside this test ever called it — the
  // method was deleted as dead code (R36, unreached-methods baseline, 2026-09-17).
  test('returns the compositional service', () => {
    const factory = new GateServiceFactory(createLogger(), createConfigLoader(), fakeRenderer);

    expect(factory.createGateService()).toBeInstanceOf(CompositionalGateService);
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
