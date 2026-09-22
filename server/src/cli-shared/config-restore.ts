// @lifecycle canonical - Reading a recorded config version back, and putting its bytes on disk.
/**
 * `cpm config history` and `cpm config rollback` — the read half of ruling R53.
 *
 * WHAT REPLACES A BACKUP FILE. `config.json[c].backup.<epoch-ms>` was written on every `cpm config
 * set`/`reset` and read by nothing: recovering from one was a manual `cp`, and an operator who had
 * run five sets had five files with no way to tell which was which. A version row carries the same
 * bytes plus a number, a date and a description, and this module is what puts them back.
 *
 * NO PROJECTION FALLBACK — A ROW WITHOUT BYTES IS REFUSED BY NAME. Every other rollback in this
 * repo degrades to `SnapshotContract.restore` when a row carries no tree: the projection can
 * re-render the resource, imperfectly but usefully. Config has no projection — its `snapshot`
 * column holds a filename, a size and a digest, deliberately (see `config-checkpoint.ts`) — so
 * there is nothing to degrade TO. A caller that fell back would have to invent a document, which
 * is the one thing a config restore must never do. The refusal names the version and the reason.
 *
 * THE PARSE-BACK GATE RUNS BEFORE THE WRITE, NOT AFTER IT. A recorded version can predate a config
 * schema change: bytes that were valid when they were recorded may name a key this build has
 * retired, or hold a value it now rejects. Writing them and discovering that at the next startup
 * would leave the server refusing to boot on a file the operator asked for by number. So the
 * recorded bytes are parsed and validated against THIS build's key table first, and a version that
 * fails is refused with the errors named — nothing is written, and the current config stands.
 *
 * ONE FILE, ONE NAME. `config.jsonc` and `config.json` are different dialects of the same setting,
 * and the recorded row carries which one it was. Restoring a `config.jsonc` version into a
 * workspace that now holds a `config.json` would leave BOTH on disk, which every reader in this
 * repo already refuses as ambiguous (`ambiguousConfigError`). That is refused here too, by name,
 * rather than produced and then complained about at the next read.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import {
  recordConfigWrite,
  CONFIG_RESOURCE_ID,
  CONFIG_RESOURCE_TYPE,
} from './config-checkpoint.js';
import {
  resolveConfigPath,
  validateConfigDocument,
  writeConfigBytesAtomic,
} from './config-operations.js';
import { hasObjectStore, loadVersionTree } from './object-store.js';
import { resolveStateDbPath } from './version-history-location.js';
import { asObjectStoreDatabase } from './version-history-rows.js';
import { openStateDb, loadHistory } from './version-history.js';

import type { RestorePlan } from '#modules/versioning/restore-plan.js';
import type { HistoryFile } from '#modules/versioning/types.js';
import type { HistoryResourceRef } from './version-history.js';
import type { DatabaseSync } from 'node:sqlite';

import { planRestore } from '#modules/versioning/restore-plan.js';
import { configFileFormat, parseConfigText } from '#shared/utils/config-file-format.js';
import { configTenantId } from '#shared/utils/config-scope.js';
import { hashBytes } from '#shared/utils/hash.js';

/**
 * Which rows a config operation reads — the same key AND the same tenant `config-checkpoint.ts`
 * writes under.
 *
 * A function rather than a constant because the tenant is a function of the config FILE's path
 * (`configTenantId`, P4.109), not of the workspace scope every other resource uses: the server
 * writes this file from its own install directory and `cpm` from the operator's, and a cwd-derived
 * scope makes those two the same file with two histories. Carrying it on the ref means every
 * dispatched action about config — load, get, compare — takes the same exact tenant and none of
 * them is corrected against another workspace's rows.
 */
function configRef(configPath: string): HistoryResourceRef {
  return {
    resourceType: CONFIG_RESOURCE_TYPE,
    resourceId: CONFIG_RESOURCE_ID,
    tenantId: configTenantId(configPath),
  };
}

/** Every recorded version of this workspace's config, newest first, or `null` when there are none. */
export function loadConfigHistory(workspace: string): HistoryFile | null {
  return loadHistory(workspace, configRef(resolveConfigPath(workspace)));
}

