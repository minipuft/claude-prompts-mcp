// @lifecycle canonical - Builds resource change tracker auxiliary reload config.
/**
 * Resource Change Tracking Integration
 *
 * Provides auxiliary reload configuration to track filesystem changes
 * and integrates with the ResourceChangeTracker for audit logging.
 */

import { existsSync, readdirSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import * as path from 'node:path';

import { resolveResourceRoots } from './resource-roots.js';

import type { StateStoreOptions } from '#infra/database/stores/interface.js';
import type { Logger } from '#infra/logging/index.js';
import type {
  AuxiliaryReloadConfig,
  HotReloadEvent,
} from '#modules/hot-reload/hot-reload-observer.js';
import type { FileChangeOperation } from '#shared/types/index.js';
import type { QuarantineView } from '#shared/utils/resource-quarantine.js';
import type {
  DiskEditOutcome,
  DiskEditResourceType,
  DiskEditVersioning,
  LoadedCategoryFile,
} from './disk-edit-versioning.js';
import type { PathResolver } from './paths.js';

import { ConfigLoader } from '#infra/config/index.js';
import {
  createResourceChangeTracker,
  ResourceChangeTracker,
  TrackedResourceType,
} from '#infra/observability/tracking/index.js';
import { setResourceChangeLog } from '#shared/core/resource-change-log.js';
import {
  isExcludedCategoryDirectoryName,
  isIgnoredPromptEntryName,
  isReservedPromptDirectoryName,
  promptIdFromDirectory,
  promptIdFromSingleFile,
} from '#shared/utils/prompt-layout.js';

/**
 * Singleton tracker instance for the application
 * Initialized once and shared across all consumers
 */
let trackerInstance: ResourceChangeTracker | undefined;

/**
 * Initialize the ResourceChangeTracker
 * Should be called once during application startup
 *
 * Publishing the instance to `shared/core/resource-change-log.js` is part of initializing it, not
 * a separate wiring step a caller could forget: mcp/ reads the log through that slot, and a
 * tracker that is running but unpublished loses every mcp-tool-sourced row while the filesystem
 * watcher keeps writing — the shape that reads as "tracking works" in a spot check.
 */
export async function initializeResourceChangeTracker(
  logger: Logger,
  dbPath: string,
  defaultScope?: StateStoreOptions
): Promise<ResourceChangeTracker> {
  if (trackerInstance !== undefined) {
    logger.debug('ResourceChangeTracker already initialized, returning existing instance');
    return trackerInstance;
  }

  trackerInstance = createResourceChangeTracker(logger, {
    dbPath,
    maxEntries: 1000,
    trackPrompts: true,
    trackGates: true,
    ...(defaultScope !== undefined ? { defaultScope } : {}),
  });

  await trackerInstance.initialize();
  setResourceChangeLog(trackerInstance);
  return trackerInstance;
}

/**
 * Get the initialized tracker instance
 * Returns undefined if not yet initialized
 *
 * Module-private since 2026-09-15. The composition root is the only place that should hold the
 * concrete tracker; every other reader takes `ResourceChangeLogPort` from
 * `shared/core/resource-change-log.js`. Exporting it is what let mcp/ import this file.
 */
function getResourceChangeTracker(): ResourceChangeTracker | undefined {
  return trackerInstance;
}

/** The roots the change tracker records for each type it tracks, highest precedence first. */
export interface TrackedResourceRoots {
  prompt: readonly string[];
  gate: readonly string[];
}

/**
 * The roots the change tracker records: each type's primary and every workspace overlay, highest
 * precedence first — never the bundled tree unless it IS the primary.
 *
 * Decided 2026-09-17, when hot reload had come to watch bundled, primary and overlay roots while
 * this tracker still recorded the primary alone, so a served change could leave no record:
 *
 *   - Overlays are in. They are the operator's own files, the catalog serves them over the
 *     primary, and an edit to one changes what `prompt_engine` answers with.
 *   - The bundled tree is out. It changes only when the package does — a plugin update replaces
 *     it wholesale — so a baseline over it would log every release as a burst of external edits,
 *     and `resource_manager` never writes there. When the workspace is the package itself, the
 *     bundled tree is the primary and is tracked exactly as before.
 *   - A root that does not exist yet is listed, so its events reach the tracker once it appears.
 *     A walk over it finds nothing.
 *
 * Rejected: recording every root including bundled, which is the literal "match the watch set" —
 * see the second point. Also rejected: keeping the primary alone as a per-root baseline, which
 * leaves an overlay edit served and unrecorded.
 */
export function trackedResourceRoots(
  configManager: ConfigLoader,
  pathResolver: PathResolver | undefined
): TrackedResourceRoots {
  return {
    prompt: operatorRoots(pathResolver, 'prompts', configManager.getResolvedPromptsDirectory()),
    gate: operatorRoots(pathResolver, 'gates', gatesDirectoryOf(configManager)),
  };
}

/**
 * The framework roots a disk edit is versioned in, by the same rule as {@link
 * trackedResourceRoots}: the primary and every overlay, never the bundled tree unless it is the
 * primary. Apart from that record because frameworks are versioned but not change-logged
 * (`TrackedResourceType` is prompts and gates), so the startup walk and the removal sweep, which
 * feed the change log, never read them.
 */
export function versionedFrameworkRoots(
  configManager: ConfigLoader,
  pathResolver: PathResolver | undefined
): string[] {
  return operatorRoots(pathResolver, 'frameworks', frameworksDirectoryOf(configManager));
}

/** One type's contributing roots, highest precedence first, without the bundled tree. */
function operatorRoots(
  pathResolver: PathResolver | undefined,
  resourceType: string,
  primary: string | undefined
): string[] {
  if (primary === undefined || primary === '') return [];
  const roots = resolveResourceRoots(pathResolver, resourceType, primary);
  return roots.lookupDirs.filter((dir) => dir !== roots.bundled);
}

/** The gates directory, or `undefined` when none is configured. */
function gatesDirectoryOf(configManager: ConfigLoader): string | undefined {
  try {
    return configManager.getGatesDirectory();
  } catch {
    // Gates directory may not be configured
    return undefined;
  }
}

/** The frameworks directory, or `undefined` when none is configured — the gates twin above. */
function frameworksDirectoryOf(configManager: ConfigLoader): string | undefined {
  try {
    return configManager.getFrameworksDirectory();
  } catch {
    return undefined;
  }
}

/**
 * The `category.yaml` each category id is served from: the highest-precedence prompts root holding
 * one, the merge rule `prompt-root-loader.ts` applies to category metadata. A category directory
 * is what the loader counts as one (`isExcludedCategoryDirectoryName`).
 */
function servedCategoryFiles(promptRoots: readonly string[]): LoadedCategoryFile[] {
  const files: LoadedCategoryFile[] = [];
  const seen = new Set<string>();
  for (const root of promptRoots) {
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || isExcludedCategoryDirectoryName(entry.name)) continue;
      const entryPath = path.join(root, entry.name, CATEGORY_ENTRY_FILE);
      if (seen.has(entry.name) || !existsSync(entryPath)) continue;
      seen.add(entry.name);
      files.push({ resourceId: entry.name, entryPath });
    }
  }
  return files;
}

