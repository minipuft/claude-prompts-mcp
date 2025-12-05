import { describe, expect, test } from '@jest/globals';

import {
  buildReviewInstructions,
  composeReviewPrompt,
  parseLLMReview,
} from '../../../../dist/gates/core/review-utils.js';

import type { GateReviewPrompt } from '../../../../dist/execution/types.js';

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

  test('parseLLMReview detects PASS verdicts with justification', () => {
    const parsed = parseLLMReview('GATE_REVIEW: PASS - all gates satisfied');

    expect(parsed.decision).toBe('pass');
    expect(parsed.reasoning).toContain('all gates satisfied');
    expect(parsed.matchType).toBe('explicit');
  });

  test('parseLLMReview detects FAIL verdicts and captures reasoning', () => {
    const parsed = parseLLMReview('GATE_REVIEW: FAIL\nMissing citations for claim 42.');

    expect(parsed.decision).toBe('fail');
    expect(parsed.reasoning).toContain('Missing citations for claim 42.');
  });
});
