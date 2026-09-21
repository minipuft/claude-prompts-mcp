// @lifecycle test - P4.88: the emitter resolves its sink per event, and a send failure is inert.
/**
 * Sink resolution for `McpNotificationEmitter`.
 *
 * The e2e suite (`tests/e2e/http-notification-delivery.e2e.test.ts`) proves five of the six
 * events reach a real Streamable HTTP client. This file covers what a drive cannot reach:
 *
 *  - `notifications/gate/response_blocked`, whose producer is unreachable on this tree (the
 *    reason is recorded in the e2e file's header) — so the claim here is narrower and honest:
 *    the emitter routes it exactly like its five siblings;
 *  - the isolation property `AsyncLocalStorage` is chosen for, asserted rather than assumed;
 *  - a rejecting sink, which must neither throw at the call site nor reach
 *    `process.on('unhandledRejection')` — the mechanism that killed the server mid-chain on
 *    2026-09-20 and the reason `send` settles its own promise.
 */

import { describe, expect, jest, test } from '@jest/globals';

import { McpNotificationEmitter } from '../../../../src/infra/observability/notifications/index.js';
import {
  runWithRequestNotificationSink,
  resolveRequestNotificationSink,
  type RequestNotificationSink,
} from '../../../../src/shared/utils/request-notification-scope.js';

import type { McpNotificationServer } from '../../../../src/infra/observability/notifications/index.js';
import type { Logger } from '../../../../src/infra/logging/index.js';

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

interface Recorded {
  method: string;
  params?: Record<string, unknown>;
}

const recordingSink = (into: Recorded[]): RequestNotificationSink => {
  return async (method, params) => {
    into.push(params === undefined ? { method } : { method, params });
  };
};

const recordingServer = (into: Recorded[]): McpNotificationServer => ({
  notification: async (n) => {
    into.push(
      n.params === undefined ? { method: n.method } : { method: n.method, params: n.params }
    );
  },
});

/** One call per emit method, so a method added later without a route is visible. */
const EMISSIONS: Array<[string, (e: McpNotificationEmitter) => void]> = [
  ['notifications/gate/failed', (e) => e.emitGateFailed({ gateId: 'g', reason: 'r' })],
  ['notifications/gate/response_blocked', (e) => e.emitResponseBlocked({ gateIds: ['g'] })],
  [
    'notifications/gate/retry_exhausted',
    (e) => e.emitRetryExhausted({ gateIds: ['g'], chainId: 'c', maxAttempts: 2 }),
  ],
  [
    'notifications/framework/changed',
    (e) => e.emitFrameworkChanged({ from: 'a', to: 'b', reason: 'switch' }),
  ],
  [
    'notifications/chain/step_complete',
    (e) => e.emitChainStepComplete({ chainId: 'c', stepIndex: 1, status: 'passed' }),
  ],
  [
    'notifications/chain/complete',
    (e) => e.emitChainComplete({ chainId: 'c', totalSteps: 3, status: 'completed' }),
  ],
];

describe('request-scoped notification sink', () => {
  test.each(EMISSIONS)(
    '%s goes to the request sink, not the bound server',
    async (method, emit) => {
      const toSink: Recorded[] = [];
      const toServer: Recorded[] = [];
      const emitter = new McpNotificationEmitter(createLogger());
      emitter.setServer(recordingServer(toServer));

      await runWithRequestNotificationSink(recordingSink(toSink), async () => {
        emit(emitter);
      });
      await new Promise((resolve) => setImmediate(resolve));

      expect(toSink.map((r) => r.method)).toEqual([method]);
      // The bound server belongs to a different exchange under Streamable HTTP. A delivery that
      // went to BOTH would double-deliver over STDIO, where both reach the same client.
      expect(toServer).toHaveLength(0);
    }
  );

  test('an event raised outside any request falls back to the bound server', async () => {
    const toServer: Recorded[] = [];
    const emitter = new McpNotificationEmitter(createLogger());
    emitter.setServer(recordingServer(toServer));

    emitter.emitChainComplete({ chainId: 'c', totalSteps: 1, status: 'cancelled' });
    await new Promise((resolve) => setImmediate(resolve));

    expect(toServer.map((r) => r.method)).toEqual(['notifications/chain/complete']);
  });

  test('two concurrent requests each reach their own sink and neither the other', async () => {
    const a: Recorded[] = [];
    const b: Recorded[] = [];
    const emitter = new McpNotificationEmitter(createLogger());
    emitter.setServer(recordingServer([]));

    await Promise.all([
      runWithRequestNotificationSink(recordingSink(a), async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        emitter.emitChainStepComplete({ chainId: 'A', stepIndex: 1, status: 'passed' });
      }),
      runWithRequestNotificationSink(recordingSink(b), async () => {
        emitter.emitFrameworkChanged({ from: 'x', to: 'y', reason: 'switch' });
      }),
    ]);
    await new Promise((resolve) => setImmediate(resolve));

    // POSITIVE CONTROL first: each sink saw its own event, so the two absences below are
    // absences of delivery and not of observation.
    expect(a.map((r) => r.method)).toEqual(['notifications/chain/step_complete']);
    expect(b.map((r) => r.method)).toEqual(['notifications/framework/changed']);
  });

  test('a sink that rejects neither throws nor escapes as an unhandled rejection', async () => {
    const logger = createLogger();
    const emitter = new McpNotificationEmitter(logger);
    emitter.setServer(recordingServer([]));

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const failing: RequestNotificationSink = async () => {
        throw new Error('stream already ended');
      };
      await runWithRequestNotificationSink(failing, async () => {
        // Not wrapped in expect().not.toThrow() — a throw here fails the test on its own, and
        // the synchronous call was never the failure mode. The rejection was.
        emitter.emitChainComplete({ chainId: 'c', totalSteps: 1, status: 'failed' });
      });
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(unhandled).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalledWith(
        '[McpNotificationEmitter] Failed to send notification',
        expect.objectContaining({ error: 'stream already ended' })
      );
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('resolveRequestNotificationSink', () => {
  test('reads the SDK notifier off a request handler extra', async () => {
    const seen: Array<{ method: string; params?: Record<string, unknown> }> = [];
    const extra = {
      mcpReq: {
        notify: async (n: { method: string; params?: Record<string, unknown> }) => {
          seen.push(n);
        },
      },
    };

    const sink = resolveRequestNotificationSink(extra);
    expect(sink).toBeDefined();
    await sink?.('notifications/gate/failed', { gateId: 'g' });
    expect(seen).toEqual([{ method: 'notifications/gate/failed', params: { gateId: 'g' } }]);
  });

  test.each([
    ['undefined', undefined],
    ['null', null],
    ['a non-object', 'extra'],
    ['an extra with no mcpReq', {}],
    ['an mcpReq with no notify', { mcpReq: {} }],
    ['a notify that is not callable', { mcpReq: { notify: 'yes' } }],
  ])('returns undefined for %s', (_label, value) => {
    expect(resolveRequestNotificationSink(value)).toBeUndefined();
  });
});