/** One resource as the tracker compares it: the id, and the file that serves it. */
interface TrackedResource {
  resourceType: TrackedResourceType;
  resourceId: string;
  filePath: string;
}

/**
 * Walk every tracked root and return ONE file per id — the one that serves it.
 *
 * The tracker's hash cache is keyed `type/id`, and the overlay contract lets an id live in several
 * roots, so recording every copy would make the comparison alternate between them at each run.
 * The highest-precedence root holding an id wins, which is the loaders' own rule. Gate roots are
 * walked before prompt roots so a real gate root outranks the legacy gate-inside-prompts reading.
 */
async function collectTrackedResources(
  roots: TrackedResourceRoots,
  logger: Logger
): Promise<TrackedResource[]> {
  const resources: TrackedResource[] = [];
  const seen = new Set<string>();

  /**
   * Record one resource, unless the layout says it is not one, the file is not there, or a
   * higher-precedence root already supplied this id.
   *
   * `resourceId === undefined` is `#shared/utils/prompt-layout.js` declining the entry — a
   * reserved filename, or a location the loader does not serve a prompt from.
   */
  const record = (
    resourceType: TrackedResourceType,
    resourceId: string | undefined,
    filePath: string
  ): void => {
    if (resourceId === undefined) return;
    const key = `${resourceType}/${resourceId}`;
    if (seen.has(key) || !existsSync(filePath)) return;
    seen.add(key);
    resources.push({ resourceType, resourceId, filePath });
  };

  for (const root of roots.gate) {
    await scanGateRoot(root, record);
  }
  for (const root of roots.prompt) {
    if (existsSync(root)) {
      await scanPromptTree(root, root, record, logger);
    }
  }
  return resources;
}

