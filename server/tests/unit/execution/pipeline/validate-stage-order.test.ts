/**
 * Unit spec for validateStageOrder.
 *
 * Pure function over the stage contract, so the cases are table-driven fakes rather than
 * real stages: constructing real stages would test their constructors, and the property
 * under test is a property of the array.
 */
import { describe, expect, test } from '@jest/globals';

import {
  formatStageOrderViolations,
  validateStageOrder,
} from '../../../../src/engine/execution/pipeline/validate-stage-order.js';

import type { ExecutionContext } from '../../../../src/engine/execution/context/index.js';
import type { PipelineStage } from '../../../../src/engine/execution/pipeline/stage.js';

interface StageSpec {
  readonly name: string;
  readonly provides?: readonly string[];
  readonly requires?: readonly string[];
}

const stage = (spec: StageSpec): PipelineStage => ({
  name: spec.name,
  ...(spec.provides ? { provides: spec.provides } : {}),
  ...(spec.requires ? { requires: spec.requires } : {}),
  execute: async (_context: ExecutionContext): Promise<void> => undefined,
});

/** The three invariants seeded on the real pipeline, in their correct order. */
const SESSION = stage({ name: 'SessionManagement', provides: ['sessionContext.currentStep'] });
const INJECTION = stage({
  name: 'InjectionControl',
  provides: ['state.injection'],
  requires: ['sessionContext.currentStep'],
});
const JUDGE = stage({
  name: 'JudgeSelection',
  provides: ['state.framework.clientSelectedStyle'],
});
const GUIDANCE = stage({
  name: 'PromptGuidance',
  requires: ['state.injection', 'state.framework.clientSelectedStyle'],
});

describe('validateStageOrder', () => {
  test('accepts the correctly ordered pipeline', () => {
    expect(validateStageOrder([JUDGE, SESSION, INJECTION, GUIDANCE])).toEqual([]);
  });

  test('accepts an array of stages that declare nothing', () => {
    const undeclared = ['A', 'B', 'C'].map((name) => stage({ name }));
    expect(validateStageOrder(undeclared)).toEqual([]);
  });

  test('accepts an empty array', () => {
    expect(validateStageOrder([])).toEqual([]);
  });

  describe('catches each seeded invariant when inverted', () => {
    test('InjectionControl before SessionManagement', () => {
      expect(validateStageOrder([JUDGE, INJECTION, SESSION, GUIDANCE])).toEqual([
        {
          stage: 'InjectionControl',
          missing: 'sessionContext.currentStep',
          producedBy: 'SessionManagement',
          producedAtIndex: 2,
        },
      ]);
    });

    test('PromptGuidance before InjectionControl', () => {
      expect(validateStageOrder([JUDGE, SESSION, GUIDANCE, INJECTION])).toEqual([
        {
          stage: 'PromptGuidance',
          missing: 'state.injection',
          producedBy: 'InjectionControl',
          producedAtIndex: 3,
        },
      ]);
    });

    test('PromptGuidance before JudgeSelection', () => {
      expect(validateStageOrder([SESSION, INJECTION, GUIDANCE, JUDGE])).toEqual([
        {
          stage: 'PromptGuidance',
          missing: 'state.framework.clientSelectedStyle',
          producedBy: 'JudgeSelection',
          producedAtIndex: 3,
        },
      ]);
    });
  });

  test('reports a requirement no stage provides, distinguished by null producer', () => {
    const orphan = stage({ name: 'Orphan', requires: ['state.nobodyWritesThis'] });

    expect(validateStageOrder([SESSION, orphan])).toEqual([
      {
        stage: 'Orphan',
        missing: 'state.nobodyWritesThis',
        producedBy: null,
        producedAtIndex: null,
      },
    ]);
  });

  test('reports every unmet requirement of a stage, not just the first', () => {
    const violations = validateStageOrder([GUIDANCE, JUDGE, SESSION, INJECTION]);

    expect(violations).toHaveLength(2);
    expect(violations.map((violation) => violation.missing)).toEqual([
      'state.injection',
      'state.framework.clientSelectedStyle',
    ]);
  });

  test('a stage does not satisfy its own requirement', () => {
    const selfDependent = stage({
      name: 'SelfDependent',
      provides: ['state.thing'],
      requires: ['state.thing'],
    });

    expect(validateStageOrder([selfDependent])).toEqual([
      {
        stage: 'SelfDependent',
        missing: 'state.thing',
        producedBy: 'SelfDependent',
        producedAtIndex: 0,
      },
    ]);
  });

  test('names the earliest producer when several provide the same key', () => {
    const early = stage({ name: 'EarlyProducer', provides: ['state.thing'] });
    const late = stage({ name: 'LateProducer', provides: ['state.thing'] });
    const consumer = stage({ name: 'Consumer', requires: ['state.thing'] });

    expect(validateStageOrder([consumer, early, late])).toEqual([
      {
        stage: 'Consumer',
        missing: 'state.thing',
        producedBy: 'EarlyProducer',
        producedAtIndex: 1,
      },
    ]);
  });

  test('an earlier producer satisfies a consumer even when a later one also provides', () => {
    const early = stage({ name: 'EarlyProducer', provides: ['state.thing'] });
    const late = stage({ name: 'LateProducer', provides: ['state.thing'] });
    const consumer = stage({ name: 'Consumer', requires: ['state.thing'] });

    expect(validateStageOrder([early, consumer, late])).toEqual([]);
  });
});

describe('formatStageOrderViolations', () => {
  test('distinguishes a late producer from an absent one', () => {
    const formatted = formatStageOrderViolations([
      {
        stage: 'InjectionControl',
        missing: 'sessionContext.currentStep',
        producedBy: 'SessionManagement',
        producedAtIndex: 2,
      },
      {
        stage: 'Orphan',
        missing: 'state.nobodyWritesThis',
        producedBy: null,
        producedAtIndex: null,
      },
    ]);

    expect(formatted).toBe(
      [
        '  - InjectionControl requires "sessionContext.currentStep": provided by SessionManagement at index 2, which runs later',
        '  - Orphan requires "state.nobodyWritesThis": no stage in this array provides it',
      ].join('\n')
    );
  });

  test('renders an empty list as an empty string', () => {
    expect(formatStageOrderViolations([])).toBe('');
  });
});
