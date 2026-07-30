/**
 * Tests for methodology phase guard schema validation.
 *
 * Verifies:
 * - PhaseGuardSchema accepts valid phase guard configs
 * - PhaseGuardSchema rejects invalid configs
 * - Existing methodology YAMLs still parse (backward compatibility)
 * - ProcessingStepDefinition accepts marker + guards
 */

import {
  PhaseGuardSchema,
  validatePhasesSchema,
} from '../../../src/engine/frameworks/methodology/methodology-schema.js';
import type { PhaseGuard } from '../../../src/engine/frameworks/methodology/methodology-schema.js';
import type { ProcessingStepDefinition } from '../../../src/engine/frameworks/utils/step-generator.js';

describe('PhaseGuardSchema', () => {
  it('accepts empty object (all fields optional)', () => {
    const result = PhaseGuardSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts full phase guard config', () => {
    const result = PhaseGuardSchema.safeParse({
      required: true,
      min_length: 50,
      max_length: 5000,
      contains_any: ['context', 'background'],
      contains_all: ['analysis', 'evidence'],
      matches_pattern: '^## Context',
      forbidden_terms: ['TODO', 'FIXME'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.required).toBe(true);
      expect(result.data.min_length).toBe(50);
      expect(result.data.contains_any).toEqual(['context', 'background']);
      expect(result.data.forbidden_terms).toEqual(['TODO', 'FIXME']);
    }
  });

  it('leaves required undefined when omitted (optional field)', () => {
    const result = PhaseGuardSchema.safeParse({ min_length: 10 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.required).toBeUndefined();
    }
  });

  it('rejects negative min_length', () => {
    const result = PhaseGuardSchema.safeParse({ min_length: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects zero min_length', () => {
    const result = PhaseGuardSchema.safeParse({ min_length: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer min_length', () => {
    const result = PhaseGuardSchema.safeParse({ min_length: 10.5 });
    expect(result.success).toBe(false);
  });

  it('rejects non-string items in contains_any', () => {
    const result = PhaseGuardSchema.safeParse({ contains_any: [123] });
    expect(result.success).toBe(false);
  });

  it('accepts partial phase guard configs', () => {
    const cases = [
      { required: true },
      { min_length: 50 },
      { contains_any: ['test'] },
      { forbidden_terms: ['bad'] },
      { matches_pattern: '\\d+' },
    ];

    for (const testCase of cases) {
      const result = PhaseGuardSchema.safeParse(testCase);
      expect(result.success).toBe(true);
    }
  });
});

describe('ProcessingStepDefinition with guards', () => {
  it('accepts step with marker and guards', () => {
    const step: ProcessingStepDefinition = {
      id: 'context_establishment',
      name: 'Context Establishment',
      description: 'Establish context',
      frameworkBasis: 'CAGEERF Context phase',
      order: 1,
      required: true,
      section_header: '## Context',
      guards: {
        required: true,
        min_length: 50,
        contains_any: ['context', 'situation'],
      },
    };

    expect(step.section_header).toBe('## Context');
    expect(step.guards?.required).toBe(true);
    expect(step.guards?.min_length).toBe(50);
  });

  it('accepts step without section_header or guards (backward compatible)', () => {
    const step: ProcessingStepDefinition = {
      id: 'analysis',
      name: 'Analysis',
      description: 'Analyze',
      frameworkBasis: 'Basis',
      order: 2,
      required: true,
    };

    expect(step.section_header).toBeUndefined();
    expect(step.guards).toBeUndefined();
  });
});

describe('PhaseGuard type', () => {
  it('matches PhaseGuardSchema output shape', () => {
    const guard: PhaseGuard = {
      required: true,
      min_length: 100,
      max_length: 5000,
      contains_any: ['analysis'],
      contains_all: ['evidence', 'conclusion'],
      matches_pattern: '## Analysis',
      forbidden_terms: ['placeholder'],
    };

    // Verify all fields are accessible
    expect(guard.required).toBe(true);
    expect(guard.min_length).toBe(100);
    expect(guard.max_length).toBe(5000);
    expect(guard.contains_any).toHaveLength(1);
    expect(guard.contains_all).toHaveLength(2);
    expect(guard.matches_pattern).toBeDefined();
    expect(guard.forbidden_terms).toHaveLength(1);
  });
});

// ============================================
// validatePhasesSchema edge case tests
// ============================================

describe('validatePhasesSchema', () => {
  const makeStep = (overrides: Record<string, unknown> = {}) => ({
    id: 'test_step',
    name: 'Test Step',
    description: 'A test processing step',
    frameworkBasis: 'Test basis',
    order: 1,
    required: true,
    ...overrides,
  });

  const makeExecStep = (overrides: Record<string, unknown> = {}) => ({
    id: 'exec_step',
    name: 'Exec Step',
    action: 'Do something',
    frameworkPhase: 'Test',
    dependencies: [],
    expected_output: 'Some output',
    ...overrides,
  });

  it('accepts valid phases with marker + guards', () => {
    const result = validatePhasesSchema({
      processingSteps: [
        makeStep({
          section_header: '## Context',
          guards: { required: true, min_length: 80, forbidden_terms: ['TODO'] },
        }),
      ],
      executionSteps: [makeExecStep()],
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('accepts steps without section_header or guards (backward compatible)', () => {
    const result = validatePhasesSchema({
      processingSteps: [makeStep()],
      executionSteps: [makeExecStep()],
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('warns when section_header exists without guards', () => {
    const result = validatePhasesSchema({
      processingSteps: [makeStep({ section_header: '## Context' })],
    });

    expect(result.valid).toBe(true);
    expect(result.warnings).toContainEqual(expect.stringContaining('Has section_header'));
    expect(result.warnings).toContainEqual(expect.stringContaining('no guards'));
  });

  it('errors when guards exist without section_header', () => {
    const result = validatePhasesSchema({
      processingSteps: [makeStep({ guards: { required: true, min_length: 50 } })],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('Has guards but no section_header')
    );
  });

  it('errors when min_length exceeds max_length', () => {
    const result = validatePhasesSchema({
      processingSteps: [
        makeStep({
          section_header: '## Test',
          guards: { min_length: 500, max_length: 100 },
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('min_length (500) exceeds max_length (100)')
    );
  });

  it('errors on duplicate processing step order', () => {
    const result = validatePhasesSchema({
      processingSteps: [makeStep({ id: 'step_a', order: 1 }), makeStep({ id: 'step_b', order: 1 })],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('Duplicate order 1'));
  });

  it('errors on invalid execution step dependency reference', () => {
    const result = validatePhasesSchema({
      executionSteps: [
        makeExecStep({ id: 'step_a', dependencies: [] }),
        makeExecStep({
          id: 'step_b',
          dependencies: ['nonexistent_step'],
        }),
      ],
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining("Dependency 'nonexistent_step' does not match")
    );
  });

  it('accepts valid execution step dependency references', () => {
    const result = validatePhasesSchema({
      executionSteps: [
        makeExecStep({ id: 'step_a', dependencies: [] }),
        makeExecStep({ id: 'step_b', dependencies: ['step_a'] }),
      ],
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('warns when no processing or execution steps defined', () => {
    const result = validatePhasesSchema({});

    expect(result.valid).toBe(true);
    expect(result.warnings).toContainEqual(expect.stringContaining('No processingSteps defined'));
    expect(result.warnings).toContainEqual(expect.stringContaining('No executionSteps defined'));
  });

  it('rejects structurally invalid data', () => {
    const result = validatePhasesSchema({
      processingSteps: [{ id: '' }], // Missing required fields
    });

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('passes extra fields through (passthrough schema)', () => {
    const result = validatePhasesSchema({
      processingSteps: [makeStep()],
      phases: [{ id: 'test', name: 'Test', description: 'Extra field' }],
    });

    expect(result.valid).toBe(true);
  });
});
