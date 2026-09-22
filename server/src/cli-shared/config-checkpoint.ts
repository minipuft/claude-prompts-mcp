// @lifecycle canonical - The one place a write to the workspace config file is checkpointed.
/**
 * Config as a checkpointed resource (owner ruling R53).
 *
 * WHAT THIS REPLACES. Every `cpm config set` and `cpm config reset` used to copy the config file
 * beside itself as `config.json[c].backup.<epoch-ms>` — on every invocation, with no equality
 * check, no retention bound, and nothing anywhere that reads one back (`system_control config
 * restore` was retired in #312). Measured 2026-09-21: two `cpm config set gates.enabled false` in a
 * row, the second changing nothing, left two backup files. Those files are now version rows, and
 * the thing that reads them back is `cpm config history` / `cpm config rollback`.
 *
 * WHY CONFIG IS NOT A `ResourceType`. It is keyed `resource_type='config'`, `resource_id='config'`
 * in `version_history` — a bare `TEXT` column with no CHECK, so no schema bump, exactly as
 * `'category'` was at P4.7 — and that literal widens ONE of this repo's five `ResourceType`
 * homonyms, `version-history-types.ts`. It deliberately does not widen the other four:
 *
 *   - `mcp/tools/resource-manager/core/types.ts` is the PUBLISHED union. Config is read-only over
 *     MCP since #312 and stays so; `resource_manager` learns nothing here and neither does
 *     `system_control config`. R53's "`cpm` can restore one" is satisfied entirely on the CLI.
 *   - `modules/versioning/types.ts` keys `ENTRY_FILENAME` in `shared/utils/resource-file-set.ts`
 *     and the four `SnapshotContract`s. Config has no resource root, no entry-filename rule and no
 *     loader, so a `config:` entry there would be a fake filename publishing an enumeration that
 *     cannot run.
 *
 * NO PROJECTION FALLBACK, AND THAT IS THE CONTRACT. Every other checkpointed thing has a
 * `SnapshotContract` that can re-render it from the `snapshot` column when its bytes are missing.
 * Config has none: the file's BYTES are the version, comments and all. So `snapshot` holds only
 * {@link ConfigSnapshot} — filename, size, digest — which is enough to render a history and to
 * satisfy `snapshot TEXT NOT NULL`, and deliberately not enough to restore from. A `config` row
 * whose tree is missing is REFUSED by name rather than restored from a projection
 * (`config-restore.ts`). Storing the parsed document instead was rejected twice over: it would be a
 * second copy of every value an operator typed (`validateConfigDocument` only WARNS on an unknown
 * key, so a config may legally hold anything), and it would still not restore a comment.
 *
 * WHAT IS IN THE BYTES. No declared config key holds a credential — every secret this server reads
 * is an environment variable (`MCP_CATALOG_READ_TOKEN`, `MCP_SHELL_VERIFY_ALLOWLIST`, …), and the
 * generated 60-key table carries nothing matching token/secret/password/credential except the
 * number `gates.reminderTokenBudget`. The object store does hold a byte-for-byte copy of the file,
 * in the same workspace's `state.db`, behind the same filesystem permissions as the config itself —
 * said plainly because the duplication is real; what it is not is a new exposure.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';

import { recordCheckpointedWrite } from './checkpointed-write.js';
import { resetConfig, resolveConfigPath, setConfigValueAtPath } from './config-operations.js';
import { readFileTree } from './object-store.js';
import { resolveStateDbPath } from './version-history-location.js';
import { openStateDb, resolveConfiguredMaxVersions } from './version-history.js';

import type { ConfigResetResult, ConfigSetResult } from './config-operations.js';
import type { LoadedTree } from './object-store.js';
import type { HistoryRowRequest } from './version-history-types.js';

import { configTenantId } from '#shared/utils/config-scope.js';
import { hashBytes } from '#shared/utils/hash.js';

/**
 * The type and id every config row is keyed under.
 *
 * One id, not one per workspace: rows are already scoped by `tenant_id`, so two workspaces on one
 * `state.db` hold two histories under the same id, exactly as two workspaces holding a gate called
 * `alpha` do. A per-workspace id would be a second scope channel beside the one that already works.
 *
 * What scopes a config row is NOT the workspace scope every other row uses, though — it is
 * `configTenantId(configPath)`, a function of the file's own path (`shared/utils/config-scope.ts`).
 * Every surface that writes or reads one goes through that function, because the surfaces do not
 * share a working directory and the workspace derivation is a cwd basename.
 */
export const CONFIG_RESOURCE_TYPE = 'config' as const;
export const CONFIG_RESOURCE_ID = 'config';

/**
 * What a config version row's `snapshot` column holds.
 *
 * `filename` rather than a full path: the path is machine-specific and the row is not. The name is
 * load-bearing, though — `config.jsonc` and `config.json` are different dialects, and a restore
 * writes the recorded bytes back under the recorded name so a JSONC document can never land as a
 * `.json` a strict reader rejects.
 */
