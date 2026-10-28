// @lifecycle test - A verdict sent with its answer is graded by the step's check-tier gates.
import { describe, expect, jest, test } from '@jest/globals';

import { PromptRequestContext } from '../../../../src/engine/execution/context/prompt-request-context.js';
import { GateEnforcementAuthority } from '../../../../src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.js';
import { createSemanticReviewContext } from '../../../../src/engine/execution/pipeline/decisions/gates/semantic-review-context.js';
import { runGateReviewEvidence } from '../../../../src/engine/gates/services/gate-review-evidence.js';
import { GateVerdictProcessor } from '../../../../src/engine/gates/services/gate-verdict-processor.js';
import { ShellVerifyExecutor } from '../../../../src/engine/gates/shell/shell-verify-executor.js';
import { noopLogger } from '../../../../src/infra/logging/index.js';

import type { GateDefinitionProvider } from '../../../../src/engine/gates/core/gate-loader.js';
import type { LightweightGateDefinition } from '../../../../src/engine/gates/types.js';
import type { GateReview } from '../../../../src/shared/types/chain-execution.js';
import type {
  ChainSession,
  ChainSessionService,
} from '../../../../src/shared/types/chain-session.js';
import type { GateVerdictSubmission } from '../../../../src/shared/types/gate-evaluation.js';

const ANSWER = 'Implemented the greeting; tests pass.';
const PASS: GateVerdictSubmission = { overall: 'PASS', rationale: 'Looks done' };
const PASSING_GATE: LightweightGateDefinition = {
  id: 'gate-a',
  name: 'Tests',
  type: 'validation',
  description: 'The suite must pass',
  enforcementMode: 'blocking',
  pass_criteria: [{ type: 'shell_verify', shell_command: ['true'] }],
};
const FAILING_GATE: LightweightGateDefinition = {
  ...PASSING_GATE,
  pass_criteria: [{ type: 'shell_verify', shell_command: ['false'] }],
};

/** A step review opened when the step rendered: no answer bound yet, no checks run. */
function renderTimeReview(gate: LightweightGateDefinition): GateReview {
  return {
    nodeId: 'n1',
    kind: 'gate',
    phase: 'awaiting-verdict',
    gateIds: [gate.id],
    prompts: [],
    combinedPrompt: '',
    createdAt: 1,
    attemptCount: 0,
    maxAttempts: 3,
    metadata: {},
    semanticContext: createSemanticReviewContext('n1', 'attempt-1', [gate]),
  };
}

/**
 * Real authority, real review lifecycle, a real shell executor running `true`/`false`; only the
 * gate catalog and the session store are substituted. The run stands on `n1`, a gated step.
 */
function fixture(options: {
  gate: LightweightGateDefinition;
  openReview?: GateReview;
  answer?: string;
  stepComplete?: boolean;
}) {
  const live = [options.gate];
  const provider = {
    loadGate: jest.fn(async (id: string) => live.find((gate) => gate.id === id) ?? null),
    loadGates: jest.fn(async (ids: string[]) => live.filter((gate) => ids.includes(gate.id))),
  } as unknown as GateDefinitionProvider;
  const store = {
    setReview: jest.fn<ChainSessionService['setReview']>(async () => undefined),
    clearReview: jest.fn(async () => undefined),
    recordGateReviewOutcome: jest.fn(async () => undefined),
    isStepComplete: jest.fn(() => options.stepComplete ?? false),
  };
  const service = store as unknown as ChainSessionService;
  const context = new PromptRequestContext(
    {
      chain_id: 'chain-1',
      gate_verdict: PASS,
      ...(options.answer !== undefined ? { user_response: options.answer } : {}),
    },
    noopLogger
  );
  context.gateEnforcement = new GateEnforcementAuthority(service, noopLogger, provider, () => ({
    evaluation: {},
  }));
  context.state.gates.enforcementMode = 'blocking';
  context.state.gates.reviewGateIds = [options.gate.id];
  const sessionContext = {
    sessionId: 'session-1',
    currentStep: 1,
    currentNodeId: 'n1',
    isChainExecution: true,
    ...(options.openReview !== undefined ? { pendingReview: options.openReview } : {}),
  };
  context.sessionContext = sessionContext;
  const session = {
    sessionId: 'session-1',
    chainId: 'chain-1',
    reviews: options.openReview !== undefined ? { n1: options.openReview } : {},
    state: { currentNodeId: 'n1', nodes: [{ id: 'n1' }, { id: 'n2' }] },
  } as unknown as ChainSession;
  const executor = new ShellVerifyExecutor({
    gateSystemEnabled: () => true,
    allowlist: ['false', 'true'],
  });
  const executed = jest.spyOn(executor, 'execute');
  type Callback = NonNullable<ConstructorParameters<typeof GateVerdictProcessor>[4]>;
  const checks = jest.fn<Callback>(
    async (ids, output, scope, definitions) =>
      (
        await runGateReviewEvidence(
          ids,
          provider,
          output,
          { shellVerifyExecutor: executor },
          scope,
          definitions
        )
      ).checkResults
  );
  const processor = new GateVerdictProcessor(service, noopLogger, undefined, undefined, checks);
  return {
    context,
    store,
    checks,
    executed,
    submit: () => processor.processReviewVerdict(context, session, sessionContext, options.answer),
  };
}

