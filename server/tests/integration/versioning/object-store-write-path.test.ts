// @lifecycle canonical - Integration tests for the object store write path (row O.4b).
/**
 * A version row's FILES, recorded against a real `state.db` written by the real `SqliteEngine`,
 * from real files on disk.
 *
 * Everything asserted here is about bytes nothing else regenerates, so nothing is stubbed: the
 * object store's dedup is only meaningful if `INSERT OR IGNORE` ran against a live composite
 * primary key, and its atomicity is only meaningful if a throw met a live `BEGIN IMMEDIATE`.
 *
 * Every "rows are GONE" assertion reads the table RAW rather than through a join to
 * `version_history` — design note C6: a join discards exactly the orphans a missing delete would
 * leave behind, so the join-shaped version of these tests passes against the defect.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';

import type { TestDatabaseContext } from '../../helpers/test-database.js';
import type { VersioningConfigProvider } from '../../../src/modules/versioning/version-history-service.js';
import type { ResourceFileLocatorPort } from '../../../src/shared/utils/resource-file-set.js';

import { MAX_OBJECT_BYTES } from '../../../src/cli-shared/object-store.js';
import { VersionHistoryService } from '../../../src/modules/versioning/version-history-service.js';
import { createTestDatabaseManager } from '../../helpers/test-database.js';

const TENANT = 'object-store-tenant';

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
let gatesRoot: string;
let warnings: string[];

/**
 * A locator over the temp gates root.
 *
 * Deliberately a hand-written port rather than the composition root's implementation: these tests
 * are about what the store does with an ANSWER, and building a `PathResolver` here would make
 * every case below depend on path resolution too — which `resource-file-locator.test.ts` already
 * covers end to end.
 */
function locatorOver(root: string): ResourceFileLocatorPort {
  return {
    locate: async (resourceType, resourceId) => {
      const entryPath = path.join(root, resourceId, 'gate.yaml');
      try {
        const { stat } = await import('node:fs/promises');
        await stat(entryPath);
      } catch {
        return { located: false, reason: `no gate.yaml for ${resourceType} '${resourceId}'` };
      }
      return { located: true, entryPath, roots: { primary: root } };
    },
  };
}

function serviceWith(locator?: ResourceFileLocatorPort): VersionHistoryService {
  return new VersionHistoryService({
    logger: {
      ...ctx.logger,
      warn: (message: string) => {
        warnings.push(message);
      },
    } as never,
    configManager: new FixedVersioningConfig(ctx.testDir),
    dbManager: ctx.dbManager,
    scope: { workspaceId: TENANT },
    ...(locator !== undefined ? { resourceFileLocator: locator } : {}),
  });
}

/**
 * Write a gate whose `gate.yaml` DECLARES its `guidance.md`.
 *
 * The declaration is required, not decorative: `GateDefinitionLoader` inlines `guidanceFile` and
 * looks for nothing by name, so `resourceFileSet` enumerates a gate's guidance only when the
 * entry file points at it — a `guidance.md` nobody references is a file the server never reads.
 */
async function writeGate(id: string, yaml: string, guidance: string): Promise<void> {
  const dir = path.join(gatesRoot, id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'gate.yaml'), yaml);
  await writeFile(path.join(dir, 'guidance.md'), guidance);
}

const objectRows = (): Array<{ tenant_id: string; hash: string; size: number }> =>
  ctx.dbManager.query('SELECT tenant_id, hash, size FROM objects');

const entryRows = (): Array<{ version_row_id: number; path: string; object_hash: string }> =>
  ctx.dbManager.query('SELECT version_row_id, path, object_hash FROM version_entries');

const historyRows = (): Array<{
  id: number;
  version: number;
  description: string;
  tree_hash: string | null;
  tree_origin: string | null;
}> =>
  ctx.dbManager.query(
    'SELECT id, version, description, tree_hash, tree_origin FROM version_history ORDER BY version'
  );

beforeEach(async () => {
  warnings = [];
  ctx = await createTestDatabaseManager('object-store-write');
  gatesRoot = path.join(ctx.testDir, 'resources', 'gates');
  await mkdir(gatesRoot, { recursive: true });
  await writeGate(
    'alpha',
    'id: alpha\nguidanceFile: guidance.md\nname: Alpha\n',
    '# shared guidance\n'
  );
});

afterEach(async () => {
  await ctx.cleanup();
});

