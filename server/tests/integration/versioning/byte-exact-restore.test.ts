// @lifecycle canonical - The restore side of the object store: plan, refusals, and the apply.
/**
 * What a rollback to a recorded file tree does, against a real `state.db` and real files.
 *
 * The e2e suite (`tests/e2e/byte-exact-rollback.e2e.test.ts`) drives the same route through real
 * `tools/call` and proves byte identity over hand-authored fixtures. This file covers what an e2e
 * cannot reach without corrupting a live server's database: the two REFUSALS, which both require
 * writing a state into `state.db` that no writer in this repository produces.
 *
 * Both refusals are asserted the same way — the refusal is returned by name AND nothing was
 * written. A refusal that named the right thing while writing half the files would pass an
 * assertion about its message alone.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type { TestDatabaseContext } from '../../helpers/test-database.js';
import type { VersioningConfigProvider } from '../../../src/modules/versioning/version-history-service.js';
import type { ResourceFileLocatorPort } from '../../../src/shared/utils/resource-file-set.js';

import { rollbackVersion } from '../../../src/cli-shared/version-history.js';
import { applyByteRestore } from '../../../src/modules/versioning/byte-restore.js';
import { VersionHistoryService } from '../../../src/modules/versioning/version-history-service.js';
import { hashBytes } from '../../../src/shared/utils/hash.js';
import { resourceFileSet } from '../../../src/shared/utils/resource-file-set.js';
import { createTestDatabaseManager } from '../../helpers/test-database.js';

const TENANT = 'byte-restore-tenant';

/** The entry filename each type is addressed by — the same table the enumerator validates on. */
const ENTRY: Record<string, string> = {
  gate: 'gate.yaml',
  framework: 'framework.yaml',
  category: 'category.yaml',
};

class FixedVersioningConfig implements VersioningConfigProvider {
  constructor(private readonly root: string) {}
  getVersioningConfig() {
    return { enabled: true, maxVersions: 50, autoVersion: true };
  }
  getServerRoot(): string {
    return this.root;
  }
}

let ctx: TestDatabaseContext;
let resourcesRoot: string;

function rootFor(resourceType: string): string {
  return path.join(resourcesRoot, `${resourceType}s`);
}

/** A locator over the temp roots, one implementation for every type under test. */
const locator: ResourceFileLocatorPort = {
  locate: async (resourceType, resourceId) => {
    const root = rootFor(resourceType);
    const entryPath = path.join(root, resourceId, ENTRY[resourceType] ?? 'prompt.yaml');
    try {
      await stat(entryPath);
    } catch {
      return { located: false, reason: `no entry file for ${resourceType} '${resourceId}'` };
    }
    return { located: true, entryPath, roots: { primary: root } };
  },
};

function service(): VersionHistoryService {
  return new VersionHistoryService({
    logger: ctx.logger as never,
    configManager: new FixedVersioningConfig(ctx.testDir),
    dbManager: ctx.dbManager,
    scope: { workspaceId: TENANT },
    resourceFileLocator: locator,
  });
}

/** Write one resource's files, then record them as the state a version produced. */
async function recordVersion(
  resourceType: string,
  id: string,
  files: Record<string, string>
): Promise<number> {
  const dir = path.join(rootFor(resourceType), id);
  await mkdir(dir, { recursive: true });
  for (const [relative, content] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, relative)), { recursive: true });
    await writeFile(path.join(dir, relative), content, 'utf8');
  }
  const saved = await service().saveVersion(resourceType as 'gate', id, {
    id,
    marker: Object.keys(files).join(','),
  });
  return saved.version ?? 0;
}

beforeEach(async () => {
  ctx = await createTestDatabaseManager('byte-exact-restore');
  resourcesRoot = path.join(ctx.testDir, 'resources');
});

afterEach(async () => {
  await ctx.cleanup();
});

