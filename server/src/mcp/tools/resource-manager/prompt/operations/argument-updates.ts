// @lifecycle canonical - Pure merge-by-name overlay for `argument_updates` (Fix D).
/**
 * Structured per-field overlay onto an existing prompt's `arguments`, addressed by `name` (P6-F16
 * / tier-b-settability-proposal §2 Fix D).
 *
 * Pure by construction: no I/O, no logging, no clock — same posture as `template-patch.ts`, and
 * for the same reason (architecture.md: business logic does not belong in the orchestrating
 * processor, and a merge worth naming is worth unit-testing without constructing the processor's
 * context). `PATCH_TARGET_FIELDS` deliberately stays closed to the three text bodies; anchored
 * string replacement cannot address WHICH argument, so reaching a single argument's field
 * otherwise requires resending the entire `arguments` array.
 *
 * No upsert: an update naming an argument the prompt does not have is a rejection, never an
 * insert. Adding, removing, or renaming arguments stays with a full `arguments` re-send — this
 * module only overlays fields onto an entry that already exists.
 */

/** One argument's per-field overlay. `name` is the match key, not itself an overlaid field. */
export interface PromptArgumentUpdate {
  name: string;
  description?: string;
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
  required?: boolean;
  defaultValue?: unknown;
  validation?: unknown;
}

export type ArgumentUpdateResult =
  { ok: true; arguments: Array<Record<string, unknown>> } | { ok: false; unmatchedName: string };

/**
 * Merge `updates` onto `baseArguments` by `name`. Each update overlays only the fields it
 * supplies onto the matched entry — an omitted field on the update leaves the matched entry's
 * existing value untouched, and every argument not named by any update is returned unchanged.
 *
 * Fails on the FIRST unmatched name rather than collecting every mismatch: `updates` may name the
 * same argument more than once (later overlays win), so a name that is unmatched after earlier
 * updates already landed would report a materially different mismatch than a check run up front —
 * failing fast keeps the reported name unambiguous.
 */
export function mergeArgumentUpdates(
  baseArguments: readonly Record<string, unknown>[],
  updates: readonly PromptArgumentUpdate[]
): ArgumentUpdateResult {
  const merged = baseArguments.map((argument) => ({ ...argument }));
  const indexByName = new Map<string, number>();
  merged.forEach((argument, index) => {
    if (typeof argument['name'] === 'string') {
      indexByName.set(argument['name'], index);
    }
  });

  for (const update of updates) {
    const index = indexByName.get(update.name);
    if (index === undefined) {
      return { ok: false, unmatchedName: update.name };
    }
    const { name: _matchKey, ...overlay } = update;
    merged[index] = { ...merged[index], ...overlay };
  }

  return { ok: true, arguments: merged };
}
