// @lifecycle canonical - Exports for MCP notification system.
/**
 * MCP Notification System
 *
 * Provides notification emission for gate, framework, and chain events.
 *
 * Usage:
 * ```typescript
 * import { McpNotificationEmitter } from './notifications/index.js';
 *
 * const emitter = new McpNotificationEmitter(logger);
 * emitter.setServer(mcpServer);
 *
 * emitter.emitGateFailed({ gateId: 'code-quality', reason: 'Criteria not met' });
 * ```
 */

// Every notification payload (GateFailedNotification, ResponseBlockedNotification,
// RetryExhaustedNotification, FrameworkChangedNotification, ChainStepCompleteNotification,
// ChainCompleteNotification) is declared in `#shared/types` with the port that names
// them — import them from there.
export type { McpNotificationServer } from './mcp-notification-emitter.js';
export { McpNotificationEmitter } from './mcp-notification-emitter.js';
