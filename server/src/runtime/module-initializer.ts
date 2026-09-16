// @lifecycle canonical - Module initialization helper for runtime startup.
/**
 * Initializes framework state, MCP tools, tool descriptions, and prompt registration.
 * Reuses existing managers without duplicating orchestration inside Application.
 */

import * as path from 'node:path';

import {
  initializeResourceChangeTracker,
  compareResourceBaseline,
} from './resource-change-tracking.js';
import {
  formatIndexReconciliation,
  formatResourceInventory,
  type ResourceInventory,
} from './resource-inventory.js';
import {
  indexerResourceRoots,
  resolveResourceRoots,
  type ResourceRoots,
} from './resource-roots.js';
import { resolveSkillsSyncPaths } from './skills-sync-paths.js';

import type { ConvertedPrompt } from '#engine/execution/types.js';
import type { ConfigLoader } from '#infra/config/index.js';
import type { Logger } from '#infra/logging/index.js';
import type { PromptAssetManager } from '#modules/prompts/index.js';
import type { Category, PromptData } from '#modules/prompts/types.js';
import type { TextReferenceStore } from '#modules/text-refs/index.js';
import type { PersistedArgumentHistory } from '#modules/text-refs/types.js';
import type {
  ResolvedFrameworkConfig,
  HookRegistryPort,
  McpNotificationEmitterPort,
} from '#shared/types/index.js';
import type { DatabasePort } from '#shared/types/persistence.js';
import type { QuarantineView } from '#shared/utils/resource-quarantine.js';
import type { RuntimeLaunchOptions } from './options.js';
import type { PathResolver } from './paths.js';
import type { McpServer } from '@modelcontextprotocol/server';

import { getDefaultRuntimeLoader } from '#engine/frameworks/definitions/runtime-framework-loader.js';
import {
  createFrameworkStateStore,
  FrameworkStateStore,
} from '#engine/frameworks/framework-state-store.js';
import { createGateManager, GateManager } from '#engine/gates/gate-manager.js';
import { createMetricsCollector } from '#infra/observability/metrics/index.js';
import { ResourceChangeTracker } from '#infra/observability/tracking/index.js';
import { createMcpToolsManager, McpToolRouter } from '#mcp/tools/index.js';
import {
  createToolDescriptionLoader,
  ToolDescriptionLoader,
} from '#mcp/tools/tool-description-loader.js';
import { getDefaultStyleDefinitionLoader } from '#modules/formatting/core/style-definition-loader.js';
import { isChainPrompt } from '#shared/utils/chainUtils.js';
import { mergeQuarantineViews } from '#shared/utils/resource-quarantine.js';

export interface ModuleInitCallbacks {
  fullServerRefresh: () => Promise<void>;
  restartServer: (reason: string) => Promise<void>;
  handleFrameworkConfigChange: (
    config: ResolvedFrameworkConfig,
    previous?: ResolvedFrameworkConfig
  ) => void;
}

export interface ModuleInitParams {
  logger: Logger;
  configManager: ConfigLoader;
  runtimeOptions: RuntimeLaunchOptions;
  promptsData: PromptData[];
  categories: Category[];
  convertedPrompts: ConvertedPrompt[];
  promptManager: PromptAssetManager;
  textReferenceStore: TextReferenceStore;
  mcpServer: McpServer;
  callbacks: ModuleInitCallbacks;
  /** Server root for runtime state directories */
  serverRoot?: string;
  /** Path resolver for workspace-derived resource overlays */
  pathResolver?: PathResolver;
  /** Hook registry for pipeline event emissions */
  hookRegistry?: HookRegistryPort;
  /** Notification emitter for MCP client notifications */
  notificationEmitter?: McpNotificationEmitterPort;
}

export interface ModuleInitResult {
  frameworkStateStore: FrameworkStateStore;
  gateManager: GateManager;
  mcpToolsManager: McpToolRouter;
  toolDescriptionLoader: ToolDescriptionLoader;
  /** Resource change tracker for audit logging (undefined if serverRoot not provided) */
  resourceChangeTracker?: ResourceChangeTracker;
  /**
   * Every loader's refusal record, merged once — what the resource index must withhold.
   *
   * Returned rather than rebuilt by the caller: `Application` holds the prompt and gate managers
   * and no framework or style loader, so its hot-reload re-sync cannot assemble this and must
   * consume it. Live, not a snapshot — see the assembly site for what each leaf reads through.
   */
  indexQuarantine: QuarantineView;
}

