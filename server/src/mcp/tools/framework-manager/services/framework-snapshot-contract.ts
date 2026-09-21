// @lifecycle canonical - How a framework version restores, over the shared projection.

import type { ExistingFrameworkData } from './framework-file-writer.js';
import type { FrameworkCreationData } from '../core/types.js';

import {
  copyPresentFields,
  FRAMEWORK_OPTIONAL_SNAPSHOT_FIELDS,
  FRAMEWORK_REQUIRED_SNAPSHOT_FIELDS,
  FRAMEWORK_SNAPSHOT_PROJECTED_KEYS,
  missingRequiredFields,
  projectFrameworkSnapshot,
  type RestoreResult,
  type SnapshotContract,
} from '#modules/versioning/index.js';

/** The payload `FrameworkFileWriter.writeFrameworkFiles` accepts. */
export type FrameworkWriteModel = Partial<FrameworkCreationData> & { id: string };

/**
 * The framework half of the `SnapshotContract` interface.
 *
 * What a framework version RECORDS is stated once, in
 * `modules/versioning/projections/framework-snapshot.ts`, so `cpm` and `resource_manager` record
 * the same shape — see the note on `gateSnapshotContract` for what a second projection costs.
 * `restore` stays here because it builds a tool-layer write model.
 */
export const frameworkSnapshotContract: SnapshotContract<
  ExistingFrameworkData,
  FrameworkWriteModel
> = {
  resourceType: 'framework',
  requiredFields: FRAMEWORK_REQUIRED_SNAPSHOT_FIELDS,
  projectedFields: FRAMEWORK_SNAPSHOT_PROJECTED_KEYS,

  project(id, live) {
    return projectFrameworkSnapshot(id, {
      framework: live.framework,
      systemPrompt: live.systemPrompt,
    });
  },

  restore(id, snapshot): RestoreResult<FrameworkWriteModel> {
    const missing = missingRequiredFields(snapshot, FRAMEWORK_REQUIRED_SNAPSHOT_FIELDS);
    if (missing.length > 0) {
      return { ok: false, missingFields: missing };
    }

    const writeModel: FrameworkWriteModel = {
      id,
      name: String(snapshot['name']),
      type: String(snapshot['type']),
      enabled: snapshot['enabled'] === true,
    };

    copyPresentFields(writeModel, snapshot, FRAMEWORK_OPTIONAL_SNAPSHOT_FIELDS);

    const unrecordedFields = FRAMEWORK_OPTIONAL_SNAPSHOT_FIELDS.filter(
      (field) => snapshot[field] == null
    );

    return unrecordedFields.length > 0
      ? { ok: true, writeModel, unrecordedFields }
      : { ok: true, writeModel };
  },
};
