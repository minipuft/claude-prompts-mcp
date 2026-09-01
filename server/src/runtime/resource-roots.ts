// @lifecycle canonical - Single derivation of which directories contribute one resource type.
/**
 * Resource root resolution.
 *
 * One resource type can be defined in three places at once: the package's own bundled tree, the
 * primary directory the path resolver picked, and workspace overlay directories. Which of those
 * contribute, and in what precedence, is a single question — but it used to be answered
 * independently by the loaders, and a third time by the resource indexer, which never learned the
 * answer at all.
 *
 * That divergence is the defect this module exists to prevent. Measured 2026-08-29 against a live
 * STDIO server: the loaders served 119 prompts across 16 categories while `resource_index` held
 * 78 across 11, because the indexer walked only the primary root. Every Python hook reads the
 * index, so `strategicImplement` and `design_muse` — bundled, loaded, executable — did not exist
 * as far as the prompt router was concerned.
 *
 * Callers that need precedence-ordered directories use {@link orderedResourceRoots}; callers
 * feeding a loader's `{primary, additional[]}` shape use {@link ResourceRoots} directly.
 */

import type { ResourceRootMap } from '#infra/database/resource-indexer.js';
import type { PathResolver } from './paths.js';

/** Every directory that contributes definitions of one resource type, in precedence order. */
export interface ResourceRoots {
  /** The root the loader treats as primary; a same-id definition here wins. */
  primary: string | undefined;
  /** Workspace directories layered over the primary. */
  overlays: string[];
  /** The package's own directory, when it is a source distinct from the primary. */
  bundled: string | undefined;
  /** What the loader takes as its fallback list: overlays, then the bundled tree last. */
  additional: string[];
}

/**
 * Resolve the contributing roots for one resource type.
 *
 * Pure apart from the resolver's own `existsSync` probes. The bundled directory goes LAST in
 * `additional`, not into `overlays`: all three loaders resolve an id as `primary ?? additional[0]
 * ?? …`, so trailing it yields "workspace wins, bundled definitions stay reachable" — the
 * semantics `src/index.ts`'s help has always documented but the code did not implement. Omitted
 * entirely on an ordinary install, where the primary already IS the bundle.
 */
export function resolveResourceRoots(
  pathResolver: PathResolver | undefined,
  resourceType: string,
  primary: string | undefined
): ResourceRoots {
  const overlays = pathResolver?.getOverlayResourceDirs(resourceType, primary) ?? [];
  const candidate = pathResolver?.getBundledResourceDir(resourceType);
  const bundled = candidate !== undefined && candidate !== primary ? candidate : undefined;
  const additional =
    bundled !== undefined && !overlays.includes(bundled) ? [...overlays, bundled] : overlays;
  return { primary, overlays, bundled, additional };
}

/**
 * The same roots as a flat list ordered LOWEST precedence first, deduplicated.
 *
 * `ResourceRoots.additional` is a loader fallback list — a lookup order, where the first hit wins
 * and the bundled tree therefore trails. A consumer that instead *accumulates* (the indexer scans
 * every root into one map) needs the opposite arrangement: bundled first so a later root's
 * same-id definition overwrites it. Reusing `additional` there would index the bundled copy over
 * the workspace one and invert the documented "same ID = custom wins".
 */
function orderedResourceRoots(roots: ResourceRoots): string[] {
  const ordered = [
    ...(roots.bundled !== undefined ? [roots.bundled] : []),
    ...(roots.primary !== undefined ? [roots.primary] : []),
    ...roots.overlays,
  ];
  return [...new Set(ordered)];
}

/**
 * The resource-type subdirectory each indexed type is loaded from.
 *
 * The indexer names types in the singular (`prompt`) because that is what the `resource_index.type`
 * column holds; the path resolver names directories in the plural. One mapping, stated once.
 */
const INDEXED_TYPE_DIRS = {
  prompt: 'prompts',
  gate: 'gates',
  framework: 'frameworks',
  style: 'styles',
} as const;

/**
 * The roots the resource indexer must walk so its rows describe the catalog the loaders serve.
 *
 * The indexer cannot compute this itself: it lives in `infra/` (Layer 1), which
 * `.dependency-cruiser.cjs` forbids from importing `runtime/`. So the runtime resolves the roots
 * and hands them down, which is the correct direction anyway — path policy is not a database
 * concern.
 */
export function indexerResourceRoots(pathResolver: PathResolver | undefined): ResourceRootMap {
  if (pathResolver === undefined) return {};
  const primaries: Record<keyof typeof INDEXED_TYPE_DIRS, string> = {
    prompt: pathResolver.getPromptsPath(),
    gate: pathResolver.getGatesPath(),
    framework: pathResolver.getFrameworksPath(),
    style: pathResolver.getStylesPath(),
  };

  const map: ResourceRootMap = {};
  for (const [type, dir] of Object.entries(INDEXED_TYPE_DIRS)) {
    const key = type as keyof typeof INDEXED_TYPE_DIRS;
    map[key] = orderedResourceRoots(resolveResourceRoots(pathResolver, dir, primaries[key]));
  }
  return map;
}