/**
 * Claim the SqliteEngine singleton with the resolved runtime path before any consumer can
 * construct it from `serverRoot`.
 *
 * `getInstance` keeps the config of whichever call arrives first, and five of its six call sites
 * pass no `dbPath` — falling back to the PACKAGE directory, which is read-only under a sandboxed
 * MCP child and invisible to the workspace either way. `MCP_WORKSPACE` was honored only because
 * ResourceChangeTracker happened to initialize early and is the one site that passes the
 * PathResolver-derived path. Claiming it here makes that an invariant rather than an ordering
 * accident; the divergence guard in `SqliteEngine.getInstance` names any later disagreement.
 *
 * Extracted rather than inlined: `initializeModules` is already at cognitive complexity 53, and
 * the lint ratchet counts violations, not the number inside one — an inline `if` would have
 * pushed it to 54 with every gate still green.
 */
async function claimStateDatabase(
  runtimeDbPath: string | undefined,
  serverRoot: string | undefined,
  logger: Logger
): Promise<void> {
  if (runtimeDbPath === undefined) return;
  const { SqliteEngine } = await import('#infra/database/sqlite-engine.js');
  await SqliteEngine.getInstance(serverRoot ?? '', logger, { dbPath: runtimeDbPath });
}

/**
 * Run the startup baseline comparison and report what it found.
 *
 * WHY IT IS NOT AT THE TRACKER'S CONSTRUCTION SITE. The comparison runs its own filesystem walk
 * and, before this, called every readable YAML file a resource — so a file the prompt loader had
 * refused was logged to `resource_changes` as an external `added`, announcing a resource that
 * `prompt_engine` rejects. Reading the quarantine fixes that, but only for loaders that have
 * already run: prompts load before `initializeModules` is called at all, while gates load at
 * `createGateManager` below. Calling from there covers both of the types this comparison tracks
 * (`TrackedResourceType` is `'prompt' | 'gate'`), which the tracker's own construction site could
 * not.
 *
 * Extracted rather than inlined for the reason `claimStateDatabase` records: `initializeModules`
 * is already over the cognitive-complexity limit, and the ratchet counts violations rather than
 * their size, so an inline block would grow one that is already counted.
 *
 * No try/catch: `compareResourceBaseline` catches its own failures and returns zeros. A second
 * boundary here would be the two-level catch `architecture.md` names — the outer one never fires
 * and the inner one hides the failure.
 */
async function compareBaselineAndReport(
  tracker: ResourceChangeTracker,
  configManager: ConfigLoader,
  logger: Logger,
  quarantine: QuarantineView,
  isVerbose: boolean
): Promise<void> {
  const { added, modified, removed, refused } = await compareResourceBaseline(
    tracker,
    configManager,
    logger,
    quarantine
  );
  if (!isVerbose) return;
  if (added > 0 || modified > 0 || removed > 0 || refused > 0) {
    logger.info(
      `📊 External changes detected: ${added} added, ${modified} modified, ${removed} removed, ` +
        `${refused} refused (on disk, not in the catalog — no change event logged)`
    );
  } else {
    logger.info('✅ ResourceChangeTracker baseline compared (no external changes detected)');
  }
}

/**
 * Open the state database the MCP tools persist through, or `undefined` when no server root is
 * configured — the one composition in which persistence is genuinely off.
 *
 * Opened BEFORE the tools are built, so `PromptExecutor` hands the port to its chain session store
 * at construction. That store starts initializing in its constructor; when the port arrived later
 * through `setDatabasePort`, every start warned "persistence disabled" for a store that went on to
 * persist. Takes the same `runtimeDbPath` that `claimStateDatabase` claimed the singleton with and
 * supplies it to `getInstance` here too, so this call opens the same singleton at the same path
 * rather than merely relying on it already being open.
 */
async function openToolsDatabase(
  runtimeDbPath: string | undefined,
  serverRoot: string | undefined,
  logger: Logger
): Promise<DatabasePort | undefined> {
  if (serverRoot === undefined || serverRoot === '') return undefined;
  try {
    const { SqliteEngine } = await import('#infra/database/sqlite-engine.js');
    const dbManager = await SqliteEngine.getInstance(serverRoot, logger, {
      dbPath: runtimeDbPath,
    });
    await dbManager.initialize();
    return dbManager;
  } catch (error) {
    throw toolsDatabaseWiringError(serverRoot, error);
  }
}

