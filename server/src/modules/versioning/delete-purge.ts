// @lifecycle canonical - The one way a delete handler purges the history of what it removed.
import type { ResourceType } from './types.js';
import type { VersionHistoryService } from './version-history-service.js';

/** Either the number of rows purged, or the sentence to hand the operator instead. */
export interface HistoryPurgeOutcome {
  removed: number;
  /** Set only on failure; `removed` is then 0 and nothing was purged. */
  failure?: string;
}

/**
 * Purge the history of a resource that has just been removed from disk, for a delete handler.
 *
 * ONE implementation for all four resource types, because the defect it closes was one shape at
 * four sites: none of them purged, so a deleted resource's rows survived forever — unreachable,
 * since every reader resolves the resource first, and inherited by whatever was created under that
 * id next. Four hand-written copies of this would be four chances to drift back apart.
 *
 * It does NOT throw. `deleteHistory` does, correctly — persistence throws and the caller decides —
 * and this IS that decision, made once: the files are already gone, so neither "the delete failed"
 * nor a silent success is true. The caller gets a sentence naming both halves and returns it as an
 * error, which keeps the honest report at one `if` per handler rather than a try/catch each.
 */
export async function purgeHistoryOnDelete(
  service: VersionHistoryService,
  resourceType: ResourceType,
  resourceId: string,
  removedDescription: string
): Promise<HistoryPurgeOutcome> {
  try {
    return { removed: await service.deleteHistory(resourceType, resourceId) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      removed: 0,
      failure:
        `${resourceType} '${resourceId}' was deleted — ${removedDescription} — but its ` +
        `\`version_history\` rows could NOT be purged: ${message}. They remain and are ` +
        `unreachable by any action, and a ${resourceType} later created under this id would ` +
        `inherit them.`,
    };
  }
}
