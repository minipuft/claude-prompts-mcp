// @lifecycle canonical - Startup inventory lines pairing each resource root with its count.
/**
 * Startup inventory lines — which root each resource type was served from, and how many.
 *
 * The count alone is not diagnostic. Before this, a normal-level startup said
 * `✓ Loaded 39 prompts from 8 categories` and named no directory, so a catalog that was a SUBSET
 * of what the operator expected looked identical to a complete one. Roots were logged only under
 * `--verbose` (`context.ts`) or `PathResolver`'s `debug` flag, which is to say: only when someone
 * already suspected a path problem.
 *
 * The case that motivated it (T1-F5): `git worktree add` checks out tracked files only, and 83 of
 * this repo's 122 prompts are gitignored, so a session launched against a worktree serves 39.
 * Among the missing is `tech_recommendation`, which the operator's handbook gates on — so the gate
 * silently cannot fire, and nothing in the log distinguishes that from a healthy start.
 *
 * Pairing the count WITH the root is what makes the subset visible: 39 is unremarkable until it
 * appears next to a path the reader did not expect.
 */

/** One resource type's resolved location and size, as measured at startup. */
export interface ResourceInventory {
  /** Resource type as the operator names it: `prompts`, `gates`, `frameworks`, `styles`. */
  resource: string;
  /** The directory actually resolved and read. */
  root: string;
  /** How many of the resource were served from it. */
  count: number;
  /** Optional secondary count, e.g. `{ label: 'categories', value: 8 }`. */
  detail?: { label: string; value: number };
  /** Overlay directories merged on top of `root`, if any. */
  overlays?: readonly string[];
}

/**
 * Render one inventory line, plus an overlay line when overlays contributed.
 *
 * Pure: returns the text and writes nothing. The caller owns the logger and the quiet/verbose
 * decision, so this stays testable without a logger and honest about where the side effect is.
 */
export function formatResourceInventory(inventory: ResourceInventory): string[] {
  const { resource, root, count, detail, overlays } = inventory;

  const size = detail !== undefined ? `${count} (${detail.value} ${detail.label})` : `${count}`;
  const lines = [`📂 ${resource}: ${size} — ${root}`];

  if (overlays !== undefined && overlays.length > 0) {
    lines.push(`   ↳ overlaid from: ${overlays.join(', ')}`);
  }

  return lines;
}
