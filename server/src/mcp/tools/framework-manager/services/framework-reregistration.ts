// @lifecycle canonical - Shared registry re-registration for framework write paths.
import type { FrameworkResourceContext } from '../core/context.js';

/**
 * Make a framework the process just wrote visible to that same process.
 *
 * Every framework handler that writes `framework.yaml` owes this call. `onRefresh` does NOT do it:
 * for this tool it is supplied at `src/mcp/tools/index.ts` and its whole body is a comment plus a
 * `logger.debug`, so a handler that writes and awaits only `onRefresh` leaves the in-memory
 * definition at its pre-edit content until the next server restart while reporting success.
 *
 * Shared rather than private to one processor because it was private to one processor: `update`
 * and `reload` were fixed in `d5eaa6a1` and `rollback` — which writes through the same file
 * service, one file over — kept emitting `🔄 Framework registry reloaded` over a no-op. One copy
 * means the next write path cannot inherit the old behaviour by not knowing about this one.
 *
 * Clearing the loader cache first is load-bearing: `reloadResource` regenerates from the guide
 * already in the registry, so without the clear a re-register returns the stale content.
 *
 * @returns `true` when the in-memory definition now reflects what is on disk. Callers MUST branch
 *   on this rather than asserting a refresh — reporting one that did not happen is the defect
 *   class this function exists to close.
 */
export async function reregisterFramework(
  ctx: FrameworkResourceContext,
  id: string
): Promise<boolean> {
  try {
    ctx.frameworkManager.getFrameworkRegistry().getRuntimeLoader().clearCache(id);
  } catch (error) {
    // `getFrameworkRegistry` throws when the manager is not initialized. Reported, not swallowed:
    // the caller branches on false and says the content is not live.
    ctx.logger.warn(
      `Could not clear the framework loader cache for '${id}': ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return false;
  }

  return await ctx.frameworkManager.registerFramework(id);
}
