/**
 * `cpm rollback` restores the recorded BYTES, previews exactly what it applies, and refuses rather
 * than restoring something else — driven through the BUILT `cpm` binary.
 *
 * WHY THE BINARY AND NOT THE FUNCTION. The previous worker on this arc measured the cost of not
 * doing so: every parity case called `rollbackVersion` directly, so the command's own wiring was
 * unpinned and two mutants that deleted it came back green. A command is the thing an operator
 * runs; a function it forgets to call is not.
 *
 * WHY THE FIXTURE BYTES ARE HAND-WRITTEN, AND WHY ONE OF THEM IS INVALID UTF-8. A fixture the
 * writer produced can only prove idempotence. A BOM, CRLF and a non-ASCII character look hostile
 * and are not: all three survive a `Buffer.toString('utf8')` round trip unchanged, so a restore
 * that decoded and re-encoded would pass a fixture built only from them — measured on this arc,
 * as a mutation that came back green. `0x80` is a continuation byte with no lead, so nothing but a
 * verbatim write puts it back.
 *
 * WHY A SERVER IS BOOTED AT ALL. A tree-backed row has to exist before a rollback can target one,
 * and `cpm create` records no version for a PROMPT (the prompt projection does not fit the CLI
 * bundle). The server writes the rows; `cpm` does every rollback under test.
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DatabaseSync } from 'node:sqlite';

import { hashBytes } from '../../src/shared/utils/hash.js';
import { STATE_DB_WRITER_PRAGMAS } from '../../src/shared/utils/runtime-state-location.js';
import { parseYamlOrThrow } from '../../src/shared/utils/yaml/index.js';
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

/** See the header: the last byte is what a text round trip cannot carry. */
const HAND_AUTHORED_BODY = Buffer.concat([
  Buffer.from('﻿Template — café ☕\r\n\r\nTrailing space \r\n', 'utf8'),
  Buffer.from([0x80]),
  Buffer.from('\r\nEnd.\r\n', 'utf8'),
]);

interface CpmRun {
  status: number;
  stdout: string;
  stderr: string;
  json: Record<string, unknown> | undefined;
}