type RecordResource = (
  resourceType: TrackedResourceType,
  resourceId: string | undefined,
  filePath: string
) => void;

/** A flat gate root: `{root}/{id}/gate.yaml`. */
async function scanGateRoot(root: string, record: RecordResource): Promise<void> {
  if (!existsSync(root)) return;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      record('gate', entry.name, path.join(root, entry.name, 'gate.yaml'));
    }
  }
}

/**
 * Whether a walk skips the directory `name` found inside `dir`, by the loader's rules.
 *
 * At a prompts root every directory is a category candidate, and the loader's category rule
 * decides: nothing below `backup/` or `node_modules/` is served, so nothing there is announced.
 * Below the root, a prompt's `tools/` is reserved for script tools, so nothing below it entered
 * the catalog either. At the root `tools` is an ordinary category, which the loader serves and
 * this walk must announce. One predicate for the baseline walk and the watcher's event reading, so
 * the two cannot disagree about which directories hold resources.
 */
function isSkippedPromptDirectory(root: string, dir: string, name: string): boolean {
  return dir === root
    ? isExcludedCategoryDirectoryName(name)
    : isIgnoredPromptEntryName(name) || isReservedPromptDirectoryName(name);
}

/**
 * Walk a prompts tree the way the loader walks it.
 *
 * THREE QUESTIONS, ALL OF THEM ANSWERED IN `#shared/utils/prompt-layout.js`: which entries to
 * skip, which files are prompts and where they may sit, and what id each is served under. Only
 * the filename half was shared before P4.28. This walk stopped descending at any directory
 * holding `prompt.yaml` — on the reasoning that such a directory IS the resource rather than a
 * container — while `discoverYamlPrompts` always recurses, because a chain directory holds its
 * own definition AND its steps. Measured 2026-09-15: 15 shipped step prompts sit below that
 * line (`examples/deep_analysis`, `planning/implementation_plan`, `examples/quick_decision`,
 * `codebase-setup/scaffold_project`), so an external edit to any of them reached this
 * comparison as nothing at all — no `added`, no `modified`, no `removed`.
 *
 * Ids derive from `root`, the tracked root being walked, not from the primary: an overlay's
 * `{category}/{id}` is served under the same id as the primary's.
 */
