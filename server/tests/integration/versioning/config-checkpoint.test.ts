// @lifecycle canonical - Integration tests for O.9: a config write is a checkpoint, not a backup file.
/**
 * `cpm config set` / `reset` / `enable` / `disable` and the two `system_control` persist paths all
 * write ONE file, and after ruling R53 all of them record a `version_history` row for it.
 *
 * Every case here runs against a REAL `state.db` written by the real `SqliteEngine`, through the
 * real `recordCheckpointedWrite` — the point is that the row a config write leaves is a row the
 * shared reader can find, keyed exactly like every other resource's.
 *
 * ENUMERATED INDEPENDENTLY OF THE DECLARATION UNDER TEST. The "which surfaces write config" list
 * below is derived from a `rg` for the ONE publisher of config bytes (`writeConfigTextAtomic`) and
 * is written out literally, not imported from the module it constrains: a list read out of
 * `config-checkpoint.ts` would move whenever that module did, which is the opposite of a gate.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  CONFIG_RESOURCE_ID,
  CONFIG_RESOURCE_TYPE,
  readConfigSnapshot,
  recordConfigWrite,
  resetConfigRecorded,
  setConfigValueRecorded,
} from '../../../src/cli-shared/config-checkpoint.js';
import { loadHistory } from '../../../src/cli-shared/version-history.js';
import { hashBytes } from '../../../src/shared/utils/hash.js';
import { seedStateDbSchema } from '../../helpers/test-database.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

import { DatabaseSync } from 'node:sqlite';
import { rmSync } from 'node:fs';

/**
 * A config a human wrote: a comment, a blank line, a trailing comment, and a non-ASCII character.
 *
 * Hand-authored on purpose. A fixture produced by the writer under test only proves idempotence —
 * it cannot show that a comment survived, because the writer that made it never had one to lose.
 */
const HAND_AUTHORED_JSONC = `{
  // gates: the operator's own note — café ☕
  "$schema": "https://example.invalid/config.schema.json",
  "version": 5,

  "gates": { "enabled": true } // inline, deliberately
}
`;

const CONFIG_REF = { resourceType: CONFIG_RESOURCE_TYPE, resourceId: CONFIG_RESOURCE_ID } as const;

