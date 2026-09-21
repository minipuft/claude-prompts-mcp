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

/**
 * What a `version_history` row of this surface can be ABOUT.
 *
 * One of five same-named unions in this repo with four different memberships, so be precise about
 * which one this is: it types `HistoryRowRequest.resource_type`, which is the value bound into
 * every statement in `version-history-rows.ts`. It is not the published `resource_type` of
 * `resource_manager` (`mcp/tools/resource-manager/core/types.ts`), and it is not the versioning
 * domain's own (`modules/versioning/types.ts`, which carries `category` and no `style`).
 *
 * `'config'` joined at O.9 (owner ruling R53), and it is deliberately the ONLY union that gained
 * it. `version_history.resource_type` is a bare `TEXT NOT NULL` with no CHECK, so there is no
 * schema bump — same as `'category'` at P4.7. Widening the published union instead would advertise
 * a config write surface over MCP, and config has been read-only there since #312; widening the
 * versioning domain's union would force a fake entry filename into `resourceFileSet`'s
 * `ENTRY_FILENAME` table and publish an enumeration that cannot exist. Config is checkpointed by
 * `cli-shared/config-checkpoint.ts`, which states the whole argument.
 */
export type ResourceType = 'prompt' | 'gate' | 'framework' | 'style' | 'config';

/**
 * Which rows an operation acts on, and the per-call facts a row records.
 *
 * Separate from {@link HistoryRequest} because the row-level helpers read exactly these four
 * fields and nothing else, while a dispatched request additionally names an action and a database.
 * `rollbackVersion` needs the first without the second: it holds its own connection open across
 * the file write (see `recordCheckpointedWrite`) instead of routing one action through `dispatch`,
 * so it has a resource to name and no action to dispatch.
 */
export interface HistoryRowRequest {
  resource_type: ResourceType;
  resource_id: string;
  max_versions?: number;
  created_at?: string;
}

export interface HistoryRequest extends HistoryRowRequest {
  action:
    | 'load_history'
    | 'get_version'
    | 'save_version'
    | 'compare_versions'
    | 'delete_history'
    | 'rename_history';
  db_path: string;
  version?: number;
  from_version?: number;
  to_version?: number;
  snapshot?: Record<string, unknown>;
  /**
   * The resource's bytes, already read, for the row the disk currently describes.
   *
   * Absent means projection-only. See `recordTree` for why the answer is per ROW rather than per
   * row kind, and `recordCheckpointedWrite` for the ordering that lets BOTH rows of one operation
   * carry one.
   */
  produced_tree?: LoadedTree | null;
  description?: string;
  diff_summary?: string;
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
   * Set by `save_version` — whether a row was inserted.
   *
   * False means the snapshot was identical to the newest recorded one, so `version` is the number
   * that already existed. A caller printing `version` without reading this announces a save that
   * did not happen.
   */
  recorded?: boolean;
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
