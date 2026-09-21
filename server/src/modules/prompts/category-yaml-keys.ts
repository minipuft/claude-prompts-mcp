// @lifecycle canonical - Prompts-side key derivation for category.yaml preservation (tool-layer boundary).
/**
 * `CategorySchema`'s declared object keys, computed once from the schema itself.
 *
 * Exists so `mcp/tools/category-manager` can derive which `category.yaml` keys to preserve on
 * write WITHOUT importing `prompt-schema.ts` directly — `validate:arch`'s
 * `tool-layer-no-validator-value-imports` rule forbids the tool layer from value-importing
 * resource validators/schemas (type-only imports are exempt; a runtime `Object.keys(...)` walk
 * is not). This module is the sanctioned seam, exactly as `gate-yaml-keys.ts` is for gates: it
 * holds the one value import of `CategorySchema`, and everything downstream reads a plain
 * `string[]`.
 *
 * A schema field lands in `CATEGORY_YAML_DECLARED_KEYS` automatically — nothing to update by
 * hand when `CategorySchema` changes.
 */

import { CategorySchema } from './prompt-schema.js';

export const CATEGORY_YAML_DECLARED_KEYS: readonly string[] = Object.keys(CategorySchema.shape);

/**
 * `category.yaml` keys `buildCategoryYaml` writes directly from `CategoryCreationData` — always,
 * because `CategorySchema` requires all three. Never candidates for the generic carry-forward
 * below: `CategoryFileWriter` already decides their fate.
 */
export const CATEGORY_YAML_PROJECTED_KEYS = ['id', 'name', 'description'] as const;

/**
 * Authorable `category.yaml` keys `CategoryFileWriter` builds no value for — carried forward from
 * the on-disk file when the caller didn't supply one. Without this, ANY `resource_manager` update
 * on a hand-authored category setting these silently strips them back to loader defaults, which
 * is the same class already fixed for prompts (`PRESERVED_PROMPT_YAML_KEYS`) and gates
 * (`PRESERVED_GATE_YAML_KEYS`).
 *
 * Derived from `CATEGORY_YAML_DECLARED_KEYS` above minus the projected set, so a future schema
 * field lands here automatically with nothing to update by hand. There is no manual tail as there
 * is for gates: `CategorySchema` is a plain `z.object` with no `.passthrough()`, so every key it
 * accepts is a key it declares.
 *
 * Both constants live HERE rather than beside the writer because the snapshot projection derives
 * from them too (`modules/versioning/projections/category-snapshot.ts`) and a second copy of the
 * partition is exactly what the derivation exists to prevent.
 */
export const PRESERVED_CATEGORY_YAML_KEYS = CATEGORY_YAML_DECLARED_KEYS.filter(
  (key) => !(CATEGORY_YAML_PROJECTED_KEYS as readonly string[]).includes(key)
);