async function scanPromptTree(
  root: string,
  dir: string,
  record: RecordResource,
  logger: Logger
): Promise<void> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      // The loader's first act on every entry, file or directory. Without it this walk would
      // descend into `_drafts/` and announce everything below it.
      if (isIgnoredPromptEntryName(entry.name)) continue;

      const entryPath = path.join(dir, entry.name);
      if (!entry.isDirectory()) {
        record('prompt', promptIdFromSingleFile(root, entryPath), entryPath);
        continue;
      }

      if (isSkippedPromptDirectory(root, dir, entry.name)) continue;

      record('prompt', promptIdFromDirectory(root, entryPath), path.join(entryPath, 'prompt.yaml'));
      // Gates keep their directory name as their id: the gate layout is flat
      // (`{root}/{id}/gate.yaml`) and has no category level for a path-derived id to strip.
      record('gate', entry.name, path.join(entryPath, 'gate.yaml'));

      // Finding a definition is NOT a reason to stop — that was the defect.
      await scanPromptTree(root, entryPath, record, logger);
    }
  } catch (error) {
    logger.debug(`Error scanning directory ${dir}:`, error);
  }
}

/**
 * Compare current resources against baseline and log external changes
 * Called at startup to detect changes made while server was down
 *
 * `quarantine` is the loaders' record of what they refused. Without it this function runs its own
 * filesystem walk and treats every readable file as a resource — a third derivation of "what is in
 * the catalog", disagreeing with the loaders by construction, which is how a file that never
 * entered the catalog came to be logged as `added`. With it, a refused file is neither added nor
 * removed; see `ResourceChangeTracker.compareBaseline`.
 */
export async function compareResourceBaseline(
  tracker: ResourceChangeTracker,
  roots: TrackedResourceRoots,
  logger: Logger,
  quarantine?: QuarantineView
): Promise<{ added: number; modified: number; removed: number; refused: number }> {
  /**
   * Ask the quarantine by PATH, which is what this walk holds.
   *
   * Deliberately not by id, even now that this walk and the loader derive the same one (P4.28):
   * two roots may legitimately serve the same id, which is the overlay contract, so an id is not a
   * unique handle on a FILE. `ResourceQuarantine` is keyed by `(root, path)` for that reason. The
   * path is the one thing both sides hold unambiguously.
   */
  const isRefused = (filePath: string): boolean => quarantine?.isRefused(filePath) === true;

  try {
    const resources = (await collectTrackedResources(roots, logger)).map((resource) => ({
      ...resource,
      refused: isRefused(resource.filePath),
    }));
    logger.debug(`ResourceChangeTracker: Comparing baseline with ${resources.length} resources`);
    return await tracker.compareBaseline(resources);
  } catch (error) {
    logger.warn('Failed to compare resource baseline:', error);
    return { added: 0, modified: 0, removed: 0, refused: 0 };
  }
}

/** Where a changed file sits among the tracked roots, and what it is. */
interface LocatedChange {
  resourceType: DiskEditResourceType;
  resourceId: string;
  /** Every tracked root of this type, highest precedence first. */
  roots: readonly string[];
  root: string;
  /** The file's path below `root` — the same relative path names the same entry in any root. */
  relative: string;
}

/** A category's one file, `{promptsRoot}/{category}/category.yaml`. */
const CATEGORY_ENTRY_FILE = 'category.yaml';

/** What a located file is: its kind, and its id when the layout gives it one. */
type ResourceAt = { resourceType: DiskEditResourceType; resourceId: string | undefined };

/** The resource a file in a prompts tree is, by the walk's own rules, or `undefined`. */
function promptTreeResourceAt(root: string, filePath: string): ResourceAt | undefined {
  const dir = path.dirname(filePath);
  const segments = path
    .relative(root, dir)
    .split(path.sep)
    .filter((segment) => segment !== '');
  // Each segment is judged where the walk would meet it: the first at the root, the rest below.
  const skipped = segments.some((segment, index) =>
    isSkippedPromptDirectory(
      root,
      index === 0 ? root : path.join(root, ...segments.slice(0, index)),
      segment
    )
  );
  const fileName = path.basename(filePath);
  if (skipped || isIgnoredPromptEntryName(fileName)) return undefined;
  // A category is declared one level below the root and nowhere else; deeper, the name is a
  // reserved prompt filename (`prompt-layout.ts`) and declares nothing the loader reads.
  if (fileName === CATEGORY_ENTRY_FILE) {
    return segments.length === 1
      ? { resourceType: 'category', resourceId: segments[0] }
      : undefined;
  }
  if (fileName === 'prompt.yaml') {
    return { resourceType: 'prompt', resourceId: promptIdFromDirectory(root, dir) };
  }
  if (fileName === 'gate.yaml' && segments.length > 0) {
    return { resourceType: 'gate', resourceId: path.basename(dir) };
  }
  return { resourceType: 'prompt', resourceId: promptIdFromSingleFile(root, filePath) };
}

