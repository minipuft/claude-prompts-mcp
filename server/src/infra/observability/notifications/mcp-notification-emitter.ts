// @lifecycle canonical - MCP notification emitter for pushing events to clients.
/**
 * MCP Notification Emitter
 *
 * Emits MCP protocol notifications for gate failures, framework changes,
 * chain events, and response blocking. Enables clients to react to
 * server-side events without polling.
 *
 * Notification Types:
 * - notifications/gate/failed - Gate evaluation failed
 * - notifications/gate/response_blocked - Response blocked due to gate failure
 * - notifications/gate/retry_exhausted - All retry attempts exhausted
 * - notifications/framework/changed - Active framework changed
 * - notifications/chain/step_complete - Chain step completed
 * - notifications/chain/complete - A chain run reached a terminal status, which its
 *   `status` field names ('completed' | 'failed' | 'cancelled'). There is no separate
 *   `notifications/chain/failed`: one terminal event carrying its outcome means a client
 *   subscribes once and cannot miss an ending by listening to the wrong method.
 *
 * ORDERING CAVEAT, measured 2026-09-20 and NOT introduced by this wiring: on the final step of
 * a gated chain, the PASS verdict advances past the last node — latching the run `completed`
 * and announcing it — before `StepCaptureService` captures that step's response, so
 * `chain/complete` is delivered ~25ms BEFORE the last `chain/step_complete`. A client that
 * tears its handler down on `chain/complete` misses the final step event. The defect is in
 * `GateVerdictProcessor`'s advance-on-PASS running ahead of capture, not here; until it is
 * fixed, treat `chain/complete` as "the run ended", not as "no further events".
 *
 * TRANSPORT. Every one of these six events is caused BY a tool call that is still in flight, so
 * the channel is the causing request's own notification sender, taken from the async context
 * `withRequestNotifications` enters around each tool callback
 * (`shared/utils/request-notification-scope.ts`, which documents why that is the only channel the
 * SDK offers a stateless Streamable HTTP server). The server bound to `setServer` is the
 * fallback, used only for an event raised outside any tool call — of which there are none today.
 * One emitter, one payload shape, both transports.
 */

import {
  currentRequestNotificationSink,
  type RequestNotificationSink,
} from '#shared/utils/request-notification-scope.js';

import type {
  ChainCompleteNotification,
  ChainStepCompleteNotification,
  FrameworkChangedNotification,
  GateFailedNotification,
  McpNotificationEmitterPort,
  ResponseBlockedNotification,
  RetryExhaustedNotification,
} from '#shared/types/index.js';
import type { Logger } from '../../logging/index.js';

/**
 * Minimal MCP server interface for sending notifications.
 *
 * The return type is `void | Promise<void>` because the SDK's is a Promise, and declaring it
 * `void` here is not a harmless simplification: a `void`-typed call is not awaited, and the
 * SDK rejects with `SdkError: Not connected` whenever the bound instance has no transport —
 * which is always, under Streamable HTTP. Measured 2026-09-20: that rejection escaped to
 * `process.on('unhandledRejection')` and took the whole server down mid-chain, one tick after
 * the triggering request had already answered `isError: false`.
 */
export interface McpNotificationServer {
  notification(params: { method: string; params?: Record<string, unknown> }): void | Promise<void>;
}

// Every notification payload is declared in `shared/types` alongside
// `McpNotificationEmitterPort`, which names them: `engine/` and `modules/` build these
// values while holding the emitter as the port, so the port has to spell out their shape.

/**
 * MCP Notification Emitter
 *
 * Sends MCP protocol notifications to connected clients.
 * Gracefully handles missing server or notification support.
 */
