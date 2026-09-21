// @lifecycle canonical - How a gate version restores, over the shared projection.

import type { GateGuide } from '#engine/gates/types.js';
import type { GateCreationData } from '../core/types.js';

import {
  copyPresentFields,
  GATE_OPTIONAL_SNAPSHOT_FIELDS,
  GATE_REQUIRED_SNAPSHOT_FIELDS,
  GATE_SNAPSHOT_PROJECTED_KEYS,
  missingRequiredFields,
  projectGateSnapshot,
  type RestoreResult,
  type SnapshotContract,
} from '#modules/versioning/index.js';

/**
 * The gate half of the `SnapshotContract` interface.
 *
 * `project` is one line on purpose. What a gate version RECORDS is stated once, in
 * `modules/versioning/projections/gate-snapshot.ts`, because `cpm` records gate versions too and
 * `cli-shared/` may not import `mcp/` (`validate:arch`'s `cli-shared-no-runtime`). Before that
 * move the CLI wrote a second, differently-shaped projection of the same gate — the raw YAML map,
 * `{id,name,description,type,severity,guidanceFile}` against the server's
 * `{id,name,type,description,guidance}` — so the two could never compare equal and every `cpm`
 * rollback of a server-written gate wrote a bridge row.
 *
 * `restore` stays HERE, and that is not an oversight: it reconstructs `GateCreationData`, a
 * tool-layer payload type `modules/` may not name. A restore is a write-model concern, not a
 * projection.
 */
export const gateSnapshotContract: SnapshotContract<GateGuide, GateCreationData> = {
  resourceType: 'gate',
  requiredFields: GATE_REQUIRED_SNAPSHOT_FIELDS,
  projectedFields: GATE_SNAPSHOT_PROJECTED_KEYS,

  project(id, live) {
    return projectGateSnapshot(id, {
      name: live.name,
      type: live.type,
      description: live.description,
      guidance: live.getGuidance(),
      definition: live.getDefinition(),
    });
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