/**
 * The startup failure for the tools' database wiring, shared by the open and the wiring step.
 *
 * This wiring owns argument history and version history. A swallow here left the rollback feature
 * silently inert — `resource_manager` would report no versions rather than report that it could not
 * reach them.
 */
function toolsDatabaseWiringError(serverRoot: string | undefined, error: unknown): Error {
  const msg = error instanceof Error ? error.message : String(error);
  return new Error(
    `Failed to wire DatabasePort to MCP tools (serverRoot ${String(serverRoot)}): ${msg}`,
    { cause: error }
  );
}

/**
 * Emit one resource's startup inventory.
 *
 * The formatter is pure and returns lines; this is the only place they reach a logger, which keeps
 * the side effect at the orchestration boundary rather than inside the utility.
 */
function logResourceInventory(logger: Logger, inventory: ResourceInventory): void {
  for (const line of formatResourceInventory(inventory)) {
    logger.info(line);
  }
}

/**
 * The inventory line for a resource type, or `undefined` when its root never resolved.
 *
 * `bundled` is reported as `base` and never folded into `overlays`: precedence runs the other way,
 * and a reader deciding which definition is live needs the two kept apart.
 */
function resourceInventoryOf(
  resource: string,
  roots: ResourceRoots,
  count: number
): ResourceInventory | undefined {
  if (roots.primary === undefined) return undefined;
  return {
    resource,
    root: roots.primary,
    count,
    overlays: roots.overlays,
    ...(roots.bundled !== undefined ? { base: roots.bundled } : {}),
  };
}

/** A loader config naming only the roots that resolved, so an absent one stays absent. */
function loaderDirsConfig<PrimaryKey extends string, AdditionalKey extends string>(
  roots: ResourceRoots,
  primaryKey: PrimaryKey,
  additionalKey: AdditionalKey
): Record<string, string | string[]> {
  return {
    ...(roots.primary !== undefined ? { [primaryKey]: roots.primary } : {}),
    ...(roots.additional.length > 0 ? { [additionalKey]: roots.additional } : {}),
  };
}

