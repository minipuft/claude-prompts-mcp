import { describe, expect, test, jest } from '@jest/globals';

import { ContentAnalyzer } from '../../../src/semantic/configurable-semantic-analyzer.js';

import type { ConvertedPrompt } from '../../../src/execution/types.js';

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

function createAnalyzer(llmEnabled = false) {
  return new ContentAnalyzer(mockLogger, {
    llmIntegration: {
      enabled: llmEnabled,
      apiKey: null,
      endpoint: null,
      model: 'gpt-4',
      maxTokens: 1000,
      temperature: 0.1,
    },
  });
}

function createPrompt(partial: Partial<ConvertedPrompt>): ConvertedPrompt {
  return {
    id: 'prompt',
    name: 'Prompt',
    description: 'Test prompt',
    category: 'analysis',
    userMessageTemplate: 'Hello {{name}}',
    arguments: [{ name: 'name', type: 'string', required: true }],
    requiresExecution: true,
    ...partial,
  };
}

describe('ContentAnalyzer (minimal mode - LLM not configured)', () => {
  test('returns minimal analysis result for simple prompts', async () => {
    const analyzer = createAnalyzer();
    const result = await analyzer.analyzePrompt(
      createPrompt({
        id: 'simple',
        userMessageTemplate: 'Hello {{name}}, how are you?',
      })
    );

    expect(result.executionType).toBe('single');
    expect(result.requiresFramework).toBe(false);
    expect(result.capabilities.hasSemanticUnderstanding).toBe(false);
    expect(result.capabilities.canRecommendFramework).toBe(false);
    expect(result.analysisMetadata.mode).toBe('minimal');
    expect(result.reasoning).toContain('Minimal analysis - LLM not configured');
  });

  test('returns minimal analysis for prompts with chain steps', async () => {
    const analyzer = createAnalyzer();
    const result = await analyzer.analyzePrompt(
      createPrompt({
        id: 'chain',
        chainSteps: [
          { id: 'step1', promptId: 'analyze' },
          { id: 'step2', promptId: 'summarize' },
        ],
      })
    );

    expect(result.executionType).toBe('single');
    expect(result.executionCharacteristics.hasChainSteps).toBe(true);
    expect(result.analysisMetadata.mode).toBe('minimal');
  });

  test('reports limitations when LLM not configured', async () => {
    const analyzer = createAnalyzer();
    const result = await analyzer.analyzePrompt(
      createPrompt({
        id: 'complex',
        userMessageTemplate: 'Analyze {{content}} with comprehensive methodology',
      })
    );

    expect(result.limitations.length).toBeGreaterThan(0);
    expect(result.limitations).toContain('LLM integration not configured');
    expect(result.warnings.length).toBe(0); // No warnings in minimal mode
  });

  test('caches analysis results', async () => {
    const analyzer = createAnalyzer();
    const prompt = createPrompt({ id: 'cached' });

    const result1 = await analyzer.analyzePrompt(prompt);
    expect(result1.analysisMetadata.cacheHit).toBe(false);

    const result2 = await analyzer.analyzePrompt(prompt);
    expect(result2.analysisMetadata.cacheHit).toBe(true);
  });

  test('getPerformanceStats returns current cache state', () => {
    const analyzer = createAnalyzer();
    const stats = analyzer.getPerformanceStats();

    expect(stats.cacheEnabled).toBe(true);
    expect(stats.llmIntegrationEnabled).toBe(false);
    expect(typeof stats.cacheSize).toBe('number');
  });

  test('clearCache empties the analysis cache', async () => {
    const analyzer = createAnalyzer();

    await analyzer.analyzePrompt(createPrompt({ id: 'to-clear' }));
    expect(analyzer.getPerformanceStats().cacheSize).toBe(1);

    analyzer.clearCache();
    expect(analyzer.getPerformanceStats().cacheSize).toBe(0);
  });

  test('isLLMEnabled returns false when LLM not configured', () => {
    const analyzer = createAnalyzer(false);
    expect(analyzer.isLLMEnabled()).toBe(false);
  });

  test('isLLMEnabled returns true when LLM configured', () => {
    const analyzer = createAnalyzer(true);
    expect(analyzer.isLLMEnabled()).toBe(true);
  });

  test('suggested gates include basic_validation in minimal mode', async () => {
    const analyzer = createAnalyzer();
    const result = await analyzer.analyzePrompt(createPrompt({ id: 'gates-test' }));

    expect(result.suggestedGates).toContain('basic_validation');
  });
});

describe('ContentAnalyzer configuration', () => {
  test('getConfig returns current configuration', () => {
    const analyzer = createAnalyzer();
    const config = analyzer.getConfig();

    expect(config.llmIntegration.enabled).toBe(false);
    expect(config.llmIntegration.model).toBe('gpt-4');
  });

  test('updateConfig merges new configuration', () => {
    const analyzer = createAnalyzer();

    analyzer.updateConfig({
      llmIntegration: {
        enabled: true,
        apiKey: 'test-key',
        endpoint: 'http://localhost:8080',
        model: 'gpt-3.5-turbo',
        maxTokens: 500,
        temperature: 0.5,
      },
    });

    const config = analyzer.getConfig();
    expect(config.llmIntegration.enabled).toBe(true);
    expect(config.llmIntegration.model).toBe('gpt-3.5-turbo');
  });
});
