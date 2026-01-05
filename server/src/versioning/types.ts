// @lifecycle canonical - Type definitions for version history system

/**
 * Configuration for versioning behavior
 */
export interface VersioningConfig {
  /** Enable/disable version tracking globally */
  enabled: boolean;
  /** Maximum versions to retain per resource (FIFO pruning) */
  max_versions: number;
  /** Auto-save version on updates (can be overridden per-call) */
  auto_version: boolean;
}

/**
 * Default versioning configuration
 */
export const DEFAULT_VERSIONING_CONFIG: VersioningConfig = {
  enabled: true,
  max_versions: 50,
  auto_version: true,
};

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
 * Structure of the .history.json sidecar file
 */
export interface HistoryFile {
  /** Type of resource (prompt, gate, methodology) */
  resource_type: 'prompt' | 'gate' | 'methodology';
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