export async function initializeModules(params: ModuleInitParams): Promise<ModuleInitResult> {
  const {
    logger,
    configManager,
    runtimeOptions,
    promptsData,
    categories,
    convertedPrompts,
    promptManager,
    textReferenceStore,
    mcpServer,
    callbacks,
    serverRoot,
    pathResolver,
    hookRegistry,
    notificationEmitter,
  } = params;

  const isVerbose = runtimeOptions.verbose;

  // Initialize Resource Change Tracker early (for audit logging)
  let resourceChangeTracker: ResourceChangeTracker | undefined;
  const runtimeDbPath =
    pathResolver !== undefined
      ? path.join(pathResolver.getRuntimeStatePath(), 'state.db')
      : undefined;

  await claimStateDatabase(runtimeDbPath, serverRoot, logger);

  if (serverRoot !== undefined && serverRoot !== '') {
    if (isVerbose) logger.info('🔄 Initializing Resource Change Tracker...');
    try {
      // Read here rather than at the FrameworkStateStore site below: the tracker is
      // constructed first, and a value read after construction never reaches it.
      const trackerWorkspaceId = configManager.getConfig().identity?.launchDefaults?.workspaceId;
      resourceChangeTracker = await initializeResourceChangeTracker(
        logger,
        serverRoot,
        runtimeDbPath,
        trackerWorkspaceId != null ? { workspaceId: trackerWorkspaceId } : undefined
      );
      // The baseline comparison used to run HERE, and had to move: it must not report a refused
      // file as an external addition, and it cannot know what was refused until the loaders that
      // do the refusing have run. See the call below the Gate Manager.
      if (isVerbose) logger.info('✅ ResourceChangeTracker initialized');
    } catch (error) {
      // Loud, not degraded. The `serverRoot` guard above already expresses "persistence
      // is not configured"; reaching this catch means it WAS configured and failed, and
      // swallowing it started the server with no audit trail while reporting success.
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to initialize ResourceChangeTracker (state.db at ${runtimeDbPath ?? '<unresolved>'}): ${msg}`,
        { cause: error }
      );
    }
  }

  // Initialize the framework loader with PathResolver-resolved dirs.
  // This ensures PathResolver is the SSOT for directory resolution and enables overlays.
  // Must happen before the framework state store is built, and before any pipeline/tool code calls
  // getDefaultRuntimeLoader(): the store builds the one framework manager the server uses, and that
  // manager's registry keeps the loader it finds at construction. Configured afterwards, the
  // manager would read only the package's frameworks and never a workspace one.
  // Without the bundled tree trailing the search list, a workspace holding a single framework made
  // the server throw `FATAL: Framework 'cageerf' not found` at startup — `resolveResourceSubdir`
  // had made that workspace dir the only frameworks root (see `PathResolver.getBundledResourceDir`).
  const frameworkRoots = resolveResourceRoots(
    pathResolver,
    'frameworks',
    pathResolver?.getFrameworksPath()
  );
  const frameworkLoader = getDefaultRuntimeLoader(
    loaderDirsConfig(frameworkRoots, 'frameworksDir', 'additionalFrameworksDirs')
  );

  if (isVerbose) logger.info('🔄 Initializing Framework State Manager...');
  const frameworkStateRoot =
    typeof configManager.getServerRoot === 'function'
      ? configManager.getServerRoot()
      : path.dirname(configManager.getConfigPath());
  const currentFrameworkConfig = configManager.getFrameworksConfig();
  // Read before construction: the store seeds its in-memory default state from this value,
  // so supplying it afterwards would leave the seed on the built-in fallback.
  const workspaceId = configManager.getConfig().identity?.launchDefaults?.workspaceId;
  const frameworkStateStore = await createFrameworkStateStore(logger, frameworkStateRoot, {
    // Read through the config manager each time, not copied now: it reloads `config.json` when
    // the file changes, so the fallback follows an edited `frameworks.defaultFramework` exactly as
    // the delete refusal in `resource_manager` does, without a restart.
    defaultFramework: () => configManager.getFrameworksConfig().defaultFramework,
    // Every unscoped read and write in this process now resolves to this project.
    ...(workspaceId != null ? { defaultScope: { workspaceId } } : {}),
  });
  if (isVerbose) logger.info('✅ FrameworkStateStore initialized successfully');

  callbacks.handleFrameworkConfigChange(currentFrameworkConfig);

  // Initialize Gate Manager (Phase 4 - registry-based gate system)
  if (isVerbose) logger.info('🔄 Initializing Gate Manager...');
  //
  // `gatesDir` is supplied explicitly. Left unset, `GateDefinitionLoader` falls back to
  // `resolveGatesDir()`, which walks up to the PACKAGE's `resources/gates` and consults neither
  // `MCP_RESOURCES_PATH` nor the workspace — so gate reads ignored both while gate writes have
  // resolved through `getGatesPath()` since Arc 1. The two only agreed on a default install. It
  // also made the startup inventory report a root the gates had not been read from: measured
  // 2026-08-28, `gates: 25 — <workspace>/resources/gates` for a directory holding one gate.
  const gateRoots = resolveResourceRoots(pathResolver, 'gates', pathResolver?.getGatesPath());
  const gateManager = await createGateManager(logger, {
    registryConfig: {
      loaderConfig: loaderDirsConfig(gateRoots, 'gatesDir', 'additionalGatesDirs'),
    },
  });
  if (isVerbose) {
    logger.info(`✅ GateManager initialized with ${gateManager.getStats().totalGates} gates`);
  }

  // The loaders' record of what they refused, as the CHANGE TRACKER needs it.
  //
  // Prompts AND gates here, because `TrackedResourceType` is exactly `'prompt' | 'gate'` — this
  // covers the comparison's whole domain, and adding the framework view would widen the merge past
  // anything that reads it. The indexer walks all four kinds and extends this merge below.
  //
  // Both views are live: `GateManager.getQuarantine()` resolves its registry on every read
  // (`lazyQuarantineView`), so this expression does not depend on having been evaluated after
  // `createGateManager` — which it is, but a reader should not have to verify that to trust it.
  const trackedQuarantine = mergeQuarantineViews(
    promptManager.getQuarantine(),
    gateManager.getQuarantine()
  );

  if (resourceChangeTracker !== undefined) {
    await compareBaselineAndReport(
      resourceChangeTracker,
      configManager,
      logger,
      trackedQuarantine,
      isVerbose
    );
  }

  // Initialize the style loader with PathResolver-resolved dirs, for the same reason as the
  // framework loader above: PathResolver is the SSOT for directory resolution and enables overlays.
  const styleRoots = resolveResourceRoots(pathResolver, 'styles', pathResolver?.getStylesPath());
  const styleLoader = getDefaultStyleDefinitionLoader(
    loaderDirsConfig(styleRoots, 'stylesDir', 'additionalStylesDirs')
  );

  // Root + count for the three resource types initialized here (T1.8). Not gated on quiet — see
  // the matching note in `data-loader.ts`: STDIO auto-enables quiet, so gating would make these
  // unreachable in the only deployment that matters. INFO goes to the log file, not stdout.
  const inventories = [
    resourceInventoryOf('gates', gateRoots, gateManager.getStats().totalGates),
    resourceInventoryOf('frameworks', frameworkRoots, frameworkLoader.discoverFrameworks().length),
    // LOADED styles, not discovered ones. Two things follow from the difference and both are
    // wanted: the line now reports the count the server can actually serve, and reading every
    // style is what FILLS the loader's refusal record — `discoverStyles()` only lists directories
    // holding a `style.yaml` and never opens one, so a quarantine consulted by the indexer further
    // down would have been empty no matter how broken the tree was. The read is cheap (a handful
    // of files) and its results are cached, so nothing downstream pays for it twice.
    resourceInventoryOf('styles', styleRoots, styleLoader.loadAllStyles().size),
  ];
  for (const inventory of inventories) {
    if (inventory !== undefined) logResourceInventory(logger, inventory);
  }

  // The whole catalog's refusal record, and the ONLY place it is assembled.
  //
  // `resource_index` is a projection of the SERVED catalog, so a file the loaders refused gets no
  // row: the Python hooks read this table and hand its ids straight to `prompt_engine`, which
  // rejects an unloadable one. A quarantine MARKER would work only for readers that remember to
  // check it, and some of those readers are not in this repo.
  //
  // Built HERE rather than at the indexer below, and returned in `ModuleInitResult`, because the
  // hot-reload re-sync in `application.ts` indexes the same four kinds and that file holds only
  // `promptManager` and `gateManager` — no framework or style loader. It rebuilt what it could,
  // which was the prompt view alone, under a comment claiming the other three joined there; the
  // first hot reload then re-indexed every refused gate, framework and style (P4.25). One owner
  // for one merged view is what makes that unrepeatable: the reload path can only consume it.
  //
  // Read by reference, never snapshotted. Every leaf is a live collection — `PromptLoader`'s is a
  // `private readonly` field re-filled per root walk, and `GateManager`/`FrameworkManager` resolve
  // theirs through `lazyQuarantineView` on every read — so a repair that lands between two syncs
  // is reflected without anything re-registering.
  //
  // `styleLoader`, not a `StyleManager`: the manager builds its OWN `StyleDefinitionLoader` from
  // its own config (see `PromptExecutor`), so its collection describes a different root set than
  // the one `indexerResourceRoots` walks — and `isRefused` is path-keyed, so a record from the
  // wrong root can never match. The loader this line reads is the same singleton instance
  // `styleRoots` configured above.
  const indexQuarantine = mergeQuarantineViews(
    trackedQuarantine,
    frameworkLoader.getQuarantine(),
    styleLoader.getQuarantine()
  );

  const chainCount = convertedPrompts.filter((p) => isChainPrompt(p)).length;
  if (isVerbose) {
    logger.info(
      `🔗 Chain prompts available: ${chainCount}/${convertedPrompts.length} total prompts`
    );
  }

  if (isVerbose) logger.info('🔄 Initializing MCP tools manager...');
  const metricsCollector = createMetricsCollector(logger);
  const toolsDatabase = await openToolsDatabase(runtimeDbPath, serverRoot, logger);
  const mcpToolsManager = await createMcpToolsManager(
    logger,
    mcpServer,
    promptManager,
    configManager,
    textReferenceStore,
    callbacks.fullServerRefresh,
    callbacks.restartServer,
    gateManager,
    metricsCollector,
    toolsDatabase
  );

  if (isVerbose) logger.info('🔄 Updating MCP tools manager data...');
  mcpToolsManager.updateData(promptsData, convertedPrompts, categories);

  // Wired unconditionally, ahead of any request: `resolveSkillsSyncPaths` reads this same
  // `pathResolver`, so `system_control`'s `skills_sync` action resolves `--workspace` and
  // `MCP_WORKSPACE` the way the rest of the server does, instead of re-deriving them from
  // the environment the way the standalone CLI wrapper does.
  mcpToolsManager.setSkillsSyncPathsProvider(() => resolveSkillsSyncPaths(pathResolver));

  // Wire DatabasePort early so sub-handlers have it before first use
  if (toolsDatabase !== undefined) {
    try {
      const { SqliteStateStore } = await import('#infra/database/stores/sqlite-store.js');
      // Built here, not in the tracker or in mcp/: `modules-no-infra-static` and
      // `mcp-no-infra-static` both bar those layers from naming a concrete infra store, so the
      // composition root is the only place allowed to construct one. It is handed down as the
      // `StateStore` interface. This replaces the tracker's own
      // `INSERT ... kv_state ... 'default'`, which made it a second writer to a table
      // `sqlite-store.ts` owns and pinned all argument history to one shared scope.
      const argHistoryStore = new SqliteStateStore<PersistedArgumentHistory>(
        toolsDatabase,
        {
          tableName: 'kv_state',
          key: 'arg_history',
          defaultState: () => ({
            version: '1.0.0',
            lastUpdated: 0,
            chains: {},
            sessionToChain: {},
          }),
        },
        logger
      );
      // Same launch workspace the tracker and chain stores use, so version_history rows land
      // under the project that produced them instead of one shared 'default' tenant.
      const versionHistoryScope = workspaceId != null ? { workspaceId } : undefined;
      mcpToolsManager.setDatabasePort(toolsDatabase, argHistoryStore, versionHistoryScope);
    } catch (error) {
      throw toolsDatabaseWiringError(serverRoot, error);
    }
  }

  if (isVerbose) logger.info('🔄 Connecting Framework State Manager...');
  mcpToolsManager.setFrameworkStateStore(frameworkStateStore);

  if (isVerbose) logger.info('🔄 Initializing Framework Manager...');
  mcpToolsManager.setFrameworkManager();

  if (isVerbose) logger.info('🔄 Initializing Tool Description Manager...');
  const toolDescriptionLoader = createToolDescriptionLoader(logger, configManager);
  toolDescriptionLoader.setFrameworkStateStore(frameworkStateStore);
  await toolDescriptionLoader.initialize();

  if (isVerbose) logger.info('🔄 Connecting Tool Description Manager to MCP Tools...');
  mcpToolsManager.setToolDescriptionLoader(toolDescriptionLoader);

  // Wire up hook registry and notification emitter for pipeline events
  if (hookRegistry) {
    mcpToolsManager.setHookRegistry(hookRegistry);
  }
  if (notificationEmitter) {
    mcpToolsManager.setNotificationEmitter(notificationEmitter);
  }

  if (isVerbose) logger.info('🔄 Registering all MCP tools...');
  await mcpToolsManager.registerAllTools(mcpServer);

  // Index resources to SQLite for hook consumption (prompt-suggest, etc.)
  if (serverRoot !== undefined && serverRoot !== '') {
    try {
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
        // Assembled above and returned to `Application`, so this walk and the hot-reload walk
        // read one view rather than two that can drift. All four directory-form kinds are in it
        // (P4.16 closed `style`, the last kind the indexer walked with no refusal record at all);
        // the change tracker's narrower merge is `trackedQuarantine`, which this one extends.
        quarantine: indexQuarantine,
      });
      const syncResult = await indexer.syncAll();
      reportSyncFindings(syncResult, logger);
      // The index and the catalog are two derivations of one question; compare them rather than
      // assuming they agree, which is how they came to disagree by 41 prompts unnoticed.
      const indexedPromptIds = dbManager
        .query<{ id: string }>("SELECT id FROM resource_index WHERE type = 'prompt'")
        .map((row) => row.id);
      for (const line of formatIndexReconciliation(
        convertedPrompts.map((prompt) => prompt.id),
        indexedPromptIds
      )) {
        logger.warn(line);
      }
      if (isVerbose) logger.info('✅ ResourceIndexer synced to SQLite');
    } catch (error) {
      // `resource_index` is what the Python hooks read; a stale one makes prompt-suggest
      // recommend resources that no longer exist.
      //
      // Reachability note: `syncAll()` catches per resource type internally and reports
      // failures through `SyncResult.errors` rather than throwing, so this catch fires
      // only if the engine or the dynamic imports fail — the same root cause that would
      // already have thrown at the DatabasePort site above. It is corrected for posture
      // consistency, not because a test can currently reach it. The unchecked
      // `SyncResult.errors` is a separate silent-failure channel, out of Tier 5's scope.
      const msg = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to sync resource index (serverRoot ${serverRoot}): ${msg}`, {
        cause: error,
      });
    }
  }

  return {
    frameworkStateStore,
    gateManager,
    mcpToolsManager,
    toolDescriptionLoader,
    resourceChangeTracker,
    indexQuarantine,
  };
}
