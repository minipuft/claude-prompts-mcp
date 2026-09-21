// @lifecycle test - A cpm write and a server write of the same files produce the same tree_hash.
/**
 * Two writers, one checkpoint format.
 *
 * `version_history` has two accepted writers against one `state.db`, and the object store is
 * content-addressed — so if the CLI and the server enumerated or hashed a resource even slightly
 * differently, the same files would land under two `tree_hash` values and every dedup, every
 * skip-if-equal and every byte-exact restore would silently depend on which process wrote last.
 * There is one implementation (`resourceFileSet` → `readResourceTree` → `recordTree`) and this
 * file is what says the CLI actually reaches it.
 *
 * It also pins WHICH ROW a `cpm rollback` may hang a tree on, which is the inverse of the
 * server's answer and for a measured reason: `rollbackVersion` runs BEFORE
 * `cli/src/commands/rollback.ts` writes the restored file, so the bytes on disk at record time
 * are the PRE-rollback state — the bridge row's state, not the produced row's. A tree on the
 * produced row there would file the pre-rollback bytes under the row claiming the restored
 * content, and a later byte-exact rollback would restore the wrong state at full confidence.
 */

import { describe, it, expect, afterEach } from '@jest/globals';
import { DatabaseSync } from 'node:sqlite';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { VersioningConfigProvider } from '../../../src/modules/versioning/version-history-service.js';
import type { ResourceFileLocatorPort } from '../../../src/shared/utils/resource-file-set.js';

import { VersionHistoryService } from '../../../src/modules/versioning/version-history-service.js';
import { createTestDatabaseManager, seedStateDbSchema } from '../../helpers/test-database.js';
import { testScratchPath } from '../../helpers/scratch-path.js';
import { readResourceTree } from '../../../src/cli-shared/object-store.js';
import { resourceFileSet } from '../../../src/shared/utils/resource-file-set.js';
import { rollbackVersion, saveVersion } from '../../../src/cli-shared/version-history.js';
import { resolveTenantId } from '../../../src/cli-shared/version-history-scope.js';
import {
  DANGLING_ENTRY_SQL,
  EMPTY_TREE_SQL,
} from '../../../src/infra/database/version-tree-fsck.js';

const GATE_YAML = 'id: alpha\nguidanceFile: guidance.md\nname: Alpha\n';
const GUIDANCE = '# guidance\n\nwith a trailing newline and a non-ASCII character: é\n';

class FixedVersioningConfig implements VersioningConfigProvider {
  constructor(private readonly root: string) {}
  getVersioningConfig() {
    return { enabled: true, maxVersions: 50, autoVersion: true };
  }
  getServerRoot(): string {
    return this.root;
  }
}

async function writeGate(gatesRoot: string, id: string): Promise<string> {
  const dir = path.join(gatesRoot, id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'gate.yaml'), GATE_YAML);
  await writeFile(path.join(dir, 'guidance.md'), GUIDANCE);
  return path.join(dir, 'gate.yaml');
}

function locatorOver(root: string): ResourceFileLocatorPort {
  return {
    locate: async (_type, id) => ({
      located: true,
      entryPath: path.join(root, id, 'gate.yaml'),
      roots: { primary: root },
    }),
  };
}

