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
