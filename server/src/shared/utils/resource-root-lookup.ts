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
 * by putting overlays above the primary. A project workspace reversed that: it is the root a write
 * lands in AND the nearest root, so the primary now outranks the overlays and the overlays outrank
 * the bundled tree. The documented "same ID = custom wins" over the bundle never moved.
 *
 * TWO HALVES. {@link resourceRootPrecedence} states the order, once, for every caller that has the
 * three root kinds in hand. Everything below it merely WALKS an order it is handed and reports
 * which directory under a root actually holds an id — with one judgement of its own, the fallback
 * in {@link resourceLookupOrder}, for a loader configured by hand rather than through the
 * composition root.
 */

import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * THE statement of precedence among the roots that contribute one resource type.
 *
 * The primary (the root a write lands in) outranks the overlays, the overlays outrank the bundled
 * tree, and a later overlay outranks an earlier one. One rule, not a case for any root kind: under
 * a project workspace it reads project > user workspace > bundle, and under a plain workspace the
 * only pair it orders differently from before R9 is `<ws>/resources/<type>` (the primary) over the
 * legacy `<ws>/<type>` (an overlay).
 *
 * `modules/prompts/prompt-root-loader.ts` produces the same order read backwards, by loading
 * bundle -> overlays -> primary and letting a later result win; the resource indexer produces it by
 * accumulating in that direction, and `classifyOrigin` in `resource-file-set.ts` reads it forwards.
 *
 * It lived in `shared/` because its two callers sat in layers that may not import each other:
 * `runtime/resource-roots.ts` (the composition root's three loaders, and the resource indexer via
 * the reverse of this list) and `mcp/.../prompt-executor.ts` (a style loader the pipeline built
 * for itself). Those two derived the order independently and had to agree by inspection; the
 * second one omitted the primary altogether, which under a first-hit-wins walk ranks the bundled
 * tree above an operator's own styles. P4.31 deleted the second caller along with the second
 * loader — the pipeline now receives the composition root's instance — so `runtime/` is the only
 * caller today. It stays in `shared/` because that is where a statement about resource layout
 * belongs and because `mcp/` still may not import `runtime/`, not because two callers need it.
 *
 * The primary is IN the list, not beside it: a list that left it out could not say where it goes,
 * and every consumer would have to re-derive the boundary between "overlay" and "bundled" from a
 * flat array that cannot express it.
 */
export function resourceRootPrecedence(roots: {
  primary: string | undefined;
  overlays: readonly string[];
  bundled: string | undefined;
}): string[] {
  return [
    ...new Set([
      ...(roots.primary !== undefined ? [roots.primary] : []),
      // Reversed: `overlays` is stated lowest-first (a later entry wins) and this is a
      // first-hit-wins lookup order.
      ...[...roots.overlays].reverse(),
      ...(roots.bundled !== undefined && roots.bundled !== roots.primary ? [roots.bundled] : []),
    ]),
  ];
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
