// @lifecycle canonical - The one conversion from a loaded gate.yaml to the definition the pipeline reads.
/**
 * `toGateDefinition` turns a parsed gate (`LoadedGateDefinition`) into the
 * `LightweightGateDefinition` every pipeline stage reads.
 *
 * `GateLoader` and `GateManagerProvider` used to hold one private copy each. They drifted one key
 * at a time: the provider, which is the one the live server reviews through, dropped `evaluation`
 * (P4.133) and then `sourceRoot` (P4.140), while tests drove the loader and stayed green. The two
 * callers are peers in different layers, so neither delegates to the other; both call this.
 *
 * The carried keys are an exhaustive table over `LightweightGateDefinition`: adding a field to
 * that interface fails the typecheck here until the table names it. A key only the passthrough
 * schema knows (an undeclared `gate.yaml` key) is NOT carried, because the output type is closed
 * and nothing downstream could read it.
 */

import type { LightweightGateDefinition } from '../types.js';
import type { LoadedGateDefinition } from './gate-schema.js';

/** `retry_config` is the one key rebuilt rather than copied — see `normalizeRetryConfig`. */
type CopiedKey = Exclude<keyof LightweightGateDefinition, 'retry_config'>;

/**
 * Every key copied as-is when present. `satisfies` makes the table exhaustive in both directions:
 * a missing key and a key the output does not declare are each a compile error.
 */
const COPIED_KEYS = {
  id: true,
  name: true,
  type: true,
  description: true,
  subject: true,
  severity: true,
  enforcementMode: true,
  guidanceFile: true,
  guidance: true,
  pass_criteria: true,
  activation: true,
  gate_type: true,
  blockResponseOnFail: true,
  evaluation: true,
  // Provenance travels with the definition: a `shell_verify` criterion naming a script that ships
  // inside the gate directory can only be resolved by something that knows which root served it.
  sourceRoot: true,
} as const satisfies Record<CopiedKey, true>;

/**
 * Compile-time proof that each copied key's loaded type fits the output's, which is what licenses
 * the single widening assignment in the loop below. Resolves to `never` (and fails the assignment
 * that follows) the day a schema change makes one of them incompatible.
 */
type CopiedKeysFit = {
  [K in CopiedKey]-?: NonNullable<LoadedGateDefinition[K]> extends NonNullable<
    LightweightGateDefinition[K]
  >
    ? true
    : never;
};
const copiedKeysFit: CopiedKeysFit = COPIED_KEYS;

/**
 * The retry defaults the schema declares. They stay spelled out here: `GateRetryConfigSchema` is
 * `.partial()`, which re-wraps each defaulted field as optional, so the OUTPUT type still admits
 * `undefined` even though a parsed `retry_config` carries the values at runtime.
 */
function normalizeRetryConfig(
  retry: LoadedGateDefinition['retry_config']
): LightweightGateDefinition['retry_config'] {
  if (retry === undefined) return undefined;
  return {
    max_attempts: retry.max_attempts ?? 2,
    improvement_hints: retry.improvement_hints ?? true,
    preserve_context: retry.preserve_context ?? true,
  };
}

/** Convert a loaded gate definition to the shape the pipeline reads. Pure; never mutates input. */
export function toGateDefinition(loaded: LoadedGateDefinition): LightweightGateDefinition {
  const carried: Record<string, unknown> = {};
  for (const key of Object.keys(copiedKeysFit) as CopiedKey[]) {
    const value = loaded[key];
    if (value !== undefined) carried[key] = value;
  }
  const retryConfig = normalizeRetryConfig(loaded.retry_config);
  if (retryConfig !== undefined) carried['retry_config'] = retryConfig;
  return carried as unknown as LightweightGateDefinition;
}