export interface ConfigSnapshot extends Record<string, unknown> {
  filename: string;
  size: number;
  /** `sha256:<hex>` of the file's bytes — what makes an unchanged write record nothing. */
  hash: string;
}

/** The three states one checkpointed config write can end in — `recordResourceWrite`'s shape. */
export type ConfigWriteOutcome =
  | { written: true; recorded: true; version: number }
  | { written: true; recorded: false; reason: string }
  | { written: false; rolledBack: boolean; error: string };

/**
 * The digest-only projection of the config file as it is right now, or `undefined` when there is
 * no file yet.
 *
 * `undefined` reaches `recordCheckpointedWrite` as `priorSnapshot: undefined`, which is that
 * module's CREATE signal: a reset of a workspace that had no config has no prior state to bridge.
 */
export function readConfigSnapshot(configPath: string): ConfigSnapshot | undefined {
  if (!existsSync(configPath)) {
    return undefined;
  }
  const bytes = readFileSync(configPath);
  return { filename: basename(configPath), size: bytes.byteLength, hash: hashBytes(bytes) };
}

/**
 * The config file as a one-entry {@link LoadedTree}, through the shared reader.
 *
 * `readFileTree` rather than a local read, so the per-file ceiling, the `hashBytes` algorithm and
 * the entry shape are the same ones every resource checkpoint uses. An over-limit or unreadable
 * config yields `null` — a projection-only row, which for config means an unrestorable one.
 *
 * ORIGIN IS ALWAYS `primary`, AND THAT IS A STATEMENT ABOUT CONFIG, NOT AN OMISSION. A resource
 * has overlay roots: the same gate id can be served from the package and overridden in a
 * workspace, so a rollback has to decide which tree it writes into and `planRestore` refuses the
 * bundled one. Config has no such layering — `resolveConfigPath` / `configManager.getConfigPath()`
 * resolve exactly ONE file, and that same file is both what was read and what is written back. A
 * restore therefore writes where the write came from, whatever directory that is.
 *
 * Measured 2026-09-21, correcting the design's premise that "a bundled/packaged config is never
 * written": with no workspace config present, `configManager.getConfigPath()` resolves to the
 * packaged `server/config.json` and a `system_control gates disable` writes it today. That is the
 * local-checkout shape, so classifying it `bundled` would refuse a rollback of the only config the
 * operator has.
 */
async function readConfigTree(configPath: string): Promise<LoadedTree | null> {
  if (!existsSync(configPath)) {
    return null;
  }
  const loaded = await readFileTree(
    [{ relativePath: basename(configPath), absolutePath: configPath }],
    'primary'
  );
  return 'tree' in loaded ? loaded.tree : null;
}

/**
 * Checkpoint one write to `configPath`: bridge the prior bytes, write, record what was produced.
 *
 * THE ONE ENTRY POINT. Every surface that changes the config file goes through here — `cpm config
 * set`, `cpm config reset`, `cpm enable`/`cpm disable` (which call `setConfigValue`), and the two
 * `system_control` persist paths (`persistGateConfig`, `persistFrameworkConfig`), which write the
 * workspace config file through `writeConfigKeyAtomic` exactly as the CLI does. A write that does
 * not come through here is a write no `cpm config history` can show.
 *
 * `write` is synchronous on purpose: every config writer beneath this is
 * (`writeConfigTextAtomic`'s temp-file-and-rename plus its parse-back check), and wrapping a
 * synchronous write in a callback keeps the ORDER — prior row, write, produced row — owned by
 * `recordCheckpointedWrite` rather than restated here.
 *
 * **A workspace with no `state.db` still gets its write.** The CLI never authors that schema, so
 * `cpm config set` in a fresh `cpm init` workspace must not fail because a checkpoint could not be
 * taken. It returns `recorded: false` carrying the reason, which every caller prints.
 */
