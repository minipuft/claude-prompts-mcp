import {
  evaluatePhaseGuards,
  buildPhaseGuardPassSummary,
} from '../../../../src/engine/frameworks/phase-guards/phase-guard-evaluator.js';
import type { ProcessingStep } from '../../../../src/engine/frameworks/types/methodology-types.js';
import type { PhaseGuardEvaluationResult } from '../../../../src/engine/frameworks/phase-guards/types.js';

function makePhase(
  overrides: Partial<ProcessingStep> & { id: string; section_header: string }
): ProcessingStep {
  return {
    name: overrides.id,
    description: `Test phase ${overrides.id}`,
    frameworkBasis: 'test',
    order: 1,
    required: true,
    ...overrides,
  };
}

describe('evaluatePhaseGuards', () => {
  // --- Empty / no-op cases ---

  it('returns allPassed with empty phases', () => {
    const result = evaluatePhaseGuards('some output', []);
    expect(result.allPassed).toBe(true);
    expect(result.results).toHaveLength(0);
    expect(result.retryFeedback).toBe('');
  });

  it('skips phases without section_header', () => {
    const phases: ProcessingStep[] = [
      {
        id: 'no-marker',
        name: 'No Marker',
        description: 'Phase without section_header',
        frameworkBasis: 'test',
        order: 1,
        required: true,
        guards: { required: true },
      },
    ];
    const result = evaluatePhaseGuards('any output', phases);
    expect(result.allPassed).toBe(true);
    expect(result.results).toHaveLength(0);
  });

  it('skips phases without guards', () => {
    const phases: ProcessingStep[] = [makePhase({ id: 'no-guards', section_header: '## Context' })];
    const result = evaluatePhaseGuards('## Context\nSome text', phases);
    expect(result.allPassed).toBe(true);
    expect(result.results).toHaveLength(0);
  });

  // --- required guard ---

  it('passes when required section is present', () => {
    const phases = [
      makePhase({
        id: 'context',
        section_header: '## Context',
        guards: { required: true },
      }),
    ];
    const output = '## Context\nHere is the context.';
    const result = evaluatePhaseGuards(output, phases);

    expect(result.allPassed).toBe(true);
    expect(result.results[0]!.passed).toBe(true);
    expect(result.results[0]!.found).toBe(true);
  });

  it('fails when required section is missing', () => {
    const phases = [
      makePhase({
        id: 'context',
        section_header: '## Context',
        guards: { required: true },
      }),
    ];
    const output = '## Analysis\nSome analysis.';
    const result = evaluatePhaseGuards(output, phases);

    expect(result.allPassed).toBe(false);
    expect(result.failedPhases).toContain('context');
    expect(result.results[0]!.found).toBe(false);
    expect(result.results[0]!.checks[0]!.type).toBe('required');
    expect(result.results[0]!.checks[0]!.passed).toBe(false);
    expect(result.retryFeedback).toContain('Missing required section');
  });

  it('skips content checks when required section is missing', () => {
    const phases = [
      makePhase({
        id: 'context',
        section_header: '## Context',
        guards: { required: true, min_length: 10 },
      }),
    ];
    const result = evaluatePhaseGuards('No matching section here.', phases);

    // Should only have the required check, not min_length
    expect(result.results[0]!.checks).toHaveLength(1);
    expect(result.results[0]!.checks[0]!.type).toBe('required');
  });

  // --- min_length guard ---

  it('passes min_length when content is long enough', () => {
    const phases = [
      makePhase({
        id: 'analysis',
        section_header: '## Analysis',
        guards: { min_length: 10 },
      }),
    ];
    const output = '## Analysis\nThis is a sufficiently long analysis section.';
    const result = evaluatePhaseGuards(output, phases);

    expect(result.allPassed).toBe(true);
  });

  it('fails min_length when content is too short', () => {
    const phases = [
      makePhase({
        id: 'analysis',
        section_header: '## Analysis',
        guards: { min_length: 100 },
      }),
    ];
    const output = '## Analysis\nShort.';
    const result = evaluatePhaseGuards(output, phases);

    expect(result.allPassed).toBe(false);
    const check = result.results[0]!.checks.find((c) => c.type === 'min_length');
    expect(check!.passed).toBe(false);
    expect(result.retryFeedback).toContain('too short');
  });

  // --- max_length guard ---

  it('passes max_length when content is within limit', () => {
    const phases = [
      makePhase({
        id: 'goals',
        section_header: '## Goals',
        guards: { max_length: 1000 },
      }),
    ];
    const output = '## Goals\nBrief goals.';
    const result = evaluatePhaseGuards(output, phases);

    expect(result.allPassed).toBe(true);
  });

  it('fails max_length when content exceeds limit', () => {
    const phases = [
      makePhase({
        id: 'goals',
        section_header: '## Goals',
        guards: { max_length: 10 },
      }),
    ];
    const output = '## Goals\nThis content is definitely more than ten characters long.';
    const result = evaluatePhaseGuards(output, phases);

    expect(result.allPassed).toBe(false);
    expect(result.retryFeedback).toContain('too long');
  });

  // --- contains_any guard ---

  it('passes contains_any when at least one keyword present', () => {
    const phases = [
      makePhase({
        id: 'context',
        section_header: '## Context',
        guards: { contains_any: ['background', 'situation', 'environment'] },
      }),
    ];
    const output = '## Context\nThe background of this problem is complex.';
    const result = evaluatePhaseGuards(output, phases);

    expect(result.allPassed).toBe(true);
  });

  it('fails contains_any when no keywords present', () => {
    const phases = [
      makePhase({
        id: 'context',
        section_header: '## Context',
        guards: { contains_any: ['background', 'situation', 'environment'] },
      }),
    ];
    const output = '## Context\nHere is some generic text without the expected terms.';
    const result = evaluatePhaseGuards(output, phases);

    expect(result.allPassed).toBe(false);
    expect(result.retryFeedback).toContain('must include at least one of');
  });

  it('matches contains_any case-insensitively', () => {
    const phases = [
      makePhase({
        id: 'context',
        section_header: '## Context',
        guards: { contains_any: ['Background'] },
      }),
    ];
    const output = '## Context\nThe BACKGROUND is clear.';
    const result = evaluatePhaseGuards(output, phases);

    expect(result.allPassed).toBe(true);
  });

  // --- contains_all guard ---

  it('passes contains_all when all keywords present', () => {
    const phases = [
      makePhase({
        id: 'analysis',
        section_header: '## Analysis',
        guards: { contains_all: ['because', 'evidence'] },
      }),
    ];
    const output = '## Analysis\nBecause the evidence shows this pattern.';
    const result = evaluatePhaseGuards(output, phases);

    expect(result.allPassed).toBe(true);
  });

  it('fails contains_all when some keywords missing', () => {
    const phases = [
      makePhase({
        id: 'analysis',
        section_header: '## Analysis',
        guards: { contains_all: ['because', 'evidence', 'indicates'] },
      }),
    ];
    const output = '## Analysis\nBecause this is relevant.';
    const result = evaluatePhaseGuards(output, phases);

    expect(result.allPassed).toBe(false);
    expect(result.retryFeedback).toContain('missing required terms');
    expect(result.retryFeedback).toContain('"evidence"');
    expect(result.retryFeedback).toContain('"indicates"');
  });

  // --- matches_pattern guard ---

  it('passes matches_pattern when regex matches', () => {
    const phases = [
      makePhase({
        id: 'execution',
        section_header: '## Execution',
        guards: { matches_pattern: '\\d+\\s*steps?' },
      }),
    ];
    const output = '## Execution\nThis plan has 3 steps to complete.';
    const result = evaluatePhaseGuards(output, phases);

    expect(result.allPassed).toBe(true);
  });

  it('fails matches_pattern when regex does not match', () => {
    const phases = [
      makePhase({
        id: 'execution',
        section_header: '## Execution',
        guards: { matches_pattern: '\\d+\\s*steps?' },
      }),
    ];
    const output = '## Execution\nDo some things.';
    const result = evaluatePhaseGuards(output, phases);

    expect(result.allPassed).toBe(false);
    expect(result.retryFeedback).toContain('does not match required pattern');
  });

  it('handles invalid regex gracefully', () => {
    const phases = [
      makePhase({
        id: 'test',
        section_header: '## Test',
        guards: { matches_pattern: '[invalid' },
      }),
    ];
    const output = '## Test\nSome content.';
    const result = evaluatePhaseGuards(output, phases);

    expect(result.allPassed).toBe(false);
    expect(result.retryFeedback).toContain('Invalid phase guard pattern');
  });

  // --- forbidden_terms guard ---

  it('passes forbids when no forbidden terms present', () => {
    const phases = [
      makePhase({
        id: 'analysis',
        section_header: '## Analysis',
        guards: { forbidden_terms: ['TODO', 'FIXME', 'hack'] },
      }),
    ];
    const output = '## Analysis\nClean professional analysis.';
    const result = evaluatePhaseGuards(output, phases);

    expect(result.allPassed).toBe(true);
  });

  it('fails forbids when forbidden terms are present', () => {
    const phases = [
      makePhase({
        id: 'analysis',
        section_header: '## Analysis',
        guards: { forbidden_terms: ['TODO', 'FIXME', 'hack'] },
      }),
    ];
    const output = '## Analysis\nThis is a TODO hack that needs work.';
    const result = evaluatePhaseGuards(output, phases);

    expect(result.allPassed).toBe(false);
    expect(result.retryFeedback).toContain('forbidden terms');
    expect(result.retryFeedback).toContain('"TODO"');
    expect(result.retryFeedback).toContain('"hack"');
  });

  // --- Multiple guards on one phase ---

  it('evaluates all guard types on a single phase', () => {
    const phases = [
      makePhase({
        id: 'context',
        section_header: '## Context',
        guards: {
          required: true,
          min_length: 20,
          contains_any: ['context', 'background'],
          forbidden_terms: ['TODO'],
        },
      }),
    ];
    const output = '## Context\nThe background context of this problem spans multiple concerns.';
    const result = evaluatePhaseGuards(output, phases);

    expect(result.allPassed).toBe(true);
    expect(result.results[0]!.checks).toHaveLength(4);
  });

  it('reports multiple failures on a single phase', () => {
    const phases = [
      makePhase({
        id: 'context',
        section_header: '## Context',
        guards: {
          min_length: 1000,
          contains_all: ['background', 'environment'],
          forbidden_terms: ['hack'],
        },
      }),
    ];
    const output = '## Context\nShort hack.';
    const result = evaluatePhaseGuards(output, phases);

    expect(result.allPassed).toBe(false);
    const failedChecks = result.results[0]!.checks.filter((c) => !c.passed);
    expect(failedChecks.length).toBeGreaterThanOrEqual(3); // min_length, contains_all, forbids
  });

  // --- Multiple phases ---

  it('evaluates multiple phases independently', () => {
    const phases = [
      makePhase({
        id: 'context',
        section_header: '## Context',
        guards: { required: true, min_length: 10 },
      }),
      makePhase({
        id: 'analysis',
        section_header: '## Analysis',
        guards: { required: true, min_length: 10 },
      }),
    ];
    const output = [
      '## Context',
      'Here is enough context content for the phase.',
      '',
      '## Analysis',
      'Short.',
    ].join('\n');

    const result = evaluatePhaseGuards(output, phases);

    expect(result.allPassed).toBe(false);
    expect(result.failedPhases).toEqual(['analysis']);
    expect(result.results[0]!.passed).toBe(true); // context passes
    expect(result.results[1]!.passed).toBe(false); // analysis fails
  });

  // --- Retry feedback format ---

  it('builds structured retry feedback', () => {
    const phases = [
      makePhase({
        id: 'context',
        section_header: '## Context',
        guards: { required: true },
      }),
    ];
    const result = evaluatePhaseGuards('No sections at all.', phases);

    expect(result.retryFeedback).toContain('## Phase Guard Failures');
    expect(result.retryFeedback).toContain('structural requirements');
    expect(result.retryFeedback).toContain('revise your response');
  });

  it('returns empty feedback when all pass', () => {
    const phases = [
      makePhase({
        id: 'context',
        section_header: '## Context',
        guards: { required: true },
      }),
    ];
    const output = '## Context\nContent here.';
    const result = evaluatePhaseGuards(output, phases);

    expect(result.retryFeedback).toBe('');
  });

  // --- Non-required section not found ---

  it('passes when optional section is missing', () => {
    const phases = [
      makePhase({
        id: 'evaluation',
        section_header: '## Evaluation',
        guards: { required: false, min_length: 50 },
      }),
    ];
    const output = 'No evaluation section here.';
    const result = evaluatePhaseGuards(output, phases);

    // Section not found and not required — all checks skipped, phase passes
    expect(result.allPassed).toBe(true);
    expect(result.results[0]!.found).toBe(false);
    expect(result.results[0]!.passed).toBe(true);
    expect(result.results[0]!.checks).toHaveLength(0);
  });
});

