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

import { resourceRootPrecedence } from '#shared/utils/resource-root-lookup.js';

/** Every directory that contributes definitions of one resource type, in precedence order. */
export interface ResourceRoots {
  /** The writable root: where a `resource_manager` write lands, and what the inventory reports. */
  primary: string | undefined;
  /** Workspace directories layered over the primary. Highest precedence, later entry wins. */
  overlays: string[];
  /** The package's own directory, when it is a source distinct from the primary. Lowest. */
  bundled: string | undefined;
  /**
   * The loader's lookup list: every contributing root, HIGHEST precedence first.
   *
   * Named `additional` for the loader config key it feeds (`additionalGatesDirs` and its two
   * siblings), which is now a misnomer — the list includes the primary, because the primary is not
   * the top of the order and a list that omitted it could not say where it sits. Renaming both ends
   * needs `runtime/module-initializer.ts`, owned elsewhere this slice.
   */
  additional: string[];
}

/**
 * Resolve the contributing roots for one resource type.
 *
 * Which directories contribute is decided here; their ORDER is decided by
 * `resourceRootPrecedence` in `shared/`, which this and the pipeline's own style loader both call
 * so the two cannot drift. Until P4.27 the three flat-layout loaders resolved `primary ??
 * additional` and the docstring here justified it as "workspace wins"; that held only while the
 * workspace WAS the primary, so an operator's `<workspace>/gates/foo` lost to
 * `<workspace>/resources/gates/foo` while their `<workspace>/prompts/foo` won. Two answers to one
 * question.
 *
 * Pure apart from the resolver's own `existsSync` probes.
 */
export function resolveResourceRoots(
  pathResolver: PathResolver | undefined,
  resourceType: string,
  primary: string | undefined
): ResourceRoots {
  const overlays = pathResolver?.getOverlayResourceDirs(resourceType, primary) ?? [];
  const candidate = pathResolver?.getBundledResourceDir(resourceType);
  const bundled = candidate !== undefined && candidate !== primary ? candidate : undefined;
  const additional = resourceRootPrecedence({ primary, overlays, bundled });
  return { primary, overlays, bundled, additional };
}

/**
 * The same roots as a flat list ordered LOWEST precedence first.
 *
 * Literally the reverse of the loader lookup list, and derived from it rather than rebuilt beside
 * it — the two readings of one order, not two orders. A loader looks an id UP, so the first hit
 * wins and the highest-precedence root leads; the indexer ACCUMULATES every root into one id-keyed
 * map, so the highest-precedence root must land last and overwrite. Stating the second arrangement
 * independently is how the indexer once walked only the primary while the loaders walked three
 * roots, which is the defect this module's header records.
 */
function orderedResourceRoots(roots: ResourceRoots): string[] {
  return [...roots.additional].reverse();
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
