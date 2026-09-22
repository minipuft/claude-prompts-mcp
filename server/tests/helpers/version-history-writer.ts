/**
 * Write one `version_history` row the way a test needs it — a test helper, not a product path.
 *
 * WHY IT LIVES HERE. `cli-shared` exported a `saveVersion` that append-wrote a row from a
 * snapshot, and it had 47 call sites in 11 test files and ZERO production callers: every `cpm`
 * write goes through `recordCheckpointedWrite`, which enumerates the resource's files, writes
 * them, and records the row inside the same transaction. A row-writer that takes a snapshot and
 * nothing else is what a TEST wants — a table populated with known versions, cheaply, to exercise
 * the UNIQUE race, the prune bound, the object sweep and tree parity — and it is a shape no
 * `cpm` command may use, because it records a row for a write it did not perform.
 *
 * Migrating those 47 sites onto the production writer was considered and rejected (ruling R76):
 * `recordCheckpointedWrite` adds a bridge row for a resource with no prior history, which
 * renumbers every assertion in those files. The fix is the one that matches what the function IS.
 *
 * WHAT IT SHARES WITH PRODUCTION. Everything below the row: `openStateDb` (the same pragmas and
 * the same missing-table refusal), `resolveTenantId` (the same scope derivation), and
 * `appendVersion` (the same transaction, numbering, unchanged-write equality test and prune). So
 * a test writing a row here exercises the production row writer; only the decision to record one
 * is the test's.
 */

import { DEFAULT_MAX_VERSIONS } from '../../src/cli-shared/version-history-types.js';
import { openStateDb } from '../../src/cli-shared/version-history.js';
import { appendVersion } from '../../src/cli-shared/version-history-rows.js';
import { resolveTenantId } from '../../src/cli-shared/version-history-scope.js';
import { resolveStateDbPath } from '../../src/cli-shared/version-history-location.js';

import type { LoadedTree } from '../../src/cli-shared/object-store.js';
// TWO `ResourceType`s exist and they are not the same union: `cli-shared`'s adds `style` and
// `config`, which `version_history` holds rows for and the resource tools do not author. The
// row writer's union is the one to take here — the retired export took it too.
import type { ResourceType } from '../../src/cli-shared/version-history-types.js';
import type { SaveVersionResult } from '../../src/modules/versioning/types.js';

/** The same options the retired `cli-shared` export took, so call sites moved unchanged. */
export interface TestSaveVersionOptions {
  description?: string;
  diff_summary?: string;
  maxVersions?: number;
  /** The resource's bytes as they are on disk right now, when the row may claim them. */
  tree?: LoadedTree | null;
}

/**
 * Append a version row for `resourceId` under the workspace holding `resourceDir`.
 *
 * Returns the same three-field result the retired export did: `recorded: false` with a
 * `version` of 0 for an unchanged write, and `success: false` with a reason when `state.db` is
 * absent or carries no `version_history` table.
 */
export function saveVersion(
  resourceDir: string,
  resourceType: ResourceType,
  resourceId: string,
  snapshot: Record<string, unknown>,
  options?: TestSaveVersionOptions
): SaveVersionResult {
  const dbPath = resolveStateDbPath(resourceDir);
  if (dbPath === null || resourceType.length === 0 || resourceId.length === 0) {
    return { success: false, error: 'Unable to resolve resource DB path', recorded: false };
  }

  const opened = openStateDb(dbPath);
  if ('error' in opened) {
    return { success: false, error: opened.error, recorded: false };
  }

  try {
    const outcome = appendVersion(
      opened.db,
      resolveTenantId(dbPath),
      {
        resource_type: resourceType,
        resource_id: resourceId,
        max_versions: options?.maxVersions ?? DEFAULT_MAX_VERSIONS,
        created_at: new Date().toISOString(),
      },
      snapshot,
      {
        description: options?.description ?? '',
        diffSummary: options?.diff_summary ?? '',
        tree: options?.tree ?? null,
      }
    );
    return { success: true, version: outcome.version, recorded: outcome.recorded };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      recorded: false,
    };
  } finally {
    opened.db.close();
  }
}
