import { describe, expect, jest, test } from '@jest/globals';

import { ContentAnalyzer } from '../../../../../src/modules/semantic/content-analyzer.js';
import { PromptAnalyzer } from '../../../../../src/mcp/tools/resource-manager/prompt/analysis/prompt-analyzer.js';

import type { Logger } from '../../../../../src/shared/types/index.js';

const createLogger = () =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

/**
 * Real `ContentAnalyzer`, not a mock. It is pure and dependency-free, so mocking it here would
 * only assert that the mock returns what it was told to — the branch under test reads the
 * analyzer's actual output, which is the thing worth pinning.
 */
const createAnalyzer = () =>
  new PromptAnalyzer({
    logger: createLogger(),
    semanticAnalyzer: new ContentAnalyzer(createLogger(), {
      llmIntegration: {
        enabled: false,
        apiKey: null,
        endpoint: null,
        model: 'gpt-4',
        maxTokens: 1000,
        temperature: 0.1,
      },
    } as unknown as ConstructorParameters<typeof ContentAnalyzer>[1]),
  });

const promptData = {
  id: 'sample',
  name: 'Sample',
  description: 'A prompt',
  category: 'analysis',
  userMessageTemplate: 'Hello {{name}}',
  arguments: [{ name: 'name', type: 'string', required: true }],
};

describe('PromptAnalyzer.analyzePromptIntelligence', () => {
  // The feedback used to be suppressed behind `semanticAnalyzer.isLLMEnabled()`, which defaulted
  // false — so every user saw "API Analysis Disabled" and no gate suggestions, even though the
  // analyzer produced real output and `GateAnalyzer` is rule-based with no model dependency.
  // These assertions pin the ungated behavior.
  test('reports the analysis line rather than a disabled notice', async () => {
    const result = await createAnalyzer().analyzePromptIntelligence(promptData);

    expect(result.feedback).not.toContain('API Analysis Disabled');
    expect(result.feedback).toContain(result.classification.executionType);
  });

  test('includes the suggested gates the classification carries', async () => {
    const result = await createAnalyzer().analyzePromptIntelligence(promptData);

    expect(result.classification.suggestedGates.length).toBeGreaterThan(0);
    expect(result.feedback).toContain('Suggested gates:');
    for (const gate of result.classification.suggestedGates) {
      expect(result.feedback).toContain(gate);
    }
  });

  test('returns the classification alongside the feedback', async () => {
    const result = await createAnalyzer().analyzePromptIntelligence(promptData);

    expect(result.classification.executionType).toBe('single');
    expect(Array.isArray(result.suggestions)).toBe(true);
  });
});

/**
 * Icon selection, pinned per reachable input.
 *
 * `getAnalysisIcon` is private, so these drive it through `analyzePromptIntelligence` — the only
 * caller. Two inputs are reachable: the normal path yields `analysisMode: 'minimal'`, and a
 * throwing analyzer routes through the catch to `analysisMode: 'fallback'`. These assertions are
 * the guard for collapsing the switch: they hold identically before and after, which is what makes
 * the removal of the unreachable arms provably behavior-preserving rather than merely plausible.
 */
describe('PromptAnalyzer icon selection', () => {
  test('renders the analysis icon on the normal path', async () => {
    const result = await createAnalyzer().analyzePromptIntelligence(promptData);

    expect(result.classification.analysisMode).toBe('minimal');
    expect(result.feedback.startsWith('🧠')).toBe(true);
  });

  test('renders the fallback icon when analysis throws', async () => {
    const throwingAnalyzer = new PromptAnalyzer({
      logger: createLogger(),
      semanticAnalyzer: {
        analyzePrompt: jest.fn(async () => {
          throw new Error('analysis exploded');
        }),
      } as never,
    });

    const result = await throwingAnalyzer.analyzePromptIntelligence(promptData);

    expect(result.classification.analysisMode).toBe('fallback');
    expect(result.feedback.startsWith('🚨')).toBe(true);
  });
});
