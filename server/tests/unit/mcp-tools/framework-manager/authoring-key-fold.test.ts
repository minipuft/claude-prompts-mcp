/**
 * Pins the `methodology_gates`/`methodology_elements` -> `framework_gates`/`framework_elements`
 * authoring-payload rename (plan row 5.3).
 *
 * Why this needs a test rather than tsc: the `resource_manager` input schema is `.passthrough()`,
 * so a client sending the pre-rename key parses cleanly and the key survives on the object — but
 * every typed consumer reads `undefined`. Nothing errors at any layer; the draft simply scores as
 * if it had no gates. That is the exact shape that shipped once as regression #3.
 *
 * NEGATIVE-VERIFY TARGET: delete the body of `foldDeprecatedAuthoringKeys` in
 * `framework-authoring-keys.ts` and the "pre-rename spelling" cases must fail.
 *
 * Classification: Unit (pure fold + scorer, no I/O).
 */

import { describe, expect, test } from '@jest/globals';

import type {
  FrameworkCreationData,
  FrameworkElements,
  FrameworkGate,
} from '../../../../src/mcp/tools/framework-manager/core/types.js';

import { foldDeprecatedAuthoringKeys } from '../../../../src/mcp/tools/framework-manager/services/framework-authoring-keys.js';
import { FrameworkDraftValidator } from '../../../../src/mcp/tools/framework-manager/services/framework-draft-validator.js';

const GATES: FrameworkGate[] = [
  {
    id: 'g1',
    name: 'Gate One',
    description: 'Checks context is present.',
    frameworkArea: 'context',
    priority: 'high',
    validationCriteria: ['does a thing'],
  },
  {
    id: 'g2',
    name: 'Gate Two',
    description: 'Checks analysis is present.',
    frameworkArea: 'analysis',
    priority: 'medium',
    validationCriteria: ['does another'],
  },
];

const ELEMENTS: FrameworkElements = {
  requiredSections: ['context', 'analysis'],
  sectionDescriptions: { context: 'Background', analysis: 'Decomposition' },
};

/**
 * Calls the PRODUCTION fold (`foldDeprecatedAuthoringKeys`), which mutates in place. Wrapped only
 * to return a value so assertions read naturally. Do not reimplement the fold here — a test that
 * copies the logic it is meant to guard passes whatever production does.
 */
function fold(target: FrameworkCreationData): FrameworkCreationData {
  const folded = { ...target };
  foldDeprecatedAuthoringKeys(folded);
  return folded;
}

function draft(overrides: Partial<FrameworkCreationData>): FrameworkCreationData {
  return {
    id: 'test',
    name: 'Test',
    framework: 'TEST',
    system_prompt_guidance: 'Guidance that is long enough to count.',
    description: 'A test framework.',
    phases: [
      { name: 'context', description: 'Gather context' },
      { name: 'analysis', description: 'Analyse it' },
    ],
    ...overrides,
  } as FrameworkCreationData;
}

describe('authoring-key fold: methodology_* -> framework_*', () => {
  const validator = new FrameworkDraftValidator();

  test('canonical spelling scores as complete', () => {
    const result = validator.validate(
      draft({ framework_gates: GATES, framework_elements: ELEMENTS })
    );

    expect(result.valid).toBe(true);
  });

  test('pre-rename spelling scores identically once folded', () => {
    const canonical = validator.validate(
      draft({ framework_gates: GATES, framework_elements: ELEMENTS })
    );
    const legacy = validator.validate(
      fold(draft({ methodology_gates: GATES, methodology_elements: ELEMENTS }))
    );

    expect(legacy.valid).toBe(canonical.valid);
    expect(legacy.score).toBe(canonical.score);
  });

  test('pre-rename gates without the fold are invisible to the scorer', () => {
    // Documents the silent-loss shape the fold exists to prevent: no error, just a lower score.
    const unfolded = validator.validate(draft({ methodology_gates: GATES }));

    expect(unfolded.valid).toBe(false);
    expect(unfolded.errors.join(' ')).toContain('framework_gates');
  });

  test('canonical wins when both spellings are present', () => {
    const folded = fold(
      draft({ framework_gates: GATES, methodology_gates: [] as FrameworkGate[] })
    );

    expect(folded.framework_gates).toHaveLength(GATES.length);
  });

  test('fold is a no-op when only the canonical key is set', () => {
    const folded = fold(draft({ framework_gates: GATES }));

    expect(folded.framework_gates).toEqual(GATES);
    expect(folded.methodology_gates).toBeUndefined();
  });

  test('validator reports the canonical name, not the deprecated one', () => {
    const result = validator.validate(draft({}));

    expect(result.errors.join(' ')).not.toContain('methodology_gates');
  });
});