describe('the two writers produce one checkpoint format', () => {
  const savedRuntimeRoot = process.env['MCP_RUNTIME_ROOT'];
  const savedWorkspace = process.env['MCP_WORKSPACE'];
  const savedResources = process.env['MCP_RESOURCES_PATH'];

  afterEach(() => {
    for (const [key, value] of [
      ['MCP_RUNTIME_ROOT', savedRuntimeRoot],
      ['MCP_WORKSPACE', savedWorkspace],
      ['MCP_RESOURCES_PATH', savedResources],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('gives the same tree_hash to the same files, written from either side', async () => {
    const ctx = await createTestDatabaseManager('tree-parity');
    try {
      const gatesRoot = path.join(ctx.testDir, 'resources', 'gates');
      const entryPath = await writeGate(gatesRoot, 'alpha');

      // The SERVER writes, through the wired path.
      const service = new VersionHistoryService({
        logger: ctx.logger as never,
        configManager: new FixedVersioningConfig(ctx.testDir),
        dbManager: ctx.dbManager,
        scope: { workspaceId: 'parity' },
        resourceFileLocator: locatorOver(gatesRoot),
      });
      await service.saveVersion('gate', 'alpha', { body: 'server' }, { description: 'server' });

      // The CLI writes the SAME files, through its own exported functions. The CLI has no server
      // process to route through, so calling the exports directly is the whole of its path.
      delete process.env['MCP_RESOURCES_PATH'];
      delete process.env['MCP_WORKSPACE'];
      process.env['MCP_RUNTIME_ROOT'] = ctx.testDir;
      const files = await resourceFileSet({
        resourceType: 'gate',
        entryPath,
        roots: { primary: gatesRoot },
      });
      const loaded = await readResourceTree(files);
      expect('tree' in loaded).toBe(true);
      if (!('tree' in loaded)) return;

      const cliTenant = resolveTenantId(path.join(ctx.testDir, 'runtime-state', 'state.db'));
      saveVersion(
        ctx.testDir,
        'gate',
        'alpha',
        { body: 'cli' },
        { description: 'cli', tree: loaded.tree }
      );

      const rows = ctx.dbManager.query<{
        tenant_id: string;
        description: string;
        tree_hash: string | null;
        tree_origin: string | null;
      }>('SELECT tenant_id, description, tree_hash, tree_origin FROM version_history');

      const server = rows.find((row) => row.description === 'server');
      const cli = rows.find((row) => row.description === 'cli');
      expect(server?.tree_hash).toMatch(/^sha256:/);
      // Two tenants, two object sets — and one tree_hash, because the hash is over content.
      expect(cli?.tenant_id).toBe(cliTenant);
      expect(cli?.tree_hash).toBe(server?.tree_hash);
      expect(cli?.tree_origin).toBe(server?.tree_origin);

      // The positive control for the comparison: DIFFERENT bytes must give a different hash, or
      // the equality above would also hold for a constant.
      await writeFile(path.join(gatesRoot, 'alpha', 'guidance.md'), '# different\n');
      const changed = await resourceFileSet({
        resourceType: 'gate',
        entryPath,
        roots: { primary: gatesRoot },
      });
      const changedLoaded = await readResourceTree(changed);
      expect('tree' in changedLoaded).toBe(true);
      saveVersion(
        ctx.testDir,
        'gate',
        'alpha',
        { body: 'cli2' },
        {
          description: 'cli2',
          tree: 'tree' in changedLoaded ? changedLoaded.tree : null,
        }
      );
      const second = ctx.dbManager.queryOne<{ tree_hash: string }>(
        `SELECT tree_hash FROM version_history WHERE description = 'cli2'`
      );
      expect(second?.tree_hash).not.toBe(server?.tree_hash);
    } finally {
      await ctx.cleanup();
    }
  });

  it('has the cpm rollback COMMAND supplying a tree, not just the function accepting one', () => {
    // Every case here calls `rollbackVersion` directly, which proves the function records what it
    // is given and says nothing about whether anything gives it anything. Without this, removing
    // the enumeration from `cli/src/commands/rollback.ts` leaves the whole suite green and the
    // feature dead — measured: that mutant was caught only by driving the built binary by hand.
    const source = readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../../cli/src/commands/rollback.ts'
      ),
      'utf8'
    );
    // The control for the reader itself: the file must be the one that calls rollbackVersion,
    // and it must enumerate and read the bytes at all.
    expect(source).toMatch(/rollbackVersion\s*\(/);
    expect(source).toMatch(/resourceFileSet\s*\(/);
    expect(source).toMatch(/readResourceTree\s*\(/);
    // It must KEEP what it read — computing a tree and dropping it is the shape this catches.
    expect(source).toMatch(/=\s*loaded\.tree/);

    // And the call itself must carry it. Read from the call's own text, brace-balanced, so the
    // word `tree` appearing anywhere else in the file cannot answer for the argument.
    const open = source.indexOf('(', source.search(/rollbackVersion\s*\(/));
    let depth = 0;
    let call = '';
    for (let i = open; i < source.length; i += 1) {
      const ch = source[i] as string;
      if ('([{'.includes(ch)) depth += 1;
      if (')]}'.includes(ch)) depth -= 1;
      call += ch;
      if (depth === 0) break;
    }
    expect(call).toMatch(/\btree\b/);
  });

  it('still rolls back on a pre-v29 database, where there is no store to record into', async () => {
    // `cpm` opens whatever `state.db` it finds, and one written by a server older than v29 has no
    // `objects` table. Found by the CLI suite, not this one: the first draft threw
    // `no such table: objects` inside the append's transaction, which rolled the rollback back and
    // made `cpm rollback` exit 1 against a database that had worked the day before. The positive
    // control is the case above, where the same call against a v29 database DOES record a tree.
    const workspace = testScratchPath('cli-rollback-legacy');
    await rm(workspace, { recursive: true, force: true });
    await mkdir(path.join(workspace, 'runtime-state'), { recursive: true });
    const dbPath = path.join(workspace, 'runtime-state', 'state.db');
    const gatesRoot = path.join(workspace, 'resources', 'gates');
    const entryPath = await writeGate(gatesRoot, 'alpha');

    const seed = new DatabaseSync(dbPath);
    seed.exec(`CREATE TABLE version_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, organization_id TEXT,
      workspace_id TEXT, resource_type TEXT NOT NULL, resource_id TEXT NOT NULL,
      version INTEGER NOT NULL, snapshot TEXT NOT NULL, diff_summary TEXT DEFAULT '',
      description TEXT DEFAULT '', created_at TEXT NOT NULL)`);
    seed.close();

    delete process.env['MCP_RESOURCES_PATH'];
    delete process.env['MCP_WORKSPACE'];
    process.env['MCP_RUNTIME_ROOT'] = workspace;

    try {
      saveVersion(workspace, 'gate', 'alpha', { name: 'One' }, { description: 'v1' });
      const files = await resourceFileSet({
        resourceType: 'gate',
        entryPath,
        roots: { primary: gatesRoot },
      });
      const loaded = await readResourceTree(files);
      expect('tree' in loaded).toBe(true);

      const result = rollbackVersion(
        entryPath,
        'gate',
        'alpha',
        1,
        { name: 'Live' },
        { tree: 'tree' in loaded ? loaded.tree : null }
      );
      expect(result.success).toBe(true);

      const db = new DatabaseSync(dbPath);
      const count = db.prepare('SELECT COUNT(*) AS cnt FROM version_history').get() as {
        cnt: number;
      };
      db.close();
      expect(Number(count.cnt)).toBeGreaterThan(1);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it('hangs a cpm rollback tree on the row the disk describes, and leaves the check quiet', async () => {
    const workspace = testScratchPath('cli-rollback-tree');
    await rm(workspace, { recursive: true, force: true });
    await mkdir(workspace, { recursive: true });
    await seedStateDbSchema(workspace);
    const dbPath = path.join(workspace, 'runtime-state', 'state.db');
    const gatesRoot = path.join(workspace, 'resources', 'gates');
    const entryPath = await writeGate(gatesRoot, 'alpha');

    delete process.env['MCP_RESOURCES_PATH'];
    delete process.env['MCP_WORKSPACE'];
    process.env['MCP_RUNTIME_ROOT'] = workspace;

    try {
      // Two versions to roll back between, written with no tree — this asserts what the ROLLBACK
      // records, so the history it starts from must contribute nothing to the answer.
      saveVersion(workspace, 'gate', 'alpha', { name: 'One' }, { description: 'v1' });
      saveVersion(workspace, 'gate', 'alpha', { name: 'Two' }, { description: 'v2' });

      const files = await resourceFileSet({
        resourceType: 'gate',
        entryPath,
        roots: { primary: gatesRoot },
      });
      const loaded = await readResourceTree(files);
      expect('tree' in loaded).toBe(true);

      const result = rollbackVersion(
        entryPath,
        'gate',
        'alpha',
        1,
        { name: 'Two', extra: 'live' },
        { tree: 'tree' in loaded ? loaded.tree : null }
      );
      expect(result.success).toBe(true);

      const db = new DatabaseSync(dbPath);
      const rows = db
        .prepare('SELECT version, description, tree_hash FROM version_history ORDER BY version')
        .all() as unknown as Array<{
        version: number;
        description: string;
        tree_hash: string | null;
      }>;
      const dangling = db.prepare(DANGLING_ENTRY_SQL).all().length;
      const emptyTrees = db.prepare(EMPTY_TREE_SQL).all().length;
      db.close();

      const bridge = rows.find((row) => row.description.startsWith('Bridge'));
      const produced = rows.find((row) => row.description.startsWith('Rollback to'));

      // The bridge row holds the state the disk holds right now, so it carries the tree...
      expect(bridge?.tree_hash).toMatch(/^sha256:/);
      // ...and the produced row claims the RESTORED state, which the restore has not written yet.
      expect(produced).toBeDefined();
      expect(produced?.tree_hash).toBeNull();
      // The startup referential check has nothing to say about any of it.
      expect(dangling + emptyTrees).toBe(0);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