/** The resource a file in a flat gate root is, or `undefined`. */
function gateRootResourceAt(root: string, filePath: string): ResourceAt | undefined {
  const segments = path.relative(root, filePath).split(path.sep);
  if (segments.length !== 2 || segments[1] !== 'gate.yaml') return undefined;
  return { resourceType: 'gate', resourceId: segments[0] };
}

/**
 * The resource a file in a flat framework root is: `{root}/{id}/framework.yaml`, or `undefined`.
 *
 * The entry file only. A framework's `phases.yaml` and `judge-prompt.md` are outside what its
 * version snapshot records (`FRAMEWORK_SNAPSHOT_PROJECTED_KEYS`), so an edit of one changes no
 * recorded state and records nothing.
 */
function frameworkRootResourceAt(root: string, filePath: string): ResourceAt | undefined {
  const segments = path.relative(root, filePath).split(path.sep);
  if (segments.length !== 2 || segments[1] !== 'framework.yaml') return undefined;
  return { resourceType: 'framework', resourceId: segments[0] };
}

/**
 * Locate a changed file in the NEAREST tracked root holding it, and derive its id the way the
 * walk does. The event path used to be read with two regexes of its own — a `/gates/` substring
 * for the type and the parent folder name for the id — so a nested step prompt was logged under a
 * key the startup walk never produces.
 */
function locateTrackedFile(
  filePath: string,
  roots: TrackedResourceRoots,
  frameworkRoots: readonly string[]
): LocatedChange | undefined {
  const candidates = [
    ...roots.gate.map((root) => ({ root, typeRoots: roots.gate, at: gateRootResourceAt })),
    ...roots.prompt.map((root) => ({ root, typeRoots: roots.prompt, at: promptTreeResourceAt })),
    ...frameworkRoots.map((root) => ({
      root,
      typeRoots: frameworkRoots,
      at: frameworkRootResourceAt,
    })),
  ]
    .filter(({ root }) => filePath.startsWith(`${root}${path.sep}`))
    .sort((a, b) => b.root.length - a.root.length);
  const nearest = candidates[0];
  if (nearest === undefined) return undefined;
  const found = nearest.at(nearest.root, filePath);
  if (found?.resourceId === undefined) return undefined;
  return {
    resourceType: found.resourceType,
    resourceId: found.resourceId,
    roots: nearest.typeRoots,
    root: nearest.root,
    relative: path.relative(nearest.root, filePath),
  };
}

/**
 * What a file event changed about the SERVED resource, or `undefined` when it changed nothing.
 *
 * The same one-file-per-id rule the walk applies: a copy shadowed by a higher-precedence root
 * serves nothing, so editing or removing it is not a change; and while a lower root still holds
 * the entry, adding or removing this copy changes the served content, not whether it exists.
 */
function servedChange(
  located: LocatedChange,
  operation: FileChangeOperation
): { operation: FileChangeOperation; filePath: string } | undefined {
  const index = located.roots.indexOf(located.root);
  const holds = (root: string): boolean => existsSync(path.join(root, located.relative));
  if (located.roots.slice(0, index).some(holds)) return undefined;

  const ownPath = path.join(located.root, located.relative);
  const fallback = located.roots.slice(index + 1).find(holds);
  if (fallback === undefined) return { operation, filePath: ownPath };
  return operation === 'removed'
    ? { operation: 'modified', filePath: path.join(fallback, located.relative) }
    : { operation: 'modified', filePath: ownPath };
}

