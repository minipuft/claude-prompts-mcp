// @lifecycle test - Durable rows cross a schema upgrade only through declared migration steps
/**
 * An upgrade of `state.db` snapshots the durable tables, runs the migration steps registered for
 * the versions it crosses, drops and recreates the schema, and restores the rows STRICTLY: a
 * snapshot column with no place in the new schema must be declared by a step, or the upgrade
 * rolls back. A database older than `MIGRATION_FLOOR` is refused, unchanged. Before any upgrade
 * the file is copied to `<db>.v<from>.bak`, and only that one backup is kept.
 *
 * Every case drives the real engine through its two test seams: `schemaVersion` sets the target
 * one ahead of the version a file was created at, and `durableMigrations` injects the steps, so
 * an upgrade runs against today's DDL without a future one existing. Durable state is read back
 * through a separate read-only connection, never through the engine under test.
 *
 * Positive controls: the "declares that column dropped" case differs from the rollback case only
 * in the step's declaration — the snapshot refused there lands here, so the refusal is the missing
 * declaration's doing. The fresh-versus-migrated case proves its comparison sees an index
 * difference before trusting an equal result.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { MIGRATION_FLOOR } from '../../../src/infra/database/durable-migrations.js';
import { SqliteEngine } from '../../../src/infra/database/sqlite-engine.js';
import { createMockLogger } from '../../helpers/test-database.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

import type {
  DurableMigration,
  DurableRow,
  DurableSnapshot,
} from '../../../src/infra/database/durable-migrations.js';

const logger = createMockLogger();

const CONFIG_SCOPE = `config:${'ab'.repeat(32)}`;

interface HistoryRow {
  readonly tenant_id: string;
  readonly workspace_id: string | null;
  readonly resource_id: string;
  readonly snapshot: string;
}

/** What `PRAGMA table_info` + `index_list` + `index_info` say about every table, and the views. */
interface SchemaShape {
  readonly tables: Record<string, { columns: unknown[]; indexes: unknown[] }>;
  readonly views: string[];
}

function readOnly<T>(file: string, read: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return read(db);
  } finally {
    db.close();
  }
}

function readVersion(file: string): unknown {
  return readOnly(
    file,
    (db) => (db.prepare('SELECT version FROM schema_version').get() as { version: unknown }).version
  );
}

function readHistory(file: string): HistoryRow[] {
  return readOnly(
    file,
    (db) =>
      db
        .prepare(
          'SELECT tenant_id, workspace_id, resource_id, snapshot FROM version_history ORDER BY id'
        )
        .all() as unknown as HistoryRow[]
  );
}

function readShape(file: string): SchemaShape {
  return readOnly(file, (db) => {
    const names = (type: string): string[] =>
      (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = ? AND name NOT GLOB 'sqlite_*'")
          .all(type) as Array<{ name: string }>
      )
        .map((row) => row.name)
        .sort();
    const tables: SchemaShape['tables'] = {};
    for (const table of names('table')) {
      const indexes = (
        db.prepare(`PRAGMA index_list("${table}")`).all() as Array<
          { name: string } & Record<string, unknown>
        >
      )
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((index) => ({
          ...index,
          columns: db.prepare(`PRAGMA index_info("${index.name}")`).all(),
        }));
      tables[table] = { columns: db.prepare(`PRAGMA table_info("${table}")`).all(), indexes };
    }
    return { tables, views: names('view') };
  });
}

/** Rewrite every `version_history` row through `change`; the input snapshot is left untouched. */
function mapHistory(
  snapshot: DurableSnapshot,
  change: (row: DurableRow) => DurableRow
): DurableSnapshot {
  const next = new Map(snapshot);
  next.set('version_history', (snapshot.get('version_history') ?? []).map(change));
  return next;
}

