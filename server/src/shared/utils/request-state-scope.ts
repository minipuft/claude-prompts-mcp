// @lifecycle canonical - Carries a resource_manager request's workspace scope to version history.
/**
 * The workspace scope of the `resource_manager` request being handled.
 *
 * Under Streamable HTTP a workspace header makes the request its own tenant (owner ruling R94), and
 * version history is per tenant: `version_history.tenant_id` is what every read, write and prune in
 * `VersionHistoryService` filters on. That service is built once per resource type with the launch
 * workspace's scope, and 36 call sites across ten processors reach it, none of them holding the
 * request. Threading a scope parameter through all of them would widen every versioning method and
 * every processor to carry a value none of them is about — the reason
 * `request-notification-scope.ts` carries the notification sink the same way.
 *
 * `AsyncLocalStorage` is readable only inside the async context that entered it, so two concurrent
 * requests each see their own scope. Outside a request (hot reload, the CLI, startup) there is no
 * store, and the service keeps its launch scope — which is also what a request with no workspace
 * of its own gets, because {@link runWithRequestStateScope} enters no store for it.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import type { StateStoreOptions } from '#shared/types/persistence.js';

const storage = new AsyncLocalStorage<StateStoreOptions>();

/** Run `fn` with `scope` as the request's state scope; `undefined` enters none. */
export function runWithRequestStateScope<T>(
  scope: StateStoreOptions | undefined,
  fn: () => Promise<T>
): Promise<T> {
  return scope === undefined ? fn() : storage.run(scope, fn);
}

/** The scope of the request being handled on this async context, if it named one. */
export function currentRequestStateScope(): StateStoreOptions | undefined {
  return storage.getStore();
}