/** The entry files a resource directory can hold, in the order a companion is resolved against. */
const RESOURCE_ENTRY_FILES = ['prompt.yaml', 'gate.yaml'] as const;

/**
 * The entry file a changed file belongs to: itself for a YAML file, and for a companion
 * (`user-message.md`, `system-message.md`, `guidance.md`) the entry file beside it. A companion is
 * part of its resource — the loader inlines it — so editing one changes what that id serves even
 * though the entry file's bytes did not move. `undefined` for a file that is neither.
 */
function entryFileOf(filePath: string): { entryPath: string; companion: boolean } | undefined {
  if (filePath.endsWith('.yaml') || filePath.endsWith('.yml')) {
    return { entryPath: filePath, companion: false };
  }
  const dir = path.dirname(filePath);
  const entry = RESOURCE_ENTRY_FILES.map((name) => path.join(dir, name)).find((candidate) =>
    existsSync(candidate)
  );
  return entry === undefined ? undefined : { entryPath: entry, companion: true };
}

/** The version half of a change-log row, from what the disk-edit recorder did or why it failed. */
function versionFields(
  outcome: DiskEditOutcome | undefined,
  failure: string | undefined
): { versionRecorded?: boolean; reason?: string } {
  if (failure !== undefined) return { versionRecorded: false, reason: failure };
  if (outcome?.kind === 'recorded') return { versionRecorded: true };
  if (outcome?.kind === 'unchanged') return { versionRecorded: false };
  // A purge records no version; the row says what a `resource_manager` delete row says.
  return {};
}

/**
 * Record what a served disk change did to the resource's history, THEN log the change.
 *
 * This is the boundary that catches. `DiskEditVersioning.record` throws when the database refuses
 * a version write (persistence throws, architecture.md); the reload still runs, and the change-log
 * row carries `versionRecorded: false` with the reason, so the gap is on the record rather than in
 * a log line. A refused file records no version — the previous definition keeps serving — and is
 * logged as `refused` with the loader's reason, against the file that changed.
 */
async function recordDiskChange(input: {
  tracker: ResourceChangeTracker;
  versions: DiskEditVersioning;
  located: LocatedChange;
  change: { operation: FileChangeOperation; filePath: string };
  changedFile: string;
  logger: Logger;
}): Promise<void> {
  const { tracker, versions, located, change, changedFile, logger } = input;
  let outcome: DiskEditOutcome | undefined;
  let failure: string | undefined;
  try {
    outcome = await versions.record({
      resourceType: located.resourceType,
      resourceId: located.resourceId,
      operation: change.operation,
      entryPath: change.filePath,
    });
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    logger.error(
      `Disk edit of ${located.resourceType} '${located.resourceId}' recorded no version: ${failure}`
    );
  }

  const row =
    outcome?.kind === 'refused'
      ? { operation: 'refused' as const, filePath: changedFile, reason: outcome.reason }
      : {
          operation: change.operation,
          filePath: change.filePath,
          ...versionFields(outcome, failure),
        };
  if (outcome?.kind === 'refused') {
    logger.warn(
      `${located.resourceType} '${located.resourceId}' was edited on disk and refused by its ` +
        `loader; the previous definition keeps serving: ${outcome.reason}`
    );
  }

  // Frameworks and categories are versioned, not change-logged: the log's vocabulary is
  // `TrackedResourceType`. Their refusal and failure reach the log lines above.
  const resourceType = located.resourceType;
  if (resourceType !== 'prompt' && resourceType !== 'gate') return;
  try {
    await tracker.logChange({
      source: 'filesystem',
      resourceType,
      resourceId: located.resourceId,
      ...row,
    });
  } catch (error) {
    logger.warn(`Failed to log filesystem change for ${located.resourceId}:`, error);
  }
}

