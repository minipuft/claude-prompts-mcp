// @lifecycle canonical - Type definitions for version history system

// VersioningConfig and DEFAULT_VERSIONING_CONFIG are defined in shared/types/ (Layer 0).
// Import directly from shared/types/index.js — no re-export shim.

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
  /** Type of resource (prompt, gate, methodology) */
  resource_type: 'prompt' | 'gate' | 'framework';
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
  error?: string;
}

/**
 * Result of a rollback operation
 */
export interface RollbackResult {
  success: boolean;
  /** The new version number created for the pre-rollback state */
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
