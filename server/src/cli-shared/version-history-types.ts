// @lifecycle canonical - The request/response and row shapes the CLI history modules exchange.
/**
 * Shapes shared by every `cli-shared/version-history-*` module.
 *
 * They live apart from the functions that use them so the four modules can depend on one another
 * through data rather than through each other: the dispatcher needs the request, the row helpers
 * need the request and the row, and neither needs the other's functions. Split out of
 * `version-history.ts` when that file crossed the 1000-line gate — a pure move, no shape changed.
 */

import type { VersionEntry, HistoryFile } from '#modules/versioning/types.js';
import type { LoadedTree } from './object-store.js';

import { DEFAULT_VERSIONING_CONFIG } from '#shared/types/core-config.js';

/**
 * Trim a history to this many versions when the workspace configures no bound of its own.
 *
 * Derived from the server's `DEFAULT_VERSIONING_CONFIG` rather than restated: the two writers of
 * `version_history` must agree on what an unconfigured workspace keeps, and a second literal is a
 * second thing to forget. It is the FALLBACK only — an operator who set `versioning.maxVersions`
 * gets that value on both surfaces (`resolveConfiguredMaxVersions`).
 */
export const DEFAULT_MAX_VERSIONS = DEFAULT_VERSIONING_CONFIG.maxVersions;

export type ResourceType = 'prompt' | 'gate' | 'framework' | 'style';

export interface HistoryRequest {
  action:
    | 'load_history'
    | 'get_version'
    | 'save_version'
    | 'record_edit_result'
    | 'compare_versions'
    | 'rollback'
    | 'delete_history'
    | 'rename_history';
  db_path: string;
  resource_type: ResourceType;
  resource_id: string;
  version?: number;
  from_version?: number;
  to_version?: number;
  max_versions?: number;
  created_at?: string;
  snapshot?: Record<string, unknown>;
  /** The on-disk state immediately BEFORE this edit — only read by `record_edit_result`/`rollback` for the bridge check. */
  prior_snapshot?: Record<string, unknown>;
  /**
   * The resource's bytes, already read, for whichever row the disk currently describes.
   *
   * Absent means projection-only, which is every action but `rollback` today. See
   * `recordEditResultRow` for why the answer is per ROW rather than per row kind.
   */
  bridge_tree?: LoadedTree | null;
  produced_tree?: LoadedTree | null;
  description?: string;
  diff_summary?: string;
  target_version?: number;
  current_snapshot?: Record<string, unknown>;
  new_resource_id?: string;
}

export interface HistoryResponse {
  success: boolean;
  error?: string;
  history?: HistoryFile | null;
  entry?: VersionEntry | null;
  from?: VersionEntry;
  to?: VersionEntry;
  version?: number;
  /**
   * Set by `save_version`, `record_edit_result` and `rollback` — whether a row was inserted.
   *
   * False means the snapshot was identical to the newest recorded one, so `version` is the number
   * that already existed. A caller printing `version` without reading this announces a save that
   * did not happen.
   */
  recorded?: boolean;
  /** Set by `record_edit_result` — true when a bridge row was inserted before the recorded result. */
  bridged?: boolean;
  saved_version?: number;
  restored_version?: number;
  snapshot?: Record<string, unknown>;
  /**
   * Set alongside `success: false` by `load_history` when `resolveEffectiveTenantId` found the
   * guessed tenant empty AND more than one other tenant holding rows for this resource — refused
   * rather than guessed between two real candidates. Distinguishes this from every other
   * `success: false` (missing `state.db`, missing table): those map to `loadHistory` returning
   * `null`, same as a genuinely empty history; this one must not, or a caller cannot tell
   * "nothing recorded" from "recorded somewhere this guess could not find".
   */
  ambiguous?: true;
}

/** One persisted `version_history` row, before decoding the JSON snapshot. */
export interface HistoryRow {
  version: number;
  snapshot: string;
  diff_summary: string | null;
  description: string | null;
  created_at: string;
}
