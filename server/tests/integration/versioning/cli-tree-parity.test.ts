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
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { VersioningConfigProvider } from '../../../src/modules/versioning/version-history-service.js';
import type { ResourceFileLocatorPort } from '../../../src/shared/utils/resource-file-set.js';

import { VersionHistoryService } from '../../../src/modules/versioning/version-history-service.js';
import { createTestDatabaseManager, seedStateDbSchema } from '../../helpers/test-database.js';
import { testScratchPath } from '../../helpers/scratch-path.js';
import { hashBytes } from '../../../src/shared/utils/hash.js';
import { readResourceTree } from '../../../src/cli-shared/object-store.js';
import { resourceFileSet } from '../../../src/shared/utils/resource-file-set.js';
import { rollbackVersion, saveVersion } from '../../../src/cli-shared/version-history.js';
import { resolveTenantId } from '../../../src/cli-shared/version-history-scope.js';
import {
  DANGLING_ENTRY_SQL,
  EMPTY_TREE_SQL,
} from '../../../src/infra/database/version-tree-fsck.js';

const GATE_YAML = 'id: alpha\nguidanceFile: guidance.md\nname: Alpha\n';
/** What a restore writes: different bytes, so the two rows' trees cannot be one value twice. */
const RESTORED_YAML = '# authored by hand\nid: alpha\nguidanceFile: guidance.md\nname: One\n';
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

/**
 * The restore half of a rollback, as the command supplies it: enumerate, one target, one write.
 *
 * `targets` is the entry FILE, matching the command — a single-file prompt's directory is its
 * category, and snapshotting that would restore every sibling on a failed record.
 */
function restoreGate(entryPath: string, gatesRoot: string, yamlText: string) {
  return {
    enumerate: () =>
      resourceFileSet({ resourceType: 'gate' as const, entryPath, roots: { primary: gatesRoot } }),
    targets: [{ path: entryPath, kind: 'file' as const }],
    apply: async (_snapshot: Record<string, unknown>): Promise<void> => {
      await writeFile(entryPath, yamlText);
    },
  };
}