describe('a config write is recorded as a version', () => {
  let workspace: string;
  let configPath: string;
  let previousProjectDir: string | undefined;

  /** Oldest first — `loadHistory` returns newest first, and every assertion below reads forward. */
  const rows = (): Array<{ version: number; description: string; snapshot: unknown }> =>
    (loadHistory(workspace, CONFIG_REF)?.versions ?? [])
      .map((entry) => ({
        version: entry.version,
        description: entry.description,
        snapshot: entry.snapshot,
      }))
      .sort((a, b) => a.version - b.version);

  const treeHashes = (): Array<string | null> => {
    const db = new DatabaseSync(path.join(workspace, 'runtime-state', 'state.db'));
    try {
      return (
        db
          .prepare(`SELECT tree_hash FROM version_history WHERE resource_type = ? ORDER BY version`)
          .all(CONFIG_RESOURCE_TYPE) as unknown as Array<{ tree_hash: string | null }>
      ).map((row) => row.tree_hash);
    } finally {
      db.close();
    }
  };

  beforeEach(async () => {
    previousProjectDir = process.env['CLAUDE_PROJECT_DIR'];
    workspace = testScratchPath(`config-checkpoint-${Math.random().toString(36).slice(2)}`);
    rmSync(workspace, { recursive: true, force: true });
    mkdirSync(workspace, { recursive: true });
    process.env['CLAUDE_PROJECT_DIR'] = workspace;
    configPath = path.join(workspace, 'config.jsonc');
    writeFileSync(configPath, HAND_AUTHORED_JSONC, 'utf8');
    await seedStateDbSchema(workspace);
  });

  afterEach(() => {
    if (previousProjectDir === undefined) delete process.env['CLAUDE_PROJECT_DIR'];
    else process.env['CLAUDE_PROJECT_DIR'] = previousProjectDir;
    rmSync(workspace, { recursive: true, force: true });
  });

  it('records the prior bytes and the produced bytes, and nothing for a repeat', async () => {
    const first = await setConfigValueRecorded(workspace, 'gates.enabled', 'false');
    expect(first.success).toBe(true);
    expect(first.recorded).toBe(true);
    expect(first.version).toBe(2);

    // v1 is the BRIDGE row: the bytes that were on disk before the edit. That is what makes
    // `cpm config rollback 1` able to put the operator's original file back.
    const after = rows();
    expect(after.map((row) => row.version)).toEqual([1, 2]);
    expect(after[0]?.snapshot).toEqual({
      filename: 'config.jsonc',
      size: Buffer.byteLength(HAND_AUTHORED_JSONC),
      hash: hashBytes(Buffer.from(HAND_AUTHORED_JSONC)),
    });
    expect(after[1]?.description).toBe('Set gates.enabled');
    // Both rows carry bytes — a config row without a tree cannot be restored at all.
    expect(treeHashes().every((hash) => typeof hash === 'string')).toBe(true);

    const repeat = await setConfigValueRecorded(workspace, 'gates.enabled', 'false');
    expect(repeat.success).toBe(true);
    expect(repeat.recorded).toBe(false);
    expect(repeat.recordNote).toContain('already matches version 2');
    expect(rows()).toHaveLength(2);

    // Positive control: the probe CAN see a third row appear.
    const changed = await setConfigValueRecorded(workspace, 'gates.enabled', 'true');
    expect(changed.recorded).toBe(true);
    expect(rows()).toHaveLength(3);
  });

  it('keeps the operator comments the edit did not touch', async () => {
    await setConfigValueRecorded(workspace, 'gates.enabled', 'false');
    const text = readFileSync(configPath, 'utf8');
    expect(text).toContain(`// gates: the operator's own note — café ☕`);
    expect(text).toContain('// inline, deliberately');
    expect(text).toContain('"enabled": false');
  });

  it('records a reset, and a reset of a workspace with no config records one row', async () => {
    const reset = await resetConfigRecorded(workspace);
    expect(reset.success).toBe(true);
    expect(reset.recorded).toBe(true);
    expect(rows().map((row) => row.description)).toEqual([
      'Bridge: prior live state (era transition or out-of-band edit)',
      'Reset to defaults',
    ]);

    // A workspace whose config does not exist yet has NO prior state, so no bridge row is written
    // — the create shape of `recordCheckpointedWrite`. The re-created template is byte-identical to
    // what v2 already holds, so the produced row is suppressed too, and the count stays at two.
    // Both halves matter: a bridge row here would claim a state that was not on disk.
    rmSync(configPath);
    rmSync(path.join(workspace, 'config.json'), { force: true });
    const fresh = await resetConfigRecorded(workspace);
    expect(fresh.success).toBe(true);
    expect(fresh.recorded).toBe(false);
    expect(rows()).toHaveLength(2);
    expect(existsSync(configPath)).toBe(true);
  });

  it('still performs the write when the workspace has no state.db, and says so', async () => {
    rmSync(path.join(workspace, 'runtime-state'), { recursive: true, force: true });
    const result = await setConfigValueRecorded(workspace, 'gates.enabled', 'false');
    expect(result.success).toBe(true);
    expect(result.recorded).toBe(false);
    expect(result.recordNote).toMatch(/state\.db/);
    expect(readFileSync(configPath, 'utf8')).toContain('"enabled": false');
  });

  it('writes no file and no produced row when the value is refused', async () => {
    const before = readFileSync(configPath, 'utf8');
    const result = await setConfigValueRecorded(workspace, 'gates.enabled', 'not-a-boolean');
    expect(result.success).toBe(false);
    expect(result.recorded).toBe(false);
    expect(readFileSync(configPath, 'utf8')).toBe(before);

    // The BRIDGE row stands and is the only row: it says "these bytes were on disk and nobody had
    // recorded them", which is true before the refusal and still true after it. What must not
    // exist is a row claiming the refused change happened.
    expect(rows().map((row) => row.description)).toEqual([
      'Bridge: prior live state (era transition or out-of-band edit)',
    ]);

    // Positive control: the same call with a legal value DOES produce a `Set` row, so the absence
    // above is a statement about the refusal rather than about a probe that sees nothing.
    await setConfigValueRecorded(workspace, 'gates.enabled', 'false');
    expect(rows().map((row) => row.description)).toContain('Set gates.enabled');
  });

  it('is keyed resource_type=config, resource_id=config — not under any published type', async () => {
    await setConfigValueRecorded(workspace, 'gates.enabled', 'false');
    const db = new DatabaseSync(path.join(workspace, 'runtime-state', 'state.db'));
    try {
      const keys = db
        .prepare(`SELECT DISTINCT resource_type, resource_id FROM version_history`)
        .all() as unknown as Array<{ resource_type: string; resource_id: string }>;
      expect(keys).toEqual([{ resource_type: 'config', resource_id: 'config' }]);
    } finally {
      db.close();
    }
  });

  it('records a raw write handed in by the server-side writer', async () => {
    // `SafeConfigWriter.updateConfigValue` reaches `recordConfigWrite` with its own callback rather
    // than through `setConfigValueRecorded`; this is that seam, driven directly.
    const outcome = await recordConfigWrite(configPath, 'Set gates.enabled', () => {
      writeFileSync(configPath, HAND_AUTHORED_JSONC.replace('true', 'false'), 'utf8');
    });
    expect(outcome).toEqual({ written: true, recorded: true, version: 2 });
    expect(rows()).toHaveLength(2);
  });

  it('puts the file back byte-identical when the write throws', async () => {
    const before = readFileSync(configPath, 'utf8');
    const outcome = await recordConfigWrite(configPath, 'Set gates.enabled', () => {
      writeFileSync(configPath, 'CORRUPT', 'utf8');
      throw new Error('the writer refused');
    });
    expect(outcome).toEqual({
      written: false,
      rolledBack: true,
      error: expect.stringContaining('the writer refused'),
    });
    expect(readFileSync(configPath, 'utf8')).toBe(before);
    // The bridge row stands: it describes a state that genuinely existed and still does.
    expect(rows().map((row) => row.version)).toEqual([1]);
  });

  it('projects only filename, size and digest — never the config values', async () => {
    writeFileSync(
      configPath,
      HAND_AUTHORED_JSONC.replace('"version": 5,', '"version": 5,\n  "operatorSecret": "hunter2",'),
      'utf8'
    );
    await setConfigValueRecorded(workspace, 'gates.enabled', 'false');
    for (const row of rows()) {
      expect(Object.keys(row.snapshot as object).sort()).toEqual(['filename', 'hash', 'size']);
      expect(JSON.stringify(row.snapshot)).not.toContain('hunter2');
    }
    // Positive control: the value IS in the file the digest was taken of, so the absence above is
    // a statement about the projection rather than about a value that was never there.
    expect(readFileSync(configPath, 'utf8')).toContain('hunter2');
  });

  it('readConfigSnapshot reports undefined for a file that does not exist', () => {
    expect(readConfigSnapshot(path.join(workspace, 'nope.jsonc'))).toBeUndefined();
    expect(readConfigSnapshot(configPath)?.filename).toBe('config.jsonc');
    expect(existsSync(configPath)).toBe(true);
  });
});
