// @lifecycle canonical - The one gate snapshot projection, read by the MCP tool layer and by cpm.

import { canonicalizeSnapshot, copyPresentFields } from '../snapshot-contract.js';

import { GATE_YAML_PROJECTED_KEYS } from '#engine/gates/core/gate-yaml-keys.js';

/**
 * gate.yaml keys the snapshot records, derived from the writer's own partition rather than
 * restated (OQ-C1, ruled 2026-08-17).
 *
 * `GATE_YAML_PROJECTED_KEYS` (built from the caller's payload), `GATE_YAML_EXCLUDED_KEYS`, and
 * `PRESERVED_GATE_YAML_KEYS` are a three-way split of the gate surface, and that split is exactly
 * the authored-versus-resolved question a snapshot has to answer — so this list subtracts from the
 * declared constant instead of maintaining a second copy: a field added to `GateDefinitionSchema`
 * later lands in the preserved set automatically and is therefore automatically absent here, with
 * nothing to update by hand.
 *
 * Two adjustments to the projected set, both because a snapshot records CONTENT and the writer's
 * constant describes YAML KEYS:
 *
 *  - `guidanceFile` is dropped. `buildGateYaml` hardcodes it to `'guidance.md'` on every write, so
 *    it carries no information and recording it would imply a restorable choice that does not
 *    exist.
 *  - `guidance` is added. It is in the writer's EXCLUDED set — excluded from generic YAML
 *    carry-forward precisely because it lives in `guidance.md` rather than in `gate.yaml` — but it
 *    is authored content, and a version that could not restore the guidance body would record
 *    almost nothing worth rolling back to.
 */
export const GATE_SNAPSHOT_PROJECTED_KEYS = [
  ...GATE_YAML_PROJECTED_KEYS.filter((key) => key !== 'guidanceFile'),
  'guidance',
] as const;

/**
 * Fields a gate snapshot must carry before it can be restored.
 *
 * These are precisely `GateCreationData`'s non-optional members. The three optional ones
 * (`pass_criteria`, `activation`, `retry_config`) are deliberately absent: `buildGateYaml` omits
 * each when the value is undefined, so "absent from the snapshot" and "the gate genuinely had
 * none at that version" are the same state, and requiring them would refuse rollbacks to versions
 * of gates that never declared them.
 */
export const GATE_REQUIRED_SNAPSHOT_FIELDS = [
  'id',
  'name',
  'type',
  'description',
  'guidance',
] as const;

/** The projected keys that are optional — restored when recorded, left absent when not. */
export const GATE_OPTIONAL_SNAPSHOT_FIELDS = GATE_SNAPSHOT_PROJECTED_KEYS.filter(
  (key) => !(GATE_REQUIRED_SNAPSHOT_FIELDS as readonly string[]).includes(key)
);

/**
 * Everything a gate snapshot is projected FROM, stated as plain data rather than as a loaded gate.
 *
 * The server holds a `GateGuide` and the CLI holds a parsed `gate.yaml` plus the body of the file
 * `guidanceFile` names; both can produce this, and neither can produce the other's object. Naming
 * the four scalars separately from `definition` is not decoration: the server reads them off the
 * guide (`live.name`), whose values are the schema-defaulted ones, and passing the definition
 * alone would have silently changed what the server records.
 */
export interface GateSnapshotSource {
  readonly name: unknown;
  readonly type: unknown;
  readonly description: unknown;
  /** The guidance BODY — `guidance.md`'s content, never the file name. */
  readonly guidance: unknown;
  /**
   * The gate's own declaration, read for the optional projected keys.
   *
   * On the server this is `getDefinition()` — the raw on-disk definition, NOT the normalizing
   * `getActivationRules()`/`getPassCriteria()` accessors: those default absent fields to `{}`/`[]`,
   * which would record an `activation: {}` the gate never declared and make a later restore write
   * that fabricated key to disk. On the CLI it is the parsed `gate.yaml`, which is the same thing
   * before defaults — and the three optional keys carry no schema default, so the two agree.
   */
  readonly definition: Record<string, unknown>;
}

/** Project a gate onto exactly the authored state a version row records. */
export function projectGateSnapshot(
  id: string,
  source: GateSnapshotSource
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {
    id,
    name: source.name,
    type: source.type,
    description: source.description,
    guidance: source.guidance,
  };

  copyPresentFields(snapshot, source.definition, [...GATE_OPTIONAL_SNAPSHOT_FIELDS]);

  // Declared key order, always — `latestSnapshotMatches` is JSON.stringify equality (F18).
  return canonicalizeSnapshot(snapshot, GATE_SNAPSHOT_PROJECTED_KEYS);
}
