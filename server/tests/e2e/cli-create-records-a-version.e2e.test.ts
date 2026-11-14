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
 * is edited out of band before the server's edit — where an extra row does appear: the running
 * server's watcher versions the hand edit (R5), which it does only because its projection of the
 * moved file differs from the row `cpm` wrote. Without it, "no extra row" would also be satisfied
 * by a server that recorded nothing at all.
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

import { projectResourceSnapshot } from '../../src/cli-shared/resource-snapshot.js';
import { recordResourceWrite } from '../../src/cli-shared/version-history.js';
import { updateRowDescription } from '../../src/modules/versioning/snapshot-contract.js';
import { hashBytes } from '../../src/shared/utils/hash.js';
import { resourceFileSet } from '../../src/shared/utils/resource-file-set.js';
import { loadYamlFileSync } from '../../src/shared/utils/yaml/yaml-file-loader.js';
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

  /**
   * Waits until the watcher has recorded an out-of-band edit. The observer debounces by 1 s, so a
   * tool write that lands first would bridge instead and the row under test would never exist;
   * the control case asserts the watcher's row, so it waits for that row rather than a clock.
   */
  const waitForHistoryRows = async (
    type: string,
    id: string,
    count: number,
    timeoutMs = 10000
  ): Promise<void> => {
    const deadline = Date.now() + timeoutMs;
    while (historyRows(type, id).length < count && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  /**
   * The control invariant: an out-of-band edit is captured exactly once, by whichever writer saw
   * it first. The running server's watcher records it as `Update via filesystem` when its 1 s
   * debounce fires before the tool write; otherwise the versioning service bridges it as
   * `Bridge: prior live state`. Which one wins is timing (a loaded runner flips it), so the
   * assertion is on the row's VALUE — the snapshot carries the edited `name` — not its label.
   */
  const expectOobCapturedOnce = (rows: VersionRow[]): void => {
    expect(rows).toHaveLength(3);
    expect(rows[0]!.description).toBe('Created via cpm');
    expect(rows[1]!.description).toMatch(/^(Update via filesystem|Bridge: prior live state)/);
    expect((JSON.parse(rows[1]!.snapshot) as Record<string, unknown>)['name']).toBe('Control OOB');
    expect(rows[2]!.description).toBe('Update via resource_manager');
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
    // One owner for the sentence, parameterised by SURFACE: a row `cpm` wrote names `cpm`, and
    // `resource_manager`'s own rows are unchanged. Naming the other surface is a plain untruth in
    // the only prose `cpm history` shows about what produced a row.
    expect(rows[0]!.description).toBe('Created via cpm');
    expect(rows[0]!.tree_hash).toMatch(/^sha256:/);

    // The row's VALUE, not just its existence: the snapshot must be the state the create wrote,
    // which is what a later rollback restores. A row carrying an empty or pre-write projection
    // would satisfy every assertion above.
    const snapshot = JSON.parse(rows[0]!.snapshot) as Record<string, unknown>;
    expect(snapshot['id']).toBe(id);
    expect(snapshot['name']).toBe(`N ${id}`);
    expect(snapshot['description']).toBe(`D ${id}`);

    const entries = treeEntries(rows[0]!.id);
    // Every file the create wrote, not just the one `cpm` happened to write last. A framework
    // has no companion: its system prompt is the inline `systemPromptGuidance` (R91).
    expect(entries.map((entry) => entry.path).sort()).toEqual(
      type === 'gate' ? ['gate.yaml', 'guidance.md'] : ['framework.yaml']
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

  it('records a created prompt as version 1, with the RESOLVED template in the snapshot', () => {
    const reply = createJson(
      'create',
      'prompt',
      'created_prompt',
      '--name',
      'P',
      '--description',
      'D prompt'
    );
    expect(reply['recorded']).toBe(true);
    expect(reply['version']).toBe(1);
    expect(reply['not_recorded_reason']).toBeUndefined();
    // The negative half of the degraded path, stated as a value: a prompt the loader served has
    // nothing to warn about, so the key must be absent rather than present-and-empty.
    expect(reply['snapshot_degraded_reason']).toBeUndefined();

    const rows = historyRows('prompt', 'created_prompt');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.description).toBe('Created via cpm');
    expect(rows[0]!.tree_hash).toMatch(/^sha256:/);

    // The VALUE a raw-YAML projection could not have produced. `cpm`'s scaffold writes the body
    // to a companion file and `prompt.yaml` carries only `userMessageTemplateFile`, so a snapshot
    // holding the resolved template is the observable that the loader-backed projection ran.
    const snapshot = JSON.parse(rows[0]!.snapshot) as Record<string, unknown>;
    expect(snapshot['userMessageTemplateFile']).toBeUndefined();
    expect(typeof snapshot['userMessageTemplate']).toBe('string');
    expect(String(snapshot['userMessageTemplate']).length).toBeGreaterThan(0);
    expect(snapshot['description']).toBe('D prompt');
  });

  it('records a cpm link-gate and a cpm unlink-gate, and refuses a no-op without a row', () => {
    createJson('create', 'prompt', 'linked_prompt', '--name', 'L', '--description', 'D');
    createJson('create', 'gate', 'link_target', '--name', 'LT', '--description', 'D');

    const linked = createJson('link-gate', 'linked_prompt', 'link_target');
    expect(linked['recorded']).toBe(true);
    expect(linked['version']).toBe(2);
    expect(linked['action']).toBe('added');

    const unlinked = createJson('link-gate', 'linked_prompt', 'link_target', '--remove');
    expect(unlinked['recorded']).toBe(true);
    expect(unlinked['version']).toBe(3);

    const rows = historyRows('prompt', 'linked_prompt');
    expect(rows.map((row) => row.description)).toEqual([
      'Created via cpm',
      'Update via cpm',
      'Update via cpm',
    ]);
    // The row's VALUE: v2 must carry the link and v3 must not. A pair of rows recording the same
    // state would satisfy the count above.
    const gatesAt = (version: number): unknown =>
      (JSON.parse(rows[version - 1]!.snapshot) as Record<string, unknown>)['gateConfiguration'];
    expect(JSON.stringify(gatesAt(2))).toContain('link_target');
    expect(gatesAt(3)).toBeUndefined();

    // A no-op is refused before the table is reached, so it writes neither a file nor a row.
    const noop = cpm('link-gate', 'linked_prompt', 'link_target', '--remove');
    expect(noop.status).toBe(1);
    expect(`${noop.stdout}${noop.stderr}`).toContain('not linked');
    expect(historyRows('prompt', 'linked_prompt')).toHaveLength(3);
  });

  it('lets the server edit a cpm-created PROMPT without a bridge row, and captures the out-of-band edit once, by whichever writer saw it first', async () => {
    // The prompt half of the parity assertion below. The observable is the same: a bridge row
    // appears exactly when the server's live projection does not hash-equal the newest recorded
    // snapshot, so its absence says `cpm`'s loader-backed projection and the server's are one
    // value — measured through both real writers.
    createJson('create', 'prompt', 'parity_prompt', '--name', 'Parity', '--description', 'D1');
    createJson('create', 'prompt', 'control_prompt', '--name', 'Control', '--description', 'D1');

    // The control differs in ONE thing: a PROJECTED field of its prompt.yaml, changed out of band.
    const controlYaml = path.join(
      workspace,
      'resources',
      'prompts',
      'general',
      'control_prompt',
      'prompt.yaml'
    );
    const before = await readFile(controlYaml, 'utf8');
    expect(before).toContain('name: Control');
    await writeFile(controlYaml, before.replace('name: Control', 'name: Control OOB'), 'utf8');

    await new Promise((resolve) => setTimeout(resolve, WATCHER_RELOAD_MS));
    await waitForHistoryRows('prompt', 'control_prompt', 2);

    for (const id of ['parity_prompt', 'control_prompt']) {
      const updated = await callTool('resource_manager', {
        resource_type: 'prompt',
        action: 'update',
        id,
        description: 'D2',
      });
      expect(updated.isError).toBe(false);
    }

    expect(historyRows('prompt', 'parity_prompt').map((row) => row.description)).toEqual([
      'Created via cpm',
      'Update via resource_manager',
    ]);
    // The extra row exists only because the projection of the moved file differs from the row
    // `cpm` wrote; the parity twin has no such row, which says the two projections of the unmoved
    // file are one value.
    expectOobCapturedOnce(historyRows('prompt', 'control_prompt'));
  }, 120000);

  it('says a created style records nothing because styles carry no history', () => {
    const reply = createJson('create', 'style', 'created_style', '--name', 'S');
    expect(reply['recorded']).toBe(false);
    expect(String(reply['not_recorded_reason'])).toContain('no version history');
  });

  it('lets the server edit a cpm-created gate without a bridge row, and captures the out-of-band edit once, by whichever writer saw it first', async () => {
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
    await waitForHistoryRows('gate', 'control_gate', 2);

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

    expect(parity).toEqual(['Created via cpm', 'Update via resource_manager']);
    expectOobCapturedOnce(historyRows('gate', 'control_gate'));
  }, 120000);

  it("records one version for a cpm write the running server watches, under cpm's description", async () => {
    // One write is one version (R5). `cpm link-gate` writes the file and then its own row; the
    // watcher sees the same bytes while the catalog still serves the state before them. A watcher
    // that compared only against the catalog recorded a bridge of that stale state and a second
    // row for the bytes `cpm` had already recorded — measured on this branch, `Rollback to v1`
    // followed by `Bridge:` and `Update via filesystem`.
    createJson('create', 'prompt', 'watched_prompt', '--name', 'W', '--description', 'D');
    createJson('create', 'gate', 'watched_gate', '--name', 'WG', '--description', 'D');
    // Served first, so the write below is an UPDATE of a resource the catalog holds.
    await new Promise((resolve) => setTimeout(resolve, WATCHER_RELOAD_MS));

    const linked = createJson('link-gate', 'watched_prompt', 'watched_gate');
    expect(linked['recorded']).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, WATCHER_RELOAD_MS));

    expect(historyRows('prompt', 'watched_prompt').map((row) => row.description)).toEqual([
      'Created via cpm',
      'Update via cpm',
    ]);
    // The control that the watcher saw this file at all: the server serves the linked state.
    const inspected = await callTool('resource_manager', {
      resource_type: 'prompt',
      action: 'inspect',
      id: 'watched_prompt',
    });
    expect(inspected.text).toContain('watched_gate');
  }, 120000);

  /**
   * `cpm`'s own write path — `recordResourceWrite`, which every `cpm` command that edits a resource
   * calls — run in this process, so its row can be held back. The seam is the `write` callback the
   * command supplies: it returns the produced state, and the row is appended only after it does.
   * Run against the server's `state.db` under the tenant `cpm` resolves, with the variables the
   * binary is spawned with above.
   */
  const cpmWrite = async (
    id: string,
    hold: (write: () => Promise<void>) => Promise<void>
  ): Promise<Awaited<ReturnType<typeof recordResourceWrite>>> => {
    const gatesRoot = path.join(workspace, 'resources', 'gates');
    const entryPath = path.join(gatesRoot, id, 'gate.yaml');
    const project = async (): Promise<Record<string, unknown>> => {
      const declared = loadYamlFileSync<Record<string, unknown>>(entryPath) ?? {};
      return (await projectResourceSnapshot('gate', id, entryPath, declared)).snapshot;
    };
    const before = await readFile(entryPath, 'utf8');
    const cliEnv: Record<string, string> = {
      MCP_WORKSPACE: workspace,
      MCP_RUNTIME_ROOT: workspace,
      CLAUDE_PROJECT_DIR: SERVER_ROOT,
    };
    const saved = Object.fromEntries(Object.keys(cliEnv).map((key) => [key, process.env[key]]));
    Object.assign(process.env, cliEnv);
    try {
      return await recordResourceWrite(
        entryPath,
        { resourceType: 'gate', resourceId: id },
        {
          enumerate: () =>
            resourceFileSet({ resourceType: 'gate', entryPath, roots: { primary: gatesRoot } }),
          targets: [{ path: entryPath, kind: 'file' }],
          priorSnapshot: await project(),
          write: async () => {
            await hold(() => writeFile(entryPath, before.replace(/^name: .*$/m, 'name: Edited')));
            return await project();
          },
          description: updateRowDescription('cpm'),
        }
      );
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  };

  it("names a cpm write after cpm even when the watcher's row for the same bytes lands first", async () => {
    // One write is one version, under the name of the command that made it (R5). The watcher
    // debounces by 1 s, so `cpm`'s row normally lands first and the watcher skips the identical
    // bytes (the CONTROL below). Here `cpm`'s row is held until the watcher has recorded the
    // bytes: `cpm` then renames that identical newest row instead of skipping it.
    createJson('create', 'gate', 'late_gate', '--name', 'Late', '--description', 'D');
    createJson('create', 'gate', 'prompt_gate', '--name', 'Prompt', '--description', 'D');
    // Served first, so each write below is an UPDATE the watcher records against the catalog.
    await new Promise((resolve) => setTimeout(resolve, WATCHER_RELOAD_MS));

    const late = await cpmWrite('late_gate', async (write) => {
      await write();
      await waitForHistoryRows('gate', 'late_gate', 2);
      // The order under test: the watcher's row is there before `cpm` appends its own.
      expect(historyRows('gate', 'late_gate').map((row) => row.description)).toEqual([
        'Created via cpm',
        'Update via filesystem',
      ]);
    });
    expect(late).toEqual(expect.objectContaining({ written: true, recorded: true, version: 2 }));
    expect(historyRows('gate', 'late_gate').map((row) => row.description)).toEqual([
      'Created via cpm',
      'Update via cpm',
    ]);
    expect(JSON.parse(historyRows('gate', 'late_gate')[1]!.snapshot)['name']).toBe('Edited');

    // CONTROL: the same seam, not held — `cpm`'s row lands first and the watcher adds nothing.
    const prompt = await cpmWrite('prompt_gate', (write) => write());
    expect(prompt).toEqual(expect.objectContaining({ written: true, recorded: true, version: 2 }));
    await new Promise((resolve) => setTimeout(resolve, WATCHER_RELOAD_MS));
    expect(historyRows('gate', 'prompt_gate').map((row) => row.description)).toEqual([
      'Created via cpm',
      'Update via cpm',
    ]);
  }, 120000);

  it('rolls a SERVER-written prompt back from cpm with no bridge row, and records the file when it moved', async () => {
    /**
     * The other direction of parity, and the one an operator actually hits: the SERVER wrote the
     * rows and `cpm` is the one reading them. `cpm rollback` records the state it is replacing,
     * and bridges it when the newest recorded snapshot does not hash-equal what `cpm` projects
     * from disk — so no bridge row here says `cpm`'s projection of a server-written prompt IS the
     * server's own. Before the shared prompt projection landed, every one of these bridged.
     *
     * The control differs in ONE thing: a PROJECTED field of its prompt.yaml is edited out of
     * band between the server's two writes, so the state `cpm` projects genuinely is unrecorded
     * and the bridge row must appear.
     */
    for (const id of ['server_prompt', 'server_control']) {
      const created = await callTool('resource_manager', {
        resource_type: 'prompt',
        action: 'create',
        id,
        name: `N ${id}`,
        description: 'S1',
        user_message_template: 'Handle {{input}}.',
      });
      expect(created.isError).toBe(false);
      const updated = await callTool('resource_manager', {
        resource_type: 'prompt',
        action: 'update',
        id,
        description: 'S2',
      });
      expect(updated.isError).toBe(false);
    }

    expect(historyRows('prompt', 'server_prompt').map((row) => row.description)).toEqual([
      'Created via resource_manager',
      'Update via resource_manager',
    ]);

    // `cpm history` must SEE those rows — the read half, through the built binary.
    const history = createJson('history', 'prompt', 'server_prompt') as {
      versions?: Array<{ version: number }>;
    };
    expect([...(history.versions ?? [])].map((row) => row.version).sort()).toEqual([1, 2]);

    // A preview writes nothing: no file changes and no row appears.
    const promptYaml = path.join(
      workspace,
      'resources',
      'prompts',
      'general',
      'server_prompt',
      'prompt.yaml'
    );
    const beforePreview = await readFile(promptYaml, 'utf8');
    const preview = createJson('rollback', 'prompt', 'server_prompt', '1', '--preview');
    expect(preview['preview']).toBe(true);
    expect(await readFile(promptYaml, 'utf8')).toBe(beforePreview);
    expect(historyRows('prompt', 'server_prompt')).toHaveLength(2);

    // The control's file moves out of band, on a PROJECTED field.
    const controlYaml = path.join(
      workspace,
      'resources',
      'prompts',
      'general',
      'server_control',
      'prompt.yaml'
    );
    const controlBefore = await readFile(controlYaml, 'utf8');
    expect(controlBefore).toContain('description: S2');
    await writeFile(
      controlYaml,
      controlBefore.replace('description: S2', 'description: OOB'),
      'utf8'
    );

    createJson('rollback', 'prompt', 'server_prompt', '1');
    createJson('rollback', 'prompt', 'server_control', '1');

    // Exactly one row added, and it is the restored state — not a bridge.
    const rolled = historyRows('prompt', 'server_prompt').map((row) => row.description);
    expect(rolled).toHaveLength(3);
    expect(rolled[2]).toContain('Rollback to v1');
    expect(rolled.some((description) => description.includes('Bridge:'))).toBe(false);

    // The control: exactly one row records the moved file, and it sits before the rollback row.
    // Which writer records it depends on timing and both are correct — `cpm`'s bridge when the
    // rollback runs first, the running server's watcher (R5) when its debounce fires first — so
    // the assertion is on the row's VALUE, the out-of-band description, not on its label.
    const controlRows = historyRows('prompt', 'server_control');
    const control = controlRows.map((row) => row.description);
    expect(control).toHaveLength(4);
    expect(control[3]).toContain('Rollback to v1');
    expect((JSON.parse(controlRows[2]!.snapshot) as Record<string, unknown>)['description']).toBe(
      'OOB'
    );
    expect(
      control.filter(
        (description) => description.includes('Bridge:') || description === 'Update via filesystem'
      )
    ).toHaveLength(1);
  }, 120000);
});