describe('planByteRestore', () => {
  it.each(['gate', 'framework', 'category'])(
    'plans a byte-exact restore for a %s',
    async (resourceType) => {
      const entry = ENTRY[resourceType] as string;
      const version = await recordVersion(resourceType, 'alpha', {
        [entry]: `# recorded ${resourceType}\nid: alpha\n`,
      });

      const dir = path.join(rootFor(resourceType), 'alpha');
      await writeFile(path.join(dir, entry), 'id: alpha\n', 'utf8');

      const available = await service().planByteRestore(resourceType as 'gate', 'alpha', version);
      expect(available.status).toBe('ready');
      if (available.status !== 'ready') throw new Error('unreachable');
      expect(available.plan.write.map((file) => file.path)).toEqual([entry]);
      expect(available.plan.write[0]?.reason).toBe('differs');
    }
  );

  it('puts a file the target version never recorded in leftInPlace, not in write', async () => {
    const version = await recordVersion('gate', 'alpha', {
      'gate.yaml': 'id: alpha\nguidanceFile: guidance.md\n',
      'guidance.md': '# recorded\n',
    });
    // Added AFTER the version was recorded, which is the positive control for the claim: it is
    // provably absent from that version's tree, so a delete-on-restore would remove it.
    await writeFile(
      path.join(rootFor('gate'), 'alpha', 'gate.yaml'),
      'id: alpha\nguidanceFile: guidance.md\nextra: 1\n',
      'utf8'
    );

    const available = await service().planByteRestore('gate', 'alpha', version);
    if (available.status !== 'ready') throw new Error(`expected ready, got ${available.status}`);
    expect(available.plan.unchanged).toEqual(['guidance.md']);
    expect(available.plan.write.map((file) => file.path)).toEqual(['gate.yaml']);
  });

  it('reports projection-only for a row that recorded no tree', async () => {
    const version = await recordVersion('gate', 'alpha', { 'gate.yaml': 'id: alpha\n' });
    ctx.dbManager.run(`UPDATE version_history SET tree_hash = NULL WHERE version = ?`, [version]);

    const available = await service().planByteRestore('gate', 'alpha', version);
    expect(available.status).toBe('projection-only');
  });

  it('refuses a recorded path that escapes the resource root, and writes nothing', async () => {
    const version = await recordVersion('gate', 'alpha', { 'gate.yaml': 'id: alpha\n' });
    // A tampered `state.db`, which is the only way to reach this: no writer in this repository
    // stores a path with a `..` segment.
    ctx.dbManager.run(`UPDATE version_entries SET path = ? WHERE tenant_id = ?`, [
      '../escaped.yaml',
      TENANT,
    ]);

    const available = await service().planByteRestore('gate', 'alpha', version);
    expect(available.status).toBe('refused');
    if (available.status !== 'refused') throw new Error('unreachable');
    expect(available.reason).toContain('../escaped.yaml');
    await expect(stat(path.join(rootFor('gate'), 'escaped.yaml'))).rejects.toThrow();
  });

  it('refuses by name when a recorded object is missing, rather than falling back', async () => {
    const version = await recordVersion('gate', 'alpha', {
      'gate.yaml': 'id: alpha\nguidanceFile: guidance.md\n',
      'guidance.md': '# recorded\n',
    });
    const [entry] = ctx.dbManager.query<{ path: string; object_hash: string }>(
      `SELECT path, object_hash FROM version_entries WHERE path = 'guidance.md'`
    );
    // The pragma is dropped for exactly this statement, and that is the point rather than a
    // convenience: `ON DELETE RESTRICT` refuses this delete on both of this repository's writers
    // (design note C2), so the only way the state exists is a THIRD opener that wrote with
    // constraints off — which is failure mode #2 the design names, and what the startup
    // referential repair exists to find. Reproducing it is how this refusal gets tested at all.
    ctx.dbManager.run(`PRAGMA foreign_keys = OFF`);
    ctx.dbManager.run(`DELETE FROM objects WHERE hash = ?`, [entry?.object_hash ?? '']);
    ctx.dbManager.run(`PRAGMA foreign_keys = ON`);

    const available = await service().planByteRestore('gate', 'alpha', version);
    expect(available.status).toBe('refused');
    if (available.status !== 'refused') throw new Error('unreachable');
    // Named — a caller reading this must know WHICH file, not merely that something was wrong.
    expect(available.reason).toContain('guidance.md');
    // And it must NOT be the projection fallback: silently restoring something else is the
    // failure this whole route exists to remove.
    expect(available.reason).not.toContain('recorded no file tree');
  });

  it("does not read another workspace's object for the same digest", async () => {
    // Objects are keyed `(tenant_id, hash)` (ruling R56), so two workspaces holding byte-identical
    // files hold two rows with the SAME digest. Drop one tenant's object and its rollback must
    // refuse — a read joined on hash alone would find the other workspace's copy and report a
    // byte-exact restore from bytes this workspace never recorded.
    const version = await recordVersion('gate', 'alpha', { 'gate.yaml': 'id: alpha\n' });
    const [entry] = ctx.dbManager.query<{ object_hash: string }>(
      `SELECT object_hash FROM version_entries`
    );
    const hash = entry?.object_hash ?? '';

    // A second workspace's row for the identical bytes, under a different tenant.
    ctx.dbManager.run(
      `INSERT INTO objects (tenant_id, hash, bytes, size, created_at)
       SELECT 'other-workspace', hash, bytes, size, created_at FROM objects WHERE hash = ?`,
      [hash]
    );
    // Positive control: both rows exist, so a hash-only read would find one.
    expect(
      ctx.dbManager.query(`SELECT tenant_id FROM objects WHERE hash = ?`, [hash])
    ).toHaveLength(2);

    ctx.dbManager.run(`PRAGMA foreign_keys = OFF`);
    ctx.dbManager.run(`DELETE FROM objects WHERE hash = ? AND tenant_id = ?`, [hash, TENANT]);
    ctx.dbManager.run(`PRAGMA foreign_keys = ON`);

    const available = await service().planByteRestore('gate', 'alpha', version);
    expect(available.status).toBe('refused');
  });
});

