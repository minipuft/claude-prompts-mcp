/**
 * P4.89: `GateVerdictProcessor` decides a step advance; it does not perform one.
 *
 * Every advance this processor reached used to run inside the verdict method, which is before
 * `StepCaptureService` captures the step the verdict answered. On a run's final step that is
 * observable on the wire — advancing past the last node latches the run `completed` and
 * announces `chain/complete`, ahead of the `step_complete` for the step just answered
 * (`tests/integration/hooks/chain-lifecycle-emission.integration.test.ts` drives that order).
 *
 * The defect had a SHAPE — a `chainSessionStore.advanceStep(...)` call inside a verdict path —
 * and four sites carried it: the deferred PASS, the pending-review PASS, and the advisory and
 * informational FAILs. The first test below covers the deferred PASS (the other three are
 * covered in the sibling `-action` and `-advisory` files); the last one closes the class, by
 * failing when a fifth advance appears anywhere in the file outside the single application
 * point the stage calls after the capture.
 *
 * Classification: Unit (one processor, stubbed store and context) plus one source-shape check.
 */

import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { GateVerdictProcessor } from '../../../../src/engine/gates/services/gate-verdict-processor.js';

import type { Logger } from '../../../../src/infra/logging/index.js';
import type { ChainSession, ChainSessionService } from '../../../../src/shared/types/index.js';

const PROCESSOR_SOURCE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../src/engine/gates/services/gate-verdict-processor.ts'
);

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

function createStore() {
  return {
    advanceStep: jest.fn(async () => ({ ordinal: 2, nodeId: 'node-2' })),
    getPendingShellVerification: jest.fn((): unknown => undefined),
    setPendingShellVerification: jest.fn(async () => undefined),
    recordGateReviewOutcome: jest.fn(async () => undefined),
    clearReview: jest.fn(async () => undefined),
    setReview: jest.fn(async () => undefined),
    isStepComplete: jest.fn(() => false),
    getSession: jest.fn(() => undefined),
    getChainContext: jest.fn(() => ({ step_results: { 1: 'step one answer' } })),
  } as unknown as ChainSessionService & Record<string, jest.Mock>;
}

/** A context whose gate authority opens the review a verdict answers — the deferred shape. */
function createContext() {
  return {
    getGateVerdict: () => 'GATE_REVIEW: PASS - fine',
    gateEnforcement: {
      parseVerdict: () => ({
        verdict: 'PASS' as const,
        rationale: 'fine',
        raw: 'GATE_REVIEW: PASS - fine',
        source: 'gate_verdict' as const,
      }),
      createReview: async (_sessionId: string, kind: string, nodeId: string) => ({
        nodeId,
        kind,
        phase: 'awaiting-verdict',
        combinedPrompt: '',
        gateIds: [],
        prompts: [],
        createdAt: 1,
        attemptCount: 0,
        maxAttempts: 2,
      }),
      parseGateVerdicts: () => [],
    },
    setResponse: jest.fn(),
    state: { gates: { enforcementMode: 'blocking' }, session: {} },
    diagnostics: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    getScopeOptions: () => ({}),
    frameworkAuthority: { getCachedDecision: () => undefined },
    sessionContext: undefined as unknown,
  } as never;
}

const session = {
  sessionId: 'session-1',
  state: { currentNodeId: 'node-1', nodes: [{ id: 'node-1' }, { id: 'node-2' }] },
} as unknown as ChainSession;

