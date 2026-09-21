// @lifecycle canonical - Type definitions for version history system

// VersioningConfig and DEFAULT_VERSIONING_CONFIG are defined in shared/types/ (Layer 0).
// Import directly from shared/types/index.js — no re-export shim.

/**
 * The resource types `version_history` records.
 *
 * Exported here rather than declared privately in the service because the snapshot contract is
 * keyed on it and the tool layer implements that contract — a second local declaration would be a
 * homonym, and a filter written against the wrong one is not type-detectable.
 *
 * `'category'` joined at P4.7. `version_history.resource_type` is a bare `TEXT NOT NULL` with no
 * CHECK constraint, so the column needed no schema bump and no existing row changes meaning — the
 * widening is in this type and in the contracts keyed on it.
 */
export type ResourceType = 'prompt' | 'gate' | 'framework' | 'category';

/**
 * A single version entry in the history
 */
export interface VersionEntry {
  /** Incrementing version number */
  version: number;
  /** ISO 8601 timestamp of when this version was saved */
  date: string;
  /** Full snapshot of the resource at this version */
  snapshot: Record<string, unknown>;
  /** Summary of changes (e.g., "+2/-1") */
  diff_summary: string;
  /** Human-readable description of changes */
  description: string;
}

/**
 * Assembled history for a resource (loaded from version_history table)
 */
export interface HistoryFile {
  /** Type of resource (prompt, gate, framework, category) */
  resource_type: ResourceType;
  /** ID of the resource */
  resource_id: string;
  /** Current/latest version number */
  current_version: number;
  /** Array of version entries (newest first) */
  versions: VersionEntry[];
}

/**
 * Result of a version save operation
 */
export interface SaveVersionResult {
  success: boolean;
  version?: number;
  /**
   * Whether a row was actually inserted.
   *
   * `version` alone cannot say. A write whose snapshot is identical to the newest recorded one
   * creates no row and returns the version that already existed, so a reply reading only `version`
   * would tell the operator "Version 7 saved" about a row written minutes ago by someone else.
   * Required rather than optional, and false rather than absent on the disabled path: a second
   * writer that forgets to set it should fail to compile, not default to claiming a save.
   */
  recorded: boolean;
  error?: string;
}

/**
 * Result of a rollback operation
 */
export interface RollbackResult {
  success: boolean;
  /**
   * Whether the rollback recorded a row for the restored state.
   *
   * False when the target version is already the current state: there is nothing to restore and
   * nothing to record, so `saved_version` is the version that was already newest.
   */
  recorded?: boolean;
  /**
   * The newest version number after the rollback — go-forward semantics (P7): this row holds
   * the RESTORED content, not the pre-rollback state. A bridge row for the pre-rollback live
   * state is inserted first only when it was not already the latest recorded snapshot, in
   * which case `saved_version` is two versions ahead of the pre-rollback latest rather than one.
   */
  saved_version?: number;
  /** The version that was restored */
  restored_version?: number;
  error?: string;
}

/**
 * Options for the saveVersion operation
 */
export interface SaveVersionOptions {
  /** Human-readable description of the changes */
  description?: string;
  /** Pre-computed diff summary (e.g., "+2/-1") */
  diff_summary?: string;
}
