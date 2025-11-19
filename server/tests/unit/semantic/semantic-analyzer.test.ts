import { describe, expect, test, jest } from '@jest/globals';

import { ContentAnalyzer } from '../../../src/semantic/configurable-semantic-analyzer.js';

import type { ConvertedPrompt } from '../../../src/execution/types.js';

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as any;

function createAnalyzer(mode: 'structural' | 'semantic' = 'structural') {
  return new ContentAnalyzer(mockLogger, {
    mode,
    llmIntegration: { enabled: false },
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

describe('ContentAnalyzer (structural mode)', () => {
  test('classifies simple variable substitution prompts as prompt execution type', async () => {
    const analyzer = createAnalyzer();
    const result = await analyzer.analyzePrompt(
      createPrompt({
        id: 'simple',
        userMessageTemplate: 'Hello {{name}}, how are you?',
      })
    );

    expect(result.executionType).toBe('prompt');
    expect(result.requiresFramework).toBe(false);
    expect(result.frameworkRecommendation?.requiresUserChoice).toBe(true);
    expect(result.reasoning.length).toBeGreaterThan(0);
  });

  test('detects chain-style structure when multiple sequential steps exist', async () => {
    const analyzer = createAnalyzer();
    const result = await analyzer.analyzePrompt(
      createPrompt({
        id: 'chain',
        userMessageTemplate: `
Step 1: Analyze {{input}}
Step 2: Summarize findings
Step 3: Recommend actions
        `,
      })
    );

    expect(result.executionType).toBe('chain');
    expect(result.executionCharacteristics.hasChainSteps).toBe(true);
    expect(result.suggestedGates.length).toBeGreaterThan(0);
  });

  test('provides warnings about structural limitations when semantic analysis is unavailable', async () => {
    const analyzer = createAnalyzer();
    const result = await analyzer.analyzePrompt(
      createPrompt({
        id: 'complex',
        userMessageTemplate: `
{% if analysis_type == 'detailed' %}
Perform detailed analysis of {{content}}
{% else %}
Quick analysis
{% endif %}
        `,
        arguments: [
          { name: 'content', type: 'string', required: true },
          { name: 'analysis_type', type: 'string', required: false },
        ],
      })
    );

    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.capabilities.hasSemanticUnderstanding).toBe(false);
    expect(result.capabilities.canDetectStructure).toBe(true);
  });
});