describe('GateVerdictProcessor defers every advance it decides', () => {
  let store: ReturnType<typeof createStore>;
  let processor: GateVerdictProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    store = createStore();
    processor = new GateVerdictProcessor(store, createLogger());
  });

  test('a deferred PASS decides the advance without performing it', async () => {
    const context = createContext();

    const result = await processor.processReviewVerdict(
      context,
      session,
      { sessionId: 'session-1', currentStep: 1 } as never,
      'an answer'
    );

    expect(result.passClearedThisCall).toBe(true);
    expect(store.advanceStep).not.toHaveBeenCalled();
    expect(result.deferredAdvance).toEqual({
      sessionId: 'session-1',
      nodeId: 'node-1',
      reason: 'gate-pass',
    });

    // Positive control for the assertion above: the same store DOES move when the decision is
    // applied, so "not called" is evidence about timing rather than about a store nobody wired.
    await processor.applyDeferredAdvance(context, result.deferredAdvance!);
    expect(store.advanceStep).toHaveBeenCalledWith('session-1', 'node-1');
  });

  test('R19: a PASS with no answer and no open review is refused and opens no review', async () => {
    const context = createContext();
    const createReview = jest.spyOn(
      (context as never as { gateEnforcement: { createReview: () => unknown } }).gateEnforcement,
      'createReview'
    );

    const result = await processor.processReviewVerdict(
      context,
      session,
      { sessionId: 'session-1', currentStep: 1 } as never,
      undefined
    );

    expect(result.earlyExit).toBe(true);
    expect(result.passClearedThisCall).toBe(false);
    expect(result.deferredAdvance).toBeUndefined();
    expect(createReview).not.toHaveBeenCalled();
    const response = (context as never as { setResponse: jest.Mock }).setResponse.mock
      .calls[0]?.[0] as { content: Array<{ text: string }>; isError: boolean };
    expect(response.isError).toBe(true);
    expect(response.content[0]?.text).toContain('answer step 1 first');
  });

  describe('R19: a PASS with no answer on an open review of node-1', () => {
    const reviewed = {
      ...session,
      reviews: {
        'node-1': {
          nodeId: 'node-1',
          kind: 'gate',
          phase: 'awaiting-verdict',
          combinedPrompt: '',
          gateIds: [],
          prompts: [],
          createdAt: 1,
          attemptCount: 0,
          maxAttempts: 2,
        },
      },
    } as unknown as ChainSession;

    test('is refused while node-1 holds no captured output', async () => {
      const context = createContext();
      const result = await processor.processReviewVerdict(
        context,
        reviewed,
        { sessionId: 'session-1', currentStep: 1 } as never,
        undefined
      );

      expect(result.deferredAdvance).toBeUndefined();
      expect(store.recordGateReviewOutcome).not.toHaveBeenCalled();
      const text = (context as never as { setResponse: jest.Mock }).setResponse.mock.calls[0]?.[0];
      expect(JSON.stringify(text)).toContain('Step 1 has no answer yet');
    });

    test('CONTROL: answers the review once node-1 holds its captured output', async () => {
      (store.isStepComplete as jest.Mock<() => boolean>).mockReturnValue(true);
      const context = createContext();
      const result = await processor.processReviewVerdict(
        context,
        reviewed,
        { sessionId: 'session-1', currentStep: 1 } as never,
        undefined
      );

      expect(result.deferredAdvance).toEqual({
        sessionId: 'session-1',
        nodeId: 'node-1',
        reason: 'gate-pass',
      });
      expect(store.recordGateReviewOutcome).toHaveBeenCalledTimes(1);
    });
  });

  test('applying the advance publishes the new position on the context', async () => {
    const context = createContext();
    (context as never as { sessionContext: unknown }).sessionContext = {
      sessionId: 'session-1',
      currentStep: 1,
      currentNodeId: 'node-1',
    };

    await processor.applyDeferredAdvance(context, {
      sessionId: 'session-1',
      nodeId: 'node-1',
      reason: 'gate-pass',
    });

    const snapshot = (context as never as { sessionContext: Record<string, unknown> })
      .sessionContext;
    expect(snapshot.currentStep).toBe(2);
    expect(snapshot.currentNodeId).toBe('node-2');
  });

  /**
   * R25 (P6.24): `step_complete` announces the run moving past a step, so the application point
   * is also the one place it is emitted — only when the advance MOVED the run, which a held
   * capture or an in-budget FAIL never reaches, and a re-applied advance does not do.
   */
  describe('the application announces the step the run moved past', () => {
    const standingOn = (currentNodeId: string) =>
      ({
        sessionId: 'session-1',
        chainId: 'chain-a',
        state: { currentNodeId, nodes: [{ id: 'node-1' }, { id: 'node-2' }] },
      }) as unknown as ChainSession;

    function announcing(currentNodeId: string) {
      (store.getSession as jest.Mock).mockReturnValue(standingOn(currentNodeId));
      const hooks = { emitStepComplete: jest.fn(async () => undefined) };
      const emitter = { emitChainStepComplete: jest.fn() };
      const announcer = new GateVerdictProcessor(
        store,
        createLogger(),
        hooks as never,
        emitter as never
      );
      return { announcer, hooks, emitter };
    }

    test('an advance that moves the run announces the step once, with its output', async () => {
      const { announcer, hooks, emitter } = announcing('node-1');
      await announcer.applyDeferredAdvance(createContext(), {
        sessionId: 'session-1',
        nodeId: 'node-1',
        reason: 'captured',
      });
      expect(emitter.emitChainStepComplete.mock.calls).toEqual([
        [{ chainId: 'chain-a', stepIndex: 1, status: 'passed' }],
      ]);
      expect(hooks.emitStepComplete).toHaveBeenCalledTimes(1);
      expect(hooks.emitStepComplete.mock.calls[0]?.slice(0, 3)).toEqual([
        'chain-a',
        1,
        'step one answer',
      ]);
    });

    test('a skip announces the step it moved past as failed', async () => {
      const { announcer, emitter } = announcing('node-1');
      await announcer.applyDeferredAdvance(createContext(), {
        sessionId: 'session-1',
        nodeId: 'node-1',
        reason: 'gate-skip',
      });
      expect(emitter.emitChainStepComplete.mock.calls).toEqual([
        [{ chainId: 'chain-a', stepIndex: 1, status: 'failed' }],
      ]);
    });

    test('R29: a pending shell verification holds every advance; nothing moves or announces', async () => {
      const { announcer, hooks, emitter } = announcing('node-1');
      (store.getPendingShellVerification as jest.Mock).mockReturnValue({ nodeId: 'node-1' });
      await announcer.applyDeferredAdvance(createContext(), {
        sessionId: 'session-1',
        nodeId: 'node-1',
        reason: 'gate-pass',
      });
      expect(store.getPendingShellVerification).toHaveBeenCalledWith('session-1');
      expect(store.advanceStep).not.toHaveBeenCalled();
      expect(emitter.emitChainStepComplete).not.toHaveBeenCalled();
      expect(hooks.emitStepComplete).not.toHaveBeenCalled();
    });

    /**
     * P6.53: a check re-armed for the next answer (no node) after its pass was left to an open
     * review holds only the capture it will grade. The review's verdict moves its step; an
     * answer captured on this call is still held for the check.
     */
    test('P6.53: a check armed for the next answer lets a verdict move its step', async () => {
      const { announcer, emitter } = announcing('node-1');
      (store.getPendingShellVerification as jest.Mock).mockReturnValue({ attemptCount: 0 });
      await announcer.applyDeferredAdvance(createContext(), {
        sessionId: 'session-1',
        nodeId: 'node-1',
        reason: 'gate-pass',
      });
      expect(store.advanceStep).toHaveBeenCalledWith('session-1', 'node-1');
      expect(emitter.emitChainStepComplete).toHaveBeenCalledTimes(1);
    });

    test('P6.53 control: the same check holds the answer captured on this call', async () => {
      const { announcer, emitter } = announcing('node-1');
      (store.getPendingShellVerification as jest.Mock).mockReturnValue({ attemptCount: 0 });
      const context = createContext() as unknown as {
        state: { session: { capturedStep?: { nodeId: string; ordinal: number } } };
      };
      context.state.session.capturedStep = { nodeId: 'node-1', ordinal: 1 };
      await announcer.applyDeferredAdvance(context as never, {
        sessionId: 'session-1',
        nodeId: 'node-1',
        reason: 'gate-pass',
      });
      expect(store.advanceStep).not.toHaveBeenCalled();
      expect(emitter.emitChainStepComplete).not.toHaveBeenCalled();
    });

    /**
     * P6.54: the hold moves nothing, so it keeps WHY the advance was decided on the check for the
     * call whose pass releases the step. A skipped review's step is then announced `failed`.
     */
    test('P6.54: a held skip keeps its reason on the check that holds the step', async () => {
      const { announcer } = announcing('node-1');
      (store.getPendingShellVerification as jest.Mock).mockReturnValue({
        nodeId: 'node-1',
        attemptCount: 2,
      });
      await announcer.applyDeferredAdvance(createContext(), {
        sessionId: 'session-1',
        nodeId: 'node-1',
        reason: 'gate-skip',
      });
      expect(store.advanceStep).not.toHaveBeenCalled();
      expect((store.setPendingShellVerification as jest.Mock).mock.calls).toEqual([
        [
          'session-1',
          {
            nodeId: 'node-1',
            attemptCount: 2,
            heldAdvance: { nodeId: 'node-1', reason: 'gate-skip' },
          },
        ],
      ]);
    });

    test("P6.54 control: a held capture records nothing: the release's default is its reason", async () => {
      const { announcer } = announcing('node-1');
      (store.getPendingShellVerification as jest.Mock).mockReturnValue({ nodeId: 'node-1' });
      await announcer.applyDeferredAdvance(createContext(), {
        sessionId: 'session-1',
        nodeId: 'node-1',
        reason: 'captured',
      });
      expect(store.advanceStep).not.toHaveBeenCalled();
      expect(store.setPendingShellVerification).not.toHaveBeenCalled();
    });

    test('an advance the run already made announces nothing', async () => {
      // The store answers with the position the run already holds: nothing moved.
      const { announcer, hooks, emitter } = announcing('node-2');
      await announcer.applyDeferredAdvance(createContext(), {
        sessionId: 'session-1',
        nodeId: 'node-1',
        reason: 'gate-pass',
      });
      expect(store.advanceStep).toHaveBeenCalledTimes(1); // the probe ran
      expect(emitter.emitChainStepComplete).not.toHaveBeenCalled();
      expect(hooks.emitStepComplete).not.toHaveBeenCalled();
    });
  });

  test('step_complete has one emitter for an advance, and the capture advances nothing itself', () => {
    const engine = resolve(dirname(PROCESSOR_SOURCE), '../..');
    const capture = readFileSync(
      resolve(engine, 'execution/capture/step-capture-service.ts'),
      'utf8'
    );
    const processor = readFileSync(PROCESSOR_SOURCE, 'utf8');

    // The processor's one emitter sits in the method `applyDeferredAdvance` calls.
    expect(processor.match(/\.emitChainStepComplete\(/g) ?? []).toHaveLength(1);
    expect(processor.match(/this\.announceAdvancedStep\(/g) ?? []).toHaveLength(1);
    const application = processor.slice(processor.indexOf('async applyDeferredAdvance('));
    expect(application).toContain('this.announceAdvancedStep(');

    // The capture service's own emitter serves a detached node's late report only, and its one
    // store advance is passing a detached node on a placeholder, which announces nothing.
    expect(capture.match(/\.emitChainStepComplete\(/g) ?? []).toHaveLength(1);
    expect(capture.match(/this\.announceStepComplete\(/g) ?? []).toHaveLength(1);
    const lateReport = capture.slice(capture.indexOf('async recordDetachedReport('));
    expect(lateReport.slice(0, lateReport.indexOf('\n  }\n'))).toContain(
      'this.announceStepComplete('
    );
    expect(capture.match(/chainSessionStore\.advanceStep\(/g) ?? []).toHaveLength(1);
  });

  test('the file performs an advance in exactly one place — the deferred application', () => {
    const source = readFileSync(PROCESSOR_SOURCE, 'utf8');

    const callSites = source.match(/chainSessionStore\.advanceStep\(/g) ?? [];
    expect(callSites).toHaveLength(1);

    // And that one site sits inside the method the stage calls after the capture. A new verdict
    // path that advances on its own reintroduces the ordering defect, and fails here.
    const applicationPoint = source.indexOf('async applyDeferredAdvance(');
    expect(applicationPoint).toBeGreaterThan(-1);
    expect(source.slice(applicationPoint)).toContain('chainSessionStore.advanceStep(');
  });
});
