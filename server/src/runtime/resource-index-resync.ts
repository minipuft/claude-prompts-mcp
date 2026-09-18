// @lifecycle canonical - Syncs the SQLite resource index at startup and after every hot reload.
/**
 * The Python hooks (prompt-suggest, etc.) read `resource_index`, so the index is re-derived from the
 * loaded catalog twice in a process's life: once at startup, from `initializeModules`, and again
 * after every hot reload, from `Application#fullServerRefresh`. Both walks are this function.
 *
 * They were two copies of one body until B.58. The only thing that differed was a step the startup
 * copy ran afterwards — reconciling the indexed prompt ids against the loaded catalog, which the
 * startup caller passes in as `afterSync` — so the difference is a parameter, not a second copy.
 *
 * A module of its own rather than a private method: the composition root already assembles
 * `pathResolver`, `logger` and the quarantine view for this exact call, so passing them in is a
 * parameter list, not a service boundary crossed.
 */

import { indexerResourceRoots } from './resource-roots.js';

import type { Logger } from '#infra/logging/index.js';
import type { DatabasePort } from '#shared/types/persistence.js';
import type { QuarantineView } from '#shared/utils/resource-quarantine.js';
import type { PathResolver } from './paths.js';

export interface ResourceIndexSyncParams {
  /** Where the resources are read from AND where `state.db` is — one resolver for both. */
  pathResolver: PathResolver;
  logger: Logger;
  /**
   * The merged refusal record `initializeModules` assembles once and returns in
   * `ModuleInitResult`. Typed as possibly unset only because `Application` holds it in a field
   * that is empty until `initializeModules` has run; see the throw below.
   */
  indexQuarantine: QuarantineView | undefined;
  /** A step run against the database the sync just wrote. Startup passes one; reload does not. */
  afterSync?: (database: DatabasePort) => void;
}

/**
 * Sync the resource index with the loaded catalog.
 *
 * `indexQuarantine` unset means `initializeModules()` never assembled it — indexing ahead of that
 * would publish every refused gate, framework and style to the hooks while the caller goes on to
 * report success over a quarantine-blind index. Throws rather than skips: unreachable in a served
 * process, since the startup caller assembles the view a few lines above its call, and the only
 * reload caller is a callback `initializeModules` itself wires. A thrown error here means that
 * wiring broke, not that a legitimate state was reached.
 */
export async function syncResourceIndex(params: ResourceIndexSyncParams): Promise<void> {
  const { pathResolver, logger, indexQuarantine, afterSync } = params;

  if (indexQuarantine === undefined) {
    throw new Error(
      'Resource index sync has no quarantine view: initializeModules() must assemble it first.'
    );
  }

  const { SqliteEngine } = await import('#infra/database/sqlite-engine.js');
  const { createResourceIndexer, reportSyncFindings } =
    await import('#infra/database/resource-indexer.js');
  const { ScriptToolDefinitionLoader } =
    await import('#modules/automation/core/script-definition-loader.js');
  const dbManager = await SqliteEngine.getInstance(logger, {
    dbPath: pathResolver.getStateDatabasePath(),
  });
  await dbManager.initialize();
  const scriptLoader = new ScriptToolDefinitionLoader({ validateOnLoad: true });
  const indexer = createResourceIndexer(dbManager, logger, {
    resourcesDir: pathResolver.getResourcesPath(),
    resourceRoots: indexerResourceRoots(pathResolver),
    toolLoader: (dir, id) => scriptLoader.loadAllToolsForPromptDetailed(dir, id),
    // ONE merged view for both walks. The reload walk used to pass the prompt view alone under a
    // comment claiming the other three joined here; they did not, and the first hot reload
    // re-indexed every refused gate, framework and style (P4.25). All four directory-form kinds
    // are in it (P4.16 closed `style`, the last kind the indexer walked with no refusal record).
    //
    // Read by reference, so a reload sees its own corrections: `loadAndProcessData()` has just
    // re-walked every prompt root and replaced that root's records, so a prompt REPAIRED since the
    // last load is no longer refused here and indexes as `added` on this very pass. The gate and
    // framework leaves resolve through their registries on every read, so their auxiliary reloads
    // are reflected too.
    quarantine: indexQuarantine,
  });
  const syncResult = await indexer.syncAll();
  reportSyncFindings(syncResult, logger);
  afterSync?.(dbManager);
  logger.info('✅ Resource index synced to SQLite');
}
