// @lifecycle canonical - Coverage for the one derivation of "does this chain step's promptId resolve".
//
// The defect this replaces skipped every id containing '/', which is the canonical form for a
// nested chain step — so the nested cases below are the regression, not an edge case.
import { describe, expect, it } from '@jest/globals';

import {
  describeUnresolvedChainStep,
  resolveChainStepPromptId,
  resolveChainSteps,
} from '../../../src/modules/prompts/chain-step-resolution.js';

const REGISTERED = new Set(['readme_improver', 'deep_analysis', 'deep_analysis/initial_scan']);

describe('resolveChainStepPromptId', () => {
  it('resolves a bare id that is registered', () => {
    expect(resolveChainStepPromptId('readme_improver', 'documentation_change', REGISTERED)).toBe(
      'resolved'
    );
  });

  it('reports a bare id that is not registered', () => {
    expect(resolveChainStepPromptId('run_smoke_tests', 'documentation_change', REGISTERED)).toBe(
      'unresolved'
    );
  });

  it('resolves a nested id that is registered', () => {
    expect(
      resolveChainStepPromptId('deep_analysis/initial_scan', 'deep_analysis', REGISTERED)
    ).toBe('resolved');
  });

  it('exempts an unregistered one-level id under the chain being written', () => {
    expect(resolveChainStepPromptId('deep_analysis/synthesis', 'deep_analysis', REGISTERED)).toBe(
      'scaffolded-by-this-write'
    );
  });

  it('reports an unregistered nested id belonging to a DIFFERENT chain', () => {
    // The exemption is "this write scaffolds it", not "it looks nested". Another chain's step is
    // nobody's to create here — the '/' skip this replaces accepted exactly this.
    expect(resolveChainStepPromptId('quick_decision/recommend', 'deep_analysis', REGISTERED)).toBe(
      'unresolved'
    );
  });

  it('reports an id nested two levels below the chain — the scaffold skips it', () => {
    expect(resolveChainStepPromptId('deep_analysis/phase/step', 'deep_analysis', REGISTERED)).toBe(
      'unresolved'
    );
  });

  it('reports a bare prefix collision that is not a child', () => {
    expect(resolveChainStepPromptId('deep_analysis_extra', 'deep_analysis', REGISTERED)).toBe(
      'unresolved'
    );
  });

  it('reports the empty child id the scaffold refuses to create', () => {
    expect(resolveChainStepPromptId('deep_analysis/', 'deep_analysis', REGISTERED)).toBe(
      'unresolved'
    );
  });
});

describe('resolveChainSteps', () => {
  it('classifies each step by its index and carries the id back', () => {
    const references = resolveChainSteps(
      [
        { promptId: 'readme_improver' },
        { promptId: 'run_smoke_tests' },
        { promptId: 'my_chain/step_one' },
      ],
      'my_chain',
      REGISTERED
    );

    expect(references).toEqual([
      { stepIndex: 0, promptId: 'readme_improver', resolution: 'resolved' },
      { stepIndex: 1, promptId: 'run_smoke_tests', resolution: 'unresolved' },
      { stepIndex: 2, promptId: 'my_chain/step_one', resolution: 'scaffolded-by-this-write' },
    ]);
  });

  it("skips a step with no promptId — that is the schema's finding, not this one", () => {
    expect(
      resolveChainSteps([{ stepName: 'orphan' }, null, { promptId: '' }], 'c', REGISTERED)
    ).toEqual([]);
  });

  it('keeps the index of a skipped step, so reported positions match the authored array', () => {
    const references = resolveChainSteps(
      [{ stepName: 'orphan' }, { promptId: 'run_smoke_tests' }],
      'c',
      REGISTERED
    );

    expect(references).toEqual([
      { stepIndex: 1, promptId: 'run_smoke_tests', resolution: 'unresolved' },
    ]);
  });

  it('accepts any iterable of ids, not only a Set', () => {
    expect(resolveChainSteps([{ promptId: 'a' }], 'c', ['a'])[0]?.resolution).toBe('resolved');
  });
});

describe('describeUnresolvedChainStep', () => {
  it('addresses the step by its one-based position', () => {
    expect(
      describeUnresolvedChainStep({
        stepIndex: 2,
        promptId: 'run_smoke_tests',
        resolution: 'unresolved',
      })
    ).toBe("step 3 references unknown promptId 'run_smoke_tests'");
  });
});
