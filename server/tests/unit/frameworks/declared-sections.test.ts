/**
 * Tests for the declared-sections lookup — the single source `resolveDeclaredSections()` and
 * `resolveGuardedProcessingSteps()` share, extracted from the private
 * `PhaseGuardVerificationStage.getPhasesWithGuards` (Tier 1 of
 * plans/phase-guard-declaration-contract-2026-08-15.md).
 *
 * Ground truth measured at HEAD 2026-08-17: CAGEERF declares `## Context`, `## Analysis`,
 * `## Goals`, `## Execution` as required and `## Evaluation`, `## Refinement` as not required.
 */

import { describe, expect, jest, test } from '@jest/globals';

import {
  resolveDeclaredSections,
  resolveGuardedProcessingSteps,
} from '../../../src/engine/frameworks/declared-sections.js';

import type { FrameworkGuideProvider } from '../../../src/engine/frameworks/declared-sections.js';
import type { FrameworkGuide } from '../../../src/engine/frameworks/types/framework-types.js';

function createMockGuide(steps: Array<Record<string, unknown>>): FrameworkGuide {
  return {
    enhanceWithFramework: jest.fn().mockReturnValue({
      processingEnhancements: steps,
    }),
    guidePromptCreation: jest.fn(),
    guideTemplateProcessing: jest.fn(),
    guideExecutionSteps: jest.fn(),
    validateFrameworkCompliance: jest.fn(),
    getSystemPromptGuidance: jest.fn(),
  } as unknown as FrameworkGuide;
}

function createProvider(guide?: FrameworkGuide): FrameworkGuideProvider {
  return () => ({
    getFrameworkGuide: jest.fn<(id: string) => FrameworkGuide | undefined>().mockReturnValue(guide),
  });
}

/** The four required + two non-required CAGEERF phases, matching phases.yaml at HEAD. */
const cageerfSteps = [
  {
    id: 'context_establishment',
    section_header: '## Context',
    guards: { required: true, min_length: 50 },
  },
  {
    id: 'analysis_execution',
    section_header: '## Analysis',
    guards: { required: true, min_length: 50 },
  },
  {
    id: 'goals_definition',
    section_header: '## Goals',
    guards: { required: true, min_length: 20 },
  },
  {
    id: 'execution_planning',
    section_header: '## Execution',
    guards: { required: true, min_length: 100 },
  },
  {
    id: 'evaluation_criteria',
    section_header: '## Evaluation',
    guards: { required: false, min_length: 20 },
  },
  {
    id: 'refinement_notes',
    section_header: '## Refinement',
    guards: { required: false },
  },
];

describe('resolveDeclaredSections', () => {
  test('returns one entry per guarded phase with verbatim headers', () => {
    const provider = createProvider(createMockGuide(cageerfSteps));

    const sections = resolveDeclaredSections(provider, 'cageerf');

    expect(sections).toHaveLength(6);
    expect(sections.map((s) => s.header)).toEqual([
      '## Context',
      '## Analysis',
      '## Goals',
      '## Execution',
      '## Evaluation',
      '## Refinement',
    ]);
  });

  test('required propagates from guards.required', () => {
    const provider = createProvider(createMockGuide(cageerfSteps));

    const sections = resolveDeclaredSections(provider, 'cageerf');
    const byHeader = new Map(sections.map((s) => [s.header, s]));

    // Required: the first four CAGEERF phases.
    expect(byHeader.get('## Context')?.required).toBe(true);
    expect(byHeader.get('## Analysis')?.required).toBe(true);
    expect(byHeader.get('## Goals')?.required).toBe(true);
    expect(byHeader.get('## Execution')?.required).toBe(true);
    // Not required: Evaluation and Refinement.
    expect(byHeader.get('## Evaluation')?.required).toBe(false);
    expect(byHeader.get('## Refinement')?.required).toBe(false);
  });

  test('phaseId matches the phase id, for diagnostics and retry hints', () => {
    const provider = createProvider(createMockGuide(cageerfSteps));

    const sections = resolveDeclaredSections(provider, 'cageerf');

    expect(sections.find((s) => s.header === '## Context')?.phaseId).toBe('context_establishment');
    expect(sections.find((s) => s.header === '## Execution')?.phaseId).toBe('execution_planning');
  });

  test('unguarded framework returns an empty array', () => {
    const provider = createProvider(createMockGuide([{ id: 'plain_step', name: 'Plain Step' }]));

    const sections = resolveDeclaredSections(provider, 'plain-framework');

    expect(sections).toEqual([]);
  });

  test('excludes a phase with guards but no section_header', () => {
    const provider = createProvider(
      createMockGuide([
        { id: 'guarded_no_header', guards: { required: true, min_length: 10 } },
        { id: 'context', section_header: '## Context', guards: { required: true } },
      ])
    );

    const sections = resolveDeclaredSections(provider, 'mixed-framework');

    expect(sections).toHaveLength(1);
    expect(sections[0]?.header).toBe('## Context');
    expect(sections.find((s) => s.phaseId === 'guarded_no_header')).toBeUndefined();
  });

  test('returns [] when the registry provider returns undefined', () => {
    const provider: FrameworkGuideProvider = () => undefined;

    expect(resolveDeclaredSections(provider, 'cageerf')).toEqual([]);
  });

  test('returns [] when the framework guide is not found', () => {
    const provider = createProvider(undefined);

    expect(resolveDeclaredSections(provider, 'unknown')).toEqual([]);
  });

  test('reads through the provider on every call — no cache', () => {
    // First call sees a guarded framework, second call sees it become unguarded (hot-reload).
    const guardedGuide = createMockGuide(cageerfSteps.slice(0, 1));
    const unguardedGuide = createMockGuide([{ id: 'plain', name: 'Plain' }]);
    let callCount = 0;
    const provider: FrameworkGuideProvider = () => ({
      getFrameworkGuide: () => {
        callCount += 1;
        return callCount === 1 ? guardedGuide : unguardedGuide;
      },
    });

    expect(resolveDeclaredSections(provider, 'cageerf')).toHaveLength(1);
    expect(resolveDeclaredSections(provider, 'cageerf')).toEqual([]);
  });
});

describe('resolveGuardedProcessingSteps', () => {
  test('returns the full ProcessingStep objects (including non-required guard fields)', () => {
    const provider = createProvider(createMockGuide(cageerfSteps));

    const steps = resolveGuardedProcessingSteps(provider, 'cageerf');

    expect(steps).toHaveLength(6);
    const execution = steps.find((s) => s.id === 'execution_planning');
    expect(execution?.guards?.min_length).toBe(100);
  });

  test('filters out steps missing section_header or guards', () => {
    const provider = createProvider(
      createMockGuide([
        { id: 'no_header', guards: { required: true } },
        { id: 'no_guards', section_header: '## Something' },
        { id: 'both', section_header: '## Context', guards: { required: true } },
      ])
    );

    const steps = resolveGuardedProcessingSteps(provider, 'mixed-framework');

    expect(steps).toHaveLength(1);
    expect(steps[0]?.id).toBe('both');
  });
});