describe('buildPhaseGuardPassSummary', () => {
  it('produces structured markdown with phase details', () => {
    const result: PhaseGuardEvaluationResult = {
      allPassed: true,
      results: [
        {
          phase: 'context',
          section_header: '## Context',
          found: true,
          checks: [
            { type: 'required', passed: true, expected: true, actual: true, feedback: '' },
            { type: 'min_length', passed: true, expected: 20, actual: 45, feedback: '' },
          ],
          passed: true,
        },
        {
          phase: 'analysis',
          section_header: '## Analysis',
          found: true,
          checks: [{ type: 'required', passed: true, expected: true, actual: true, feedback: '' }],
          passed: true,
        },
      ],
      failedPhases: [],
      retryFeedback: '',
    };

    const summary = buildPhaseGuardPassSummary(result);

    expect(summary).toContain('## Structural Verification: PASS');
    expect(summary).toContain('2/2 phases verified');
    expect(summary).toContain('**context**: found, 2/2 checks passed');
    expect(summary).toContain('**analysis**: found, 1/1 checks passed');
    expect(summary).toContain('Focus your review on **content quality**');
  });

  it('handles single-phase result', () => {
    const result: PhaseGuardEvaluationResult = {
      allPassed: true,
      results: [
        {
          phase: 'goals',
          section_header: '## Goals',
          found: true,
          checks: [{ type: 'required', passed: true, expected: true, actual: true, feedback: '' }],
          passed: true,
        },
      ],
      failedPhases: [],
      retryFeedback: '',
    };

    const summary = buildPhaseGuardPassSummary(result);

    expect(summary).toContain('1/1 phases verified');
    expect(summary).toContain('**goals**');
  });

  it('handles zero-phase result', () => {
    const result: PhaseGuardEvaluationResult = {
      allPassed: true,
      results: [],
      failedPhases: [],
      retryFeedback: '',
    };

    const summary = buildPhaseGuardPassSummary(result);

    expect(summary).toContain('0/0 phases verified');
  });
});
