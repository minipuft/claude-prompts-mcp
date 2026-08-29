// @lifecycle canonical - Coverage for ChainStepSchema strictness + the per-step framework field.
//
// Two behaviours on one schema, covered together because a test for either alone would pass while
// the other regressed: `framework` is a newly DECLARED step field, and undeclared keys changed from
// vanishing silently to being reported by name.
import { describe, expect, it } from '@jest/globals';

import { ChainStepSchema, validatePromptYaml } from '../../../src/modules/prompts/prompt-schema.js';
import { yamlToPromptData } from '../../../src/modules/prompts/yaml-prompt-loader.js';

const STEP = { promptId: 'analyze', stepName: 'Analyze' };

function yamlChain(chainSteps: Array<Record<string, unknown>>) {
  return {
    id: 'test_chain',
    name: 'Test Chain',
    description: 'A chain prompt used for chain-step strictness coverage',
    arguments: [],
    chainSteps,
  };
}

describe('ChainStepSchema — unknown keys are rejected, not dropped', () => {
  it('rejects a step key that no schema field carries, naming it', () => {
    const result = ChainStepSchema.safeParse({ ...STEP, notAField: 'x' });

    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('notAField');
  });

  it('still ACCEPTS the step — rejecting is a resource-format break needing a major bump', () => {
    // `delegation`/`delegationAgent` have no schema entry anywhere and
    // their tolerated stripping is an asserted contract (delegation-schema.test.ts), so `.strict()`
    // would reject YAML that loads today. This test is the guard against re-tightening by accident.
    expect(ChainStepSchema.safeParse({ ...STEP, delegation: true }).success).toBe(true);
  });

  it('fails the load through validatePromptYaml, naming the key and its step index', () => {
    // yaml-prompt-loader returns null when `valid` is false, so this is the difference between a
    // chain that runs under the wrong framework and one that refuses to load with a typo named.
    const result = validatePromptYaml(yamlChain([{ ...STEP }, { ...STEP, framwork: 'ReACT' }]));

    expect(result.valid).toBe(false);
    const message = result.errors.join(' ');
    expect(message).toContain('framwork');
    expect(message).toContain('chainSteps.1');
  });

  it('loads clean when every key is declared', () => {
    const result = validatePromptYaml(yamlChain([{ ...STEP, framework: 'ReACT' }]));

    expect(result.valid).toBe(true);
  });

  it('still accepts every declared field', () => {
    const result = ChainStepSchema.safeParse({
      ...STEP,
      id: 'analyze-step',
      inputMapping: { research: 'step1_result' },
      outputMapping: { analysis: 'step2_result' },
      retries: 2,
      subagentModel: 'fast',
      agentType: 'general-purpose',
      framework: 'ReACT',
      inlineGateIds: ['code-quality'],
    });

    expect(result.success).toBe(true);
  });

  it('accepts inlineGateIds, which three shipped chains already declare', () => {
    // Regression guard for the corpus: research_chain, code_review_test and tech_evaluation_chain
    // carry six of these. Removing the field from the schema would stop all three loading.
    expect(
      ChainStepSchema.safeParse({ ...STEP, inlineGateIds: ['Source Citations'] }).success
    ).toBe(true);
  });
});

describe('ChainStepSchema — per-step framework', () => {
  it('accepts a framework id as a plain string', () => {
    const result = ChainStepSchema.safeParse({ ...STEP, framework: 'ReACT' });

    expect(result.success).toBe(true);
    expect(result.success && result.data.framework).toBe('ReACT');
  });

  it('rejects an empty framework id rather than treating it as absent', () => {
    expect(ChainStepSchema.safeParse({ ...STEP, framework: '' }).success).toBe(false);
  });

  it('does not constrain the id to a hardcoded list', () => {
    // Framework validity belongs to `frameworkManager.getFramework` (project CLAUDE.md). A schema
    // enum here would be a second, staler copy of the registry — resolution is checked at
    // 12-framework-stage, which degrades to the run-wide framework for an unknown id.
    expect(ChainStepSchema.safeParse({ ...STEP, framework: 'SomeFutureFramework' }).success).toBe(
      true
    );
  });

  it('carries framework through the loader normalizer to the runtime shape', () => {
    // The schema accepting a field is not enough: `normalizeChainSteps` is a SECOND stripper with
    // its own explicit allowlist, and a field missing there is dropped after passing validation.
    // Driven through the public `yamlToPromptData` rather than a test-only export of the private
    // normalizer — the exported path is the one the loader actually uses.
    const data = yamlToPromptData({
      ...yamlChain([{ ...STEP, framework: 'ReACT' }]),
      category: 'general',
    } as never);

    expect(data.chainSteps?.[0]?.framework).toBe('ReACT');
  });

  it('does not invent a framework when none is declared', () => {
    const data = yamlToPromptData({
      ...yamlChain([{ ...STEP }]),
      category: 'general',
    } as never);

    expect(data.chainSteps?.[0]?.framework).toBeUndefined();
  });

  it('carries inlineGateIds through the normalizer (wired, P6 Tier 4 / OQ-P6-8)', () => {
    // This assertion was inverted on 2026-08-13. Its predecessor guarded the documented gap —
    // "accepted by the schema, deliberately not carried" — and said that whoever wired the field
    // would see it fail and be pointed at the two sites that must change together. Both changed
    // (this normalizer's allowlist and the stage-04 projection), so the guard did its job and now
    // states the behaviour instead of the gap. Full path coverage:
    // tests/unit/gates/inline-gate-chain-step-wiring.test.ts.
    const data = yamlToPromptData({
      ...yamlChain([{ ...STEP, inlineGateIds: ['code-quality'] }]),
      category: 'general',
    } as never);

    expect(data.chainSteps?.[0]?.inlineGateIds).toEqual(['code-quality']);
  });

  it('does not invent inlineGateIds when none is declared', () => {
    const data = yamlToPromptData({
      ...yamlChain([{ ...STEP }]),
      category: 'general',
    } as never);

    expect(data.chainSteps?.[0]).not.toHaveProperty('inlineGateIds');
  });
});