/** What a rollback (or a preview of one) did, or the reason it was refused. */
export type ConfigRollbackResult =
  | {
      ok: true;
      /** The plan the write executed — or would have, under `preview`. */
      plan: RestorePlan;
      preview: boolean;
      /** The version the restored bytes were recorded as. Absent under `preview`. */
      savedVersion?: number;
      /** False when the restored bytes were already on disk, so no row was written. */
      recorded: boolean;
      /** Why nothing was recorded, when `recorded` is false. */
      recordNote?: string;
    }
  | { ok: false; refusal: string };

/**
 * Put version `targetVersion` of the workspace config back on disk, byte for byte.
 *
 * The resolution and the write are separated by a `db.close()` on purpose: the record that follows
 * opens its own connection and takes `BEGIN IMMEDIATE`, and holding a second handle to the same
 * file across it buys nothing and costs a lock this process would be waiting on itself for.
 */
export async function rollbackConfigVersion(
  workspace: string,
  targetVersion: number,
  options?: { preview?: boolean }
): Promise<ConfigRollbackResult> {
  const configPath = resolveConfigPath(workspace);
  const workspaceDir = dirname(configPath);
  const resolved = resolveRecordedConfig(workspaceDir, configPath, targetVersion);
  if ('refusal' in resolved) {
    return { ok: false, refusal: resolved.refusal };
  }
  const { plan, bytes, recordedName } = resolved;

  if (options?.preview === true) {
    return { ok: true, plan, preview: true, recorded: false };
  }

  const destination = join(workspaceDir, recordedName);
  const outcome = await recordConfigWrite(destination, `Rollback to v${targetVersion}`, () => {
    writeConfigBytesAtomic(destination, bytes);
  });
  if (!outcome.written) {
    return { ok: false, refusal: outcome.error };
  }
  return outcome.recorded
    ? { ok: true, plan, preview: false, recorded: true, savedVersion: outcome.version }
    : { ok: true, plan, preview: false, recorded: false, recordNote: outcome.reason };
}

/** Everything the write needs, resolved and checked, with the database already closed. */
type ResolvedConfigRestore =
  { plan: RestorePlan; bytes: Uint8Array; recordedName: string } | { refusal: string };

/**
 * Read the target row, check every refusal, and build the plan — before anything is written.
 *
 * Every one of the five refusals below is total: nothing is written, and the config on disk is the
 * config that was there. A partially-applied config restore is a document no version ever held,
 * announced as a rollback.
 */
function resolveRecordedConfig(
  workspaceDir: string,
  configPath: string,
  targetVersion: number
): ResolvedConfigRestore {
  const dbPath = resolveStateDbPath(workspaceDir);
  if (dbPath === null) {
    return { refusal: 'no state.db could be located for this workspace — nothing is recorded yet' };
  }
  const opened = openStateDb(dbPath);
  if ('error' in opened) {
    return { refusal: opened.error };
  }
  const { db } = opened;
  try {
    const recorded = readRecordedConfigFile(db, configPath, targetVersion);
    if ('refusal' in recorded) {
      return recorded;
    }

    const dialectRefusal = parseBackRefusal(recorded.path, recorded.bytes, targetVersion);
    if (dialectRefusal !== undefined) {
      return { refusal: dialectRefusal };
    }

    const currentName = basename(configPath);
    if (existsSync(configPath) && currentName !== recorded.path) {
      return {
        refusal:
          `config version ${targetVersion} recorded ${recorded.path}, but this workspace now holds ` +
          `${currentName}. Restoring would leave both names in one directory, which every reader ` +
          `here refuses as ambiguous. Remove or rename ${currentName} first`,
      };
    }

    const planned = planRestore({
      resourceType: 'config',
      resourceId: CONFIG_RESOURCE_ID,
      version: targetVersion,
      destinationRoot: workspaceDir,
      // Config has exactly one resolved path and no overlay layering, so the destination is always
      // the operator's own file — see `config-checkpoint.ts` for why there is no `bundled` case.
      destinationOrigin: 'primary',
      recordedOrigin: 'primary',
      target: [{ path: recorded.path, hash: recorded.hash }],
      current: currentConfigTree(configPath),
    });
    if (!planned.ok) {
      return { refusal: planned.refusal };
    }
    return { plan: planned.plan, bytes: recorded.bytes, recordedName: recorded.path };
  } catch (error) {
    return { refusal: error instanceof Error ? error.message : String(error) };
  } finally {
    db.close();
  }
}

