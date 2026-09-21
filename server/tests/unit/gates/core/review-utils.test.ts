import { describe, expect, test } from '@jest/globals';

import {
  buildReviewInstructions,
  composeReviewPrompt,
} from '../../../../src/engine/gates/core/review-utils.js';

import type { GateReviewPrompt } from '../../../../src/engine/execution/types.js';

describe('review-utils', () => {
  const samplePrompts: GateReviewPrompt[] = [
    {
      gateId: 'accuracy',
      criteriaSummary: 'Verify facts against provided sources.',
      promptTemplate: 'Double-check quantitative claims and cite evidence.',
      previousResponse: 'The Eiffel Tower is 324m tall.',
      explicitInstructions: [
        'Respond with PASS or FAIL and cite evidence.',
        'Provide justification in 2 sentences.',
        'respond with pass or fail and cite evidence.', // duplicate casing
      ],
    },
    {
      gateId: 'style',
      criteriaSummary: 'Ensure tone remains professional.',
      previousResponse: 'Informal tone detected.',
      explicitInstructions: ['Highlight any tone issues you identify.'],
    },
  ];

  test('buildReviewInstructions deduplicates while preserving order', () => {
    const instructions = buildReviewInstructions(samplePrompts);

    expect(instructions).toEqual([
      'Respond with PASS or FAIL and cite evidence.',
      'Provide justification in 2 sentences.',
      'Highlight any tone issues you identify.',
    ]);
  });

  test('buildReviewInstructions falls back to default text when gate instructions missing', () => {
    const fallbackPrompts: GateReviewPrompt[] = [
      {
        gateId: 'coverage',
        criteriaSummary: 'Ensure all bullet points are addressed.',
        previousResponse: 'Missing item 2',
        explicitInstructions: [],
      },
    ];

    const instructions = buildReviewInstructions(fallbackPrompts);

    expect(instructions).toEqual([
      'Respond explicitly with `GATE_REVIEW: PASS` or `GATE_REVIEW: FAIL`.',
      'Include a concise justification referencing the gate criteria.',
    ]);
  });

  test('composeReviewPrompt returns combined markdown with metadata', () => {
    const mockTimestamps = { createdAt: 1_700_000_000_000 };
    const result = composeReviewPrompt(
      samplePrompts,
      'Initial draft response',
      ['Re-check the factual claim about Eiffel Tower height', '  '],
      mockTimestamps
    );

    expect(result.gateIds).toEqual(['accuracy', 'style']);
    expect(result.instructions.length).toBe(3);
    expect(result.metadata.previousResponse).toBe('Initial draft response');
    expect(result.metadata.retryHints).toEqual([
      'Re-check the factual claim about Eiffel Tower height',
    ]);
    expect(result.createdAt).toBe(mockTimestamps.createdAt);
    expect(result.metadata.timestamps).toBe(mockTimestamps);

    expect(result.combinedPrompt).toContain(' [Gate Review] Quality Gate Self-Review');
    expect(result.combinedPrompt).toContain(' [Gate Review] accuracy');
    expect(result.combinedPrompt).toContain(' [Gate Review] style');
    expect(result.combinedPrompt).toContain('Instructions:');
    expect(result.combinedPrompt).toContain('Retry Hints:');
    expect(result.combinedPrompt).toContain('Previous Assistant Response:');
  });

  test('composeReviewPrompt renders delivery framing for originalArgs', () => {
    const promptsWithContext: GateReviewPrompt[] = [
      {
        gateId: 'code-quality',
        criteriaSummary: 'Check code quality.',
        previousResponse: 'Some code output',
        executionContext: {
          originalArgs: { command: '>>triage', request: 'Fix the login bug' },
          previousResults: {},
        },
      },
    ];

    const result = composeReviewPrompt(promptsWithContext);

    expect(result.combinedPrompt).toContain('## Original Request & Delivery Context');
    expect(result.combinedPrompt).toContain(
      'Verify that the output satisfies the original request intent:'
    );
    expect(result.combinedPrompt).toContain('- **command**: >>triage');
    expect(result.combinedPrompt).toContain('- **request**: Fix the login bug');
    expect(result.combinedPrompt).toContain(
      'Does the output address what was originally asked for?'
    );
    expect(result.combinedPrompt).toContain(
      'Are there aspects of the request that were missed or partially addressed?'
    );
    // Should NOT contain old label
    expect(result.combinedPrompt).not.toContain('Original Arguments:');
  });
});