/** A workspace with a v29 schema, a gate on disk, and two projection-only versions behind it. */
async function setUpRollbackWorkspace(label: string): Promise<{
  workspace: string;
  dbPath: string;
  gatesRoot: string;
  entryPath: string;
}> {
  const workspace = testScratchPath(label);
  await rm(workspace, { recursive: true, force: true });
  await mkdir(workspace, { recursive: true });
  await seedStateDbSchema(workspace);
  const gatesRoot = path.join(workspace, 'resources', 'gates');
  const entryPath = await writeGate(gatesRoot, 'alpha');

  delete process.env['MCP_RESOURCES_PATH'];
  delete process.env['MCP_WORKSPACE'];
  process.env['MCP_RUNTIME_ROOT'] = workspace;

  // Two versions to roll back between, written with no tree — these cases assert what the ROLLBACK
  // records, so the history they start from must contribute nothing to the answer.
  saveVersion(workspace, 'gate', 'alpha', { name: 'One' }, { description: 'v1' });
  saveVersion(workspace, 'gate', 'alpha', { name: 'Two' }, { description: 'v2' });

  return {
    workspace,
    dbPath: path.join(workspace, 'runtime-state', 'state.db'),
    gatesRoot,
    entryPath,
  };
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

  it('still rolls back on a pre-v29 database, where there is no store to record into', async () => {
    // `cpm` opens whatever `state.db` it finds, and one written by a server older than v29 has no
    // `objects` table. Found by the CLI suite, not this one: the first draft threw
    // `no such table: objects` inside the append's transaction, which rolled the rollback back and
    // made `cpm rollback` exit 1 against a database that had worked the day before. The positive
    // control is the case below, where the same call against a v29 database DOES record a tree.
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
      const result = await rollbackVersion(
        entryPath,
        { resourceType: 'gate', resourceId: 'alpha' },
        1,
        { name: 'Live' },
        restoreGate(entryPath, gatesRoot, GATE_YAML)
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

  it('records the bytes the restore PRODUCED, not the bytes it replaced', async () => {
    // The defect this closes, measured on the built binary 2026-09-21: `rollbackVersion` ran
    // before `cli/src/commands/rollback.ts` wrote the restored file, so `Rollback to v1` carried
    // `tree_hash` NULL and the bytes on disk afterwards were described by no row at all.
    //
    // The two rows are ALSO the control for each other: the bridge row holds the pre-restore bytes
    // and the produced row the post-restore bytes, so an implementation that recorded one set
    // twice — which is what a single read before the write produces — fails the inequality below
    // even though both hashes would look like plausible `sha256:` values.
    const ctx = await setUpRollbackWorkspace('cli-rollback-produced');
    try {
      const result = await rollbackVersion(
        ctx.entryPath,
        { resourceType: 'gate', resourceId: 'alpha' },
        1,
        { name: 'Two', extra: 'live' },
        restoreGate(ctx.entryPath, ctx.gatesRoot, RESTORED_YAML)
      );
      expect(result.success).toBe(true);
      expect(result.recorded).toBe(true);

      const db = new DatabaseSync(ctx.dbPath);
      const rows = db
        .prepare(`SELECT id, version, description, tree_hash FROM version_history ORDER BY version`)
        .all() as unknown as Array<{
        id: number;
        version: number;
        description: string;
        tree_hash: string | null;
      }>;
      const entries = db
        .prepare(`SELECT version_row_id, path, object_hash FROM version_entries`)
        .all() as unknown as Array<{ version_row_id: number; path: string; object_hash: string }>;
      const dangling = db.prepare(DANGLING_ENTRY_SQL).all().length;
      const emptyTrees = db.prepare(EMPTY_TREE_SQL).all().length;
      db.close();

      const bridge = rows.find((row) => row.description.startsWith('Bridge'));
      const produced = rows.find((row) => row.description.startsWith('Rollback to'));
      expect(bridge?.tree_hash).toMatch(/^sha256:/);
      expect(produced?.tree_hash).toMatch(/^sha256:/);
      // Two different states, two different trees. Same value here means one read answered for
      // both rows, which is exactly the pre-fix ordering.
      expect(produced?.tree_hash).not.toBe(bridge?.tree_hash);

      // The produced row's manifest IS the bytes on disk — hashed here from the files themselves,
      // never from anything the writer returned.
      const onDisk = new Map<string, string>();
      for (const name of ['gate.yaml', 'guidance.md']) {
        onDisk.set(name, hashBytes(await readFile(path.join(ctx.gatesRoot, 'alpha', name))));
      }
      const producedEntries = entries.filter((entry) => entry.version_row_id === produced?.id);
      expect(producedEntries).toHaveLength(2);
      for (const entry of producedEntries) {
        expect(entry.object_hash).toBe(onDisk.get(entry.path));
      }
      // And the bridge row's manifest is NOT — it describes the state the restore replaced.
      const bridgeEntries = entries.filter((entry) => entry.version_row_id === bridge?.id);
      expect(bridgeEntries.some((entry) => entry.object_hash !== onDisk.get(entry.path))).toBe(
        true
      );

      expect(dangling + emptyTrees).toBe(0);
    } finally {
      await rm(ctx.workspace, { recursive: true, force: true });
    }
  });

  it('records nothing when the target version is already the current state', async () => {
    const ctx = await setUpRollbackWorkspace('cli-rollback-current');
    try {
      // Roll back to v2 — the state the history already says is newest.
      const result = await rollbackVersion(
        ctx.entryPath,
        { resourceType: 'gate', resourceId: 'alpha' },
        2,
        { name: 'Two' },
        restoreGate(ctx.entryPath, ctx.gatesRoot, GATE_YAML)
      );
      expect(result.success).toBe(true);
      expect(result.recorded).toBe(false);
      expect(result.saved_version).toBe(2);

      const db = new DatabaseSync(ctx.dbPath);
      const count = db.prepare('SELECT COUNT(*) AS cnt FROM version_history').get() as {
        cnt: number;
      };
      db.close();
      // Two rows in, two rows out: neither the bridge nor the produced row had anything to add.
      expect(Number(count.cnt)).toBe(2);
    } finally {
      await rm(ctx.workspace, { recursive: true, force: true });
    }
  });

  it('claims nothing when the restore itself fails', async () => {
    const ctx = await setUpRollbackWorkspace('cli-rollback-write-fails');
    try {
      const before = await readFile(ctx.entryPath, 'utf8');
      const result = await rollbackVersion(
        ctx.entryPath,
        { resourceType: 'gate', resourceId: 'alpha' },
        1,
        { name: 'Two', extra: 'live' },
        {
          ...restoreGate(ctx.entryPath, ctx.gatesRoot, RESTORED_YAML),
          apply: () => {
            throw new Error('disk full');
          },
        }
      );
      expect(result.success).toBe(false);
      expect(result.error).toContain('disk full');

      const db = new DatabaseSync(ctx.dbPath);
      const produced = db
        .prepare(`SELECT COUNT(*) AS cnt FROM version_history WHERE description LIKE 'Rollback%'`)
        .get() as { cnt: number };
      db.close();
      // No row claims a restore that did not happen. The bridge row may exist — it describes the
      // prior state, which genuinely existed and is still exactly what is on disk.
      expect(Number(produced.cnt)).toBe(0);
      expect(await readFile(ctx.entryPath, 'utf8')).toBe(before);
    } finally {
      await rm(ctx.workspace, { recursive: true, force: true });
    }
  });

  it('puts the files back when the version record fails after a successful write', async () => {
    const ctx = await setUpRollbackWorkspace('cli-rollback-record-fails');
    try {
      const before = await readFile(ctx.entryPath, 'utf8');
      const restore = restoreGate(ctx.entryPath, ctx.gatesRoot, RESTORED_YAML);
      const result = await rollbackVersion(
        ctx.entryPath,
        { resourceType: 'gate', resourceId: 'alpha' },
        1,
        { name: 'Two', extra: 'live' },
        {
          ...restore,
          apply: async (snapshot) => {
            await restore.apply(snapshot);
            // The write SUCCEEDED; the record is what fails. Renaming the table from a second
            // connection is the cheapest fault that reaches the produced append and nothing else.
            const saboteur = new DatabaseSync(ctx.dbPath);
            saboteur.exec('ALTER TABLE version_history RENAME TO version_history_moved');
            saboteur.close();
          },
        }
      );
      expect(result.success).toBe(false);

      const db = new DatabaseSync(ctx.dbPath);
      db.exec('ALTER TABLE version_history_moved RENAME TO version_history');
      const produced = db
        .prepare(`SELECT COUNT(*) AS cnt FROM version_history WHERE description LIKE 'Rollback%'`)
        .get() as { cnt: number };
      db.close();
      expect(Number(produced.cnt)).toBe(0);
      // The guarantee this borrows from `ResourceMutationTransaction`: byte-identical, not
      // approximately restored.
      expect(await readFile(ctx.entryPath, 'utf8')).toBe(before);
    } finally {
      await rm(ctx.workspace, { recursive: true, force: true });
    }
  });

  it('has the cpm rollback COMMAND driving the restore through the record', () => {
    // Every case above calls `rollbackVersion` directly, which proves the function records what it
    // is given and says nothing about whether the COMMAND hands it anything. Without this,
    // reverting `cli/src/commands/rollback.ts` to writing the file after the call leaves the whole
    // suite green and the feature dead — measured: that mutant was caught only by driving the
    // built binary by hand.
    const source = readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        '../../../../cli/src/commands/rollback.ts'
      ),
      'utf8'
    );
    // The control for the reader itself: this must be the file that calls rollbackVersion and
    // enumerates the resource's files.
    expect(source).toMatch(/rollbackVersion\s*\(/);
    expect(source).toMatch(/resourceFileSet\s*\(/);

    // The call itself must carry the restore, read brace-balanced from the call's own text so the
    // words elsewhere in the file cannot answer for its arguments.
    const open = source.indexOf('(', source.search(/rollbackVersion\s*\(/));
    let depth = 0;
    let call = '';
    for (let index = open; index < source.length; index += 1) {
      const character = source[index] as string;
      if ('([{'.includes(character)) depth += 1;
      if (')]}'.includes(character)) depth -= 1;
      call += character;
      if (depth === 0) break;
    }
    expect(call).toMatch(/\benumerate\b/);
    expect(call).toMatch(/\bapply\b/);
    // The target must be the entry FILE, named as such. A single-file prompt's directory is its
    // CATEGORY, so a directory target would restore every sibling prompt when a record fails —
    // and `targets` alone is satisfied by any value at all.
    expect(call).toMatch(/targets:\s*\[\s*\{\s*path:\s*yamlPath\s*,\s*kind:\s*'file'/);

    // And the write must be INSIDE what it hands over. A command that kept its own `writeFileSync`
    // after the call would satisfy every match above while restoring the old ordering.
    const afterCall = source.slice(open + call.length);
    expect(afterCall).not.toMatch(/writeFileSync\s*\(/);
  });
});
