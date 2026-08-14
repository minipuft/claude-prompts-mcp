import { describe, expect, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { ResponseAssembler } from '../../../../src/engine/execution/formatting/response-assembler.js';

import type { ChainStepPrompt } from '../../../../src/engine/execution/operators/types.js';
import type {
  RunStepView,
  RunStepViewProvider,
} from '../../../../src/engine/gates/services/run-step-view.js';

/**
 * P5 Tier 3.2, SECOND envelope producer.
 *
 * `ChainOperatorExecutor.buildDelegationCTA` is not the only handoff renderer: when a chain step
 * is formatted for response, `ResponseAssembler.buildHandoffSection` builds its own
 * `ExecutionEnvelope` (this is the one that actually carries gate + framework text). A manifest
 * wired into only the first producer would leave every real handoff unlabelled — the early-exit
 * lie this file exists to prevent.
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

describe('ResponseAssembler handoff envelope – P5 visibility', () => {
  test('a prior withhold names the item on the handoff manifest', () => {
    const context = buildContext(steps([{ withhold: ['chain_history'] }]));

    const result = assembler.formatChainResponse(context, { isChainFormatting: true } as never);

    expect(result).toContain('HANDOFF');
    expect(result).toContain('EXECUTION CONTEXT');
    expect(result).toContain('CONTEXT WITHHELD (names only, values not provided): chain_history');
  });

  test('the delegated step’s own expose cancels the manifest', () => {
    const context = buildContext(
      steps([{ withhold: ['chain_history'] }, { expose: ['chain_history'] }])
    );

    const result = assembler.formatChainResponse(context, { isChainFormatting: true } as never);

    expect(result).toContain('HANDOFF');
    expect(result).not.toContain('CONTEXT WITHHELD');
  });

  test('the manifest coexists with gate instructions rather than replacing them', () => {
    const context = buildContext(
      steps([{ withhold: ['unknowns_ledger'] }]),
      '### Quality Gates\nEnsure code quality meets criteria.'
    );

    const result = assembler.formatChainResponse(context, { isChainFormatting: true } as never);

    expect(result).toContain('Quality Gates');
    expect(result).toContain('CONTEXT WITHHELD (names only, values not provided): unknowns_ledger');
  });

  test('control: an undeclared chain produces no envelope and no manifest', () => {
    const context = buildContext(steps());

    const result = assembler.formatChainResponse(context, { isChainFormatting: true } as never);

    expect(result).toContain('HANDOFF');
    expect(result).not.toContain('EXECUTION CONTEXT');
    expect(result).not.toContain('CONTEXT WITHHELD');
  });

  test('control: an undeclared chain with gates renders the envelope exactly as before', () => {
    const context = buildContext(steps(), '### Quality Gates\nEnsure code quality meets criteria.');

    const result = assembler.formatChainResponse(context, { isChainFormatting: true } as never);

    expect(result).toContain('EXECUTION CONTEXT');
    expect(result).not.toContain('CONTEXT WITHHELD');
  });
});

/**
 * P6 Tier 2 / P6-F1 — the handoff resolves the handed-off step by NODE IDENTITY, not by array
 * position.
 *
 * The pre-P6 reader anchored on the current node id and then took `+1` in the parse array. That
 * offset is a positional answer to a question the P4 mutation policy has already invalidated:
 * once a node is retired or inserted, "the parse step after the current one" and "the node the
 * run goes to next" are different steps. Every assertion below is chosen to be DISJOINT from the
 * positional reader — each one fails, in a distinct way, if `resolveNextStepIndex` is reverted to
 * `currentIndex + 1`.
 */
describe('ResponseAssembler handoff – P6-F1 node-addressed step resolution', () => {
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

  /**
   * n1 → n2 (retired mid-run) → n3 (delegated). The run's next live node is n3, not n2.
   *
   * n1 carries the withhold: under P5 a step's own `withhold` binds DOWNSTREAM steps, so the
   * manifest attached to a handoff is built from the PRIOR declarations, not the target's own.
   */
  const skipShapedSteps = (): ChainStepPrompt[] => [
    {
      stepNumber: 1,
      nodeId: 'n1',
      promptId: 'first',
      args: {},
      visibility: { withhold: ['chain_history'] },
    },
    { stepNumber: 2, nodeId: 'n2', promptId: 'retired-step', args: {} },
    { stepNumber: 3, nodeId: 'n3', promptId: 'delegated-step', args: {}, delegated: true },
  ];

  test('after a skip, the handoff targets the run’s next LIVE node, not the next array slot', () => {
    const assembler = new ResponseAssembler(
      providerFor(
        runView({ nodeIds: ['n1', 'n2', 'n3'], skippedNodeIds: ['n2'], currentNodeId: 'n1' })
      )
    );

    const result = assembler.formatChainResponse(mutatedContext(skipShapedSteps(), 'n1'), {
      isChainFormatting: true,
    } as never);

    // The positional reader lands on n2 ('retired-step'), which carries no `delegated` flag, so it
    // emits NO handoff at all. Node addressing lands on n3 and hands off to it — with the live
    // prior's withhold resolved against that node.
    expect(result).toContain('HANDOFF');
    expect(result).toContain('delegated-step');
    expect(result).not.toContain('retired-step');
    expect(result).toContain('CONTEXT WITHHELD (names only, values not provided): chain_history');
  });

  test('a retired prior step’s withhold does not reach the handoff manifest', () => {
    // Both readers agree on the TARGET here (n4 sits one array slot after the current node n3),
    // so this test isolates the prior-declaration half of the fix: only the retired-node filter
    // separates the two answers.
    const chainSteps: ChainStepPrompt[] = [
      { stepNumber: 1, nodeId: 'n1', promptId: 'first', args: {} },
      {
        stepNumber: 2,
        nodeId: 'n2',
        promptId: 'retired-step',
        args: {},
        visibility: { withhold: ['chain_history'] },
      },
      {
        stepNumber: 3,
        nodeId: 'n3',
        promptId: 'third',
        args: {},
        visibility: { withhold: ['unknowns_ledger'] },
      },
      { stepNumber: 4, nodeId: 'n4', promptId: 'delegated-step', args: {}, delegated: true },
    ];
    const assembler = new ResponseAssembler(
      providerFor(
        runView({
          nodeIds: ['n1', 'n2', 'n3', 'n4'],
          skippedNodeIds: ['n2'],
          currentNodeId: 'n3',
        })
      )
    );

    const result = assembler.formatChainResponse(mutatedContext(chainSteps, 'n3'), {
      isChainFormatting: true,
    } as never);

    // n3's withhold is honoured; n2's is dropped — a step that will not execute cannot withhold
    // context from a step that will. The positional reader carries both.
    expect(result).toContain('CONTEXT WITHHELD (names only, values not provided): unknowns_ledger');
    expect(result).not.toContain('chain_history');
  });

  test('after an insertion, no handoff is emitted for the planned step one slot ahead', () => {
    const chainSteps: ChainStepPrompt[] = [
      { stepNumber: 1, nodeId: 'n1', promptId: 'first', args: {} },
      {
        stepNumber: 2,
        nodeId: 'n2',
        promptId: 'delegated-step',
        args: {},
        delegated: true,
        visibility: { withhold: ['chain_history'] },
      },
    ];
    const assembler = new ResponseAssembler(
      providerFor(runView({ nodeIds: ['n1', 'unknown-x', 'n2'], currentNodeId: 'n1' }))
    );

    const result = assembler.formatChainResponse(mutatedContext(chainSteps, 'n1'), {
      isChainFormatting: true,
    } as never);

    // The run's next node is the INSERTED one, which has no parse step and therefore cannot be
    // delegated. The positional reader would render n2's handoff a full step early.
    expect(result).not.toContain('HANDOFF');
    expect(result).not.toContain('CONTEXT WITHHELD');
  });

  test('standing on the last live node emits no handoff', () => {
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

    expect(result).not.toContain('HANDOFF');
  });

  test('control: an UNMUTATED run resolves exactly what the positional reader did', () => {
    const chainSteps: ChainStepPrompt[] = [
      { stepNumber: 1, nodeId: 'n1', promptId: 'first', args: {} },
      {
        stepNumber: 2,
        nodeId: 'n2',
        promptId: 'delegated-step',
        args: {},
        delegated: true,
        visibility: { withhold: ['chain_history'] },
      },
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
