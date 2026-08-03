import { describe, expect, jest, test } from '@jest/globals';

import { CompositionalGateService } from '../../../../src/engine/gates/services/compositional-gate-service.js';
import { GateServiceFactory } from '../../../../src/engine/gates/services/gate-service-factory.js';
import { SemanticGateService } from '../../../../src/engine/gates/services/semantic-gate-service.js';

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

const fakeValidator: any = {
  validateGates: jest.fn(),
  shouldRetry: jest.fn(),
};

const samplePrompt: ConvertedPrompt = {
  id: 'prompt-',
  name: 'Sample',
  description: 'test',
  category: 'general',
  userMessageTemplate: 'Hello',
  arguments: [],
};

describe('GateServiceFactory', () => {
  test('creates compositional service when llm disabled', () => {
    const factory = new GateServiceFactory(
      createLogger(),
      createConfigLoader(false),
      fakeRenderer,
      fakeValidator
    );
    const service = factory.createGateService();
    expect(service).toBeInstanceOf(CompositionalGateService);
  });

  test('creates semantic service when llm enabled', () => {
    const factory = new GateServiceFactory(
      createLogger(),
      createConfigLoader(true),
      fakeRenderer,
      fakeValidator
    );
    const service = factory.createGateService();
    expect(service).toBeInstanceOf(SemanticGateService);
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
});

describe('SemanticGateService', () => {
  test('gracefully degrades when validation not implemented', async () => {
    // No validator argument: the service never called the `GateValidator` it used
    // to be handed, so the parameter was removed rather than kept as wiring that
    // implied validation this service does not perform. `supportsValidation()`
    // has always reported `config.llmIntegration.enabled` and is unaffected.
    const service = new SemanticGateService(createLogger(), fakeRenderer, {
      llmIntegration: {
        enabled: true,
      },
    });

    const result = await service.enhancePrompt(samplePrompt, ['gate'], {
      promptId: 'prompt-',
    });

    expect(result.validationResults).toBeUndefined();
    expect(result.injectedGateIds).toEqual(['gate']);
    expect(service.supportsValidation()).toBe(true);
  });
});
