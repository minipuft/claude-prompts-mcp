// @lifecycle test - Every path that removes version rows also removes the objects they orphaned.
/**
 * Objects have exactly one reachability path: `version_history` → `version_entries` → `objects`.
 * Nothing enumerates the table, nothing scans it later, and no maintenance pass exists — so an
 * object whose last manifest row is deleted is bytes nobody can ever reach or reclaim.
 *
 * The sweep is `NOT EXISTS` against `version_entries`, re-derived every time rather than counted.
 * Two things stand in front of a LIVE object and they are not the same thing: the `NOT EXISTS`
 * clause, which is the guard, and the foreign key from `version_entries.object_hash`, which is the
 * backstop and raises. Both are asserted, separately, because a sweep that relied on the backstop
 * would abort the caller's whole transaction and take its `version_history` deletes with it.
 *
 * Properties:
 *   a. a shared object survives the prune of ONE of its two referencing versions, and goes on the
 *      prune of the second. The positive control is in the same case: before the first prune the
 *      hash is asserted present AND referenced twice, so "it survived" cannot be read off a sweep
 *      that deleted nothing, and the second prune proves the sweep deletes something;
 *   b. the same for `deleteHistory` (server) and for `cpm`'s `deleteVersionRows`;
 *   c. tenant isolation: tenant A's removal leaves tenant B's byte-identical object and its
 *      entries untouched — two rows over two `(tenant_id, hash)` keys (ruling R56);
 *   d. the FK backstop: a hand-written `DELETE FROM objects` on a referenced hash RAISES;
 *   e. a rename re-keys rows only — entries and objects are byte-identical across it, compared as
 *      ONE value rather than field by field;
 *   f. two writers cannot interleave inside a sweep: a second real connection meeting the open
 *      `BEGIN IMMEDIATE` is refused, and the same write succeeds once it commits (the control
 *      that proves the lock was genuinely held, not that the write was invalid);
 *   g. the startup referential check stays quiet after every one of these operations, with a
 *      planted orphan as the control that the check sees anything at all;
 *   h. the CLASS: every module in `src/` that deletes `version_history` or `version_entries` rows
 *      also names the sweep. Enumerated from the sources, not from a list here.
 *
 * Every "rows are GONE" assertion reads the table RAW — a join to `version_history` discards
 * exactly the orphans a missing sweep leaves behind (design note C6).
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import type { TestDatabaseContext } from '../../helpers/test-database.js';
import type { VersioningConfigProvider } from '../../../src/modules/versioning/version-history-service.js';
import type { ResourceFileLocatorPort } from '../../../src/shared/utils/resource-file-set.js';

import { VersionHistoryService } from '../../../src/modules/versioning/version-history-service.js';
import { createTestDatabaseManager } from '../../helpers/test-database.js';
import {
  DANGLING_ENTRY_SQL,
  EMPTY_TREE_SQL,
} from '../../../src/infra/database/version-tree-fsck.js';
import {
  deleteVersionRows,
  renameHistoryResource,
} from '../../../src/cli-shared/version-history.js';
import { resolveTenantId } from '../../../src/cli-shared/version-history-scope.js';
import { STATE_DB_WRITER_PRAGMAS } from '../../../src/shared/utils/runtime-state-location.js';

const TENANT_A = 'gc-tenant-a';
const TENANT_B = 'gc-tenant-b';

/** The guidance both versions and both tenants share, byte for byte. */
const SHARED_GUIDANCE = '# shared guidance, unchanged across every version\n';

class FixedVersioningConfig implements VersioningConfigProvider {
  constructor(
    private readonly root: string,
    private readonly maxVersions: number
  ) {}
  getVersioningConfig() {
    return { enabled: true, maxVersions: this.maxVersions, autoVersion: true };
  }
  getServerRoot(): string {
    return this.root;
  }
}

let ctx: TestDatabaseContext;
let gatesRoot: string;

function locatorOver(root: string): ResourceFileLocatorPort {
  return {
    locate: async (resourceType, resourceId) => {
      const entryPath = path.join(root, resourceId, 'gate.yaml');
      try {
        await readFile(entryPath);
      } catch {
        return { located: false, reason: `no gate.yaml for ${resourceType} '${resourceId}'` };
      }
      return { located: true, entryPath, roots: { primary: root } };
    },
  };
}

