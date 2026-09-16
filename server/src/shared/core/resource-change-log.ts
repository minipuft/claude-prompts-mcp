// @lifecycle canonical - Holds the active resource change log and the mcp-tool write helper.
/**
 * Resource change log access.
 *
 * The audit log has one implementation (`ResourceChangeTracker`, infra/observability/tracking/)
 * and one writer of this slot (`initializeResourceChangeTracker`, runtime/). Everything else
 * reads it.
 *
 * It lives here, at Layer 0, because of who the readers are. `resource_manager`, `system_control`
 * and the gate tool all record what they changed, and mcp/ may not value-import infra/ — so
 * before this module the accessor they reached for was the one in runtime/, which pointed the
 * dependency graph at the composition root. `no-imports-into-runtime` in `.dependency-cruiser.cjs`
 * now forbids that edge. The instance is unchanged; only the direction is.
 *
 * Unset is a normal state, not an error: the tracker needs a resolvable server root and a
 * database, and the server serves without both. Every read therefore returns
 * `ResourceChangeLogPort | undefined` and every caller says what it does with the gap —
 * `logMcpToolChange` drops the record, `system_control changes` reports that tracking is off.
 * Nothing here throws, because an audit-log outage must not fail the operation being audited.
 */

import type { Logger, LogChangeParams, ResourceChangeLogPort } from '../types/index.js';

let activeLog: ResourceChangeLogPort | undefined;

/**
 * Publish the log the process will use. Called by the composition root once, at startup.
 *
 * Last write wins, deliberately: the tests that exercise the mcp-tool write path install a stub
 * and clear it afterwards, and a guarded single-assignment would make the second test in a file
 * silently observe the first one's stub.
 */
export function setResourceChangeLog(log: ResourceChangeLogPort | undefined): void {
  activeLog = log;
}

/** The active log, or `undefined` when the process runs without change tracking. */
export function getResourceChangeLog(): ResourceChangeLogPort | undefined {
  return activeLog;
}

/**
 * Record a change an MCP tool made, attributing it to `mcp-tool`.
 *
 * Returns silently when tracking is off, and swallows a write failure after logging it: the
 * caller has already mutated the resource on disk and reported success to the client, so throwing
 * here would report a failure that did not happen.
 */
export async function logMcpToolChange(
  logger: Logger,
  params: Omit<LogChangeParams, 'source'>
): Promise<void> {
  const log = getResourceChangeLog();
  if (log === undefined) {
    return;
  }

  try {
    await log.logChange({ source: 'mcp-tool', ...params });
  } catch (error) {
    logger.warn(`Failed to log MCP tool change for ${params.resourceId}:`, error);
  }
}
