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
  /**
   * Files found on disk that did NOT become one of `count`, by reason.
   *
   * A count of successes is not reconcilable against a directory listing, so a catalog missing
   * four prompts reads exactly like a complete one — which is how 123 files serving 119 prompts
   * went unnoticed. Naming each subtraction makes the line add up, and a reason that turns out to
   * be wrong becomes a visible claim rather than a silent absence. Zero-valued reasons are
   * dropped: a healthy start should not print `0 invalid`.
   */
  subtractions?: readonly { label: string; value: number }[];
  /** Overlay directories merged on top of `root`, if any. */
  overlays?: readonly string[];
  /**
   * The bundled directory merged UNDER `root`, when it is a distinct contributing source.
   *
   * Distinct from `overlays` because precedence runs the other way: an overlay wins a duplicate
   * id, the base loses. Reporting it as an overlay would misstate which definition is live.
   */
  base?: string;
}

/** How many disagreeing ids to name before summarising the rest. */
const MAX_NAMED_DISAGREEMENTS = 5;

/**
 * Report where the SQLite index and the served catalog disagree about which prompts exist.
 *
 * These are two independent derivations of one question — the loaders build the catalog, the
 * indexer re-walks the filesystem — and nothing compared them. So they diverged silently and
 * completely: 119 prompts served, 78 indexed (measured 2026-08-29). The index is what every
 * Python hook reads, which made a bundled, executable prompt answer "Unknown prompt" at the
 * router while `prompt_engine` ran it happily.
 *
 * Both directions are findings, and they fail differently. An id in the catalog but not the index
 * is unreachable through the hooks. An id in the index but not the catalog is worse: the hooks
 * offer it and the tool rejects it.
 *
 * Pure: returns lines, writes nothing. Empty when the two agree, so a healthy start stays quiet.
 */
export function formatIndexReconciliation(
  servedIds: readonly string[],
  indexedIds: readonly string[]
): string[] {
  const served = new Set(servedIds);
  const indexed = new Set(indexedIds);
  const unindexed = servedIds.filter((id) => !indexed.has(id));
  const unserved = indexedIds.filter((id) => !served.has(id));

  const lines: string[] = [];
  if (unindexed.length > 0) {
    lines.push(
      `⚠️  ${unindexed.length} served prompt(s) missing from resource_index — hooks cannot see them: ${nameSome(unindexed)}`
    );
  }
  if (unserved.length > 0) {
    lines.push(
      `⚠️  ${unserved.length} indexed prompt(s) are not served — hooks will offer ids the tool rejects: ${nameSome(unserved)}`
    );
  }
  return lines;
}

/** Name the first few ids and count the rest, so one bad root cannot produce a 100-line warning. */
function nameSome(ids: readonly string[]): string {
  const named = ids.slice(0, MAX_NAMED_DISAGREEMENTS).join(', ');
  const rest = ids.length - MAX_NAMED_DISAGREEMENTS;
  return rest > 0 ? `${named}, and ${rest} more` : named;
}

/**
 * Render one inventory line, plus an overlay line when overlays contributed.
 *
 * Pure: returns the text and writes nothing. The caller owns the logger and the quiet/verbose
 * decision, so this stays testable without a logger and honest about where the side effect is.
 */
export function formatResourceInventory(inventory: ResourceInventory): string[] {
  const { resource, root, count, detail, overlays, base, subtractions } = inventory;

  const parts = [
    ...(detail !== undefined ? [`${detail.value} ${detail.label}`] : []),
    ...(subtractions ?? []).filter((s) => s.value > 0).map((s) => `${s.value} ${s.label}`),
  ];
  const size = parts.length > 0 ? `${count} (${parts.join(', ')})` : `${count}`;
  const lines = [`📂 ${resource}: ${size} — ${root}`];

  if (base !== undefined && base !== root) {
    lines.push(`   ↳ over bundled base: ${base}`);
  }
  if (overlays !== undefined && overlays.length > 0) {
    lines.push(`   ↳ overlaid from: ${overlays.join(', ')}`);
  }

  return lines;
}