describe('cpm rollback restores recorded bytes (built binary)', () => {
  let proc: ChildProcess | null = null;
  let client: StreamableHttpMcpClient | null = null;
  let workspace = '';
  let requestId = 1;

  // Measured once in `beforeAll`, asserted per case: one boot and one `cpm` run each.
  let promptRun: CpmRun;
  let promptBodyAfter: Buffer;
  let promptExtraToolExists = false;
  let promptSiblingBefore: Buffer;
  let promptSiblingAfter: Buffer;
  let promptRecordedSnapshot: Record<string, unknown> = {};

  let gatePreview: CpmRun;
  let gateApply: CpmRun;
  let gateTreeBeforePreview: Record<string, string> = {};
  let gateTreeAfterPreview: Record<string, string> = {};

  let projectionRun: CpmRun;
  let tamperedRun: CpmRun;
  let tamperedTreeUnchanged = false;
  let missingObjectRun: CpmRun;
  let missingObjectTreeUnchanged = false;

  const callTool = async (args: Record<string, unknown>): Promise<string> => {
    if (!client) throw new Error('client not initialized');
    const result = (await client.request(
      'tools/call',
      { name: 'resource_manager', arguments: args },
      ++requestId
    )) as { isError?: boolean; content?: Array<{ text?: string }> };
    const text = (result.content ?? []).map((part) => part.text ?? '').join('\n');
    if (result.isError === true) throw new Error(`resource_manager: ${text}`);
    return text;
  };

  /** The version an update's own receipt says it saved — the history table renders descriptions. */
  const savedVersion = (replyText: string): number => {
    const match = /Version\*{0,2}\s+\*{0,2}(\d+)/.exec(replyText);
    if (match?.[1] === undefined) throw new Error(`no version in receipt:\n${replyText}`);
    return Number(match[1]);
  };

  const cpm = (args: string[]): CpmRun => {
    const run = spawnSync('node', [CPM_ENTRY, ...args, '-w', workspace], {
      env: buildServerEnv({
        HOME: workspace,
        MCP_WORKSPACE: workspace,
        MCP_RUNTIME_ROOT: workspace,
        // `version_history` is tenant-scoped and both sides derive the tenant from
        // `CLAUDE_PROJECT_DIR` → cwd. The server runs from `<repo>/server`; point the CLI at the
        // same directory or it reads a different tenant and finds no version at all.
        CLAUDE_PROJECT_DIR: SERVER_ROOT,
      }),
      cwd: workspace,
      encoding: 'utf8',
    });
    const stdout = run.stdout ?? '';
    let json: Record<string, unknown> | undefined;
    try {
      json = JSON.parse(stdout) as Record<string, unknown>;
    } catch {
      json = undefined;
    }
    return { status: run.status ?? -1, stdout, stderr: run.stderr ?? '', json };
  };

  /** Every file under `dir`, keyed by relative path, digest as the value. */
  const treeOf = async (dir: string): Promise<Record<string, string>> => {
    const { readdir } = await import('node:fs/promises');
    const out: Record<string, string> = {};
    const walk = async (current: string): Promise<void> => {
      for (const entry of await readdir(current, { withFileTypes: true })) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) await walk(full);
        else
          out[path.relative(dir, full).split(path.sep).join('/')] = hashBytes(await readFile(full));
      }
    };
    await walk(dir);
    return out;
  };

  /**
   * A third opener of `state.db`, applying the same pragmas both real writers apply.
   *
   * `busy_timeout` is not optional here: the server holds the file and a connection without it
   * raises `database is locked` immediately rather than waiting — measured on the first run of
   * this suite. Reaching for the shared constant rather than restating a number is also what
   * keeps this opener honest about being one.
   */
  const openStateDb = (): DatabaseSync => {
    const db = new DatabaseSync(path.join(workspace, 'runtime-state', 'state.db'));
    for (const pragma of STATE_DB_WRITER_PRAGMAS) db.exec(pragma);
    return db;
  };

  const mutateDb = (sql: string, params: Array<string | number> = []): void => {
    const db = openStateDb();
    try {
      db.prepare(sql).run(...params);
    } finally {
      db.close();
    }
  };

  const exists = async (target: string): Promise<boolean> => {
    try {
      await stat(target);
      return true;
    } catch {
      return false;
    }
  };

  const seedGate = async (id: string): Promise<number> => {
    await callTool({
      resource_type: 'gate',
      action: 'create',
      id,
      name: `Probe ${id}`,
      description: 'V1-DESC',
      guidance: 'V1-GUIDANCE',
      type: 'validation',
    });
    const target = savedVersion(
      await callTool({ resource_type: 'gate', action: 'update', id, description: 'V2-DESC' })
    );
    await callTool({ resource_type: 'gate', action: 'update', id, description: 'V3-DESC' });
    return target;
  };

  const gateDir = (id: string): string => path.join(workspace, 'resources', 'gates', id);

  beforeAll(async () => {
    const port = await getAvailablePort();
    const baseUrl = `http://localhost:${port}`;
    workspace = await mkdtemp(path.join(tmpdir(), 'cpm-byte-rollback-ws-'));
    proc = startServerWithHttp(port, {
      transport: 'streamable-http',
      env: { MCP_WORKSPACE: workspace, MCP_RUNTIME_ROOT: workspace },
    });
    await waitForHealth(baseUrl, { timeout: 20000, interval: 200 });
    client = new StreamableHttpMcpClient(baseUrl);
    await client.initialize();

    await drivePrompt();
    await driveGatePreview();
    await driveProjectionOnly();
    await driveTamperedPath();
    await driveMissingObject();
  }, 180000);

  afterAll(async () => {
    if (proc) await killServer(proc);
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  // ── the byte path, the left-in-place rule, and the untouched sibling ────────

  async function drivePrompt(): Promise<void> {
    const id = 'cpm_byte_prompt';
    const dir = path.join(workspace, 'resources', 'prompts', 'general', id);
    await callTool({
      resource_type: 'prompt',
      action: 'create',
      id,
      category: 'general',
      name: 'CPM Byte Prompt',
      description: 'V1-DESC',
      user_message_template: 'V1-BODY',
      system_message: 'V1-SYS',
    });

    // Hand-authored, after the writer has had its say.
    await writeFile(path.join(dir, 'user-message.md'), HAND_AUTHORED_BODY);
    await writeToolDirectory(path.join(dir, 'tools', 'probe'), 'probe');

    // The watcher must have reloaded before the update runs. Without this wait the update's
    // post-write verification fails — it compares the refreshed registry against what it wrote,
    // and the registry still holds the body from before the hand write. That is the server
    // behaving correctly about a file edited behind its back, not a defect in the restore; the
    // previous worker on this arc was caught by the same staleness measuring bridge rows.
    await new Promise((resolve) => setTimeout(resolve, 6000));

    // A `description`-only update is scoped to `prompt.yaml`, so the row it records carries the
    // hand-authored body and the tool files exactly as written above.
    const target = savedVersion(
      await callTool({ resource_type: 'prompt', action: 'update', id, description: 'V2-DESC' })
    );

    promptSiblingBefore = await readFile(path.join(dir, 'system-message.md'));
    await writeFile(path.join(dir, 'user-message.md'), 'DESTROYED\n', 'utf8');
    // The tool script too, or it lands in `unchanged` and the P4.83 claim is asserted by a file
    // nothing had to restore.
    await writeFile(path.join(dir, 'tools', 'probe', 'probe.py'), 'print("destroyed")\n', 'utf8');
    await writeToolDirectory(path.join(dir, 'tools', 'extra'), 'extra');

    promptRun = cpm(['rollback', 'prompt', id, String(target), '--json']);

    promptBodyAfter = await readFile(path.join(dir, 'user-message.md'));
    promptExtraToolExists = await exists(path.join(dir, 'tools', 'extra', 'tool.yaml'));
    promptSiblingAfter = await readFile(path.join(dir, 'system-message.md'));

    const db = openStateDb();
    try {
      const row = db
        .prepare(
          `SELECT snapshot FROM version_history
           WHERE resource_type = 'prompt' AND resource_id = ?
           ORDER BY version DESC LIMIT 1`
        )
        .get(id) as { snapshot: string } | undefined;
      promptRecordedSnapshot = JSON.parse(row?.snapshot ?? '{}') as Record<string, unknown>;
    } finally {
      db.close();
    }
  }

  async function writeToolDirectory(dir: string, id: string): Promise<void> {
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, 'tool.yaml'),
      `# hand-authored tool\nid: ${id}\nname: ${id}\nscript: ${id}.py\nruntime: python\n`,
      'utf8'
    );
    await writeFile(path.join(dir, `${id}.py`), `print("${id}")\n`, 'utf8');
    await writeFile(path.join(dir, 'schema.json'), '{\n  "type": "object"\n}\n', 'utf8');
    await writeFile(path.join(dir, 'description.md'), `# ${id}\n`, 'utf8');
  }

  // ── preview equals apply, and writes nothing ───────────────────────────────

  async function driveGatePreview(): Promise<void> {
    const id = 'cpm_byte_gate';
    const target = await seedGate(id);
    gateTreeBeforePreview = await treeOf(gateDir(id));
    gatePreview = cpm(['rollback', 'gate', id, String(target), '--preview', '--json']);
    gateTreeAfterPreview = await treeOf(gateDir(id));
    gateApply = cpm(['rollback', 'gate', id, String(target), '--json']);
  }

  // ── a row with no tree still restores the old way ──────────────────────────

  async function driveProjectionOnly(): Promise<void> {
    const id = 'cpm_projection_gate';
    const target = await seedGate(id);
    // The shape a pre-v29 row has, produced the only way this database can produce it.
    mutateDb(
      `UPDATE version_history SET tree_hash = NULL, tree_origin = NULL
       WHERE resource_type = 'gate' AND resource_id = ? AND version = ?`,
      [id, target]
    );
    projectionRun = cpm(['rollback', 'gate', id, String(target), '--json']);
  }

  // ── the two refusals, driven at the COMMAND ────────────────────────────────

  async function driveTamperedPath(): Promise<void> {
    const id = 'cpm_tampered_gate';
    const target = await seedGate(id);
    const before = await treeOf(gateDir(id));
    mutateDb(
      `UPDATE version_entries SET path = '../../ESCAPED.yaml'
       WHERE version_row_id = (
         SELECT id FROM version_history
         WHERE resource_type = 'gate' AND resource_id = ? AND version = ?
       ) AND path = 'gate.yaml'`,
      [id, target]
    );
    tamperedRun = cpm(['rollback', 'gate', id, String(target), '--json']);
    tamperedTreeUnchanged = JSON.stringify(await treeOf(gateDir(id))) === JSON.stringify(before);
  }

  async function driveMissingObject(): Promise<void> {
    const id = 'cpm_missing_object_gate';
    const target = await seedGate(id);
    const before = await treeOf(gateDir(id));
    // `ON DELETE RESTRICT` refuses this on both of this repository's writers, so the state only
    // exists if a THIRD opener wrote with constraints off — design failure mode #2, and the only
    // way to reach the refusal at all.
    const db = openStateDb();
    try {
      db.exec('PRAGMA foreign_keys = OFF');
      db.prepare(
        `DELETE FROM objects WHERE hash IN (
           SELECT object_hash FROM version_entries WHERE version_row_id = (
             SELECT id FROM version_history
             WHERE resource_type = 'gate' AND resource_id = ? AND version = ?
           ) AND path = 'guidance.md'
         )`
      ).run(id, target);
    } finally {
      db.close();
    }
    missingObjectRun = cpm(['rollback', 'gate', id, String(target), '--json']);
    missingObjectTreeUnchanged =
      JSON.stringify(await treeOf(gateDir(id))) === JSON.stringify(before);
  }

  // ── assertions ─────────────────────────────────────────────────────────────

  it('restores a hand-written body byte for byte, invalid UTF-8 included', () => {
    expect(promptRun.status).toBe(0);
    // Digests computed here, from the bytes this test wrote and the bytes now on disk.
    expect(hashBytes(promptBodyAfter)).toBe(hashBytes(HAND_AUTHORED_BODY));
  });

  it("restores a prompt's script tool files — the P4.83 claim, on the CLI surface", () => {
    expect(promptRun.json?.['files_written']).toEqual(
      expect.arrayContaining(['user-message.md', 'tools/probe/probe.py'])
    );
  });

  it('keeps a file added after the target version, and names it', () => {
    // Positive control: `tools/extra/` was created AFTER the version was recorded, so it is
    // provably absent from that version's tree — which is exactly why a delete-on-restore would
    // have removed it.
    expect(promptExtraToolExists).toBe(true);
    expect(promptRun.json?.['files_left_in_place']).toEqual(
      expect.arrayContaining(['tools/extra/tool.yaml'])
    );
  });

  it('leaves an untouched sibling byte-identical', () => {
    expect(hashBytes(promptSiblingAfter)).toBe(hashBytes(promptSiblingBefore));
    expect(promptRun.json?.['files_unchanged']).toEqual(
      expect.arrayContaining(['system-message.md'])
    );
  });

  it("records a prompt's snapshot through the SHARED projection, bodies inlined", () => {
    // The inverse of what this test asserted until 2026-09-21, and the assertion is inverted
    // rather than deleted because the distinguishing keys are what say WHICH projection ran.
    // `cpm` used to record the raw `prompt.yaml` map, carrying the FILE-pointer keys; it now
    // reaches the server's own projection, which carries the RESOLVED bodies. The snapshot and
    // the bytes stayed separate questions throughout — the byte assertions above are unchanged.
    expect(Object.keys(promptRecordedSnapshot)).toContain('userMessageTemplate');
    expect(Object.keys(promptRecordedSnapshot)).not.toContain('userMessageTemplateFile');
    // The VALUE, not just the key: a resolved template is the hand-authored body this test wrote,
    // which a pointer-shaped snapshot could not hold.
    expect(String(promptRecordedSnapshot['userMessageTemplate'])).toBe(
      HAND_AUTHORED_BODY.toString('utf8')
    );
  });

  it('previews without writing anything', () => {
    expect(gatePreview.status).toBe(0);
    expect(gatePreview.json?.['preview']).toBe(true);
    expect(gatePreview.json?.['recorded']).toBe(false);
    expect(gateTreeAfterPreview).toEqual(gateTreeBeforePreview);
  });

  it('previews exactly the plan it applies, compared as ONE value', () => {
    const planOf = (run: CpmRun): string =>
      JSON.stringify({
        written: run.json?.['files_written'],
        unchanged: run.json?.['files_unchanged'],
        left: run.json?.['files_left_in_place'],
      });
    expect(planOf(gatePreview)).toBe(planOf(gateApply));
    // Control: the plan is not vacuously equal because both are empty.
    expect(gateApply.json?.['files_written']).toEqual(['gate.yaml']);
  });

  it('still restores a version that recorded no file tree, through the merge path', () => {
    expect(projectionRun.status).toBe(0);
    expect(projectionRun.json?.['recorded']).toBe(true);
    // No plan on that path, and `not_restored` stays the merge path's honest report.
    expect(projectionRun.json?.['files_written']).toBeUndefined();
    expect(projectionRun.json?.['not_restored']).toBeDefined();
  });

  it('refuses a recorded path that escapes the resource root, and writes nothing', () => {
    expect(tamperedRun.status).toBe(1);
    expect(tamperedRun.stderr).toContain('../../ESCAPED.yaml');
    expect(tamperedTreeUnchanged).toBe(true);
  });

  it('refuses by name when a recorded object is missing, and writes nothing', () => {
    expect(missingObjectRun.status).toBe(1);
    expect(missingObjectRun.stderr).toContain('guidance.md');
    // Not the projection fallback: restoring something else is the failure the refusal exists for.
    expect(missingObjectRun.stderr).not.toContain('recorded no file tree');
    expect(missingObjectTreeUnchanged).toBe(true);
  });

  it('parses every entry file it left behind', async () => {
    // A cheap cross-check that nothing above wrote bytes that are not a resource: every gate this
    // suite touched still parses. A restore that wrote the wrong object would land valid YAML from
    // another file, so this is a floor, not the byte claim — that is the digest assertions above.
    for (const id of ['cpm_byte_gate', 'cpm_projection_gate']) {
      const text = await readFile(path.join(gateDir(id), 'gate.yaml'), 'utf8');
      expect(parseYamlOrThrow<Record<string, unknown>>(text)['id']).toBe(id);
    }
  });
});