function refusalText(context: PromptRequestContext): string {
  const response = context.response as { content?: Array<{ text?: string }> } | undefined;
  return (response?.content ?? []).map((part) => part.text ?? '').join('\n');
}

describe('a verdict sent with its answer runs the step gates', () => {
  test('one call, answer + PASS, no review open: a failing check refuses the PASS', async () => {
    const f = fixture({ gate: FAILING_GATE, answer: ANSWER });
    const result = await f.submit();
    expect(f.executed).toHaveBeenCalledTimes(1);
    expect(f.checks.mock.calls[0]?.[0]).toEqual(['gate-a']);
    expect(f.checks.mock.calls[0]?.[1]).toBe(ANSWER);
    expect(result.earlyExit).toBe(true);
    expect(result.passClearedThisCall).toBe(false);
    expect(refusalText(f.context)).toContain('recorded a failing check');
    expect(refusalText(f.context)).toContain('exit 1');
    expect(f.store.clearReview).not.toHaveBeenCalled();
    const stored = f.store.setReview.mock.calls.at(-1)?.[1];
    expect(stored?.checkResults).toEqual([
      expect.objectContaining({ gateId: 'gate-a', passed: false }),
    ]);
  });

  test('one call, answer + PASS, no review open: a passing check lets the PASS clear', async () => {
    const f = fixture({ gate: PASSING_GATE, answer: ANSWER });
    const result = await f.submit();
    expect(f.executed).toHaveBeenCalledTimes(1);
    expect(result.passClearedThisCall).toBe(true);
    expect(result.deferredAdvance).toMatchObject({ nodeId: 'n1', reason: 'gate-pass' });
    expect(f.store.clearReview).toHaveBeenCalledTimes(1);
  });

  test('a review opened at render time is re-graded against the answer, not its stale result', async () => {
    const stale = {
      ...renderTimeReview(FAILING_GATE),
      checkResults: [{ gateId: 'gate-a', passed: true, summary: 'ran before any answer' }],
    };
    const f = fixture({ gate: FAILING_GATE, openReview: stale, answer: ANSWER });
    const result = await f.submit();
    expect(f.executed).toHaveBeenCalledTimes(1);
    expect(result.earlyExit).toBe(true);
    expect(refusalText(f.context)).toContain('recorded a failing check');
  });

  test('control: a verdict sent alone keeps the results recorded when the answer was captured', async () => {
    const graded = {
      ...renderTimeReview(FAILING_GATE),
      checkResults: [{ gateId: 'gate-a', passed: true, summary: 'graded on capture' }],
    };
    const f = fixture({ gate: FAILING_GATE, openReview: graded, stepComplete: true });
    const result = await f.submit();
    expect(f.executed).not.toHaveBeenCalled();
    expect(f.checks).not.toHaveBeenCalled();
    expect(result.passClearedThisCall).toBe(true);
  });
});
