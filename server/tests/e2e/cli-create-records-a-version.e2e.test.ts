/**
 * `cpm create` records the state it produced, in the shape `resource_manager create` records.
 *
 * THE CLAIM, AND WHY IT IS NOT A FILE COMPARISON. The two surfaces cannot produce byte-identical
 * files from a create: `cpm` writes an authoring TEMPLATE (commented, with example blocks) and the
 * server writes its payload through the resource's own writer, so a `tree_hash` comparison between
 * the two would be a comparison of two different resources. What MUST agree is the projection —
 * `version_history.snapshot` is a `SnapshotContract` projection, and the bridge decision is
 * `hashCanonical` equality against the newest recorded row. So the parity assertion here is the
 * observable that equality produces: after `cpm create`, the SERVER's own next edit of that same
 * resource records exactly one row and NO bridge row, which can only happen if the server's live
 * projection hashes equal to the snapshot `cpm` wrote.
 *
 * The positive control for that absence is a twin resource differing in ONE thing — its gate.yaml
 * is edited out of band before the server's edit — where the bridge row does appear. Without it,
 * "no bridge row" would also be satisfied by a server that recorded nothing at all.
 *
 * Everything runs through the BUILT binary (`server/dist/cpm.js`) against the same `state.db` a
 * hermetic server owns, because that is the only arrangement in which the two writers are the two
 * real writers.
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DatabaseSync } from 'node:sqlite';

import { hashBytes } from '../../src/shared/utils/hash.js';
import { buildServerEnv } from './helpers/child-env.js';
import {
  getAvailablePort,
  killServer,
  startServerWithHttp,
  StreamableHttpMcpClient,
  waitForHealth,
} from './helpers/http-mcp-client.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CPM_ENTRY = path.join(SERVER_ROOT, 'dist', 'cpm.js');

/**
 * How long the file observer needs to have reloaded a resource `cpm` wrote.
 *
 * Measured at 6 s by the worker before this one, and the reason it is not optional: without it the
 * server's next edit is made against a STALE registry entry, so the bridge row you measure records
 * registry staleness rather than a projection mismatch. Two workers were fooled by exactly that.
 */
const WATCHER_RELOAD_MS = 6000;

interface VersionRow {
  version: number;
  description: string;
  tree_hash: string | null;
  snapshot: string;
  id: number;
}

