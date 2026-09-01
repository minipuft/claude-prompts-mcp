// @lifecycle test - P6 Tier 5 row 5.1: every field an IR node can carry survives compilation.
/**
 * `compileWorkflowIR` — the mapping edges.
 *
 * The compiler is the one place where the IR vocabulary becomes the runtime's. A field dropped
 * here is silently dead: the submission validated, the run executed, and the declaration did
 * nothing — the P6-F7 stripper failure in miniature, which is why every declarable node field
 * gets its own assertion rather than one round-trip check over a maximal fixture.
 */

import {
  compileWorkflowIR,
  WorkflowCompileError,
} from '../../../src/modules/workflow-ir/compiler.js';
import { validateWorkflowIR } from '../../../src/modules/workflow-ir/validator.js';

import type { WorkflowIR, WorkflowNode } from '../../../src/modules/workflow-ir/types.js';
import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';

const converted = (id: string): ConvertedPrompt => ({
  id,
  name: id,
  description: id,
  category: 'analysis',
  userMessageTemplate: `Body of ${id}`,
  systemMessage: '',
  arguments: [],
});

const deps = { lookupPrompt: (promptId: string) => converted(promptId) };

const node = (id: string, overrides: Partial<WorkflowNode> = {}): WorkflowNode => ({
  id,
  promptId: 'research_docs',
  ...overrides,
});

const ir = (overrides: Partial<WorkflowIR> = {}): WorkflowIR => ({
  version: 1,
  nodes: [node('gather'), node('synthesize')],
  ...overrides,
});

/** Compile through the validator, so no test can compile an order the validator would refuse. */
const compileValidated = (workflow: WorkflowIR) => {
  const validation = validateWorkflowIR(workflow, {
    lookupPrompt: () => ({ requiredArguments: [] }),
  });
  if (!validation.ok) throw new Error(JSON.stringify(validation.rejections));
  return compileWorkflowIR(workflow, validation.order, deps);
};

describe('compileWorkflowIR — order and identity', () => {
  it('emits steps in the linearized order, not the declaration order', () => {
    const compiled = compileValidated(ir({ edges: [{ from: 'synthesize', to: 'gather' }] }));
    expect(compiled.steps.map((step) => step.nodeId)).toEqual(['synthesize', 'gather']);
  });

  it('numbers steps by run position, so stepNumber and nodeId agree on the same step', () => {
    const compiled = compileValidated(ir({ edges: [{ from: 'synthesize', to: 'gather' }] }));
    expect(compiled.steps.map((step) => [step.stepNumber, step.nodeId])).toEqual([
      [1, 'synthesize'],
      [2, 'gather'],
    ]);
  });

  it('carries the declared node id as the step node id — the id space gates address', () => {
    const compiled = compileValidated(ir());
    expect(compiled.steps.map((step) => step.nodeId)).toEqual(['gather', 'synthesize']);
  });

  it('resolves each step to its converted prompt', () => {
    const compiled = compileValidated(
      ir({ nodes: [node('a', { promptId: 'alpha' }), node('b', { promptId: 'beta' })] })
    );
    expect(compiled.steps.map((step) => step.convertedPrompt?.id)).toEqual(['alpha', 'beta']);
    expect(compiled.steps.map((step) => step.promptId)).toEqual(['alpha', 'beta']);
  });
});

