import { describe, expect, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { ResponseAssembler } from '../../../../src/engine/execution/formatting/response-assembler.js';

import type { ChainStepPrompt } from '../../../../src/engine/execution/operators/types.js';
import type {
  RunStepView,
  RunStepViewProvider,
} from '../../../../src/engine/gates/services/run-step-view.js';

/**
 * R-1/S7 retarget (2026-08-18): this file used to pin the assembler's handoff ENVELOPE — the
 * second producer. That producer is retired: there is exactly ONE brief producer
 * (ChainOperatorExecutor renders the EXECUTION BRIEF with the delegated step itself), and the
 * assembler emits only a one-line advisory for a NEXT delegated step. The P5 manifest wiring
 * these tests proved now lives in the operator's brief and is pinned in
 * `tests/unit/execution/operators/chain-operator-executor-delegation.test.ts` (P5 port tests).
 *
 * What still belongs HERE: (1) the negative control that the advisory carries no envelope or
 * manifest — the pin that keeps the second producer retired; (2) the P6-F1 node-addressed
 * NEXT-step resolution, which now decides WHICH step the advisory names.
 */

const assembler = new ResponseAssembler();

const buildContext = (steps: ChainStepPrompt[], gateInstructions?: string): ExecutionContext => {
  const context = new ExecutionContext({ command: 'noop' });
  context.sessionContext = {
    sessionId: 'sess-vis',
    chainId: 'chain-vis#1',
    isChainExecution: true,
    currentStep: 1,
    totalSteps: steps.length,
  };
  (context as unknown as { parsedCommand: unknown }).parsedCommand = {
    promptId: 'demo',
    steps,
  };
  if (gateInstructions !== undefined) {
    context.gateInstructions = gateInstructions;
  }
  context.executionResults = {
    content: 'Step 1 rendered content',
    metadata: {},
    generatedAt: Date.now(),
  };
  return context;
};

const steps = (
  declarations: readonly (ChainStepPrompt['visibility'] | undefined)[] = []
): ChainStepPrompt[] => [
  {
    stepNumber: 1,
    promptId: 'first',
    args: {},
    ...(declarations[0] != null ? { visibility: declarations[0] } : {}),
  },
  {
    stepNumber: 2,
    promptId: 'delegated-step',
    args: {},
    delegated: true,
    ...(declarations[1] != null ? { visibility: declarations[1] } : {}),
  },
];

describe('ResponseAssembler advisory – single-producer pin (S7)', () => {
  test('the advisory never carries an envelope or a withheld manifest, even with declarations', () => {
    // Pre-R-1 this exact fixture produced EXECUTION CONTEXT + the manifest line here. That
    // content now belongs to the operator's brief exclusively; this pin fails if the second
    // producer ever grows back.
    const context = buildContext(
      steps([{ withhold: ['chain_history'] }]),
      '### Quality Gates\nEnsure code quality meets criteria.'
    );

    const result = assembler.formatChainResponse(context, { isChainFormatting: true } as never);

    expect(result).toContain('⚡ Note');
    expect(result).toContain('delegated-step');
    expect(result).not.toContain('HANDOFF INSTRUCTIONS');
    expect(result).not.toContain('EXECUTION CONTEXT');
    expect(result).not.toContain('CONTEXT WITHHELD');
  });

  test('control: an undeclared chain emits the same advisory shape', () => {
    const context = buildContext(steps());

    const result = assembler.formatChainResponse(context, { isChainFormatting: true } as never);

    expect(result).toContain('⚡ Note');
    expect(result).not.toContain('EXECUTION CONTEXT');
    expect(result).not.toContain('CONTEXT WITHHELD');
  });
});

/**
 * P6 Tier 2 / P6-F1 — the advisory resolves the next delegated step by NODE IDENTITY, not by
 * array position. Same resolution the retired handoff used (`resolveNextStepIndex`); what it
 * feeds changed (advisory payload), what it must answer did not. Each assertion fails, in a
 * distinct way, if the resolver reverts to `currentIndex + 1`.
 */
describe('ResponseAssembler advisory – P6-F1 node-addressed step resolution', () => {
  const runView = (view: Partial<RunStepView> & Pick<RunStepView, 'nodeIds'>): RunStepView => ({
    skippedNodeIds: [],
    ...view,
  });

  const providerFor = (view: RunStepView): RunStepViewProvider => {
    const provider: RunStepViewProvider = () => view;
    return provider;
  };

  const mutatedContext = (
    chainSteps: ChainStepPrompt[],
    currentNodeId: string
  ): ExecutionContext => {
    const context = new ExecutionContext({ command: 'noop' });
    context.sessionContext = {
      sessionId: 'sess-p6f1',
      chainId: 'chain-p6f1#1',
      isChainExecution: true,
      currentStep: 1,
      currentNodeId,
      totalSteps: chainSteps.length,
    };
    (context as unknown as { parsedCommand: unknown }).parsedCommand = {
      promptId: 'demo',
      steps: chainSteps,
    };
    context.executionResults = {
      content: 'Step 1 rendered content',
      metadata: {},
      generatedAt: Date.now(),
    };
    return context;
  };

  /** n1 → n2 (retired mid-run) → n3 (delegated). The run's next live node is n3, not n2. */
  const skipShapedSteps = (): ChainStepPrompt[] => [
    { stepNumber: 1, nodeId: 'n1', promptId: 'first', args: {} },
    { stepNumber: 2, nodeId: 'n2', promptId: 'retired-step', args: {} },
    { stepNumber: 3, nodeId: 'n3', promptId: 'delegated-step', args: {}, delegated: true },
  ];

  test('after a skip, the advisory names the run’s next LIVE node, not the next array slot', () => {
    const assembler = new ResponseAssembler(
      providerFor(
        runView({ nodeIds: ['n1', 'n2', 'n3'], skippedNodeIds: ['n2'], currentNodeId: 'n1' })
      )
    );

    const result = assembler.formatChainResponse(mutatedContext(skipShapedSteps(), 'n1'), {
      isChainFormatting: true,
    } as never);

    // The positional reader lands on n2 ('retired-step'), which carries no `delegated` flag, so
    // it emits NO advisory at all. Node addressing lands on n3 and names it.
    expect(result).toContain('⚡ Note');
    expect(result).toContain('delegated-step');
    expect(result).not.toContain('retired-step');
  });

  test('after an insertion, no advisory is emitted for the planned step one slot ahead', () => {
    const chainSteps: ChainStepPrompt[] = [
      { stepNumber: 1, nodeId: 'n1', promptId: 'first', args: {} },
      { stepNumber: 2, nodeId: 'n2', promptId: 'delegated-step', args: {}, delegated: true },
    ];
    const assembler = new ResponseAssembler(
      providerFor(runView({ nodeIds: ['n1', 'unknown-x', 'n2'], currentNodeId: 'n1' }))
    );

    const result = assembler.formatChainResponse(mutatedContext(chainSteps, 'n1'), {
      isChainFormatting: true,
    } as never);

    // The run's next node is the INSERTED one, which has no parse step and therefore cannot be
    // delegated. The positional reader would emit n2's advisory a full step early.
    expect(result).not.toContain('⚡ Note');
    expect(result).not.toContain('HANDOFF');
  });

  test('standing on the last live node emits no advisory', () => {
    const chainSteps: ChainStepPrompt[] = [
      { stepNumber: 1, nodeId: 'n1', promptId: 'first', args: {} },
      { stepNumber: 2, nodeId: 'n2', promptId: 'delegated-step', args: {}, delegated: true },
    ];
    const assembler = new ResponseAssembler(
      providerFor(runView({ nodeIds: ['n1', 'n2'], currentNodeId: 'n2' }))
    );

    const result = assembler.formatChainResponse(mutatedContext(chainSteps, 'n2'), {
      isChainFormatting: true,
    } as never);

    expect(result).not.toContain('⚡ Note');
    expect(result).not.toContain('HANDOFF');
  });

  test('control: an UNMUTATED run resolves exactly what the positional reader did', () => {
    const chainSteps: ChainStepPrompt[] = [
      { stepNumber: 1, nodeId: 'n1', promptId: 'first', args: {} },
      { stepNumber: 2, nodeId: 'n2', promptId: 'delegated-step', args: {}, delegated: true },
    ];
    const view = runView({ nodeIds: ['n1', 'n2'], currentNodeId: 'n1' });

    const nodeAddressed = new ResponseAssembler(providerFor(view)).formatChainResponse(
      mutatedContext(chainSteps, 'n1'),
      { isChainFormatting: true } as never
    );
    // Same assembler with NO run view: the ordinal fallback, i.e. the pre-P6 code path.
    const positional = new ResponseAssembler().formatChainResponse(
      mutatedContext(chainSteps, 'n1'),
      { isChainFormatting: true } as never
    );

    expect(nodeAddressed).toBe(positional);
    expect(nodeAddressed).toContain('delegated-step');
  });
});