/**
 * Build auxiliary reload config for resource change tracking
 * Hooks into HotReloadObserver to track filesystem changes
 *
 * `versions` records the version each served disk edit produced, before the change is logged and
 * — because the observer settles every auxiliary handler before its reload callback — before the
 * reload that serves the edit. Required: a watcher that logged edits without versioning them is
 * the gap this registration closes.
 */
export function buildResourceChangeTrackerAuxiliaryReloadConfig(
  logger: Logger,
  configManager: ConfigLoader,
  pathResolver: PathResolver | undefined,
  versions: DiskEditVersioning
): AuxiliaryReloadConfig | undefined {
  const tracker = getResourceChangeTracker();
  if (tracker === undefined) {
    logger.debug('ResourceChangeTracker not initialized; skipping auxiliary reload wiring');
    return undefined;
  }

  // The WATCH set is fixed here: a project `.claude-prompts/` created later is already one of these
  // roots, as a candidate. Which root outranks which is not fixed — it moves when that directory
  // appears — so the handler and the reconciliation resolve the roots again rather than reading
  // the order at startup.
  const startupRoots = trackedResourceRoots(configManager, pathResolver);
  const directories = [
    ...new Set([
      ...startupRoots.gate,
      ...startupRoots.prompt,
      ...versionedFrameworkRoots(configManager, pathResolver),
    ]),
  ];
  if (directories.length === 0) {
    logger.debug('No resource directories to watch for change tracking');
    return undefined;
  }
  // The catalog has loaded by now: every served `category.yaml` is read once, as the prior state
  // its first edit replaces (`disk-edit-versioning.ts`).
  versions.rememberLoadedCategories(servedCategoryFiles(startupRoots.prompt));

  return {
    id: 'resource-change-tracker',
    directories,
    handler: async (event: HotReloadEvent) => {
      const filePath = event.affectedFiles[0];
      if (filePath === undefined || filePath === '') {
        return;
      }

      const entry = entryFileOf(filePath);
      const located =
        entry === undefined
          ? undefined
          : locateTrackedFile(
              entry.entryPath,
              trackedResourceRoots(configManager, pathResolver),
              versionedFrameworkRoots(configManager, pathResolver)
            );
      if (entry === undefined || located === undefined) {
        logger.debug(`Not a tracked resource file: ${filePath}`);
        return;
      }
      // A companion added, edited or removed changes its resource; it never creates or deletes one.
      const change = servedChange(
        located,
        entry.companion ? 'modified' : (event.changeType ?? 'modified')
      );
      if (change === undefined) {
        logger.debug(`Shadowed by a higher-precedence root, not a served change: ${filePath}`);
        return;
      }

      await recordDiskChange({ tracker, versions, located, change, changedFile: filePath, logger });
    },
    // YAML entry files, and the companion files beside one (`entryFileOf`).
    match: (event) => entryFileOf(event.filePath) !== undefined,
    // Only the removal half: a newly watched folder reports every file in it as added, and a
    // removal needs no content, so no quarantine is consulted — a refused file is still on disk
    // and keeps its key.
    reconcile: async () => {
      const roots = trackedResourceRoots(configManager, pathResolver);
      // A root that armed late serves its categories from now on; each one not already held is
      // read before an edit of it can arrive.
      versions.rememberLoadedCategories(servedCategoryFiles(roots.prompt));
      const present = await collectTrackedResources(roots, logger);
      const removed = await tracker.sweepRemovals(present);
      if (removed > 0) {
        logger.info(`ResourceChangeTracker: reconciliation logged ${removed} removal(s)`);
      }
    },
  };
}

// `logMcpToolChange` moved to `shared/core/resource-change-log.js` on 2026-09-15. Its only callers
// are in mcp/, and while it lived here they reached the composition root to get at it —
// the edge `no-imports-into-runtime` now forbids. Behaviour is unchanged.