describe('compileWorkflowIR — field mapping (acceptance clause d)', () => {
  it('maps a gate binding through inlineGateIds, cloned rather than aliased', () => {
    const ids = ['source-quality'];
    const compiled = compileValidated(ir({ nodes: [node('gather', { inlineGateIds: ids })] }));
    expect(compiled.steps[0]?.inlineGateIds).toEqual(['source-quality']);
    expect(compiled.steps[0]?.inlineGateIds).not.toBe(ids);
  });

  it('maps visibility in both directions, cloned rather than aliased', () => {
    const visibility = { withhold: ['chain_history'], expose: ['previous_step_output'] } as const;
    const compiled = compileValidated(ir({ nodes: [node('gather', { visibility })] }));
    expect(compiled.steps[0]?.visibility).toEqual({
      withhold: ['chain_history'],
      expose: ['previous_step_output'],
    });
    expect(compiled.steps[0]?.visibility?.withhold).not.toBe(visibility.withhold);
  });

  it('maps the delegation fields but does NOT set `delegated` — stage 06 owns that flag', () => {
    // Two producers for one flag is how the two invocation paths drift apart. Stage 06's
    // `markDelegatedStepPrompts` derives it from `subagentModel` on every path since P6 Tier 1.
    const compiled = compileValidated(
      ir({ nodes: [node('gather', { subagentModel: 'fast', agentType: 'general-purpose' })] })
    );
    expect(compiled.steps[0]?.subagentModel).toBe('fast');
    expect(compiled.steps[0]?.agentType).toBe('general-purpose');
    expect(compiled.steps[0]?.delegated).toBeUndefined();
  });

  it('maps input and output mappings', () => {
    const compiled = compileValidated(
      ir({
        nodes: [
          node('gather', {
            inputMapping: { prior: 'step1_result' },
            outputMapping: { findings: 'gather' },
          }),
        ],
      })
    );
    expect(compiled.steps[0]?.inputMapping).toEqual({ prior: 'step1_result' });
    expect(compiled.steps[0]?.outputMapping).toEqual({ findings: 'gather' });
  });

  it('maps framework and retries', () => {
    const compiled = compileValidated(
      ir({ nodes: [node('gather', { framework: 'CAGEERF', retries: 2 })] })
    );
    expect(compiled.steps[0]?.framework).toBe('CAGEERF');
    expect(compiled.steps[0]?.retries).toBe(2);
  });

  it('maps args and does not alias the submitted object', () => {
    const args = { topic: 'caching' };
    const compiled = compileValidated(ir({ nodes: [node('gather', { args })] }));
    expect(compiled.steps[0]?.args).toEqual({ topic: 'caching' });
    expect(compiled.steps[0]?.args).not.toBe(args);
  });

  it('omits undeclared optional fields rather than writing them as undefined', () => {
    // An explicit `undefined` and an absent key are indistinguishable after the blueprint's
    // JSON clone, but NOT to a byte-equality comparison against an equivalent YAML chain's step.
    const compiled = compileValidated(ir({ nodes: [node('gather')] }));
    const step = compiled.steps[0] as unknown as Record<string, unknown>;
    for (const absent of [
      'inputMapping',
      'outputMapping',
      'retries',
      'subagentModel',
      'agentType',
      'framework',
      'inlineGateIds',
      'visibility',
    ]) {
      expect(Object.hasOwn(step, absent)).toBe(false);
    }
  });
});

describe('compileWorkflowIR — run-level output', () => {
  it('takes promptArgs from the FIRST step in RUN order, not declaration order', () => {
    const compiled = compileValidated(
      ir({
        nodes: [
          node('gather', { args: { which: 'gather' } }),
          node('synthesize', { args: { which: 'synthesize' } }),
        ],
        edges: [{ from: 'synthesize', to: 'gather' }],
      })
    );
    expect(compiled.promptArgs).toEqual({ which: 'synthesize' });
  });

  it('projects only the budget fields that outlive validation', () => {
    const compiled = compileValidated(
      ir({
        budget: { maxNodes: 4, maxFanOut: 2, maxInsertions: 1, declaredCostCeiling: 50_000 },
      })
    );
    expect(compiled.budget).toEqual({ maxInsertions: 1, declaredCostCeiling: 50_000 });
  });

  it('carries pauseOnBlocking, the behavioural dial, past the stripper (row 1.3, hop 2 of 4)', () => {
    // `compileBudget` drops every budget field with no post-validation reader, so a knob declared
    // only on `workflowBudgetSchema` never reaches stage 16 — it typechecks the whole way and
    // reads `undefined` forever (DEV-T0-3). This assertion is that hop.
    expect(compileValidated(ir({ budget: { pauseOnBlocking: true } })).budget).toEqual({
      pauseOnBlocking: true,
    });
    // An explicit `false` is carried too: the run must be able to report what it was asked for.
    expect(compileValidated(ir({ budget: { pauseOnBlocking: false } })).budget).toEqual({
      pauseOnBlocking: false,
    });
  });

  it('omits the budget entirely when only structural caps were declared', () => {
    // maxNodes/maxFanOut are answered at validation and have no reader afterwards; persisting
    // them would be two write-only fields on every run that declared one.
    const compiled = compileValidated(ir({ budget: { maxNodes: 4, maxFanOut: 2 } }));
    expect(compiled.budget).toBeUndefined();
  });

  it('omits the budget when none was declared', () => {
    expect(compileValidated(ir()).budget).toBeUndefined();
  });

  it('keeps maxInsertions: 0 distinguishable from an undeclared cap', () => {
    // 0 opts out of adaptive insertion; undefined means "server default". Collapsing them would
    // make an explicit opt-out unexpressible.
    expect(compileValidated(ir({ budget: { maxInsertions: 0 } })).budget).toEqual({
      maxInsertions: 0,
    });
  });
});

describe('compileWorkflowIR — refuses an unvalidated submission', () => {
  it('throws when the order names a node the IR does not declare', () => {
    expect(() => compileWorkflowIR(ir(), ['gather', 'ghost'], deps)).toThrow(WorkflowCompileError);
  });

  it('throws when a referenced prompt does not resolve', () => {
    expect(() =>
      compileWorkflowIR(ir(), ['gather', 'synthesize'], { lookupPrompt: () => undefined })
    ).toThrow(WorkflowCompileError);
  });
});
