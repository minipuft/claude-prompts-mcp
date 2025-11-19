import { describe, expect, jest, test } from '@jest/globals';

import { CompositionalGateService } from '../../../../dist/gates/services/compositional-gate-service.js';
import { GateServiceFactory } from '../../../../dist/gates/services/gate-service-factory.js';
import { SemanticGateService } from '../../../../dist/gates/services/semantic-gate-service.js';

import type { GateGuidanceRenderer } from '../../../../dist/gates/guidance/GateGuidanceRenderer.js';
import type { IGateService } from '../../../../dist/gates/services/gate-service-interface.js';
import type { ConvertedPrompt } from '../../../../dist/types/index.js';

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const createConfigManager = (llmEnabled: boolean) =>
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
      createConfigManager(false),
      fakeRenderer,
      fakeValidator
    );
    const service = factory.createGateService();
    expect(service).toBeInstanceOf(CompositionalGateService);
  });

  test('creates semantic service when llm enabled', () => {
    const factory = new GateServiceFactory(
      createLogger(),
      createConfigManager(true),
      fakeRenderer,
      fakeValidator
    );
    const service = factory.createGateService();
    expect(service).toBeInstanceOf(SemanticGateService);
  });
});

describe('CompositionalGateService', () => {
  test('injects gate instructions without validation', async () => {
    const service: IGateService = new CompositionalGateService(createLogger(), fakeRenderer);

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
    const service = new SemanticGateService(createLogger(), fakeRenderer, fakeValidator, {
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
