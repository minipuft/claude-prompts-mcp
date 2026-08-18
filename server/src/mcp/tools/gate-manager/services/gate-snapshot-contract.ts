// @lifecycle canonical - What a gate version records, and how it restores.

import { GATE_YAML_PROJECTED_KEYS } from './gate-file-writer.js';

import type { GateGuide } from '#engine/gates/types.js';
import type { GateCreationData } from '../core/types.js';

import {
  canonicalizeSnapshot,
  copyPresentFields,
  missingRequiredFields,
  type RestoreResult,
  type SnapshotContract,
} from '#modules/versioning/index.js';

/**
 * gate.yaml keys the snapshot records, derived from the writer's own partition rather than
 * restated (OQ-C1, ruled 2026-08-17).
 *
 * `GateFileWriter` already declares a three-way split of the gate surface:
 * `GATE_YAML_PROJECTED_KEYS` (built from the caller's payload), `GATE_YAML_EXCLUDED_KEYS`, and
 * `PRESERVED_GATE_YAML_KEYS` (carried forward from disk because the writer builds no value for
 * them). That split is exactly the authored-versus-resolved question a snapshot has to answer, so
 * this list subtracts from the writer's constant instead of maintaining a second copy: a field
 * added to `GateDefinitionSchema` later lands in the preserved set automatically and is therefore
 * automatically absent here, with nothing to update by hand.
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
const GATE_OPTIONAL_SNAPSHOT_FIELDS = GATE_SNAPSHOT_PROJECTED_KEYS.filter(
  (key) => !(GATE_REQUIRED_SNAPSHOT_FIELDS as readonly string[]).includes(key)
);

export const gateSnapshotContract: SnapshotContract<GateGuide, GateCreationData> = {
  resourceType: 'gate',
  requiredFields: GATE_REQUIRED_SNAPSHOT_FIELDS,
  projectedFields: GATE_SNAPSHOT_PROJECTED_KEYS,

  project(id, live) {
    // The raw on-disk definition, NOT the normalizing getActivationRules()/getPassCriteria()
    // accessors: those default absent fields to {}/[], which would record an `activation: {}` the
    // gate never declared and make a later restore write that fabricated key to disk.
    const definition = live.getDefinition();
    const snapshot: Record<string, unknown> = {
      id,
      name: live.name,
      type: live.type,
      description: live.description,
      guidance: live.getGuidance(),
    };

    copyPresentFields(snapshot, definition as unknown as Record<string, unknown>, [
      ...GATE_OPTIONAL_SNAPSHOT_FIELDS,
    ]);

    // Declared key order, always — `latestSnapshotMatches` is JSON.stringify equality (F18).
    return canonicalizeSnapshot(snapshot, GATE_SNAPSHOT_PROJECTED_KEYS);
  },

  restore(id, snapshot): RestoreResult<GateCreationData> {
    const missing = missingRequiredFields(snapshot, GATE_REQUIRED_SNAPSHOT_FIELDS);
    if (missing.length > 0) {
      return { ok: false, missingFields: missing };
    }

    const writeModel: GateCreationData = {
      id,
      name: String(snapshot['name']),
      type: snapshot['type'] === 'guidance' ? 'guidance' : 'validation',
      description: String(snapshot['description']),
      guidance: String(snapshot['guidance']),
    };

    // Restoring the optional keys is what makes a rollback own the whole projected surface: a
    // version that declared no `pass_criteria` restores to a gate.yaml with no `pass_criteria`,
    // because `buildGateYaml` omits what it is not given. Everything OUTSIDE this projection is a
    // different matter — `resolvePreservedGateYamlFields` carries it forward from disk, which is
    // the correct-by-contrast live read this contract must not replace.
    copyPresentFields(
      writeModel as unknown as Record<string, unknown>,
      snapshot,
      GATE_OPTIONAL_SNAPSHOT_FIELDS
    );

    return { ok: true, writeModel };
  },
};
