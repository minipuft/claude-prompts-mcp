import { describe, expect, test } from '@jest/globals';

import { ResponseAssembler } from '../../../../src/engine/execution/formatting/response-assembler.js';
import { UNKNOWN_INTERRUPT_GATE_ID } from '../../../../src/engine/execution/pipeline/decisions/index.js';

import type { GateReview } from '../../../../src/shared/types/chain-execution.js';
import type { ChainSession } from '../../../../src/shared/types/chain-session.js';

const assembler = new ResponseAssembler();
const SCOPE = { organizationId: null, workspaceId: 'ws-a', continuityScopeId: 'cont-a' };
const TOKEN = 'hnd_SECRET_CREDENTIAL';
const BASE_REVIEW = { nodeId: 'n2', kind: 'gate', phase: 'awaiting-verdict', gateIds: ['g'] };
const review = (extra: Partial<GateReview> = {}): Record<string, GateReview> => ({
  n2: { ...BASE_REVIEW, prompts: [], createdAt: 1, attemptCount: 0, ...extra } as GateReview,
});
function run(over: Partial<ChainSession> = {}, currentNodeId: string | null = 'n2'): ChainSession {
  return {
    sessionId: '7c1f0e9a-run-uuid',
    chainId: 'chain-demo#1',
    state: {
      currentNodeId,
      nodes: ['n1', 'n2', 'n3'].map((id) => ({ id, promptId: id, stepName: id })),
      lastUpdated: 1,
      stepStates: new Map(),
    },
    ...{ executionOrder: ['n1'], startTime: 1, lastActivity: 1, originalArgs: {} },
    runStatus: 'working',
    conversationPause: { kind: 'conversation', nodeId: currentNodeId, pausedAt: 5 },
    handoffToken: TOKEN,
    ...over,
  } as ChainSession;
}
const resumed = (session: ChainSession) =>
  assembler.formatConversationControl(session.chainId, {
    outcome: 'resumed',
    inspection: { ownerPid: '1', scope: SCOPE, session },
  });
const packetOf = (response: { structuredContent?: Record<string, unknown> }) =>
  response.structuredContent?.['conversation_control'] as Record<string, any>;

describe('conversation-control packet and text agree with one run snapshot', () => {
  const detachedOwed = new Map([
    ['n3', { state: 'pending' as const, isPlaceholder: true, spawnedAt: 2 }],
  ]);
  test.each([
    ['ordinary review', run({ reviews: review() }), 'review', 'awaits a `gate_verdict`'],
    [
      'blocking unknown',
      run({ reviews: review({ gateIds: [UNKNOWN_INTERRUPT_GATE_ID] }) }),
      'blocking-unknown',
      'blocking-unknown hold is still pending',
    ],
    [
      'exhausted retry',
      run({ reviews: review({ phase: 'exhausted' }) }),
      'exhausted-retry',
      'retry budget is spent',
    ],
    [
      'shell verification',
      run({ pendingShellVerification: { nodeId: 'n2', gateId: 'g' } as never }),
      'shell-verification',
      'shell verification of step 2',
    ],
    [
      'owed detached report, past the last node',
      run({ state: { ...run().state, currentNodeId: null, stepStates: detachedOwed } }, null),
      'detached-report',
      '`HANDOFF RESULT` trailer `node: n3`',
    ],
  ])('%s: resumed reply names the still-owed obligation', (_name, session, kind, phrase) => {
    const response = resumed(session);
    const text = response.content[0]!.text;
    const packet = packetOf(response);
    const current = session.state.currentNodeId;
    expect(packet.outcome).toBe('resumed');
    expect(packet.run).toMatchObject({
      runId: '7c1f0e9a-run-uuid',
      chainId: 'chain-demo#1',
      scope: SCOPE,
      currentNodeId: current,
      step: { current: current === null ? 3 : 2, total: 3 },
      pause: session.conversationPause,
    });
    expect(packet.run.obligations.map((owed: { kind: string }) => owed.kind)).toEqual([kind]);
    const [owed] = packet.run.obligations;
    expect(text).toContain(`step ${owed.step} (node \`${owed.nodeId}\`)`);
    expect(text).toContain(phrase);
    expect(text).toContain(current === null ? 'past its last step (3 of 3)' : 'at step 2 of 3');
    expect(text).not.toMatch(/continue in a separate call with the action/i);
  });

  test('with nothing held, the current step itself is the obligation', () => {
    expect(packetOf(resumed(run())).run.obligations).toEqual([
      { kind: 'step', nodeId: 'n2', step: 2 },
    ]);
  });

  test('the credential reaches pause and custody text only, never a packet or a refusal', () => {
    const inspection = { ownerPid: '1', scope: SCOPE, session: run() };
    const paused = assembler.formatConversationControl('chain-demo#1', {
      outcome: 'paused',
      inspection,
      token: TOKEN,
    });
    const custody = assembler.formatPausedCustody(run(), SCOPE);
    const refusal = assembler.formatPausedRefusal(run(), SCOPE, false);
    for (const response of [paused, custody, refusal, resumed(run())]) {
      expect(JSON.stringify(response.structuredContent)).not.toContain(TOKEN);
    }
    expect(paused.content[0]!.text).toContain(TOKEN);
    expect(custody.content[0]!.text).toContain(TOKEN);
    expect(refusal.content[0]!.text).not.toContain(TOKEN);
    expect(packetOf(refusal)).toMatchObject({
      outcome: 'refused',
      refusal: { reason: 'conversation-paused', retryable: false },
      run: { runId: '7c1f0e9a-run-uuid', scope: SCOPE },
    });
    expect(packetOf(custody).outcome).toBe('claimed');
  });

  test('busy is its own retryable refusal with no run identity', () => {
    const response = assembler.formatConversationControl('chain-demo#1', {
      outcome: 'refused',
      sessionId: 'chain-demo#1',
      chainId: null,
      scope: SCOPE,
      reason: 'busy',
      inspection: null,
    });
    expect(response.isError).toBe(true);
    expect(response.content[0]!.text).toContain('Control Busy');
    expect(response.content[0]!.text).toContain('Retry the same call');
    expect(packetOf(response)).toEqual({
      kind: 'conversation_control',
      outcome: 'refused',
      refusal: { reason: 'busy', retryable: true },
    });
  });
});
