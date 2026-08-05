import { describe, expect, test, jest } from '@jest/globals';

import { ContentAnalyzer } from '../../../src/modules/semantic/content-analyzer.js';

import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';

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
    ...partial,
  };
}

describe('ContentAnalyzer', () => {
  test('reports execution type and disclaims every inference capability', async () => {
    const analyzer = createAnalyzer();
    const result = await analyzer.analyzePrompt(
      createPrompt({ id: 'simple', userMessageTemplate: 'Hello {{name}}, how are you?' })
    );

    expect(result.executionType).toBe('single');
    expect(result.requiresFramework).toBe(false);
    expect(result.capabilities.hasSemanticUnderstanding).toBe(false);
    expect(result.capabilities.canRecommendFramework).toBe(false);
    expect(result.analysisMetadata.mode).toBe('minimal');
  });

  test('reports prompt shape it can read directly, without claiming to detect chains', async () => {
    const analyzer = createAnalyzer();
    const result = await analyzer.analyzePrompt(
      createPrompt({
        id: 'chain',
        chainSteps: [
          { promptId: 'analyze', stepName: 'Analyze' },
          { promptId: 'summarize', stepName: 'Summarize' },
        ],
      })
    );

    // hasChainSteps is read off the prompt; executionType stays 'single' because classifying a
    // chain is the command parser's job, not this analyzer's.
    expect(result.executionCharacteristics.hasChainSteps).toBe(true);
    expect(result.executionCharacteristics.argumentCount).toBe(1);
    expect(result.executionType).toBe('single');
  });

  test('states its limitations and raises no warnings', async () => {
    const analyzer = createAnalyzer();
    const result = await analyzer.analyzePrompt(createPrompt({ id: 'complex' }));

    expect(result.limitations).toContain(
      'Prompt content is not inspected; only its shape is reported'
    );
    expect(result.warnings).toHaveLength(0);
    expect(result.suggestedGates).toContain('basic_validation');
  });

  // Pins the T3 collapse: there is one analysis path, so the metadata cannot advertise that a
  // model was consulted. A reappearing `llmUsed` would mean a second path was reintroduced.
  test('emits no llmUsed metadata, because there is only one analysis path', async () => {
    const analyzer = createAnalyzer(true);
    const result = await analyzer.analyzePrompt(createPrompt({ id: 'no-llm-flag' }));

    expect(result.analysisMetadata).not.toHaveProperty('llmUsed');
    expect(result.analysisMetadata.mode).toBe('minimal');
  });

  // The llm flag no longer participates in the cache key, because the result no longer depends
  // on it. Two analyzers differing only in that flag must agree on everything but timing.
  test('produces identical analysis regardless of the llm config flag', async () => {
    const prompt = createPrompt({ id: 'flag-invariant' });

    const off = await createAnalyzer(false).analyzePrompt(prompt);
    const on = await createAnalyzer(true).analyzePrompt(prompt);

    const strip = (r: typeof off) => ({
      ...r,
      analysisMetadata: { ...r.analysisMetadata, analysisTime: 0 },
    });
    expect(strip(on)).toEqual(strip(off));
  });

  test('caches analysis results', async () => {
    const analyzer = createAnalyzer();
    const prompt = createPrompt({ id: 'cached' });

    expect((await analyzer.analyzePrompt(prompt)).analysisMetadata.cacheHit).toBe(false);
    expect((await analyzer.analyzePrompt(prompt)).analysisMetadata.cacheHit).toBe(true);
  });

  test('getPerformanceStats reports cache state only', () => {
    const stats = createAnalyzer().getPerformanceStats();

    expect(stats.cacheEnabled).toBe(true);
    expect(typeof stats.cacheSize).toBe('number');
    expect(stats).not.toHaveProperty('llmIntegrationEnabled');
  });

  test('clearCache empties the analysis cache', async () => {
    const analyzer = createAnalyzer();

    await analyzer.analyzePrompt(createPrompt({ id: 'to-clear' }));
    expect(analyzer.getPerformanceStats().cacheSize).toBe(1);

    analyzer.clearCache();
    expect(analyzer.getPerformanceStats().cacheSize).toBe(0);
  });
});

describe('ContentAnalyzer configuration', () => {
  test('getConfig returns current configuration', () => {
    const config = createAnalyzer().getConfig();

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

    expect(analyzer.getConfig().llmIntegration.model).toBe('gpt-3.5-turbo');
  });

  // `isLLMEnabled` reports the config flag and does NOT indicate that model-backed analysis
  // exists — it does not. Two callers branch on it to size their response detail
  // (prompt-analyzer, prompt-lifecycle-processor), so it is pinned in both directions: hardcoding
  // it to false would silently change user-visible output. Retirement is T4's call.
  test('isLLMEnabled reports the config flag in both directions', () => {
    expect(createAnalyzer(false).isLLMEnabled()).toBe(false);
    expect(createAnalyzer(true).isLLMEnabled()).toBe(true);
  });
});
