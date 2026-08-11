// @lifecycle test - P2 Tier 6 row 14: run-telemetry counters and derivation in isolation.
/**
 * Counter mutation and read projection for record-only run telemetry.
 *
 * Two things are asserted separately because they fail separately:
 *   1. `recordGateReviewOutcome` increments the RUN-cumulative counters, not just
 *      `pendingGateReview.attemptCount` — which a PASS destroys along with the review.
 *      That destruction is why the counters exist, so the PASS case is the load-bearing one.
 *   2. `getRunTelemetry` derives unknowns from the ledger rather than from counters of
 *      its own, so a resolve must move a number from "open only" to "opened AND closed"
 *      without changing the total.
 *
 * Persistence is stubbed (same spy shape as chain-session-store.test.ts) — this suite is
 * about the arithmetic, and the mutate -> await saveSessions -> throw boundary is unchanged
 * by P2.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { ChainSessionStore } from '../../../src/modules/chains/manager.js';

import type { Logger } from '../../../src/infra/logging/index.js';
import type { PendingGateReview } from '../../../src/shared/types/chain-execution.js';

class StubTextReferenceStore {
  storeChainStepResult = jest.fn();
  buildChainVariables = jest.fn().mockReturnValue({});
  clearChainStepResults = jest.fn();
  getChainStepMetadata = jest.fn().mockReturnValue({});
}

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

const pendingReview = (): PendingGateReview => ({
  combinedPrompt: 'review this',
  gateIds: ['gate-a'],
  prompts: [],
  createdAt: Date.now(),
  attemptCount: 0,
  maxAttempts: 3,
});

describe('run telemetry counters', () => {
  let manager: ChainSessionStore;
  let saveSpy: jest.SpiedFunction<() => Promise<void>>;
  let loadSpy: jest.SpiedFunction<() => Promise<void>>;
  let schedulerSpy: jest.SpiedFunction<() => void>;

  beforeEach(async () => {
    saveSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'saveSessions')
      .mockResolvedValue(undefined) as unknown as jest.SpiedFunction<() => Promise<void>>;
    loadSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'loadSessions')
      .mockResolvedValue(undefined) as unknown as jest.SpiedFunction<() => Promise<void>>;
    schedulerSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'startCleanupScheduler')
      .mockImplementation(() => {}) as unknown as jest.SpiedFunction<() => void>;

    manager = new ChainSessionStore(createLogger(), new StubTextReferenceStore() as any, {
      serverRoot: '/tmp/test-run-telemetry',
      cleanupIntervalMs: 1000,
    });
    await manager.createSession('sess-tel', 'chain-tel', 3);
  });

  afterEach(async () => {
    await manager.cleanup();
    saveSpy.mockRestore();
    loadSpy.mockRestore();
    schedulerSpy.mockRestore();
  });

  test('a single PASS counts as one gate fired and zero retries', async () => {
    await manager.setPendingGateReview('sess-tel', pendingReview());
    await manager.recordGateReviewOutcome('sess-tel', {
      verdict: 'PASS',
      rawVerdict: 'GATE_REVIEW: PASS',
    });

    // The PASS cleared pendingGateReview — attemptCount went with it, which is precisely
    // why the session-level counters are read here instead.
    expect(manager.getPendingGateReview('sess-tel')).toBeUndefined();
    expect(manager.getRunTelemetry('sess-tel')).toMatchObject({ gatesFired: 1, gateRetries: 0 });
  });

  test('FAIL, FAIL, PASS counts three fired and two retries', async () => {
    await manager.setPendingGateReview('sess-tel', pendingReview());
    await manager.recordGateReviewOutcome('sess-tel', {
      verdict: 'FAIL',
      rawVerdict: 'GATE_REVIEW: FAIL - first',
    });
    await manager.recordGateReviewOutcome('sess-tel', {
      verdict: 'FAIL',
      rawVerdict: 'GATE_REVIEW: FAIL - second',
    });
    await manager.recordGateReviewOutcome('sess-tel', {
      verdict: 'PASS',
      rawVerdict: 'GATE_REVIEW: PASS',
    });

    expect(manager.getRunTelemetry('sess-tel')).toMatchObject({ gatesFired: 3, gateRetries: 2 });
  });

  test('counters survive the review being cleared and re-opened', async () => {
    await manager.setPendingGateReview('sess-tel', pendingReview());
    await manager.recordGateReviewOutcome('sess-tel', {
      verdict: 'PASS',
      rawVerdict: 'GATE_REVIEW: PASS',
    });
    // A second gate later in the same run opens a fresh review whose attemptCount restarts
    // at 0. The run totals must not restart with it.
    await manager.setPendingGateReview('sess-tel', pendingReview());
    await manager.recordGateReviewOutcome('sess-tel', {
      verdict: 'FAIL',
      rawVerdict: 'GATE_REVIEW: FAIL - later gate',
    });

    expect(manager.getPendingGateReview('sess-tel')?.attemptCount).toBe(1);
    expect(manager.getRunTelemetry('sess-tel')).toMatchObject({ gatesFired: 2, gateRetries: 1 });
  });

  test('a verdict for a session with no pending review changes nothing', async () => {
    await manager.recordGateReviewOutcome('sess-tel', {
      verdict: 'FAIL',
      rawVerdict: 'GATE_REVIEW: FAIL - orphan',
    });

    expect(manager.getRunTelemetry('sess-tel')).toMatchObject({ gatesFired: 0, gateRetries: 0 });
  });
});

describe('getRunTelemetry derivation', () => {
  let manager: ChainSessionStore;
  let saveSpy: jest.SpiedFunction<() => Promise<void>>;
  let loadSpy: jest.SpiedFunction<() => Promise<void>>;
  let schedulerSpy: jest.SpiedFunction<() => void>;

  beforeEach(async () => {
    saveSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'saveSessions')
      .mockResolvedValue(undefined) as unknown as jest.SpiedFunction<() => Promise<void>>;
    loadSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'loadSessions')
      .mockResolvedValue(undefined) as unknown as jest.SpiedFunction<() => Promise<void>>;
    schedulerSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'startCleanupScheduler')
      .mockImplementation(() => {}) as unknown as jest.SpiedFunction<() => void>;

    manager = new ChainSessionStore(createLogger(), new StubTextReferenceStore() as any, {
      serverRoot: '/tmp/test-run-telemetry-derivation',
      cleanupIntervalMs: 1000,
    });
    await manager.createSession('sess-derive', 'chain-derive', 4);
  });

  afterEach(async () => {
    await manager.cleanup();
    saveSpy.mockRestore();
    loadSpy.mockRestore();
    schedulerSpy.mockRestore();
  });

  test('a fresh session reports planned steps and zeroes, not undefined', async () => {
    expect(manager.getRunTelemetry('sess-derive')).toEqual({
      stepsPlanned: 4,
      gatesFired: 0,
      gateRetries: 0,
      unknownsOpened: 0,
      unknownsClosed: 0,
    });
  });

  test('two unknowns with one resolved report opened 2 / closed 1', async () => {
    await manager.applyUnknownObservations('sess-derive', 1, [
      { type: 'unknown_discovered', id: 'cache-ttl', statement: 'TTL undecided' },
      { type: 'unknown_discovered', id: 'retry-policy', statement: 'Retry policy undecided' },
    ]);
    await manager.applyUnknownObservations('sess-derive', 2, [
      { type: 'unknown_resolved', id: 'cache-ttl', statement: '30s', resolution: 'answered' },
    ]);

    expect(manager.getRunTelemetry('sess-derive')).toMatchObject({
      unknownsOpened: 2,
      unknownsClosed: 1,
    });
  });

  test('resolving does not reduce the opened count — the ledger is cumulative', async () => {
    await manager.applyUnknownObservations('sess-derive', 1, [
      { type: 'unknown_discovered', id: 'cache-ttl', statement: 'TTL undecided' },
    ]);
    const beforeResolve = manager.getRunTelemetry('sess-derive');
    await manager.applyUnknownObservations('sess-derive', 2, [
      { type: 'unknown_resolved', id: 'cache-ttl', statement: '30s', resolution: 'answered' },
    ]);

    expect(beforeResolve).toMatchObject({ unknownsOpened: 1, unknownsClosed: 0 });
    expect(manager.getRunTelemetry('sess-derive')).toMatchObject({
      unknownsOpened: 1,
      unknownsClosed: 1,
    });
  });

  test('an unknown session yields undefined rather than a zeroed object', () => {
    // A zeroed object here would be indistinguishable from a real run that did nothing,
    // and the terminal-record writers spread whatever they get.
    expect(manager.getRunTelemetry('no-such-session')).toBeUndefined();
  });
});