describe('durable rows cross an upgrade only through declared steps', () => {
  let testDir: string;
  let dbPath: string;
  /** The version a file is created at — today's `SCHEMA_VERSION`. */
  let seededVersion: number;
  let targetVersion: number;

  beforeEach(async () => {
    testDir = testScratchPath('durable-migrations');
    dbPath = path.join(testDir, 'runtime-state', 'state.db');
    await fs.rm(testDir, { recursive: true, force: true });
    await fs.mkdir(path.dirname(dbPath), { recursive: true });
  });

  afterEach(async () => {
    await SqliteEngine.shutdownInstance();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  /** Create `file` at the current version holding one `version_history` row per scope value. */
  async function seedFile(file: string, scopes: readonly string[] = ['ws']): Promise<void> {
    const engine = await SqliteEngine.getInstance(logger, { dbPath: file });
    await engine.initialize();
    seededVersion = engine.getSchemaVersion();
    targetVersion = seededVersion + 1;
    scopes.forEach((scope, index) => {
      engine.run(
        `INSERT INTO version_history
           (tenant_id, workspace_id, resource_type, resource_id, version, snapshot, created_at)
         VALUES (?, ?, 'prompt', ?, 1, ?, '2026-01-01T00:00:00.000Z')`,
        [scope, scope, `seed-${index}`, `{"seed":${index}}`]
      );
    });
    await engine.shutdown();
  }

  async function upgrade(steps: readonly DurableMigration[]): Promise<SqliteEngine> {
    const engine = await SqliteEngine.getInstance(logger, {
      dbPath,
      schemaVersion: targetVersion,
      durableMigrations: steps,
    });
    await engine.initialize();
    return engine;
  }

  async function backupsBeside(file: string): Promise<string[]> {
    return (await fs.readdir(path.dirname(file))).filter((name) => name.includes('.bak')).sort();
  }

  /** A step that adds `legacy_note` to every row, declaring it dropped or not. */
  function addsNote(declared: boolean): DurableMigration {
    return {
      toVersion: targetVersion,
      tables: ['version_history'],
      ...(declared ? { droppedColumns: { version_history: ['legacy_note'] } } : {}),
      summary: 'adds a column the new schema does not have',
      migrate: (snapshot) => mapHistory(snapshot, (row) => ({ ...row, legacy_note: 'kept?' })),
    };
  }

  it('refuses a file below the floor and leaves it as it was, with no backup', async () => {
    await seedFile(dbPath);
    const belowFloor = MIGRATION_FLOOR - 1;
    const raw = new DatabaseSync(dbPath);
    raw.prepare('UPDATE schema_version SET version = ?').run(belowFloor);
    raw.close();
    const before = readHistory(dbPath);

    const error: unknown = await upgrade([]).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain(dbPath);
    expect(message).toContain(`schema v${belowFloor}`);
    expect(message).toContain(`needs v${targetVersion}`);
    expect(message).toContain(`from v${MIGRATION_FLOOR} onward`);
    expect(message).toContain('nothing was changed');

    await SqliteEngine.shutdownInstance();
    expect(readVersion(dbPath)).toBe(belowFloor);
    expect(readHistory(dbPath)).toEqual(before);
    expect(before).toHaveLength(1);
    expect(await backupsBeside(dbPath)).toEqual([]);
  });

  it('backs the file up before upgrading it and keeps only that backup', async () => {
    await seedFile(dbPath);
    const base = path.basename(dbPath);
    const stale = `${dbPath}.v30.bak`;
    const staging = `${dbPath}.v${seededVersion}.bak.tmp`;
    await fs.writeFile(stale, 'an older upgrade backup');
    await fs.writeFile(staging, 'a staging file a crashed backup left behind');

    const engine = await upgrade([]);
    expect(engine.getSchemaVersion()).toBe(targetVersion);
    await engine.shutdown();

    const backup = `${dbPath}.v${seededVersion}.bak`;
    expect(await backupsBeside(dbPath)).toEqual([`${base}.v${seededVersion}.bak`]);
    expect(readVersion(backup)).toBe(seededVersion);
    expect(readHistory(backup)).toEqual([
      { tenant_id: 'ws', workspace_id: 'ws', resource_id: 'seed-0', snapshot: '{"seed":0}' },
    ]);
    expect(readVersion(dbPath)).toBe(targetVersion);
  });

  it('upgrades past an older backup it cannot delete, warning about that file', async () => {
    await seedFile(dbPath);
    const undeletable = `${dbPath}.v30.bak`;
    await fs.mkdir(undeletable);
    await fs.writeFile(
      path.join(undeletable, 'keep'),
      'a directory is not removable without recursive'
    );
    const warnings = createMockLogger();

    const engine = await SqliteEngine.getInstance(warnings, {
      dbPath,
      schemaVersion: targetVersion,
      durableMigrations: [],
    });
    await engine.initialize();
    expect(engine.getSchemaVersion()).toBe(targetVersion);
    await engine.shutdown();

    expect(readVersion(dbPath)).toBe(targetVersion);
    expect(readVersion(`${dbPath}.v${seededVersion}.bak`)).toBe(seededVersion);
    expect((await fs.stat(undeletable)).isDirectory()).toBe(true);
    const warned = (warnings.warn as jest.Mock).mock.calls
      .map(([message]) => String(message))
      .filter((message) => message.includes(undeletable));
    expect(warned).toHaveLength(1);
  });

  it('rolls back a step that leaves an undeclared column in the snapshot', async () => {
    await seedFile(dbPath);
    const before = readHistory(dbPath);

    const error: unknown = await upgrade([addsNote(false)]).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(
      /Durable table version_history: column\(s\) legacy_note/
    );
    await SqliteEngine.shutdownInstance();
    expect(readVersion(dbPath)).toBe(seededVersion);
    expect(readHistory(dbPath)).toEqual(before);
    expect(before).toHaveLength(1);
  });

  it('upgrades when the same step declares that column dropped (control)', async () => {
    await seedFile(dbPath);
    const before = readHistory(dbPath);

    const engine = await upgrade([addsNote(true)]);
    expect(engine.getSchemaVersion()).toBe(targetVersion);
    await engine.shutdown();

    expect(readVersion(dbPath)).toBe(targetVersion);
    expect(readHistory(dbPath)).toEqual(before);
  });

  it('carries the values a registered step re-keys, losing no row', async () => {
    await seedFile(dbPath, ['server', 'default', CONFIG_SCOPE]);
    const rekey = (value: unknown): unknown =>
      typeof value === 'string' && !value.startsWith('config:') ? `legacy:${value}` : value;
    const step: DurableMigration = {
      toVersion: targetVersion,
      tables: ['version_history'],
      summary: 'scope values that are not a config hash become legacy:<value>',
      migrate: (snapshot) =>
        mapHistory(snapshot, (row) => ({
          ...row,
          tenant_id: rekey(row['tenant_id']),
          workspace_id: rekey(row['workspace_id']),
        })),
    };

    const engine = await upgrade([step]);
    await engine.shutdown();

    const after = readHistory(dbPath);
    expect(
      after.map(({ tenant_id, workspace_id, resource_id }) => ({
        tenant_id,
        workspace_id,
        resource_id,
      }))
    ).toEqual([
      { tenant_id: 'legacy:server', workspace_id: 'legacy:server', resource_id: 'seed-0' },
      { tenant_id: 'legacy:default', workspace_id: 'legacy:default', resource_id: 'seed-1' },
      { tenant_id: CONFIG_SCOPE, workspace_id: CONFIG_SCOPE, resource_id: 'seed-2' },
    ]);
    expect(after).toHaveLength(3);
  });

  it('leaves a migrated file with the same schema shape as a fresh one', async () => {
    await seedFile(dbPath);
    const engine = await upgrade([]);
    await engine.shutdown();
    const migrated = readShape(dbPath);

    const freshPath = path.join(testDir, 'fresh', 'state.db');
    const fresh = await SqliteEngine.getInstance(logger, {
      dbPath: freshPath,
      schemaVersion: targetVersion,
      durableMigrations: [],
    });
    await fresh.initialize();
    await fresh.shutdown();
    const created = readShape(freshPath);

    expect(Object.keys(migrated.tables).length).toBeGreaterThan(0);
    expect(migrated.views.length).toBeGreaterThan(0);
    expect(migrated).toEqual(created);

    // Positive control: one extra index on the migrated file must make the shapes differ, or the
    // equality above is also what a comparison blind to indexes would report.
    const raw = new DatabaseSync(dbPath);
    raw.exec('CREATE INDEX control_extra ON version_history(created_at)');
    raw.close();
    expect(readShape(dbPath)).not.toEqual(created);
  });
});
