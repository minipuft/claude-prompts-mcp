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
 * - notifications/framework/changed - Active framework/methodology changed
 * - notifications/chain/step_complete - Chain step completed
 * - notifications/chain/complete - Entire chain completed
 * - notifications/chain/failed - Chain failed with error
 */

import type { Logger } from '../logging/index.js';

/**
 * Minimal MCP server interface for sending notifications.
 * Matches the notification method signature from @modelcontextprotocol/sdk.
 */
export interface McpNotificationServer {
  notification(params: { method: string; params?: Record<string, unknown> }): void;
}

/**
 * Gate failure notification payload.
 */
export interface GateFailedNotification {
  /** Gate ID that failed */
  gateId: string;
  /** Reason for failure */
  reason: string;
  /** Chain ID if this occurred during chain execution */
  chainId?: string;
  /** Step index where failure occurred */
  stepIndex?: number;
}

/**
 * Response blocked notification payload.
 */
export interface ResponseBlockedNotification {
  /** Gate IDs that triggered the block */
  gateIds: string[];
  /** Chain ID if this occurred during chain execution */
  chainId?: string;
}

/**
 * Retry exhausted notification payload.
 */
export interface RetryExhaustedNotification {
  /** Gate IDs that exhausted retries */
  gateIds: string[];
  /** Chain ID where this occurred */
  chainId: string;
  /** Maximum attempts that were allowed */
  maxAttempts: number;
}

/**
 * Framework changed notification payload.
 */
export interface FrameworkChangedNotification {
  /** Previous framework ID (if any) */
  from?: string;
  /** New framework ID */
  to: string;
  /** Reason for the change */
  reason: string;
}

/**
 * Chain step complete notification payload.
 */
export interface ChainStepCompleteNotification {
  /** Chain ID */
  chainId: string;
  /** Step index that completed (0-indexed) */
  stepIndex: number;
  /** Whether the step passed or failed */
  status: 'passed' | 'failed';
}

/**
 * Chain complete notification payload.
 */
export interface ChainCompleteNotification {
  /** Chain ID */
  chainId: string;
  /** Total steps executed */
  totalSteps: number;
  /** Overall chain status */
  status: 'completed' | 'failed';
}

/**
 * MCP Notification Emitter
 *
 * Sends MCP protocol notifications to connected clients.
 * Gracefully handles missing server or notification support.
 */
export class McpNotificationEmitter {
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
   */
  canSend(): boolean {
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
   * Send a notification via the MCP server.
   */
  private send(method: string, params: unknown): void {
    if (!this.canSend()) {
      this.logger.debug('[McpNotificationEmitter] Cannot send notification - no server', {
        method,
      });
      return;
    }

    try {
      // Cast to Record for MCP SDK compatibility - notification payloads are always objects
      const notificationParams =
        params !== null && typeof params === 'object'
          ? (params as Record<string, unknown>)
          : undefined;
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      this.server!.notification({ method, params: notificationParams });
      this.logger.debug('[McpNotificationEmitter] Notification sent', { method });
    } catch (error) {
      this.logger.warn('[McpNotificationEmitter] Failed to send notification', {
        method,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
