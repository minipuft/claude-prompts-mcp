// @lifecycle canonical - How a category version restores, over the shared projection.

import type { CategoryCreationData } from '../core/types.js';

import {
  CATEGORY_OPTIONAL_SNAPSHOT_FIELDS,
  CATEGORY_REQUIRED_SNAPSHOT_FIELDS,
  CATEGORY_SNAPSHOT_PROJECTED_KEYS,
  copyPresentFields,
  missingRequiredFields,
  projectCategorySnapshot,
  type RestoreResult,
  type SnapshotContract,
} from '#modules/versioning/index.js';

/**
 * The category half of the `SnapshotContract` interface.
 *
 * `TLive` is the raw on-disk `category.yaml` document, not a live in-memory `Category` — the
 * reasoning is on `projectCategorySnapshot`, which is where what a category version records is
 * now stated, once, for both surfaces. `restore` stays here because it builds a tool-layer write
 * model.
 */
export const categorySnapshotContract: SnapshotContract<
  Record<string, unknown>,
  CategoryCreationData
> = {
  resourceType: 'category',
  requiredFields: CATEGORY_REQUIRED_SNAPSHOT_FIELDS,
  projectedFields: CATEGORY_SNAPSHOT_PROJECTED_KEYS,

  project(id, declared) {
    return projectCategorySnapshot(id, declared);
  },

  restore(id, snapshot): RestoreResult<CategoryCreationData> {
    const missing = missingRequiredFields(snapshot, CATEGORY_REQUIRED_SNAPSHOT_FIELDS);
    if (missing.length > 0) {
      return { ok: false, missingFields: missing };
    }

    const writeModel: CategoryCreationData = {
      id,
      name: String(snapshot['name']),
      description: String(snapshot['description']),
    };

    copyPresentFields(
      writeModel as unknown as Record<string, unknown>,
      snapshot,
      CATEGORY_OPTIONAL_SNAPSHOT_FIELDS
    );

    return { ok: true, writeModel };
  },
};
