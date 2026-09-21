// @lifecycle test - A cpm create records one row at version 1, or leaves neither row nor files.
/**
 * `recordResourceWrite` with no prior state is a CREATE, and it is atomic in both directions.
 *
 * Two properties, each with the failure it exists to prevent:
 *
 *  - **No bridge row.** A create has no prior live state, so `priorSnapshot` is omitted rather
 *    than passed as `{}`. Passing `{}` would record an empty snapshot as version 1 and make the
 *    real created state version 2 — an edit of a resource that never had any fields.
 *  - **A failed write claims nothing.** The create runs as the transaction's `mutate`, so a throw
 *    leaves no row AND removes the directory the transaction captured as absent. A create that
 *    half-happened under a row describing it is unrecoverable: nothing regenerates
 *    `version_history`.
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { recordResourceWrite } from '../../../src/cli-shared/version-history.js';
import { SqliteEngine } from '../../../src/infra/database/index.js';
import { resourceFileSet } from '../../../src/shared/utils/resource-file-set.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

const mockLogger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

const testDir = testScratchPath('cpm-create-record-atomicity');
const gatesRoot = path.join(testDir, 'resources', 'gates');

const GATE_YAML = (name: string): string =>
  `id: fresh\nname: ${name}\ntype: validation\ndescription: A fresh gate\nguidanceFile: guidance.md\n`;

async function writeGate(name: string): Promise<void> {
  const dir = path.join(gatesRoot, 'fresh');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'gate.yaml'), GATE_YAML(name), 'utf8');
  await fs.writeFile(path.join(dir, 'guidance.md'), '# guidance\n', 'utf8');
}

function rows(): Array<{ version: number; description: string; tree_hash: string | null }> {
  const db = new DatabaseSync(path.join(testDir, 'runtime-state', 'state.db'));
  const all = db
    .prepare(
      `SELECT version, description, tree_hash FROM version_history
       WHERE resource_type = 'gate' AND resource_id = 'fresh' ORDER BY version`
    )
    .all() as unknown as Array<{ version: number; description: string; tree_hash: string | null }>;
  db.close();
  return all;
}

const record = async (
  write: () => Promise<Record<string, unknown>>
): Promise<Awaited<ReturnType<typeof recordResourceWrite>>> =>
  await recordResourceWrite(
    path.join(gatesRoot, 'fresh'),
    { resourceType: 'gate', resourceId: 'fresh' },
    {
      enumerate: () =>
        resourceFileSet({
          resourceType: 'gate',
          entryPath: path.join(gatesRoot, 'fresh', 'gate.yaml'),
          roots: { primary: gatesRoot },
        }),
      targets: [{ path: path.join(gatesRoot, 'fresh'), kind: 'directory' }],
      // No `priorSnapshot` — this is the create shape.
      write,
      description: 'Created via resource_manager',
    }
  );

describe('a cpm create records one row, or nothing at all', () => {
  beforeEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
    await fs.mkdir(path.join(testDir, 'runtime-state'), { recursive: true });
    await fs.mkdir(gatesRoot, { recursive: true });
    const engine = await SqliteEngine.getInstance(mockLogger as never, {
      dbPath: path.join(testDir, 'runtime-state', 'state.db'),
    });
    await engine.initialize();
    await engine.shutdown();
  });

  afterEach(async () => {
    await SqliteEngine.shutdownInstance();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('records the created state as version 1 with no bridge row', async () => {
    const result = await record(async () => {
      await writeGate('Fresh');
      return { id: 'fresh', name: 'Fresh', type: 'validation', description: 'A fresh gate' };
    });

    expect(result.written).toBe(true);
    if (!result.written || !result.recorded) throw new Error('expected a recorded write');
    expect(result.version).toBe(1);
    // The property this test is named for: one row, and it is the CREATED state — not an empty
    // snapshot at v1 with the real one at v2.
    expect(result.bridged).toBe(false);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.version).toBe(1);
    expect(rows()[0]!.tree_hash).toMatch(/^sha256:/);
  });

  it('records nothing and leaves no directory when the write throws', async () => {
    const result = await record(async () => {
      // A partial create: the files land, and then the write fails. This is the state that must
      // not survive — both halves of it.
      await writeGate('Doomed');
      throw new Error('create failed after writing');
    });

    expect(result.written).toBe(false);
    if (result.written) throw new Error('expected the write to have been undone');
    expect(result.error).toContain('create failed after writing');
    expect(rows()).toEqual([]);
    // The transaction captured the directory as ABSENT, so restoring it means removing it.
    await expect(fs.stat(path.join(gatesRoot, 'fresh'))).rejects.toThrow();
  });

  it('still performs the write, unrecorded and saying so, when there is no state.db', async () => {
    // A workspace the server has never run in has no `state.db`, and the CLI never creates one
    // (`runSqlite` — a CLI-authored schema once left the server unable to boot). Refusing the
    // write there would make `cpm create` unusable in the workspace `cpm init` just made; the
    // server's own equivalent is `isAutoVersionEnabled()` false, which runs the writer with no
    // commit step. Measured by the CLI's own `cpm create` suite, which went red when this path
    // reported failure.
    await fs.rm(path.join(testDir, 'runtime-state'), { recursive: true, force: true });

    const result = await record(async () => {
      await writeGate('Unrecorded');
      return { id: 'fresh', name: 'Unrecorded' };
    });

    expect(result.written).toBe(true);
    if (!result.written || result.recorded) throw new Error('expected an unrecorded write');
    // The reason is returned, not swallowed: a create that silently records nothing is the defect
    // shape this seam exists to remove.
    expect(result.reason).toContain('state.db');
    // And the write really happened — the control against "reported success, wrote nothing".
    expect(await fs.readFile(path.join(gatesRoot, 'fresh', 'gate.yaml'), 'utf8')).toContain(
      'name: Unrecorded'
    );
  });

  it('is a positive control for the row probe — the same probe DOES see a row', async () => {
    // The absence asserted above is only evidence because this shows `rows()` reports one when a
    // row exists, against the same database and the same query.
    await record(async () => {
      await writeGate('Seen');
      return { id: 'fresh', name: 'Seen' };
    });
    expect(rows()).toHaveLength(1);
  });
});
