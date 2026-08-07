import { describe, expect, test, jest } from '@jest/globals';

import { ContentAnalyzer } from '../../../src/modules/semantic/content-analyzer.js';

import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

function createAnalyzer() {
  return new ContentAnalyzer(mockLogger);
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
    const analyzer = createAnalyzer();
    const result = await analyzer.analyzePrompt(createPrompt({ id: 'no-llm-flag' }));

    expect(result.analysisMetadata).not.toHaveProperty('llmUsed');
    expect(result.analysisMetadata.mode).toBe('minimal');
  });

  // The flag-invariance test that stood here is gone, and its property is now structural rather
  // than asserted: the analyzer takes no configuration at all, so two analyzers CANNOT differ by a
  // config flag. Arity is checked in the configuration describe below — a stronger guarantee than
  // comparing two results, because it removes the input instead of proving it is ignored.

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
  // The analyzer exposes no method named for a removed capability. `isLLMEnabled` used to report
  // the config flag and gated user-visible output in two callers; both now run unconditionally
  // because the work behind them never needed a model.
  test('exposes no LLM-capability method', () => {
    expect(createAnalyzer()).not.toHaveProperty('isLLMEnabled');
  });

  // The analyzer stored a SemanticAnalysisConfig and read no field from it; `getConfig` and
  // `updateConfig` had zero callers outside this file. Taking no config is what makes the
  // deprecated `analysis.semanticAnalysis` section unreachable from here — the section itself is
  // still parsed and still warns at startup, which `legacy-key-migration.test.ts` pins.
  test('accepts no configuration, and exposes no accessor for one', () => {
    expect(ContentAnalyzer).toHaveLength(1);
    expect(createAnalyzer()).not.toHaveProperty('getConfig');
    expect(createAnalyzer()).not.toHaveProperty('updateConfig');
  });
});