export async function recordConfigWrite(
  configPath: string,
  description: string,
  write: () => void
): Promise<ConfigWriteOutcome> {
  const workspaceDir = dirname(configPath);
  const dbPath = resolveStateDbPath(workspaceDir);
  if (dbPath === null) {
    return writeUnrecorded(write, 'no state.db could be located for this workspace');
  }
  const opened = openStateDb(dbPath);
  if ('error' in opened) {
    return writeUnrecorded(write, opened.error);
  }

  const { db } = opened;
  const request: HistoryRowRequest = {
    resource_type: CONFIG_RESOURCE_TYPE,
    resource_id: CONFIG_RESOURCE_ID,
    created_at: new Date().toISOString(),
    max_versions: resolveConfiguredMaxVersions(workspaceDir),
  };
  try {
    // The tenant is a function of THIS FILE's path, never of either process's cwd — see
    // `configTenantId`. A server toggling `gates.enabled` from its install directory and a `cpm
    // config set` run from the workspace are the same history exactly because they name the same
    // file.
    const result = await recordCheckpointedWrite(db, configTenantId(configPath), request, {
      loadTree: () => readConfigTree(configPath),
      targets: [{ path: configPath, kind: 'file' }],
      priorSnapshot: readConfigSnapshot(configPath),
      write: () => {
        write();
        // The produced state, re-read from disk rather than predicted. A `set` that changed no
        // character produces the digest the prior row already carries, and `appendVersion`'s
        // equality test then records nothing — which is the whole of "an unchanged write creates
        // no checkpoint" for config.
        return Promise.resolve(readConfigSnapshot(configPath) ?? {});
      },
      description,
    });
    if (!result.success) {
      return { written: false, rolledBack: result.rolledBack, error: result.error };
    }
    return result.outcome.recorded
      ? { written: true, recorded: true, version: result.outcome.version }
      : {
          written: true,
          recorded: false,
          reason: `the config file is unchanged — it already matches version ${result.outcome.version}`,
        };
  } catch (error) {
    return {
      written: false,
      rolledBack: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    db.close();
  }
}

/**
 * What every checkpointed config command reports beyond its own result.
 *
 * `recorded: false` is not a failure and must not print as one — a fresh `cpm init` workspace has
 * no `state.db`, and an edit that changed no character has nothing to record. Both carry
 * `recordNote`, which every caller prints, because a config write that silently records nothing is
 * the exact shape of the defect the timestamped backups had.
 */
export interface ConfigRecordFields {
  recorded: boolean;
  /** The version this change was recorded as. Absent when `recorded` is false. */
  version?: number;
  /** Why nothing was recorded. Absent when `recorded` is true. */
  recordNote?: string;
}

function recordFields(outcome: ConfigWriteOutcome): ConfigRecordFields {
  if (outcome.written && outcome.recorded) {
    return { recorded: true, version: outcome.version };
  }
  return {
    recorded: false,
    recordNote: outcome.written ? outcome.reason : `version not recorded: ${outcome.error}`,
  };
}

/**
 * `cpm config set` / `cpm enable` / `cpm disable`, checkpointed.
 *
 * The write itself is still `setConfigValueAtPath` — this module owns the RECORD, not the document
 * edit, and duplicating the validate-read-edit sequence here would be the second config writer
 * `config-operations.ts`'s own header exists to forbid.
 *
 * A refused set throws out of the callback on purpose. `recordCheckpointedWrite` catches it, puts
 * the target back byte-identical and records nothing, and the structured refusal is handed back
 * from `refusal` rather than being re-derived from the error text.
 */
export async function setConfigValueRecorded(
  workspace: string,
  key: string,
  value: string
): Promise<ConfigSetResult & ConfigRecordFields> {
  const configPath = resolveConfigPath(workspace);
  let refusal: ConfigSetResult | undefined;
  let applied: ConfigSetResult | undefined;

  const outcome = await recordConfigWrite(configPath, `Set ${key}`, () => {
    const result = setConfigValueAtPath(configPath, key, value);
    if (!result.success) {
      refusal = result;
      throw new Error(result.message);
    }
    applied = result;
  });

  if (refusal !== undefined) {
    return { ...refusal, recorded: false };
  }
  if (applied === undefined) {
    return {
      success: false,
      key,
      message: outcome.written ? 'The config write reported nothing' : `Failed to set ${key}`,
      ...recordFields(outcome),
    };
  }
  return { ...applied, ...recordFields(outcome) };
}

/** `cpm config reset --force`, checkpointed. Same shape and same reasoning as the setter above. */
export async function resetConfigRecorded(
  workspace: string
): Promise<ConfigResetResult & ConfigRecordFields> {
  const configPath = resolveConfigPath(workspace);
  let refusal: ConfigResetResult | undefined;
  let applied: ConfigResetResult | undefined;

  const outcome = await recordConfigWrite(configPath, 'Reset to defaults', () => {
    const result = resetConfig(workspace);
    if (!result.success) {
      refusal = result;
      throw new Error(result.message);
    }
    applied = result;
  });

  if (refusal !== undefined) {
    return { ...refusal, recorded: false };
  }
  if (applied === undefined) {
    return {
      success: false,
      configPath,
      message: outcome.written ? 'The config reset reported nothing' : 'Failed to reset config',
      ...recordFields(outcome),
    };
  }
  return { ...applied, ...recordFields(outcome) };
}

/** Perform the write with no row, because there is no history to write into. Not a failure. */
function writeUnrecorded(write: () => void, reason: string): ConfigWriteOutcome {
  try {
    write();
  } catch (error) {
    return {
      written: false,
      rolledBack: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return { written: true, recorded: false, reason };
}
