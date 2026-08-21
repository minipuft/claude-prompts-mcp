import { describe, expect, it } from '@jest/globals';

import {
  buildPromptCatalogDetail,
  buildPromptCatalogSummary,
} from '../../../src/modules/prompts/prompt-catalog.js';

import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';

function prompt(overrides: Partial<ConvertedPrompt> = {}): ConvertedPrompt {
  return {
    id: 'strategicImplement',
    name: 'Strategic Implementation',
    description: 'Implement a planned change',
    category: 'development',
    userMessageTemplate: 'Implement {{ task }}',
    arguments: [{ name: 'task', required: true }],
    ...overrides,
  };
}

describe('buildPromptCatalogSummary', () => {
  it('normalizes argument defaults and explicit composer metadata', () => {
    const summary = buildPromptCatalogSummary(
      prompt({
        composer: { inputArgument: 'task' },
        arguments: [{ name: 'task', required: false }],
      })
    );

    expect(summary.arguments).toEqual([
      { name: 'task', description: null, required: false, type: 'string' },
    ]);
    expect(summary.composerInputArgument).toBe('task');
    expect(summary.executionType).toBe('single');
    expect(summary.revision).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('reports chain prompts without exposing template content in the summary', () => {
    const summary = buildPromptCatalogSummary(
      prompt({
        systemMessage: 'private system guidance',
        chainSteps: [{ promptId: 'review', stepName: 'Review' }],
      })
    );

    expect(summary.executionType).toBe('chain');
    expect(summary).not.toHaveProperty('systemMessage');
    expect(summary).not.toHaveProperty('userMessageTemplate');
  });

  it('changes revision when executable prompt content changes', () => {
    const before = buildPromptCatalogSummary(prompt()).revision;
    const after = buildPromptCatalogSummary(
      prompt({ userMessageTemplate: 'Changed {{ task }}' })
    ).revision;

    expect(after).not.toBe(before);
  });

  it('exposes executable content only in the detail payload', () => {
    const detail = buildPromptCatalogDetail(
      prompt({ systemMessage: 'private system guidance', userMessageTemplate: 'Run {{ task }}' })
    );

    expect(detail.summary).not.toHaveProperty('userMessageTemplate');
    expect(detail.userMessageTemplate).toBe('Run {{ task }}');
    expect(detail.systemMessage).toBe('private system guidance');
  });
});
