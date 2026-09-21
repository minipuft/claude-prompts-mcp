// @lifecycle canonical - The one category snapshot projection, read by the MCP tool layer and cpm.

import { canonicalizeSnapshot, copyPresentFields } from '../snapshot-contract.js';

import {
  CATEGORY_YAML_PROJECTED_KEYS,
  PRESERVED_CATEGORY_YAML_KEYS,
} from '#modules/prompts/category-yaml-keys.js';

/**
 * `category.yaml` keys the snapshot records, derived from the writer's own partition rather than
 * restated (the ruling `gate-snapshot.ts` records as OQ-C1).
 *
 * For categories the two halves of that partition are the WHOLE authored surface — projected
 * (`id`/`name`/`description`) plus preserved (`registerWithMcp`/`mcpPromptMode`) — so the
 * snapshot is their union with no adjustment. The gate contract has to subtract `guidanceFile`
 * and add `guidance` because a gate's authored content lives partly outside `gate.yaml`; a
 * category has exactly one file and no such split.
 *
 * Including the preserved keys is what makes a category rollback whole. They are preserved on an
 * ORDINARY write because the caller omitted them; a rollback is not an ordinary write — it states
 * the entire recorded document — so a version that declared no `mcpPromptMode` must restore to a
 * file with no `mcpPromptMode`, which `buildCategoryYaml` produces by omitting what it is not
 * given.
 */
export const CATEGORY_SNAPSHOT_PROJECTED_KEYS = [
  ...CATEGORY_YAML_PROJECTED_KEYS,
  ...PRESERVED_CATEGORY_YAML_KEYS,
] as const;

/**
 * Fields a category snapshot must carry before it can be restored.
 *
 * Precisely `CategoryCreationData`'s non-optional members, which are precisely `CategorySchema`'s
 * required keys — a document missing one does not validate, so restoring it would write a file
 * the writer's own verification step rolls back.
 */
export const CATEGORY_REQUIRED_SNAPSHOT_FIELDS = ['id', 'name', 'description'] as const;

/** The projected keys that are optional — restored when recorded, left absent when not. */
export const CATEGORY_OPTIONAL_SNAPSHOT_FIELDS = CATEGORY_SNAPSHOT_PROJECTED_KEYS.filter(
  (key) => !(CATEGORY_REQUIRED_SNAPSHOT_FIELDS as readonly string[]).includes(key)
);

/**
 * A category snapshot is projected from the raw on-disk `category.yaml` document, not from a
 * loaded in-memory `Category`.
 *
 * Deliberate, and the same reasoning `inspect` follows. The loaded `Category` resolves `name` to
 * `formatCategoryName(id)` and `description` to `Prompts in the <id> category` when the file
 * declares neither, so it cannot distinguish an authored value from a derived one — and a
 * snapshot built from it would record defaults as though an author had chosen them, then restore
 * them into the file on the next rollback. The document is the only source that knows, and it is
 * the source BOTH surfaces hold.
 */
export function projectCategorySnapshot(
  id: string,
  declared: Record<string, unknown>
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = { id };
  copyPresentFields(snapshot, declared, [
    'name',
    'description',
    ...CATEGORY_OPTIONAL_SNAPSHOT_FIELDS,
  ]);

  // Declared key order, always — `latestSnapshotMatches` is JSON.stringify equality.
  return canonicalizeSnapshot(snapshot, CATEGORY_SNAPSHOT_PROJECTED_KEYS);
}
