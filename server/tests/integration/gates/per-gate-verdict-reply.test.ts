/**
 * P4.75: a FAIL reply names WHICH gates the reviewer failed, and why.
 *
 * Before this, a three-gate review that failed two of them got back the same full three-gate
 * verdict template it had already been shown, plus `failedGates[].reason` set to a literal
 * string describing response blocking rather than the gate. The per-gate detail the submission
 * carried was parsed, round-trip tested, and read by nothing.
 *
 * Composed from the production units rather than mocks — a real `ExecutionContext`, the real
 * `GateEnforcementAuthority` (parse + `index → gateId` join), the real `GateVerdictProcessor`
 * (which writes request state) and the real `ResponseAssembler` (which renders it). Each is
 * unit-tested on its own; what this asserts is that the four agree.
 *
 * Request state is the whole transport-parity argument: the verdict is submitted and the reply
 * rendered inside ONE call, on a context this test builds the same way the pipeline does. No
 * instance field survives between requests, so STDIO (one server per connection) and Streamable
 * HTTP (a fresh server per request) reach the same text by construction.
 *
 * Classification: Integration. Real collaborators; the chain session store is the only stub,
 * because it is the I/O boundary.
 */

import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../src/engine/execution/context/execution-context.js';
import { ResponseAssembler } from '../../../src/engine/execution/formatting/response-assembler.js';
import { GateEnforcementAuthority } from '../../../src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.js';
import { renderGateVerdict } from '../../../src/engine/gates/core/gate-verdict-renderer.js';
import { GateVerdictProcessor } from '../../../src/engine/gates/services/gate-verdict-processor.js';

import type { GateVerdictSubmission } from '../../../src/engine/gates/core/gate-verdict-renderer.js';
import type { Logger } from '../../../src/infra/logging/index.js';
import type { ChainSession, ChainSessionService } from '../../../src/shared/types/index.js';

const GATE_IDS = ['api-documentation', 'test-coverage', 'code-quality'];
const BLOCKED = ['test-coverage', 'code-quality'];

const createLogger = (): Logger =>
  ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

const pendingReview = () => ({
  gateIds: [...GATE_IDS],
  attemptCount: 1,
  maxAttempts: 3,
  prompts: [],
  instructions: '',
});

function createStore(): ChainSessionService {
  const review = pendingReview();
  return {
    recordGateReviewOutcome: jest.fn(async () => 'pending'),
    clearPendingGateReview: jest.fn(async () => undefined),
    advanceStep: jest.fn(async () => false),
    getPendingGateReview: jest.fn(() => review),
    isRetryLimitExceeded: jest.fn(() => false),
    setPendingGateReview: jest.fn(async () => undefined),
    setReview: jest.fn(async () => undefined),
  } as unknown as ChainSessionService;
}

const session = {
  sessionId: 'sess-verdict',
  reviews: {
    'node-1': { ...pendingReview(), nodeId: 'node-1', kind: 'gate', phase: 'awaiting-verdict' },
  },
  state: { nodes: [{ id: 'node-1' }], currentNodeId: 'node-1' },
} as unknown as ChainSession;

/**
 * Submit a rendered verdict through the real processor and return the context it wrote to —
 * the same object the assembler then reads.
 */
async function submit(rendered: string): Promise<ExecutionContext> {
  const store = createStore();
  const context = new ExecutionContext({ chain_id: 'chain-demo', gate_verdict: rendered } as never);
  context.gateEnforcement = new GateEnforcementAuthority(store, createLogger());
  context.sessionContext = {
    sessionId: 'sess-verdict',
    chainId: 'chain-demo',
    isChainExecution: true,
    currentStep: 0,
    totalSteps: 2,
    pendingReview: pendingReview(),
  } as never;
  for (const gateId of GATE_IDS) {
    context.gates.add(gateId, 'prompt' as never);
  }
  for (const gateId of BLOCKED) {
    context.gates.addBlockingGate(gateId);
  }
  context.state.gates.enforcementMode = 'blocking';
  context.executionResults = {
    content: 'Step 1 rendered content',
    metadata: {},
    generatedAt: Date.now(),
  };

  await new GateVerdictProcessor(store, createLogger()).processReviewVerdict(
    context,
    session,
    { sessionId: 'sess-verdict', currentStep: 0, currentNodeId: 'node-1' } as never,
    undefined
  );
  return context;
}

