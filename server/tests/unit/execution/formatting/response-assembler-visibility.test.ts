import { describe, expect, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { ResponseAssembler } from '../../../../src/engine/execution/formatting/response-assembler.js';

import type { ChainStepPrompt } from '../../../../src/engine/execution/operators/types.js';

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
