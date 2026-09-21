// @lifecycle canonical - Carries the causing request's notification channel to the emitter.
/**
 * The notification channel of the request that caused an event.
 *
 * MCP SDK v2 (`@modelcontextprotocol/server` 2.0.0, protocol revision 2026-07-28) gives a
 * request handler exactly one way to push a message to the client that made the call:
 * `ServerContext.mcpReq.notify()`, which the transport writes onto THAT request's own response
 * stream. Under Streamable HTTP that stream is the POST's `text/event-stream` body; under STDIO
 * it is the connection's single stream. Either way the association is per request, which is why
 * `relatedRequestId` exists in the SDK at all.
 *
 * There is no second channel for these events. Revision 2026-07-28 removed protocol sessions,
 * `createMcpHandler` builds a fresh `McpServer` per request and retains nothing between
 * exchanges, and the one unsolicited push the SDK still offers — `subscriptions/listen`, reached
 * through `McpHttpHandler.notify` — carries a CLOSED four-member `ServerEvent` union
 * (`tools_list_changed`, `prompts_list_changed`, `resources_list_changed`, `resource_updated`).
 * It cannot carry `notifications/gate/failed`. So an event with no causing request has no HTTP
 * channel, and inventing one would mean a second transport-facing publish path.
 *
 * WHY AN ASYNC CONTEXT AND NOT A PARAMETER. The six events are raised four layers below the tool
 * callback, by three services that do not share one carrier: `GateVerdictProcessor` and
 * `StepCaptureService` hold an `ExecutionContext`, `ChainSessionStore.announceRunTerminal` holds
 * only a `ChainSession`, and `FrameworkStateStore.announceFrameworkChanged` holds neither. Making
 * the sink a parameter means widening `advanceStep`, `transitionRunStatus`, `cancelChain` and
 * `switchFramework` plus their port declarations — four public contracts widened to carry a value
 * none of them is about.
 *
 * `AsyncLocalStorage` is not a mutable global: a store is readable only from inside the async
 * context that entered it, so two concurrent HTTP requests each see their own sink and neither
 * sees the other's. That property is asserted, not assumed — see the concurrent-client control in
 * `tests/e2e/http-notification-delivery.e2e.test.ts`.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** Sends one notification on the channel of the request being handled. */
export type RequestNotificationSink = (
  method: string,
  params?: Record<string, unknown>
) => Promise<void>;

const storage = new AsyncLocalStorage<RequestNotificationSink>();

/**
 * The SDK's per-request notifier, narrowed to what this module calls.
 *
 * Declared structurally rather than imported as `ServerContext`: the tool callback receives its
 * `extra` as `unknown` throughout this codebase, and a value arriving from the SDK is checked
 * here rather than asserted.
 */
interface RequestNotifyCapableExtra {
  mcpReq?: {
    notify?: (notification: { method: string; params?: Record<string, unknown> }) => Promise<void>;
  };
}

/**
 * Build a sink from an MCP request handler's `extra`, or `undefined` when it carries no notifier.
 *
 * `undefined` is the honest answer for a caller that is not a request handler — a test harness,
 * a file-watcher callback — and the emitter falls back to its bound server there.
 */
export function resolveRequestNotificationSink(
  extra: unknown
): RequestNotificationSink | undefined {
  if (extra === null || typeof extra !== 'object') {
    return undefined;
  }
  const mcpReq = (extra as RequestNotifyCapableExtra).mcpReq;
  if (mcpReq == null || typeof mcpReq.notify !== 'function') {
    return undefined;
  }
  const notify = mcpReq.notify.bind(mcpReq);
  return async (method, params) => {
    await notify(params === undefined ? { method } : { method, params });
  };
}

/** Run `fn` with `sink` as the channel every notification raised inside it resolves to. */
export function runWithRequestNotificationSink<T>(
  sink: RequestNotificationSink | undefined,
  fn: () => Promise<T>
): Promise<T> {
  if (sink === undefined) {
    return fn();
  }
  return storage.run(sink, fn);
}

/** The sink of the request being handled on this async context, if there is one. */
export function currentRequestNotificationSink(): RequestNotificationSink | undefined {
  return storage.getStore();
}

/**
 * Wrap an MCP tool callback so everything it awaits resolves notifications to its own request.
 *
 * Applied at registration rather than inside each handler body: a handler that forgot the wrapper
 * would keep working over STDIO and silently reach nobody over HTTP, which is the exact failure
 * this module exists to end.
 */
export function withRequestNotifications<Args, Result>(
  handler: (args: Args, extra: unknown) => Promise<Result>
): (args: Args, extra: unknown) => Promise<Result> {
  return (args, extra) =>
    runWithRequestNotificationSink(resolveRequestNotificationSink(extra), () =>
      handler(args, extra)
    );
}