/**
 * The one file version `targetVersion` recorded, bytes included — or why there is not one.
 *
 * Four refusals, each naming which of the four it was, because they mean different things to an
 * operator: an unknown version number, a row that never carried bytes, a row whose bytes the store
 * has lost, and a row claiming a number of files a config version cannot have.
 */
function readRecordedConfigFile(
  db: DatabaseSync,
  configPath: string,
  targetVersion: number
): { path: string; hash: string; bytes: Uint8Array } | { refusal: string } {
  const store = asObjectStoreDatabase(db);
  // Asked BEFORE the SELECT below, never after. `cpm` opens whatever `state.db` it finds, and a
  // schema written before v29 has neither the object store nor `version_history.tree_hash` — a
  // SELECT naming a column that does not exist THROWS rather than returning nothing, which would
  // turn an ordinary "nothing recorded yet" into a crash. The tables and the columns arrived in the
  // same bump, so one `sqlite_master` lookup answers for both. This is the fourth compatibility
  // defect of exactly this shape on this arc; it is closed here by construction.
  if (!hasObjectStore(store)) {
    return {
      refusal:
        'this state.db has no object store — its schema predates v29, so no config version ' +
        'carries bytes to restore',
    };
  }

  // The config file's own tenant, not a workspace guess and not a correction against whatever
  // other rows this shared `state.db` holds — every workspace keys its config under the same
  // `('config','config')` pair, so a correction here would restore another project's file.
  const tenantId = configTenantId(configPath);
  const row = db
    .prepare(
      `SELECT id, tree_hash FROM version_history
       WHERE tenant_id = ? AND resource_type = ? AND resource_id = ? AND version = ?`
    )
    .get(tenantId, CONFIG_RESOURCE_TYPE, CONFIG_RESOURCE_ID, targetVersion) as
    { id: number; tree_hash: string | null } | undefined;
  if (row === undefined) {
    return { refusal: `config version ${targetVersion} not found` };
  }
  if (row.tree_hash == null) {
    return {
      refusal:
        `config version ${targetVersion} recorded no file bytes, so it cannot be restored. ` +
        `Config has no projected fallback — its snapshot holds only a filename, a size and a ` +
        `digest — so there is nothing to rebuild the document from`,
    };
  }

  const tree = loadVersionTree(store, { tenantId, versionRowId: Number(row.id) });
  if (tree.status === 'incomplete') {
    return {
      refusal: `config version ${targetVersion} claims recorded bytes that are not in the object store: ${tree.reason}`,
    };
  }
  if (tree.status !== 'loaded') {
    return { refusal: `config version ${targetVersion} recorded no file bytes` };
  }
  const [recorded] = tree.files;
  if (recorded === undefined || tree.files.length !== 1) {
    return {
      refusal: `config version ${targetVersion} recorded ${tree.files.length} files; a config version is exactly one file`,
    };
  }
  return recorded;
}

/** The config on disk as a one-entry tree, or an empty one when the workspace has no config. */
function currentConfigTree(configPath: string): Array<{ path: string; hash: string }> {
  if (!existsSync(configPath)) {
    return [];
  }
  return [{ path: basename(configPath), hash: hashBytes(readFileSync(configPath)) }];
}

/**
 * Refuse recorded bytes this build would not accept as a config — named, before any write.
 *
 * Two checks, because they fail for different reasons and an operator needs to know which. Parsing
 * catches a corrupted or truncated object; validating catches a document that parses fine and
 * names a key or holds a value this build has since retired. Warnings are not refusals:
 * `validateConfigDocument` warns on an unknown key, and an operator's own extra key is not a
 * reason to refuse them their own file back.
 */
function parseBackRefusal(
  recordedName: string,
  bytes: Uint8Array,
  targetVersion: number
): string | undefined {
  let parsed: unknown;
  try {
    parsed = parseConfigText(Buffer.from(bytes).toString('utf8'), configFileFormat(recordedName));
  } catch (error) {
    return (
      `config version ${targetVersion} no longer parses as ${configFileFormat(recordedName)}: ` +
      `${error instanceof Error ? error.message : String(error)}. Nothing was written`
    );
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return `config version ${targetVersion} is not a JSON object. Nothing was written`;
  }
  const check = validateConfigDocument(parsed as Record<string, unknown>);
  if (!check.valid) {
    return (
      `config version ${targetVersion} is not valid configuration for this build: ` +
      `${check.errors.join('; ')}. Nothing was written`
    );
  }
  return undefined;
}