function serviceFor(tenant: string, maxVersions: number): VersionHistoryService {
  return new VersionHistoryService({
    logger: ctx.logger as never,
    configManager: new FixedVersioningConfig(ctx.testDir, maxVersions),
    dbManager: ctx.dbManager,
    scope: { workspaceId: tenant },
    resourceFileLocator: locatorOver(gatesRoot),
  });
}

async function writeGate(id: string, body: string): Promise<void> {
  const dir = path.join(gatesRoot, id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'gate.yaml'), `id: ${id}\nguidanceFile: guidance.md\n${body}`);
  await writeFile(path.join(dir, 'guidance.md'), SHARED_GUIDANCE);
}

const objects = (): Array<{ tenant_id: string; hash: string; size: number }> =>
  ctx.dbManager.query('SELECT tenant_id, hash, size FROM objects ORDER BY tenant_id, hash');

const entries = (): Array<{
  version_row_id: number;
  tenant_id: string;
  path: string;
  object_hash: string;
}> =>
  ctx.dbManager.query(
    'SELECT version_row_id, tenant_id, path, object_hash FROM version_entries ORDER BY version_row_id, path'
  );

const historyRows = (): Array<{
  id: number;
  tenant_id: string;
  resource_id: string;
  version: number;
}> =>
  ctx.dbManager.query(
    'SELECT id, tenant_id, resource_id, version FROM version_history ORDER BY id'
  );

/** How many manifest rows reference `hash` under `tenant` — read raw, never through a join. */
function referenceCount(tenant: string, hash: string): number {
  const row = ctx.dbManager.queryOne<{ cnt: number }>(
    'SELECT COUNT(*) AS cnt FROM version_entries WHERE tenant_id = ? AND object_hash = ?',
    [tenant, hash]
  );
  return Number(row?.cnt ?? 0);
}

/** The startup referential check's own two queries. Both empty is what "quiet" means. */
function referentialFindings(): number {
  return (
    ctx.dbManager.query(DANGLING_ENTRY_SQL).length + ctx.dbManager.query(EMPTY_TREE_SQL).length
  );
}

beforeEach(async () => {
  ctx = await createTestDatabaseManager('object-gc');
  gatesRoot = path.join(ctx.testDir, 'resources', 'gates');
  await mkdir(gatesRoot, { recursive: true });
});

afterEach(async () => {
  await ctx.cleanup();
});

