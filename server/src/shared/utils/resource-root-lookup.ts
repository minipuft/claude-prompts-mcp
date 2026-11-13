// @lifecycle canonical - How the flat-layout loaders walk their roots, stated in one place.
/**
 * Resource root lookup for the flat-layout kinds — gates, frameworks and styles.
 *
 * WHAT THIS EXISTS TO PREVENT. Each of those three loaders holds a primary directory plus a list
 * of further directories, and each resolved an id as `primary ?? additional`, so the PRIMARY won a
 * same-id conflict. Prompts answered the same question the other way: `prompt-root-loader.ts` loaded
 * bundle -> primary -> overlays with a later result winning, and the resource indexer agreed with
 * prompts. Three kinds disagreed with the other two, and the docstring that justified it
 * ("workspace wins") held only while the workspace WAS the primary. P4.27 settled the disagreement
 * by putting overlays above the primary. The location list (R3l) settled it for good: one ordered
 * list per type, earlier wins, the project folder first and the bundle last. The documented
 * "same ID = custom wins" over the bundle never moved.
 *
 * TWO HALVES. {@link resourceRootPrecedence} states the order, once, for every caller that has the
 * ordered locations in hand. Everything below it merely WALKS an order it is handed and reports
 * which directory under a root actually holds an id — with one judgement of its own, the fallback
 * in {@link resourceLookupOrder}, for a loader configured by hand rather than through the
 * composition root.
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * THE statement of precedence among the roots that contribute one resource type: an EARLIER root
 * wins a duplicate id, for the whole list (R3l).
 *
 * `ordered` is `PathResolver.getResourceLocations` with the bundle taken out, already highest
 * first — the project folder, the profile's folder (or the `MCP_RESOURCES_PATH` folder in its
 * place), the workspace's other layout, then each `paths.resources` entry. The bundled tree goes
 * LAST by construction, whatever position the config lists `"bundled"` at, because the prompt
 * loader and the category listing merge bundle-first (`prompt-root-loader.ts`) and every kind must
 * agree. Each path appears once, at its first position.
 *
 * Read forwards by the flat-layout loaders (first hit wins) and by `classifyOrigin` in
 * `resource-file-set.ts`; read backwards by the resource indexer, which accumulates so the last
 * write wins, and by `prompt-root-loader.ts`, which merges bundle -> overlays -> primary with a
 * later result winning. `ResourceRoots.overlays` is this list's middle, reversed, for those.
 *
 * It lives in `shared/` because that is where a statement about resource layout belongs and
 * because `mcp/` may not import `runtime/`, where its one caller (`runtime/resource-roots.ts`) is.
 */
export function resourceRootPrecedence(roots: {
  ordered: readonly string[];
  bundled: string | undefined;
}): string[] {
  return [...new Set([...roots.ordered, ...(roots.bundled !== undefined ? [roots.bundled] : [])])];
}

/**
 * The directories a loader consults for an id, highest precedence first.
 *
 * `additionalDirs` is taken AS GIVEN — the composition root already ordered it and already placed
 * the primary inside it. The primary is added only when it is absent, which is what a loader
 * configured by hand (tests, standalone use) passes, and it goes FIRST: that is where
 * {@link resourceRootPrecedence} puts the primary, and the fallback is allowed to choose nothing
 * the statement above has already chosen. A primary already in the list keeps its own position.
 */
export function resourceLookupOrder(
  primaryDir: string,
  additionalDirs: readonly string[] = []
): string[] {
  const ordered = additionalDirs.includes(primaryDir)
    ? additionalDirs
    : [primaryDir, ...additionalDirs];
  return [...new Set(ordered)];
}

/**
 * The roots a flat-layout loader holds: its primary and the WHOLE lookup order, primary included
 * (`ResourceRoots.lookupDirs` is the producing end).
 */
interface LoaderRoots {
  primary: string;
  lookupDirs: readonly string[];
}

/**
 * How a loader asks for its roots again. The composition root hands one to each loader, built from
 * the same `resolveResourceRoots` that configured it, so a loader that re-resolves never states an
 * order of its own: it takes whatever {@link resourceRootPrecedence} produces now.
 */
export type LoaderRootsSource = () => LoaderRoots;

/**
 * What a loader keeps of the roots it was given: the lookup order, and the directories beside its
 * primary that it reports and watches.
 *
 * The lookup order is built from the RAW list, before the filter that yields `besideDirs`: the
 * primary's rank is a position in that list, and filtering it out first would drop it to the end,
 * behind the bundled tree. `besideDirs` keeps absent directories — a workspace overlay created
 * while the server runs must be watched, and the observer arms on it once it appears.
 */
export function deriveLoaderRoots(
  primary: string,
  lookupDirs: readonly string[] = []
): { lookupDirs: string[]; besideDirs: string[] } {
  return {
    lookupDirs: resourceLookupOrder(primary, lookupDirs),
    besideDirs: lookupDirs.filter((dir) => dir !== primary),
  };
}

/** Whether two lookup orders name the same directories in the same order. */
export function sameLookupOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((dir, index) => dir === b[index]);
}

/**
 * The directory to load `id` from under one root, or `undefined` when that root does not hold it.
 *
 * Two layouts, and the return value is the BASE the entry point sits one level below — which for a
 * grouped tree is `{root}/{group}`, not `{root}`. That is deliberate: the loaders stamp this exact
 * string as the definition's `sourceRoot` and the quarantine sink records refusals against it, so
 * returning the configured root instead would make a shadow finding compare two different strings.
 *
 * An absent or unreadable root contributes nothing and is not an error — an ordinary install has no
 * workspace root at all, and a custom workspace's `resources/<type>/` is created by its first write.
 */
function resourceEntryRoot(root: string, id: string, entryFileName: string): string | undefined {
  // Flat: {root}/{id}/{entry}
  if (existsSync(join(root, id, entryFileName))) return root;

  // Grouped: {root}/{group}/{id}/{entry}
  try {
    for (const group of readdirSync(root, { withFileTypes: true })) {
      if (!group.isDirectory()) continue;
      if (existsSync(join(root, group.name, id, entryFileName))) return join(root, group.name);
    }
  } catch (_error) {
    // Unreadable root — skip, exactly as an absent one.
  }
  return undefined;
}

/**
 * Every root that holds `id`, in the precedence order it was given.
 *
 * A LIST, not the winner, because holding the file and loading it are different questions: a
 * definition that fails validation is refused and the loader falls through to the next root, so the
 * highest-precedence root that HAS the id is not always the one that serves it. Collapsing this to
 * a single winner would turn a broken workspace gate into a missing gate instead of leaving the
 * bundled one serving.
 */
export function resourceEntryRoots(
  lookupDirs: readonly string[],
  id: string,
  entryFileName: string
): string[] {
  const bases: string[] = [];
  for (const dir of lookupDirs) {
    const base = resourceEntryRoot(dir, id, entryFileName);
    if (base !== undefined) bases.push(base);
  }
  return bases;
}