export class McpNotificationEmitter implements McpNotificationEmitterPort {
  private server?: McpNotificationServer;
  private readonly logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
    this.logger.debug('[McpNotificationEmitter] Initialized');
  }

  /**
   * Set the MCP server instance for sending notifications.
   * Should be called during application startup.
   */
  setServer(server: McpNotificationServer): void {
    this.server = server;
    this.logger.debug('[McpNotificationEmitter] Server set');
  }

  /**
   * Check if notifications can be sent.
   *
   * True while a tool call is in flight on this async context, because that call's own sender is
   * always reachable — which is every moment any of the six events is raised.
   */
  canSend(): boolean {
    if (currentRequestNotificationSink() !== undefined) {
      return true;
    }
    return this.server !== undefined && typeof this.server.notification === 'function';
  }

  // ===== Gate Notifications =====

  /**
   * Emit notification when a gate fails evaluation.
   */
  emitGateFailed(notification: GateFailedNotification): void {
    this.send('notifications/gate/failed', notification);
  }

  /**
   * Emit notification when response content is blocked due to gate failure.
   */
  emitResponseBlocked(notification: ResponseBlockedNotification): void {
    this.send('notifications/gate/response_blocked', notification);
  }

  /**
   * Emit notification when all retry attempts for gates are exhausted.
   */
  emitRetryExhausted(notification: RetryExhaustedNotification): void {
    this.send('notifications/gate/retry_exhausted', notification);
  }

  // ===== Framework Notifications =====

  /**
   * Emit notification when the active framework changes.
   */
  emitFrameworkChanged(notification: FrameworkChangedNotification): void {
    this.send('notifications/framework/changed', notification);
  }

  // ===== Chain Notifications =====

  /**
   * Emit notification when a chain step completes.
   */
  emitChainStepComplete(notification: ChainStepCompleteNotification): void {
    this.send('notifications/chain/step_complete', notification);
  }

  /**
   * Emit notification when an entire chain completes or fails.
   */
  emitChainComplete(notification: ChainCompleteNotification): void {
    this.send('notifications/chain/complete', notification);
  }

  // ===== Internal =====

  /**
   * Send a notification on the channel of the request that caused it, fire-and-forget.
   *
   * SINK RESOLUTION. The causing request's sender wins whenever one is in scope, on BOTH
   * transports — it is the only sender that reaches the client under Streamable HTTP, where the
   * bound instance is per-request, never connected, and belongs to a different exchange. The
   * bound server is the fallback for an event raised outside any tool call.
   *
   * Either sender is ASYNC and can reject — the SDK's `notification()` rejects with
   * `SdkError: Not connected` whenever the bound instance has no transport. A `try`/`catch`
   * cannot see that: the synchronous call returns a pending promise and the enclosing block exits
   * clean, so the rejection reaches `process.on('unhandledRejection')` in `index.ts`, which
   * treats it as fatal and shuts the server down. Measured 2026-09-20 over Streamable HTTP: the
   * first chain step of the first run killed the process, one tick after that request had already
   * answered `isError: false`.
   *
   * So the promise is settled here, and the success line waits for it. A fire-and-forget
   * emission needs an attached handler, not an enclosing one: `announceStepComplete` and
   * `announceRunTerminal` are documented as never a reason to fail the work they observe, and
   * an unhandled rejection is the one way a best-effort path becomes fatal.
   */
  private send(method: string, params: unknown): void {
    // Cast to Record for MCP SDK compatibility - notification payloads are always objects
    const notificationParams =
      params !== null && typeof params === 'object'
        ? (params as Record<string, unknown>)
        : undefined;

    const requestSink: RequestNotificationSink | undefined = currentRequestNotificationSink();
    if (requestSink !== undefined) {
      this.settle(method, requestSink(method, notificationParams));
      return;
    }

    if (this.server === undefined || typeof this.server.notification !== 'function') {
      // Names WHICH conjunct failed. The old message said "no server" for both, and a server
      // WAS set — the bound object simply had no `notification()`, because SDK v2 moved it onto
      // `McpServer.server`. Anyone grepping the old line looked for a missing `setServer` call
      // that was not missing, which is how this survived every gate.
      this.logger.warn('[McpNotificationEmitter] Notification dropped', {
        method,
        reason:
          this.server === undefined
            ? 'no server bound — setServer was never called, and no request is in flight'
            : 'the bound server exposes no notification() — bind the inner Server, not McpServer',
      });
      return;
    }

    try {
      this.settle(method, this.server.notification({ method, params: notificationParams }));
    } catch (error) {
      this.reportSendFailure(method, error);
    }
  }

  /** Attach the outcome handlers a fire-and-forget send needs, for either sender. */
  private settle(method: string, pending: void | Promise<void>): void {
    if (pending instanceof Promise) {
      void pending.then(
        () => this.logger.debug('[McpNotificationEmitter] Notification sent', { method }),
        (error: unknown) => this.reportSendFailure(method, error)
      );
      return;
    }
    this.logger.debug('[McpNotificationEmitter] Notification sent', { method });
  }

  /** One report for both the synchronous throw and the rejected promise. */
  private reportSendFailure(method: string, error: unknown): void {
    this.logger.warn('[McpNotificationEmitter] Failed to send notification', {
      method,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