/**
 * A `cpm` rollback against a database written by a server older than schema v29.
 *
 * EXPLICIT, because the coverage that caught this was an accident. `cpm` opens whatever `state.db`
 * it finds, and a pre-v29 file has neither the object store nor `version_history`'s tree columns —
 * so a SELECT naming `tree_hash` THROWS rather than returning nothing, and an ordinary rollback
 * against an older database fails. It was found by the CLI suite's hand-seeded fixture, whose
 * subject is `cpm rollback` output and not schema compatibility at all; a fixture cleanup there
 * would have removed this net without anyone noticing what it protected. Same shape as the two
 * compatibility defects the previous worker on this arc recorded.
 */
describe('rollbackVersion against a pre-v29 database', () => {
  it('restores through the projection path instead of throwing', async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), 'pre-v29-rollback-'));
    try {
      const gateDir = path.join(workspace, 'resources', 'gates', 'alpha');
      await mkdir(gateDir, { recursive: true });
      await mkdir(path.join(workspace, 'runtime-state'), { recursive: true });
      await writeFile(
        path.join(gateDir, 'gate.yaml'),
        '# hand-authored\nid: alpha\nname: Current\n',
        'utf8'
      );

      // The v28 shape: no `objects`, no `version_entries`, and no tree columns.
      const db = new DatabaseSync(path.join(workspace, 'runtime-state', 'state.db'));
      try {
        db.exec(`CREATE TABLE version_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id TEXT NOT NULL DEFAULT 'default',
          organization_id TEXT, workspace_id TEXT,
          resource_type TEXT NOT NULL, resource_id TEXT NOT NULL, version INTEGER NOT NULL,
          snapshot TEXT NOT NULL, diff_summary TEXT DEFAULT '', description TEXT DEFAULT '',
          created_at TEXT NOT NULL)`);
        db.prepare(
          `INSERT INTO version_history
             (tenant_id, resource_type, resource_id, version, snapshot, created_at)
           VALUES ('default', 'gate', 'alpha', 1, ?, ?)`
        ).run(JSON.stringify({ id: 'alpha', name: 'Recorded' }), new Date().toISOString());
      } finally {
        db.close();
      }

      let applied = false;
      const result = await rollbackVersion(
        gateDir,
        { resourceType: 'gate', resourceId: 'alpha' },
        1,
        { id: 'alpha', name: 'Current' },
        {
          enumerate: () =>
            resourceFileSet({
              resourceType: 'gate',
              entryPath: path.join(gateDir, 'gate.yaml'),
              roots: { primary: path.join(workspace, 'resources', 'gates') },
            }),
          targets: [{ path: path.join(gateDir, 'gate.yaml'), kind: 'file' }],
          apply: (snapshot) => {
            applied = true;
            return Promise.resolve(snapshot);
          },
          location: {
            located: true,
            entryPath: path.join(gateDir, 'gate.yaml'),
            roots: { primary: path.join(workspace, 'resources', 'gates') },
          },
        }
      );

      // The projection path ran, and nothing threw on a column that is not there.
      expect(result.success).toBe(true);
      expect(applied).toBe(true);
      expect(result.plan).toBeUndefined();
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});

describe('applyByteRestore', () => {
  it('writes the recorded bytes back verbatim and records afterwards', async () => {
    const recorded = '# recorded ☕\r\nid: alpha\r\n';
    const version = await recordVersion('gate', 'alpha', { 'gate.yaml': recorded });
    const yamlPath = path.join(rootFor('gate'), 'alpha', 'gate.yaml');
    await writeFile(yamlPath, 'id: alpha\n', 'utf8');

    const available = await service().planByteRestore('gate', 'alpha', version);
    if (available.status !== 'ready') throw new Error(`expected ready, got ${available.status}`);

    let committed = false;
    const outcome = await applyByteRestore({
      plan: available.plan,
      bytes: available.bytes,
      commit: async (): Promise<void> => {
        // Runs AFTER the files are written, which is what lets the produced row carry their tree.
        expect(await readFile(yamlPath, 'utf8')).toBe(recorded);
        committed = true;
      },
    });

    expect(outcome.applied).toBe(true);
    expect(committed).toBe(true);
    expect(hashBytes(await readFile(yamlPath))).toBe(hashBytes(Buffer.from(recorded, 'utf8')));
  });

  it('restores every written file byte-identical when the record throws', async () => {
    const version = await recordVersion('gate', 'alpha', {
      'gate.yaml': '# recorded\nid: alpha\n',
    });
    const yamlPath = path.join(rootFor('gate'), 'alpha', 'gate.yaml');
    const before = 'id: alpha\n# edited by hand\n';
    await writeFile(yamlPath, before, 'utf8');

    const available = await service().planByteRestore('gate', 'alpha', version);
    if (available.status !== 'ready') throw new Error(`expected ready, got ${available.status}`);

    const outcome = await applyByteRestore({
      plan: available.plan,
      bytes: available.bytes,
      commit: async (): Promise<void> => {
        throw new Error('record failed');
      },
    });

    expect(outcome.applied).toBe(false);
    if (outcome.applied) throw new Error('unreachable');
    expect(outcome.rolledBack).toBe(true);
    // Byte-identical, not merely "restored": the transaction's whole purpose.
    expect(await readFile(yamlPath, 'utf8')).toBe(before);
  });
});
