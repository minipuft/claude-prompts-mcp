/**
 * `cpm toggle` records the state the flip produced, and that record is rollback-exact.
 *
 * A toggle is an EDIT, so unlike a create it carries a prior-state row: the bytes before the flip
 * may never have been recorded. The two claims here are the ones an operator can act on —
 *
 *  - the row describes the state AFTER the flip (`enabled` is the new value), and carries the
 *    bytes on disk, so `cpm rollback` to the version before it returns every value and comment
 *    (the bytes differ by one blank line — see the round-trip test, where the bound is asserted);
 *  - no bridge row appears when the prior state WAS the newest recorded row, which is the
 *    observable form of "the CLI's projection and the server's are the same value". The positive
 *    control is a twin whose framework.yaml is edited out of band first, where one does appear.
 *
 * Through the BUILT binary against a hermetic server's `state.db`, because the parity claim is
 * about two real writers of one file.
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DatabaseSync } from 'node:sqlite';

import { parseYamlOrThrow } from '../../src/shared/utils/yaml/index.js';
import { buildServerEnv } from './helpers/child-env.js';
import {
  getAvailablePort,
  killServer,
  startServerWithHttp,
  waitForHealth,
} from './helpers/http-mcp-client.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const CPM_ENTRY = path.join(SERVER_ROOT, 'dist', 'cpm.js');

interface Row {
  version: number;
  description: string;
  tree_hash: string | null;
  snapshot: string;
}

describe('cpm toggle records what it flipped (Streamable HTTP)', () => {
  let proc: ChildProcess | null = null;
  let workspace = '';

  const cpm = (...args: string[]): { status: number; stdout: string; stderr: string } => {
    const run = spawnSync('node', [CPM_ENTRY, ...args, '-w', workspace, '--json'], {
      env: buildServerEnv({
        HOME: workspace,
        MCP_WORKSPACE: workspace,
        MCP_RUNTIME_ROOT: workspace,
        CLAUDE_PROJECT_DIR: SERVER_ROOT,
      }),
      cwd: workspace,
      encoding: 'utf8',
    });
    return { status: run.status ?? -1, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
  };

  const json = (...args: string[]): Record<string, unknown> => {
    const run = cpm(...args);
    if (run.status !== 0) throw new Error(`cpm ${args.join(' ')}: ${run.stderr || run.stdout}`);
    return JSON.parse(run.stdout) as Record<string, unknown>;
  };

  const rows = (type: string, id: string): Row[] => {
    const db = new DatabaseSync(path.join(workspace, 'runtime-state', 'state.db'));
    const all = db
      .prepare(
        `SELECT version, description, tree_hash, snapshot FROM version_history
         WHERE resource_type = ? AND resource_id = ? ORDER BY version`
      )
      .all(type, id) as unknown as Row[];
    db.close();
    return all;
  };

  const frameworkYaml = (id: string): string =>
    path.join(workspace, 'resources', 'frameworks', id, 'framework.yaml');

  beforeAll(async () => {
    const port = await getAvailablePort();
    workspace = await mkdtemp(path.join(tmpdir(), 'cli-toggle-records-ws-'));
    proc = startServerWithHttp(port, {
      transport: 'streamable-http',
      env: { MCP_WORKSPACE: workspace, MCP_RUNTIME_ROOT: workspace },
    });
    await waitForHealth(`http://localhost:${port}`, { timeout: 20000, interval: 200 });
  }, 120000);

  afterAll(async () => {
    if (proc) await killServer(proc);
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  it('records the flipped state, with the new enabled value and the bytes on disk', () => {
    json('create', 'framework', 'flipme', '--name', 'Flip', '--description', 'D');
    const created = rows('framework', 'flipme');
    expect(created).toHaveLength(1);
    const before = JSON.parse(created[0]!.snapshot) as Record<string, unknown>;

    const reply = json('toggle', 'framework', 'flipme');
    expect(reply['recorded']).toBe(true);
    expect(reply['version']).toBe(2);

    const after = rows('framework', 'flipme');
    expect(after).toHaveLength(2);
    expect(after[1]!.description).toBe('Update via resource_manager');
    expect(after[1]!.tree_hash).toMatch(/^sha256:/);

    // The VALUE the flip produced, not merely that a second row exists: a row recording the
    // pre-flip projection would also be a second row.
    const recorded = JSON.parse(after[1]!.snapshot) as Record<string, unknown>;
    expect(recorded['enabled']).toBe(reply['newValue']);
    expect(recorded['enabled']).not.toBe(before['enabled']);
  });

  it('rolls the framework back to its pre-toggle values, comments included', async () => {
    json('create', 'framework', 'roundtrip', '--name', 'Round', '--description', 'D');
    const original = await readFile(frameworkYaml('roundtrip'), 'utf8');

    json('toggle', 'framework', 'roundtrip');
    const flipped = await readFile(frameworkYaml('roundtrip'), 'utf8');
    // The control for the round trip: the toggle really changed the file.
    expect(flipped).not.toBe(original);

    json('rollback', 'framework', 'roundtrip', '1');
    const restored = await readFile(frameworkYaml('roundtrip'), 'utf8');

    // Every VALUE is back, comments included — that is the claim, and it is asserted as the
    // parsed document rather than as bytes because a rollback that restored the right values
    // while stripping a comment would pass a value-only check.
    expect(parseYamlOrThrow<Record<string, unknown>>(restored)).toEqual(
      parseYamlOrThrow<Record<string, unknown>>(original)
    );
    expect(restored).toContain('# phasesFile: phases.yaml');

    // The bytes are NOT identical, and the difference is bounded rather than waved away:
    // `serializeYamlPreservingSource` drops one blank line after the key it rewrote (measured
    // 2026-09-21, on the line after `enabled:`). Every non-blank line must still match, so a real
    // content change fails here.
    const significant = (text: string): string[] =>
      text.split('\n').filter((line) => line.trim() !== '');
    expect(significant(restored)).toEqual(significant(original));
  });

  it('writes no bridge row on a toggle, and does write one when the file moved out of band', async () => {
    json('create', 'framework', 'parity_fw', '--name', 'Parity', '--description', 'D');
    json('create', 'framework', 'control_fw', '--name', 'Control', '--description', 'D');

    // The control differs in ONE thing: a PROJECTED field of its entry file is changed by neither
    // writer before the toggle. `description` is projected; a field the projection drops would
    // leave the hashes equal and the control would never fire.
    const controlPath = frameworkYaml('control_fw');
    const before = await readFile(controlPath, 'utf8');
    expect(before).toContain('description:');
    await writeFile(controlPath, before.replace(/description: .*/, 'description: OOB'), 'utf8');

    json('toggle', 'framework', 'parity_fw');
    json('toggle', 'framework', 'control_fw');

    expect(rows('framework', 'parity_fw').map((row) => row.description)).toEqual([
      'Created via resource_manager',
      'Update via resource_manager',
    ]);
    const control = rows('framework', 'control_fw').map((row) => row.description);
    expect(control[1]).toContain('Bridge:');
    expect(control).toHaveLength(3);
  });

  it('says a toggled style recorded nothing, because styles carry no history', () => {
    json('create', 'style', 'styleme', '--name', 'S');
    const reply = json('toggle', 'style', 'styleme');
    expect(reply['recorded']).toBe(false);
    expect(String(reply['not_recorded_reason'])).toContain('no version history');
    expect(rows('style', 'styleme')).toEqual([]);
  });
});
