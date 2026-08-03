// @lifecycle canonical - Pins the framework-requirement predicates extracted from the stage in Tier 16.
import { describe, expect, test } from '@jest/globals';

import {
  anyStepRequiresFramework,
  containsFrameworkGate,
  stepHasDisablingModifiers,
  stepRequiresFramework,
} from '../../../../../src/engine/execution/pipeline/decisions/framework/framework-requirement.js';

import type { ChainStepPrompt } from '../../../../../src/engine/execution/operators/types.js';

const FRAMEWORK_GATES: ReadonlySet<string> = new Set(['framework-compliance', 'cageerf-adherence']);
const NO_GATES: ReadonlySet<string> = new Set();

const step = (overrides: Partial<ChainStepPrompt> = {}): ChainStepPrompt =>
  ({
    stepNumber: 1,
    promptId: 'demo',
    args: {},
    ...overrides,
  }) as ChainStepPrompt;

/**
 * These decide whether framework guidance is injected at all. A false negative silently drops
 * guidance rather than erroring, so the cases that matter are the ones where a requirement is
 * expressed indirectly — through a gate id rather than the plan's own flag.
 */
describe('containsFrameworkGate', () => {
  test('finds a framework gate among ordinary ones', () => {
    expect(containsFrameworkGate(['code-quality', 'framework-compliance'], FRAMEWORK_GATES)).toBe(
      true
    );
  });

  test('returns false when no gate id is a framework gate', () => {
    expect(containsFrameworkGate(['code-quality', 'test-coverage'], FRAMEWORK_GATES)).toBe(false);
  });

  test('an empty framework-gate set matches nothing, including known ids', () => {
    // The set arrives from an async load that returns empty on failure. Matching anything here
    // would turn a gate-loader outage into unexpected framework injection.
    expect(containsFrameworkGate(['framework-compliance'], NO_GATES)).toBe(false);
  });

  test('treats undefined, null, and empty gate lists as no requirement', () => {
    expect(containsFrameworkGate(undefined, FRAMEWORK_GATES)).toBe(false);
    expect(containsFrameworkGate(null, FRAMEWORK_GATES)).toBe(false);
    expect(containsFrameworkGate([], FRAMEWORK_GATES)).toBe(false);
  });

  test('ignores empty-string gate ids rather than matching on them', () => {
    expect(containsFrameworkGate([''], new Set(['']))).toBe(false);
  });
});

describe('stepRequiresFramework', () => {
  test("honours the step plan's own requiresFramework flag", () => {
    const result = stepRequiresFramework(
      step({ executionPlan: { requiresFramework: true } as ChainStepPrompt['executionPlan'] }),
      NO_GATES
    );

    expect(result).toBe(true);
  });

  test('detects a framework gate in the planned gate list', () => {
    const result = stepRequiresFramework(
      step({
        executionPlan: {
          gates: ['framework-compliance'],
        } as ChainStepPrompt['executionPlan'],
      }),
      FRAMEWORK_GATES
    );

    expect(result).toBe(true);
  });

  test('detects a framework gate supplied inline on the step', () => {
    const result = stepRequiresFramework(
      step({ inlineGateIds: ['cageerf-adherence'] }),
      FRAMEWORK_GATES
    );

    expect(result).toBe(true);
  });

  test('a step with no plan and no gates requires nothing', () => {
    expect(stepRequiresFramework(step(), FRAMEWORK_GATES)).toBe(false);
  });
});

describe('anyStepRequiresFramework', () => {
  test('one requiring step is enough for the chain', () => {
    const steps = [step(), step({ inlineGateIds: ['framework-compliance'] }), step()];

    expect(anyStepRequiresFramework(steps, FRAMEWORK_GATES)).toBe(true);
  });

  test('no requiring step means the chain requires nothing', () => {
    expect(anyStepRequiresFramework([step(), step()], FRAMEWORK_GATES)).toBe(false);
  });

  test('an empty chain requires nothing', () => {
    expect(anyStepRequiresFramework([], FRAMEWORK_GATES)).toBe(false);
  });
});

describe('stepHasDisablingModifiers', () => {
  test('clean disables framework guidance for the step', () => {
    const result = stepHasDisablingModifiers(
      step({ executionPlan: { modifiers: { clean: true } } as ChainStepPrompt['executionPlan'] })
    );

    expect(result).toBe(true);
  });

  test('lean disables framework guidance for the step', () => {
    const result = stepHasDisablingModifiers(
      step({ executionPlan: { modifiers: { lean: true } } as ChainStepPrompt['executionPlan'] })
    );

    expect(result).toBe(true);
  });

  test('other modifiers do not disable it', () => {
    const result = stepHasDisablingModifiers(
      step({ executionPlan: { modifiers: { judge: true } } as ChainStepPrompt['executionPlan'] })
    );

    expect(result).toBe(false);
  });

  test('a step with no plan or no modifiers is not disabled', () => {
    expect(stepHasDisablingModifiers(step())).toBe(false);
    expect(
      stepHasDisablingModifiers(step({ executionPlan: {} as ChainStepPrompt['executionPlan'] }))
    ).toBe(false);
  });
});