/** The three-gate FAIL this row exists for: gates 2 and 3 unmet. */
const twoOfThreeFailed: GateVerdictSubmission = {
  overall: 'FAIL',
  rationale: 'two gates unmet',
  per_gate: [
    { index: 1, passed: true, rationale: 'contract annotated' },
    { index: 2, passed: false, rationale: 'error path untested' },
    { index: 3, passed: false, rationale: 'complexity over limit' },
  ],
};

describe('a FAIL reply names the gates the reviewer failed', () => {
  let assembler: ResponseAssembler;

  beforeEach(() => {
    jest.clearAllMocks();
    assembler = new ResponseAssembler();
  });

  test('the chain reply lists exactly the failing gates, above the verdict template', async () => {
    const context = await submit(renderGateVerdict(twoOfThreeFailed));

    const reply = assembler.formatChainResponse(context, { isChainFormatting: true } as never);

    expect(reply).toContain('**Gates you marked FAIL:**');
    expect(reply).toContain('- `test-coverage` — error path untested');
    expect(reply).toContain('- `code-quality` — complexity over limit');
    // The gate the reviewer PASSED is never listed as a failure.
    expect(reply).not.toContain('- `api-documentation` —');
    expect(reply.indexOf('Gates you marked FAIL')).toBeLessThan(reply.indexOf('gate_verdict='));
  });

  test('the blocked response carries each failing gate id and its rationale', async () => {
    const context = await submit(renderGateVerdict(twoOfThreeFailed));
    context.state.gates.blockedGateIds = [...BLOCKED];
    context.state.gates.responseBlocked = true;

    const blocked = assembler.formatBlockedResponse(context);

    expect(blocked).toContain('`test-coverage` — error path untested');
    expect(blocked).toContain('`code-quality` — complexity over limit');
  });

  test('`failedGates[].reason` carries the rationale, not the blocking literal', async () => {
    const context = await submit(renderGateVerdict(twoOfThreeFailed));
    context.state.gates.blockedGateIds = [...BLOCKED];
    context.state.gates.responseBlocked = true;

    expect(assembler.buildGateValidationInfo(context)?.failedGates).toEqual([
      { id: 'test-coverage', reason: 'error path untested' },
      { id: 'code-quality', reason: 'complexity over limit' },
    ]);
  });

  test('an all-PASS submission adds no failure block and keeps the literal reason', async () => {
    // Differs from the fixture above only in the two `passed` flags. If the block still
    // appears, the assembler is reading the blocked gate list rather than the verdicts.
    const context = await submit(
      renderGateVerdict({
        ...twoOfThreeFailed,
        overall: 'PASS',
        per_gate: twoOfThreeFailed.per_gate!.map((entry) => ({ ...entry, passed: true })),
      })
    );
    context.state.gates.blockedGateIds = [...BLOCKED];
    context.state.gates.responseBlocked = true;

    expect(assembler.formatBlockedResponse(context)).not.toContain('`test-coverage` —');
    expect(assembler.buildGateValidationInfo(context)?.failedGates).toEqual([
      { id: 'test-coverage', reason: 'Gate failed (blockResponseOnFail enabled)' },
      { id: 'code-quality', reason: 'Gate failed (blockResponseOnFail enabled)' },
    ]);
  });

  test('an overall-only FAIL leaves the reply exactly as it was, with a positive control', async () => {
    // The absence below is only evidence because the SAME drive with per-gate entries does
    // produce the block — the control that shows the probe observes something.
    const withDetail = await submit(
      renderGateVerdict({
        overall: 'FAIL',
        rationale: 'unmet',
        per_gate: [{ index: 2, passed: false, rationale: 'error path untested' }],
      })
    );
    const withoutDetail = await submit(renderGateVerdict({ overall: 'FAIL', rationale: 'unmet' }));

    const render = (context: ExecutionContext) =>
      assembler.formatChainResponse(context, { isChainFormatting: true } as never);

    expect(render(withDetail)).toContain('Gates you marked FAIL');
    expect(render(withoutDetail)).not.toContain('Gates you marked FAIL');
    expect(withoutDetail.state.gates.perGateVerdicts).toBeUndefined();
  });

  test('an out-of-range index is not attributed to some other gate', async () => {
    // The parse boundary drops it, so nothing downstream sees a phantom failure.
    const context = await submit('GATE_REVIEW: FAIL - unmet\n\nGATE_VERDICTS:\n[9] FAIL - nowhere');

    expect(context.state.gates.perGateVerdicts).toBeUndefined();
    expect(
      assembler.formatChainResponse(context, { isChainFormatting: true } as never)
    ).not.toContain('Gates you marked FAIL');
  });
});