describe('cpm create records what it wrote (Streamable HTTP)', () => {
  let proc: ChildProcess | null = null;
  let client: StreamableHttpMcpClient | null = null;
  let workspace = '';
  let requestId = 1;

  const callTool = async (
    name: string,
    args: Record<string, unknown>
  ): Promise<{ isError: boolean; text: string }> => {
    if (!client) throw new Error('client not initialized');
    const result = (await client.request('tools/call', { name, arguments: args }, ++requestId)) as {
      isError?: boolean;
      content?: Array<{ text?: string }>;
    };
    return {
      isError: result.isError === true,
      text: (result.content ?? []).map((part) => part.text ?? '').join('\n'),
    };
  };

  const cpm = (...args: string[]): { status: number; stdout: string; stderr: string } => {
    const run = spawnSync('node', [CPM_ENTRY, ...args, '-w', workspace, '--json'], {
      env: buildServerEnv({
        HOME: workspace,
        MCP_WORKSPACE: workspace,
        MCP_RUNTIME_ROOT: workspace,
        // Both sides derive the tenant from `CLAUDE_PROJECT_DIR` → cwd. The server runs from
        // `<repo>/server`; point the CLI at the same directory or it writes a different tenant.
        CLAUDE_PROJECT_DIR: SERVER_ROOT,
      }),
      cwd: workspace,
      encoding: 'utf8',
    });
    return { status: run.status ?? -1, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
  };

  const createJson = (...args: string[]): Record<string, unknown> => {
    const run = cpm(...args);
    if (run.status !== 0) throw new Error(`cpm ${args.join(' ')}: ${run.stderr || run.stdout}`);
    return JSON.parse(run.stdout) as Record<string, unknown>;
  };

  const historyRows = (type: string, id: string): VersionRow[] => {
    const db = new DatabaseSync(path.join(workspace, 'runtime-state', 'state.db'));
    const rows = db
      .prepare(
        `SELECT id, version, description, tree_hash, snapshot FROM version_history
         WHERE resource_type = ? AND resource_id = ? ORDER BY version`
      )
      .all(type, id) as unknown as VersionRow[];
    db.close();
    return rows;
  };

  const treeEntries = (rowId: number): Array<{ path: string; object_hash: string }> => {
    const db = new DatabaseSync(path.join(workspace, 'runtime-state', 'state.db'));
    const entries = db
      .prepare(`SELECT path, object_hash FROM version_entries WHERE version_row_id = ?`)
      .all(rowId) as unknown as Array<{ path: string; object_hash: string }>;
    db.close();
    return entries;
  };

  beforeAll(async () => {
    const port = await getAvailablePort();
    const baseUrl = `http://localhost:${port}`;
    workspace = await mkdtemp(path.join(tmpdir(), 'cli-create-records-ws-'));
    proc = startServerWithHttp(port, {
      transport: 'streamable-http',
      env: { MCP_WORKSPACE: workspace, MCP_RUNTIME_ROOT: workspace },
    });
    await waitForHealth(baseUrl, { timeout: 20000, interval: 200 });
    client = new StreamableHttpMcpClient(baseUrl);
    await client.initialize();
  }, 120000);

  afterAll(async () => {
    if (proc) await killServer(proc);
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  it.each([
    ['gate', 'gates', 'gate.yaml'],
    ['framework', 'frameworks', 'framework.yaml'],
  ])('records a created %s as version 1, describing the bytes on disk', (type, plural) => {
    const id = `created_${type}`;
    const reply = createJson('create', type, id, '--name', `N ${id}`, '--description', `D ${id}`);

    expect(reply['recorded']).toBe(true);
    expect(reply['version']).toBe(1);
    expect(reply['not_recorded_reason']).toBeUndefined();

    const rows = historyRows(type, id);
    expect(rows).toHaveLength(1);
    // The same sentence `resource_manager create` writes — one owner, `CREATE_ROW_DESCRIPTION`.
    expect(rows[0]!.description).toBe('Created via resource_manager');
    expect(rows[0]!.tree_hash).toMatch(/^sha256:/);

    // The row's VALUE, not just its existence: the snapshot must be the state the create wrote,
    // which is what a later rollback restores. A row carrying an empty or pre-write projection
    // would satisfy every assertion above.
    const snapshot = JSON.parse(rows[0]!.snapshot) as Record<string, unknown>;
    expect(snapshot['id']).toBe(id);
    expect(snapshot['name']).toBe(`N ${id}`);
    expect(snapshot['description']).toBe(`D ${id}`);

    const entries = treeEntries(rows[0]!.id);
    // The entry file AND its companion, not just the one `cpm` happened to write last.
    expect(entries.map((entry) => entry.path).sort()).toEqual(
      type === 'gate' ? ['gate.yaml', 'guidance.md'] : ['framework.yaml', 'system-prompt.md']
    );
    expect(path.join(workspace, 'resources', plural, id)).toBe(reply['path']);
  });

  it.each([
    ['gate', 'gate.yaml'],
    ['framework', 'framework.yaml'],
  ])('hashes each recorded %s file from the file itself', async (type, entryFile) => {
    const id = `created_${type}`;
    const root = path.join(workspace, 'resources', `${type}s`, id);
    const rows = historyRows(type, id);
    const entries = treeEntries(rows[0]!.id);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.object_hash).toBe(hashBytes(await readFile(path.join(root, entry.path))));
    }
    // The control that the files are the ones the create wrote, not an empty pair.
    expect((await readFile(path.join(root, entryFile), 'utf8')).length).toBeGreaterThan(50);
  });

  it('says in --json and in the text that a created prompt recorded nothing, and why', () => {
    const reply = createJson('create', 'prompt', 'created_prompt', '--name', 'P');
    expect(reply['recorded']).toBe(false);
    // The VALUE, not just the presence of a key: the reason must name the measured blocker, or a
    // future non-record could inherit a stale sentence and still pass.
    expect(String(reply['not_recorded_reason'])).toContain('+59.0 KB');
    expect(historyRows('prompt', 'created_prompt')).toEqual([]);

    // The same fact on the human path — an operator not passing `--json` must not be the one
    // person who cannot tell.
    const text = spawnSync(
      'node',
      [CPM_ENTRY, 'create', 'prompt', 'text_prompt', '-w', workspace],
      {
        env: buildServerEnv({
          HOME: workspace,
          MCP_WORKSPACE: workspace,
          MCP_RUNTIME_ROOT: workspace,
          CLAUDE_PROJECT_DIR: SERVER_ROOT,
        }),
        cwd: workspace,
        encoding: 'utf8',
      }
    );
    expect(text.stdout).toContain('No version was recorded');
    expect(text.stdout).toContain('+59.0 KB');
  });

  it('says a created style records nothing because styles carry no history', () => {
    const reply = createJson('create', 'style', 'created_style', '--name', 'S');
    expect(reply['recorded']).toBe(false);
    expect(String(reply['not_recorded_reason'])).toContain('no version history');
  });

  it('lets the server edit a cpm-created gate without a bridge row, and bridges when the file moved', async () => {
    // The parity assertion. A bridge row appears exactly when the newest recorded snapshot does
    // not hash-equal the server's live projection, so its ABSENCE here is the statement that
    // `cpm`'s create snapshot and the server's projection of the same resource are the same
    // value — measured through both real writers rather than compared in-process.
    createJson('create', 'gate', 'parity_gate', '--name', 'Parity', '--description', 'D1');
    createJson('create', 'gate', 'control_gate', '--name', 'Control', '--description', 'D1');

    // The control differs in ONE thing: its gate.yaml is edited outside both writers first.
    const controlYaml = path.join(workspace, 'resources', 'gates', 'control_gate', 'gate.yaml');
    const before = await readFile(controlYaml, 'utf8');
    // A PROJECTED field, deliberately: the snapshot carries `name`, and an out-of-band change to
    // a field the projection drops (`severity`, measured) would leave the hashes equal and the
    // control would not fire — a control that does not differ in what the probe measures is not
    // a control.
    expect(before).toContain('name: Control');
    await writeFile(controlYaml, before.replace('name: Control', 'name: Control OOB'), 'utf8');

    await new Promise((resolve) => setTimeout(resolve, WATCHER_RELOAD_MS));

    for (const id of ['parity_gate', 'control_gate']) {
      const updated = await callTool('resource_manager', {
        resource_type: 'gate',
        action: 'update',
        id,
        description: 'D2',
      });
      expect(updated.isError).toBe(false);
    }

    const parity = historyRows('gate', 'parity_gate').map((row) => row.description);
    const control = historyRows('gate', 'control_gate').map((row) => row.description);

    expect(parity).toEqual(['Created via resource_manager', 'Update via resource_manager']);
    expect(control[1]).toContain('Bridge:');
    expect(control).toHaveLength(3);
  }, 120000);
});
