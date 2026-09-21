// @lifecycle canonical - Engine-side key derivation for gate.yaml preservation (tool-layer boundary).
/**
 * `GateDefinitionSchema`'s declared object keys, computed once from the schema itself.
 *
 * Exists so `mcp/tools/gate-manager` can derive which gate.yaml keys to preserve on write
 * WITHOUT importing `gate-schema.ts` directly — `validate:arch`'s
 * `tool-layer-no-validator-value-imports` rule forbids the tool layer from value-importing
 * resource validators/schemas (type-only imports are exempt; a runtime `Object.keys(...)` walk
 * is not). This module is the sanctioned engine-side seam: it holds the one value import of
 * `GateDefinitionSchema`, and everything downstream reads a plain `string[]`.
 *
 * A schema field lands in `GATE_YAML_DECLARED_KEYS` automatically — nothing to update by hand
 * when `gate-schema.ts` changes.
 */

import { GateDefinitionSchema } from './gate-schema.js';

export const GATE_YAML_DECLARED_KEYS: readonly string[] = Object.keys(GateDefinitionSchema.shape);

/**
 * gate.yaml keys `buildGateYaml` writes directly from `GateCreationData` — always
 * (`id`/`name`/`type`/`description`/`guidanceFile`) or conditionally when the caller/fallback
 * supplied a value (`pass_criteria`/`activation`/`retry_config`). Never candidates for the
 * generic carry-forward below — `GateFileWriter` already decides their fate.
 */
export const GATE_YAML_PROJECTED_KEYS = [
  'id',
  'name',
  'type',
  'description',
  'guidanceFile',
  'pass_criteria',
  'activation',
  'retry_config',
] as const;

/**
 * Schema keys deliberately NOT carried forward generically. `guidance` is the only member:
 * inline `guidance:` YAML content is always superseded by the `guidance.md` file the writer
 * produces (referenced via `guidanceFile`), so preserving a stale inline value would create two
 * disagreeing guidance sources instead of one.
 */
export const GATE_YAML_EXCLUDED_KEYS = ['guidance'] as const;

/**
 * Authorable gate.yaml keys `GateFileWriter` builds no value for — carried forward from the
 * on-disk file when the caller didn't supply a value. Without this, ANY `resource_manager`
 * update on a hand-authored gate setting these silently strips them back to loader defaults.
 * Same class of bug already fixed for prompts via `PRESERVED_PROMPT_YAML_KEYS`
 * (`resource-manager/prompt/operations/file-operations.ts`).
 *
 * Derived from `GATE_YAML_DECLARED_KEYS` (the walk of `GateDefinitionSchema`'s declared object
 * keys above), minus the projected and excluded sets (currently `severity`, `enforcementMode`,
 * `gate_type`, `evaluation`, `blockResponseOnFail`). A future schema field lands here
 * automatically — nothing to update by hand.
 *
 * `GateCreationData` carries `severity` and `enforcementMode` since P4.4 and `gate_type` since
 * P4.10, so the "caller supplied a value" branch of `resolvePreservedGateYamlFields` is reachable
 * for all three: supplied, they are written; omitted, they still resolve from the existing
 * on-disk file. That separation is the whole point of routing them through preservation rather
 * than projection — settability did not cost the carry-forward.
 *
 * The three constants live HERE rather than beside the writer because the snapshot projection
 * derives from them too (`modules/versioning/projections/gate-snapshot.ts`) and `modules/` may
 * not import `mcp/`. One declaration, two readers — the alternative was a second copy of the
 * partition, which is the defect the derivation exists to prevent.
 */
export const PRESERVED_GATE_YAML_KEYS = GATE_YAML_DECLARED_KEYS.filter(
  (key) =>
    !(GATE_YAML_PROJECTED_KEYS as readonly string[]).includes(key) &&
    !(GATE_YAML_EXCLUDED_KEYS as readonly string[]).includes(key)
);
