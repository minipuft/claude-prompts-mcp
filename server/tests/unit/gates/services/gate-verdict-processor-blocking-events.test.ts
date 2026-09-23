/**
 * P4.117: a blocking FAIL announces its gate events in one order, inside the call.
 *
 * `handleBlockingFail` fired its three `emitGateEvents` with `void` — the fire-and-forget shape
 * row B.54 removed from the advisory and informational handlers. The events then interleaved,
 * finished after the verdict call had returned (and the response had been built from it), and
 * a throw outside `emitGateEvents`' own catch became an unhandled rejection nobody reported.
 *
 * The order is pinned as ONE sequence value, the way the chain-lifecycle emission test pins its
 * announcements: pairwise "A before B" checks constrain only the pairs someone thought of. The
 * last test closes the shape: no gate event in this processor is fired and forgotten.
 *
 * Classification: Unit (one processor, stubbed store, hooks and notifications) plus one
 * source-shape check.
 */

import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { GateVerdictProcessor } from '../../../../src/engine/gates/services/gate-verdict-processor.js';

import type { Logger } from '../../../../src/infra/logging/index.js';
import type {
  ChainSession,
  ChainSessionService,
  HookRegistryPort,
  McpNotificationEmitterPort,
} from '../../../../src/shared/types/index.js';

const PROCESSOR_SOURCE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../src/engine/gates/services/gate-verdict-processor.ts'
);

/** Resolve on a later macrotask: an awaited emitter still finishes in order, a forgotten one does not. */
const later = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const createLogger = (): Logger & { warn: jest.Mock } =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger & { warn: jest.Mock };

function createStore() {
  return {
    recordGateReviewOutcome: jest.fn(async () => undefined),
    setReview: jest.fn(async () => undefined),
    clearPendingGateReview: jest.fn(async () => undefined),
    advanceStep: jest.fn(async () => false),
  } as unknown as ChainSessionService;
}

/** Hooks and notifications that append to one shared sequence, each completing a tick later. */
function createEmitters(sequence: string[]) {
  const hooks = {
    emitGateFailed: jest.fn(async (gate: { id: string }) => {
      await later();
      sequence.push(`hook:failed:${gate.id}`);
    }),
    emitRetryExhausted: jest.fn(async (gateIds: string[]) => {
      await later();
      sequence.push(`hook:retryExhausted:${gateIds.join(',')}`);
    }),
    emitResponseBlocked: jest.fn(async (gateIds: string[]) => {
      await later();
      sequence.push(`hook:responseBlocked:${gateIds.join(',')}`);
    }),
    emitGateEvaluated: jest.fn(async () => undefined),
  } as unknown as HookRegistryPort;
  const notifications = {
    emitGateFailed: jest.fn((n: { gateId: string }) => sequence.push(`notify:failed:${n.gateId}`)),
    emitRetryExhausted: jest.fn((n: { gateIds: string[] }) =>
      sequence.push(`notify:retryExhausted:${n.gateIds.join(',')}`)
    ),
    emitResponseBlocked: jest.fn((n: { gateIds: string[] }) =>
      sequence.push(`notify:responseBlocked:${n.gateIds.join(',')}`)
    ),
  } as unknown as McpNotificationEmitterPort;
  return { hooks, notifications };
}

function createContext() {
  return {
    getGateVerdict: () => 'GATE_REVIEW: FAIL - it did not hold',
    gateEnforcement: undefined,
    setResponse: jest.fn(),
    gates: {
      hasBlockingGates: () => true,
      getBlockingGateIds: () => ['gate-a'],
    },
    frameworkAuthority: { getCachedDecision: () => undefined },
    state: { gates: { enforcementMode: 'blocking', advisoryWarnings: [] }, session: {} },
    diagnostics: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    sessionContext: { sessionId: 'session-1', isChainExecution: true, currentStep: 1 },
  } as never;
}

/** A run on `node-1` whose review of it has spent `attemptCount` of its two attempts. */
const sessionWith = (attemptCount: number) =>
  ({
    sessionId: 'session-1',
    reviews: {
      'node-1': {
        nodeId: 'node-1',
        kind: 'gate',
        phase: 'awaiting-verdict',
        combinedPrompt: '',
        gateIds: ['gate-a'],
        prompts: [],
        createdAt: 1,
        attemptCount,
        maxAttempts: 2,
      },
    },
    state: { currentNodeId: 'node-1', nodes: [{ id: 'node-1' }, { id: 'node-2' }] },
  }) as unknown as ChainSession;

/** Submit a FAIL; `lastAttempt` makes it the one that exhausts the review. */
async function submitFail(processor: GateVerdictProcessor, lastAttempt = false): Promise<void> {
  await processor.processReviewVerdict(
    createContext(),
    sessionWith(lastAttempt ? 1 : 0),
    { sessionId: 'session-1', currentStep: 1, currentNodeId: 'node-1' } as never,
    'a response'
  );
}

describe('GateVerdictProcessor blocking FAIL events', () => {
  let sequence: string[];

  beforeEach(() => {
    sequence = [];
  });

  test('every event lands before the verdict call returns, in one order', async () => {
    const { hooks, notifications } = createEmitters(sequence);
    const processor = new GateVerdictProcessor(createStore(), createLogger(), hooks, notifications);

    await submitFail(processor, true);

    // Read at return, with nothing awaited after it: a forgotten emitter has not finished yet.
    expect(sequence).toEqual([
      'hook:retryExhausted:gate-a',
      'notify:retryExhausted:gate-a',
      'hook:responseBlocked:gate-a',
      'notify:responseBlocked:gate-a',
      'hook:failed:gate-a',
      'notify:failed:gate-a',
    ]);
  });

  test('CONTROL: with retries left, the sequence drops only the exhaustion pair', async () => {
    const { hooks, notifications } = createEmitters(sequence);
    const processor = new GateVerdictProcessor(createStore(), createLogger(), hooks, notifications);

    await submitFail(processor);

    expect(sequence).toEqual([
      'hook:responseBlocked:gate-a',
      'notify:responseBlocked:gate-a',
      'hook:failed:gate-a',
      'notify:failed:gate-a',
    ]);
  });

  test('a throwing emitter is reported inside the call that raised it', async () => {
    const { hooks } = createEmitters(sequence);
    const logger = createLogger();
    const notifications = {
      emitGateFailed: jest.fn(() => {
        throw new Error('notification transport is gone');
      }),
      emitRetryExhausted: jest.fn(),
      emitResponseBlocked: jest.fn(),
    } as unknown as McpNotificationEmitterPort;
    const processor = new GateVerdictProcessor(createStore(), logger, hooks, notifications);

    await submitFail(processor);

    expect(logger.warn).toHaveBeenCalledWith(
      '[GateVerdictProcessor] Failed to emit gate event',
      expect.objectContaining({ event: 'failed', error: 'notification transport is gone' })
    );
  });

  test('no gate event in the processor is fired and forgotten', () => {
    const source = readFileSync(PROCESSOR_SOURCE, 'utf8');
    const emitCalls = source.match(/\b(?:void|await|return)?\s*this\.emitGateEvents\(/g) ?? [];

    // Positive control: the scan sees the emit sites at all.
    expect(emitCalls.length).toBeGreaterThanOrEqual(6);
    expect(emitCalls.filter((call) => !call.trimStart().startsWith('await'))).toEqual([]);
  });
});
