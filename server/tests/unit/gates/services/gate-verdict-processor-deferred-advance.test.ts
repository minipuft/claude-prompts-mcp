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
    getPendingGateReview: jest.fn(() => undefined),
    recordGateReviewOutcome: jest.fn(async () => 'cleared'),
    clearPendingGateReview: jest.fn(async () => undefined),
    isRetryLimitExceeded: jest.fn(() => false),
  } as unknown as ChainSessionService & Record<string, jest.Mock>;
}

/** A context whose gate authority clears the verdict, which is the deferred-PASS shape. */
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
      recordOutcome: async () => ({ status: 'cleared' as const, nextAction: 'continue' }),
      parseGateVerdicts: () => [],
    },
    setResponse: jest.fn(),
    state: { gates: { enforcementMode: 'blocking' }, session: {} },
    diagnostics: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    sessionContext: undefined as unknown,
  } as never;
}

const session = {
  pendingGateReview: undefined,
  state: { nodes: [{ id: 'node-1' }, { id: 'node-2' }] },
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

    const result = await processor.processDeferredVerdict(
      context,
      session,
      'session-1',
      1,
      'an answer',
      { sessionId: 'session-1', currentStep: 1 } as never
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