describe('objects are swept by every path that removes the rows referencing them', () => {
  it('keeps a shared object while one version still references it, and drops it with the last', async () => {
    const service = serviceFor(TENANT_A, 2);
    await writeGate('alpha', 'name: One\n');
    await service.saveVersion('gate', 'alpha', { body: 'one' }, { description: 'v1' });
    await writeGate('alpha', 'name: Two\n');
    await service.saveVersion('gate', 'alpha', { body: 'two' }, { description: 'v2' });

    const sharedHash = entries().find((entry) => entry.path === 'guidance.md')?.object_hash;
    expect(sharedHash).toBeDefined();

    // POSITIVE CONTROL, before anything is removed: the hash exists as exactly one row and TWO
    // manifest rows point at it. Without this, "the object survived" is indistinguishable from a
    // sweep that never ran, and from an object that was never stored.
    expect(objects().filter((row) => row.hash === sharedHash)).toHaveLength(1);
    expect(referenceCount(TENANT_A, sharedHash as string)).toBe(2);
    const gateYamlV1 = entries().find((entry) => entry.path === 'gate.yaml')?.object_hash;

    // A third version with maxVersions 2 prunes v1. The shared guidance is still referenced by
    // v2 and v3; v1's own gate.yaml is not referenced by anything.
    await writeGate('alpha', 'name: Three\n');
    await service.saveVersion('gate', 'alpha', { body: 'three' }, { description: 'v3' });

    expect(historyRows().map((row) => row.version)).toEqual([2, 3]);
    expect(objects().filter((row) => row.hash === sharedHash)).toHaveLength(1);
    expect(referenceCount(TENANT_A, sharedHash as string)).toBe(2);
    // The sweep DELETED something — the other half of the control.
    expect(objects().filter((row) => row.hash === gateYamlV1)).toHaveLength(0);
    expect(referentialFindings()).toBe(0);

    // Now remove the last references.
    const removed = await service.deleteHistory('gate', 'alpha');
    expect(removed).toBe(2);
    expect(historyRows()).toHaveLength(0);
    expect(entries()).toHaveLength(0);
    expect(objects()).toHaveLength(0);
    expect(referentialFindings()).toBe(0);
  });

  it('leaves another tenant byte-identical objects and entries untouched', async () => {
    await writeGate('alpha', 'name: One\n');
    await serviceFor(TENANT_A, 5).saveVersion('gate', 'alpha', { body: 'a' }, {});
    await serviceFor(TENANT_B, 5).saveVersion('gate', 'alpha', { body: 'b' }, {});

    // Byte-identical files, two tenants, two object rows over one hash value (ruling R56).
    const before = objects();
    expect(before).toHaveLength(4);
    expect(new Set(before.map((row) => row.tenant_id))).toEqual(new Set([TENANT_A, TENANT_B]));
    const bHashes = before.filter((row) => row.tenant_id === TENANT_B);
    const bEntries = entries().filter((entry) => entry.tenant_id === TENANT_B);
    expect(bEntries).toHaveLength(2);

    await serviceFor(TENANT_A, 5).deleteHistory('gate', 'alpha');

    expect(objects().filter((row) => row.tenant_id === TENANT_A)).toHaveLength(0);
    expect(objects().filter((row) => row.tenant_id === TENANT_B)).toEqual(bHashes);
    expect(entries().filter((entry) => entry.tenant_id === TENANT_B)).toEqual(bEntries);
    expect(referentialFindings()).toBe(0);
  });

  it('sweeps on the cpm delete path too, against the same file', async () => {
    await writeGate('alpha', 'name: One\n');
    await serviceFor(TENANT_A, 5).saveVersion('gate', 'alpha', { body: 'a' }, {});
    expect(objects()).toHaveLength(2);

    // `cpm` opens `state.db` itself. The server's engine holds it too; both carry the same
    // busy_timeout, so the second writer waits rather than colliding.
    const saved = process.env['MCP_RUNTIME_ROOT'];
    const savedWorkspace = process.env['MCP_WORKSPACE'];
    const savedResources = process.env['MCP_RESOURCES_PATH'];
    delete process.env['MCP_RESOURCES_PATH'];
    delete process.env['MCP_WORKSPACE'];
    process.env['MCP_RUNTIME_ROOT'] = ctx.testDir;
    try {
      expect(deleteVersionRows(ctx.testDir, { resourceType: 'gate', resourceId: 'alpha' })).toBe(
        true
      );
    } finally {
      if (saved === undefined) delete process.env['MCP_RUNTIME_ROOT'];
      else process.env['MCP_RUNTIME_ROOT'] = saved;
      if (savedWorkspace !== undefined) process.env['MCP_WORKSPACE'] = savedWorkspace;
      if (savedResources !== undefined) process.env['MCP_RESOURCES_PATH'] = savedResources;
    }

    expect(historyRows()).toHaveLength(0);
    expect(entries()).toHaveLength(0);
    expect(objects()).toHaveLength(0);
    expect(referentialFindings()).toBe(0);
  });

  it('still deletes rows on a pre-v29 database, where no store exists to sweep', async () => {
    // `cpm` opens whatever `state.db` it finds, and one written by a server older than v29 has no
    // `objects` table. Caught by the CLI suite rather than by this one: the first draft of the
    // sweep threw `no such table: objects`, `runSqlite` turned that into `success: false`, and
    // `cpm delete` reported success while every row stayed. The positive control is the case
    // above, where the same call against a v29 database does remove objects.
    const legacyDir = path.join(ctx.testDir, 'legacy');
    const legacyDb = path.join(legacyDir, 'runtime-state', 'state.db');
    await mkdir(path.dirname(legacyDb), { recursive: true });
    const raw = new DatabaseSync(legacyDb);
    raw.exec(`CREATE TABLE version_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, organization_id TEXT,
      workspace_id TEXT, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL,
      version INTEGER NOT NULL, snapshot TEXT NOT NULL, diff_summary TEXT DEFAULT '',
      description TEXT DEFAULT '', created_at TEXT NOT NULL)`);
    const legacyTenant = resolveTenantId(legacyDb);
    raw
      .prepare(
        `INSERT INTO version_history
           (tenant_id, workspace_id, resource_type, resource_id, version, snapshot, created_at)
         VALUES (?, ?, 'gate', 'alpha', 1, '{}', ?)`
      )
      .run(legacyTenant, legacyTenant, new Date().toISOString());
    raw.close();

    const saved = process.env['MCP_RUNTIME_ROOT'];
    process.env['MCP_RUNTIME_ROOT'] = legacyDir;
    try {
      expect(deleteVersionRows(legacyDir, { resourceType: 'gate', resourceId: 'alpha' })).toBe(
        true
      );
    } finally {
      if (saved === undefined) delete process.env['MCP_RUNTIME_ROOT'];
      else process.env['MCP_RUNTIME_ROOT'] = saved;
    }

    const after = new DatabaseSync(legacyDb);
    const left = after.prepare('SELECT COUNT(*) AS cnt FROM version_history').get() as {
      cnt: number;
    };
    after.close();
    expect(Number(left.cnt)).toBe(0);
  });

  it('refuses a hand-written delete of a referenced object — the backstop, not the guard', async () => {
    await writeGate('alpha', 'name: One\n');
    await serviceFor(TENANT_A, 5).saveVersion('gate', 'alpha', { body: 'a' }, {});
    const live = objects()[0];
    expect(live).toBeDefined();
    expect(referenceCount(TENANT_A, live?.hash as string)).toBeGreaterThan(0);

    expect(() =>
      ctx.dbManager.run('DELETE FROM objects WHERE tenant_id = ? AND hash = ?', [
        live?.tenant_id,
        live?.hash,
      ])
    ).toThrow(/FOREIGN KEY/i);

    // The control for the refusal: the same statement on an UNreferenced object succeeds, so the
    // throw above is the constraint answering and not a malformed statement.
    ctx.dbManager.run(
      `INSERT INTO objects (tenant_id, hash, bytes, size, created_at) VALUES (?, ?, ?, ?, ?)`,
      [TENANT_A, 'sha256:deadbeef', Buffer.from('x'), 1, new Date().toISOString()]
    );
    ctx.dbManager.run('DELETE FROM objects WHERE tenant_id = ? AND hash = ?', [
      TENANT_A,
      'sha256:deadbeef',
    ]);
    expect(objects().filter((row) => row.hash === 'sha256:deadbeef')).toHaveLength(0);
  });

  it('leaves entries and objects byte-untouched across a rename', async () => {
    const dbPath = path.join(ctx.testDir, 'runtime-state', 'state.db');
    // `renameSubtree` uses the CLI's UNcorrected tenant guess (unlike delete, which corrects), so
    // the rows have to be written under that same scope or the rename moves nothing and the
    // assertions below hold vacuously.
    const cliTenant = resolveTenantId(dbPath);
    await writeGate('alpha', 'name: One\n');
    await serviceFor(cliTenant, 5).saveVersion('gate', 'alpha', { body: 'a' }, {});

    const entriesBefore = entries();
    const objectsBefore = objects();
    expect(entriesBefore).toHaveLength(2);

    const saved = process.env['MCP_RUNTIME_ROOT'];
    const savedResources = process.env['MCP_RESOURCES_PATH'];
    delete process.env['MCP_RESOURCES_PATH'];
    process.env['MCP_RUNTIME_ROOT'] = ctx.testDir;
    try {
      expect(
        renameHistoryResource(ctx.testDir, { resourceType: 'gate', resourceId: 'alpha' }, 'beta')
      ).toBe(true);
    } finally {
      if (saved === undefined) delete process.env['MCP_RUNTIME_ROOT'];
      else process.env['MCP_RUNTIME_ROOT'] = saved;
      if (savedResources !== undefined) process.env['MCP_RESOURCES_PATH'] = savedResources;
    }

    // Compared as ONE value each: a rename re-keys `version_history.resource_id`, and entries key
    // on `version_row_id` while objects key on content, so neither may move at all.
    expect(entries()).toEqual(entriesBefore);
    expect(objects()).toEqual(objectsBefore);
    expect(historyRows().map((row) => row.resource_id)).toEqual(['beta']);
    expect(referentialFindings()).toBe(0);
  });

  it('excludes a second writer for the whole sweep, and admits it afterwards', async () => {
    await writeGate('alpha', 'name: One\n');
    await serviceFor(TENANT_A, 5).saveVersion('gate', 'alpha', { body: 'a' }, {});

    const dbPath = path.join(ctx.testDir, 'runtime-state', 'state.db');
    const intruder = new DatabaseSync(dbPath);
    try {
      for (const pragma of STATE_DB_WRITER_PRAGMAS) intruder.exec(pragma);
      // Zero patience, so the refusal is observed rather than waited out. Both real writers carry
      // STATE_DB_BUSY_TIMEOUT_MS instead and simply wait — the exclusion is the same fact.
      intruder.exec('PRAGMA busy_timeout = 0');

      ctx.dbManager.run('BEGIN IMMEDIATE');
      let refused: unknown;
      try {
        intruder.exec('BEGIN IMMEDIATE');
      } catch (error) {
        refused = error;
      }
      expect(String(refused)).toMatch(/busy|locked/i);
      ctx.dbManager.run('COMMIT');

      // The control: the identical statement succeeds once the lock is released, so the refusal
      // above was the lock and not a malformed connection.
      intruder.exec('BEGIN IMMEDIATE');
      intruder.exec('COMMIT');
    } finally {
      intruder.close();
    }
  });

  /**
   * The class.
   *
   * The defect's shape is "a statement removes rows that were the last reference to an object,
   * and nothing removes the object". The sites are enumerated from the SOURCES — every module
   * whose text contains such a delete — rather than from a list in this file, because a list here
   * would stay green for a site nobody added to it. One of the four members deletes no
   * `version_history` row at all (the startup repair deletes only `version_entries`), which is
   * exactly why the predicate has to name both tables.
   */
  describe('every module that removes rows of either table names the sweep', () => {
    const DELETES = /DELETE FROM (version_history|version_entries)\b/;
    /**
     * A CALL, not a mention.
     *
     * The first draft tested `source.includes('sweepUnreferencedObjects')`, and its mutation
     * proved it worthless: deleting the call from `SqliteEngine.repairVersionTrees` left the
     * import behind and the scan stayed green. The import has no parenthesis; every call does.
     */
    const SWEEPS = /sweepUnreferencedObjects\s*\(/;

    async function sourceFiles(dir: string): Promise<string[]> {
      const found: string[] = [];
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) found.push(...(await sourceFiles(full)));
        else if (entry.name.endsWith('.ts')) found.push(full);
      }
      return found;
    }

    it('finds every such module, and each one sweeps', async () => {
      const root = path.resolve(process.cwd(), 'src');
      const removers: string[] = [];
      const silent: string[] = [];
      for (const file of await sourceFiles(root)) {
        const source = await readFile(file, 'utf8');
        if (!DELETES.test(source)) continue;
        removers.push(path.relative(root, file));
        if (!SWEEPS.test(source)) silent.push(path.relative(root, file));
      }

      // The probe saw something: three modules remove rows today (the CLI's delete and its prune
      // share one). A drop toward zero means the scan stopped working, not that the class closed.
      expect(removers.length).toBeGreaterThanOrEqual(3);
      expect(silent).toEqual([]);
    });

    it('flags a module that deletes without sweeping — the scanner sees the defect', () => {
      // Two mutants this scanner must tell apart: a delete with no sweep at all, and a module
      // that still IMPORTS the sweep after its only call was removed. The second one passed the
      // first draft of this check, and its own mutation is what found that.
      const noSweep = `db.run('DELETE FROM version_history WHERE id = ?', [id]);`;
      const importOnly = `import { sweepUnreferencedObjects } from './object-store.js';\n${noSweep}`;
      expect(DELETES.test(noSweep)).toBe(true);
      expect(SWEEPS.test(noSweep)).toBe(false);
      expect(DELETES.test(importOnly)).toBe(true);
      expect(SWEEPS.test(importOnly)).toBe(false);
    });
  });

  it('reports a planted orphan — the referential check sees something', async () => {
    await writeGate('alpha', 'name: One\n');
    await serviceFor(TENANT_A, 5).saveVersion('gate', 'alpha', { body: 'a' }, {});
    expect(referentialFindings()).toBe(0);

    // A row claiming a tree with no manifest rows is the downgrade shape the check exists to find.
    ctx.dbManager.run(
      `INSERT INTO version_history
         (tenant_id, organization_id, workspace_id, resource_type, resource_id, version, snapshot,
          diff_summary, description, created_at, tree_hash, tree_origin)
       VALUES (?, NULL, ?, 'gate', 'orphan', 1, '{}', '', '', ?, 'sha256:aa', 'primary')`,
      [TENANT_A, TENANT_A, new Date().toISOString()]
    );
    expect(referentialFindings()).toBeGreaterThan(0);
  });
});