describe('object store write path', () => {
  it('records a tree for a produced row and none for its bridge row', async () => {
    const service = serviceWith(locatorOver(gatesRoot));

    // An edit whose prior live state is unrecorded: this writes the bridge row AND the produced
    // row, which is the one call that exercises both branches of the structural rule.
    const result = await service.recordEditResult(
      'gate',
      'alpha',
      { id: 'alpha', name: 'Alpha' },
      { id: 'alpha', name: 'Alpha edited' },
      { description: 'Update via resource_manager', diff_summary: '+1/-1' }
    );
    expect(result.bridged).toBe(true);

    const rows = historyRows();
    expect(rows).toHaveLength(2);
    const [bridge, produced] = rows;
    expect(bridge?.description).toContain('Bridge');
    expect(bridge?.tree_hash).toBeNull();
    expect(bridge?.tree_origin).toBeNull();
    expect(produced?.tree_hash).toMatch(/^sha256:/);
    expect(produced?.tree_origin).toBe('primary');

    // And the manifest hangs off the produced row only — read raw, so an entry mis-keyed to the
    // bridge row shows up rather than being filtered out by a join.
    const entries = entryRows();
    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((e) => e.version_row_id))).toEqual(new Set([produced?.id]));
    expect(entries.map((e) => e.path).sort()).toEqual(['gate.yaml', 'guidance.md']);
  });

  it('stores one object for a file that is byte-identical across two versions', async () => {
    const service = serviceWith(locatorOver(gatesRoot));

    await service.saveVersion('gate', 'alpha', { id: 'alpha', v: 1 });
    // Only `gate.yaml` changes; `guidance.md` is untouched, so its bytes are already stored.
    await writeFile(
      path.join(gatesRoot, 'alpha', 'gate.yaml'),
      'id: alpha\nguidanceFile: guidance.md\nname: Alpha 2\n'
    );
    await service.saveVersion('gate', 'alpha', { id: 'alpha', v: 2 });

    expect(historyRows()).toHaveLength(2);
    expect(entryRows()).toHaveLength(4);
    // Three objects, not four: two gate.yaml bodies plus ONE guidance.md.
    expect(objectRows()).toHaveLength(3);

    const guidanceHashes = new Set(
      entryRows()
        .filter((e) => e.path === 'guidance.md')
        .map((e) => e.object_hash)
    );
    expect(guidanceHashes.size).toBe(1);
  });

  it('keeps two tenants apart even when their bytes are identical', async () => {
    const shared = serviceWith(locatorOver(gatesRoot));
    await shared.saveVersion('gate', 'alpha', { id: 'alpha', v: 1 });

    const other = new VersionHistoryService({
      logger: ctx.logger,
      configManager: new FixedVersioningConfig(ctx.testDir),
      dbManager: ctx.dbManager,
      scope: { workspaceId: 'a-second-workspace' },
      resourceFileLocator: locatorOver(gatesRoot),
    });
    await other.saveVersion('gate', 'alpha', { id: 'alpha', v: 1 });

    const rows = objectRows();
    // Four rows over two distinct hashes: no cross-workspace dedup (owner ruling R56).
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.hash)).size).toBe(2);
    expect(new Set(rows.map((r) => r.tenant_id))).toEqual(new Set([TENANT, 'a-second-workspace']));
  });

  it('leaves no objects, rows or entries when the manifest insert throws', async () => {
    const service = serviceWith(locatorOver(gatesRoot));
    await service.saveVersion('gate', 'alpha', { id: 'alpha', v: 1 });
    const before = { objects: objectRows().length, entries: entryRows().length };

    // A second version whose guidance is NEW, so it would add an object of its own — then fail
    // between the object insert and the manifest insert. Injected on the port the store calls, so
    // the throw lands where WRITE-1 says nothing may survive it.
    await writeFile(path.join(gatesRoot, 'alpha', 'guidance.md'), '# changed guidance\n');
    await writeFile(
      path.join(gatesRoot, 'alpha', 'gate.yaml'),
      'id: alpha\nguidanceFile: guidance.md\nname: Alpha 2\n'
    );

    const realRun = ctx.dbManager.run.bind(ctx.dbManager);
    (ctx.dbManager as { run: (sql: string, params?: unknown[]) => void }).run = (sql, params) => {
      if (sql.includes('INSERT INTO version_entries')) throw new Error('injected');
      realRun(sql, params);
    };
    await expect(service.saveVersion('gate', 'alpha', { id: 'alpha', v: 2 })).rejects.toThrow(
      /injected/
    );
    (ctx.dbManager as { run: (sql: string, params?: unknown[]) => void }).run = realRun;

    // Nothing from the failed transaction survived: not the objects it inserted first, not the
    // version row, not an entry.
    expect(objectRows()).toHaveLength(before.objects);
    expect(entryRows()).toHaveLength(before.entries);
    expect(historyRows()).toHaveLength(1);

    // Positive control: the same write, without the injected throw, DOES add all three.
    await service.saveVersion('gate', 'alpha', { id: 'alpha', v: 2 });
    expect(historyRows()).toHaveLength(2);
    expect(objectRows().length).toBeGreaterThan(before.objects);
    expect(entryRows().length).toBeGreaterThan(before.entries);
  });

  it('records nothing new for an unchanged write', async () => {
    const service = serviceWith(locatorOver(gatesRoot));
    await service.saveVersion('gate', 'alpha', { id: 'alpha', v: 1 });
    const after = { objects: objectRows().length, entries: entryRows().length };

    const repeat = await service.saveVersion('gate', 'alpha', { id: 'alpha', v: 1 });
    expect(repeat.recorded).toBe(false);
    expect(objectRows()).toHaveLength(after.objects);
    expect(entryRows()).toHaveLength(after.entries);
  });

  it('degrades to projection-only, with one warning, for an over-limit file', async () => {
    await writeFile(path.join(gatesRoot, 'alpha', 'guidance.md'), 'x'.repeat(MAX_OBJECT_BYTES + 1));
    const service = serviceWith(locatorOver(gatesRoot));

    const result = await service.saveVersion('gate', 'alpha', { id: 'alpha', v: 1 });
    // The SAVE succeeds — the version row is the durable thing, and an oversize file costs
    // byte-exact rollback for that version, never the version.
    expect(result).toEqual({ success: true, version: 1, recorded: true });
    expect(historyRows()[0]?.tree_hash).toBeNull();
    expect(objectRows()).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('guidance.md');
    expect(warnings[0]).toContain(String(MAX_OBJECT_BYTES));
  });

  it('degrades to projection-only when the resource cannot be located', async () => {
    const service = serviceWith(locatorOver(gatesRoot));
    await rm(path.join(gatesRoot, 'alpha'), { recursive: true });

    const result = await service.saveVersion('gate', 'alpha', { id: 'alpha', v: 1 });
    expect(result.recorded).toBe(true);
    expect(historyRows()[0]?.tree_hash).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('no gate.yaml');
  });

  it('degrades to projection-only when no locator was injected at all', async () => {
    const service = serviceWith();
    const result = await service.saveVersion('gate', 'alpha', { id: 'alpha', v: 1 });
    expect(result.recorded).toBe(true);
    expect(historyRows()[0]?.tree_hash).toBeNull();
    expect(warnings).toHaveLength(1);
  });

  it('round-trips a BOM, a NUL, CRLF line endings and non-ASCII bytes', async () => {
    // Hand-authored bytes, not something a writer produced: a writer-seeded fixture only proves
    // idempotence, and the failure this guards is a Buffer ↔ Uint8Array round trip through
    // node:sqlite silently altering exactly these.
    const awkward = Buffer.from([
      0xef, 0xbb, 0xbf, 0x23, 0x20, 0x67, 0x0d, 0x0a, 0x00, 0xc3, 0xa9, 0xf0, 0x9f, 0x92, 0xa1,
      0x0d, 0x0a,
    ]);
    await writeFile(path.join(gatesRoot, 'alpha', 'guidance.md'), awkward);

    const service = serviceWith(locatorOver(gatesRoot));
    await service.saveVersion('gate', 'alpha', { id: 'alpha', v: 1 });

    const stored = ctx.dbManager.queryOne<{ bytes: Uint8Array; size: number; length: number }>(
      `SELECT o.bytes, o.size, length(o.bytes) AS length
         FROM objects o JOIN version_entries e ON e.object_hash = o.hash AND e.tenant_id = o.tenant_id
        WHERE e.path = 'guidance.md'`
    );
    expect(stored).not.toBeNull();
    expect(Buffer.from(stored!.bytes)).toEqual(awkward);
    expect(stored!.size).toBe(awkward.byteLength);
    // `length(bytes)` is the column's own cross-check — the one that costs no re-hash.
    expect(stored!.length).toBe(stored!.size);
  });
});
