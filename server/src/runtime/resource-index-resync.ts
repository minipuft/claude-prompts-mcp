// @lifecycle canonical - Re-syncs the SQLite resource index during a hot reload.
/**
 * `fullServerRefresh` re-indexes resources to SQLite after every hot reload so hook consumers
 * (prompt-suggest, etc.) see the same catalog the loaders just re-read. This is the reload half of
 * that walk; `module-initializer.ts` holds the startup half, which additionally reconciles the
 * indexed prompt ids against the loaded catalog — a check that only makes sense once, at boot.
 *
 * Extracted from `Application#fullServerRefresh` as its own module rather than a private method:
 * the composition root already assembles `serverRoot`, `pathResolver`, `logger` and the quarantine
 * view for this exact call, so passing them in is a parameter list, not a service boundary crossed.
 */

import * as path from 'node:path';

import { indexerResourceRoots } from './resource-roots.js';

import type { Logger } from '#infra/logging/index.js';
import type { QuarantineView } from '#shared/utils/resource-quarantine.js';
import type { PathResolver } from './paths.js';

/**
 * Re-sync the resource index for hook consumption after a hot reload.
 *
 * `indexQuarantine` unset means `initializeModules()` never ran — indexing ahead of that would
 * publish every refused gate, framework and style to the hooks while the caller goes on to report
 * "refresh completed successfully" over a stale, quarantine-blind index. Throws rather than skips:
 * unreachable in a served process, since the only caller of `fullServerRefresh` is a callback
 * `initializeModules` itself wires, so a thrown error here means that wiring broke, not that a
 * legitimate state was reached.
 */
export async function resyncResourceIndexAfterReload(params: {
  serverRoot: string;
  pathResolver: PathResolver | undefined;
  logger: Logger;
  indexQuarantine: QuarantineView | undefined;
}): Promise<void> {
  const { serverRoot, pathResolver, logger, indexQuarantine } = params;

  if (indexQuarantine === undefined) {
    throw new Error(
      'Resource index re-sync has no quarantine view: initializeModules() must run before a hot reload.'
    );
  }

  const { SqliteEngine } = await import('#infra/database/sqlite-engine.js');
  const { createResourceIndexer, reportSyncFindings } =
    await import('#infra/database/resource-indexer.js');
  const { ScriptToolDefinitionLoader } =
    await import('#modules/automation/core/script-definition-loader.js');
  const dbManager = await SqliteEngine.getInstance(serverRoot, logger);
  await dbManager.initialize();
  const resourcesDir = pathResolver?.getResourcesPath() ?? path.join(serverRoot, 'resources');
  const scriptLoader = new ScriptToolDefinitionLoader({ validateOnLoad: true });
  const indexer = createResourceIndexer(dbManager, logger, {
    resourcesDir,
    resourceRoots: indexerResourceRoots(pathResolver),
    toolLoader: (dir, id) => scriptLoader.loadAllToolsForPromptDetailed(dir, id),
    // The SAME merged view the startup sync reads, assembled once by `initializeModules` and
    // handed over in `ModuleInitResult`. This line used to pass the prompt view alone under a
    // comment claiming the other three joined here; they did not, and the first hot reload
    // re-indexed every refused gate, framework and style (P4.25).
    //
    // Read by reference, so this is the reload path's correction as well as startup's:
    // `loadAndProcessData()` has just re-walked every prompt root and replaced that root's
    // records, so a prompt REPAIRED since the last load is no longer refused here and indexes as
    // `added` on this very pass. The gate and framework leaves resolve through their registries
    // on every read, so their auxiliary reloads are reflected too.
    quarantine: indexQuarantine,
  });
  const syncResult = await indexer.syncAll();
  reportSyncFindings(syncResult, logger);
  logger.info('✅ Resource index re-synced after hot-reload.');
}
