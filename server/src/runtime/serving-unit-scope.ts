// @lifecycle canonical - Derives the workspace scope for one serving unit from its request context.
/**
 * Resolving the workspace scope a serving unit is built for.
 *
 * Most state in this server is read per *call*, from the handler's `extra`.
 * The advertised tool surface cannot be: `prompt_engine` builds its schema
 * when the server instance is constructed, which under `createMcpHandler` is
 * once per HTTP request and under `serveStdio` is once per connection. So the
 * scope has to be derived from what the factory receives — `McpRequestContext`
 * — rather than from a call that has not been dispatched yet.
 *
 * Reading the surface unscoped is the bug this exists to prevent: a client
 * toggling the gate system writes to *its* workspace row, so a schema built
 * from the process-default row would never narrow for that client, and a
 * toggle of the default row would reshape the surface for everyone.
 *
 * The derivation is deliberately the same one the per-call path uses
 * (`resolveRequestIdentity` → `resolveContinuityScopeId`), fed a synthetic
 * `extra` assembled from the context. Duplicating the claim and header
 * precedence here instead would let the surface and the state it describes
 * drift apart.
 */

import type { StateStoreOptions } from '#shared/types/index.js';

import { resolveRequestIdentity } from '#shared/utils/request-identity-resolver.js';
import {
  resolveContinuityScopeId,
  DEFAULT_IDENTITY_SCOPE_ID,
} from '#shared/utils/request-identity-scope.js';

/**
 * The subset of the SDK's `McpRequestContext` this needs.
 *
 * Declared structurally rather than imported so the resolver stays testable
 * without constructing an SDK context, and so an SDK shape change surfaces
 * here as a type error at the call site rather than silently widening.
 */
export interface ServingUnitContext {
  /**
   * Validated auth info; HTTP only — `serveStdio` never sets it.
   *
   * Typed without an index signature so the SDK's `AuthInfo` is assignable:
   * only the two fields the identity resolver reads are named here.
   */
  authInfo?: { extra?: Record<string, unknown> | undefined; sub?: string } | undefined;
  /** The originating HTTP request; HTTP only. Headers carry workspace ids too. */
  requestInfo?: { headers?: unknown } | undefined;
}

/** Normalize the SDK's `Headers` (or a plain object) into what the resolver reads. */
function toHeaderRecord(headers: unknown): Record<string, unknown> | undefined {
  if (headers == null) {
    return undefined;
  }
  // `Request.headers` is a `Headers` instance, which is iterable but has no
  // enumerable own properties — `asRecord` would see an empty object.
  if (typeof (headers as Headers).forEach === 'function' && !Array.isArray(headers)) {
    const record: Record<string, unknown> = {};
    (headers as Headers).forEach((value, key) => {
      record[key.toLowerCase()] = value;
    });
    return record;
  }
  if (typeof headers === 'object') {
    return headers as Record<string, unknown>;
  }
  return undefined;
}

/**
 * The workspace scope this serving unit should read state for.
 *
 * Returns `undefined` for the default scope, matching every other scope
 * consumer in this codebase: `undefined` means "the process default", and
 * passing it explicitly would be a different thing than omitting it.
 *
 * STDIO always lands here — it sets neither `authInfo` nor `requestInfo`, and
 * serves one workspace per process, so the default scope is correct for it.
 */
export function resolveServingUnitScope(
  ctx?: ServingUnitContext | undefined
): StateStoreOptions | undefined {
  if (ctx == null) {
    return undefined;
  }

  const headers = toHeaderRecord(ctx.requestInfo?.headers);
  const identity = resolveRequestIdentity({
    ...(ctx.authInfo != null ? { authInfo: ctx.authInfo } : {}),
    ...(headers != null ? { headers } : {}),
  });

  const scopeId = resolveContinuityScopeId(identity);
  return scopeId !== DEFAULT_IDENTITY_SCOPE_ID ? { continuityScopeId: scopeId } : undefined;
}
