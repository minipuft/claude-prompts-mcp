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
