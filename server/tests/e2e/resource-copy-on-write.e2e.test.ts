/**
 * Editing a resource that lives in the bundled tree must copy it up LOSSLESSLY, and deleting one
 * must refuse for the reason that is actually true (P1.1–P1.3).
 *
 * This has to drive a real server against a real bundled tree. The defect was invisible to every
 * layer above the filesystem: the tool answered `✅ Prompt Updated`, the write receipt listed
 * files, the version row recorded a diff — and five chain steps had been replaced by scaffold
 * stubs. Only reading the resulting bytes distinguishes the two outcomes.
 *
 * Measured 2026-08-30 against `dist/`, before the fix:
 *
 *   update planning/implementation_plan (description only)
 *     -> 5 chain steps replaced by 42–55 byte stubs; discovery/user-message.md 3852B -> 50B
 *     -> the served `implementation_plan/discovery` then returned the stub's description
 *   update examples/create_framework (description only)
 *     -> all four files under tools/framework_builder/ absent at the destination
 *   update frameworks/cageerf
 *     -> refused outright: "Failed to load framework files ... Files may be corrupted"
 *   delete examples/quick_decision -> "Prompt not found", for a prompt the same server served
 *
 * The assertions read the DESTINATION against the SOURCE rather than pinning byte counts, so they
 * survive edits to the bundled prompts they exercise.
 */

import { describe, expect, it, beforeAll, afterAll } from '@jest/globals';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildServerEnv } from './helpers/child-env.js';

const SERVER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PACKAGE_RESOURCES = path.join(SERVER_ROOT, 'resources');

interface JsonRpcResponse {
  id?: number;
  result?: {
    isError?: boolean;
    content?: Array<{ text?: string }>;
    structuredContent?: Record<string, unknown>;
  };
}

interface ToolResult {
  isError: boolean;
  text: string;
  structured: Record<string, unknown>;
}

class CowServer {
  private proc!: ChildProcess;
  private buffer = '';
  private pending = new Map<number, (m: JsonRpcResponse) => void>();
  private seq = 0;
  private startupFailure: string | null = null;

  constructor(readonly workspace: string) {}

  async start(): Promise<void> {
    this.proc = spawn('node', [path.join(SERVER_ROOT, 'dist', 'index.js'), '--transport=stdio'], {
      env: buildServerEnv({
        MCP_RESOURCES_PATH: path.join(this.workspace, 'resources'),
        MCP_WORKSPACE: this.workspace,
        MCP_RUNTIME_ROOT: path.join(this.workspace, 'runtime'),
      }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.proc.on('error', (err) => {
      this.startupFailure = `spawn failed: ${String(err)}`;
    });
    this.proc.on('exit', (code, signal) => {
      if (code !== null && code !== 0) {
        this.startupFailure = `server exited early (code=${code} signal=${String(signal)})`;
      }
    });

    this.proc.stdout?.on('data', (chunk: Buffer) => {
      this.buffer += chunk.toString();
      let idx: number;
      while ((idx = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line.startsWith('{')) continue;
        try {
          const message = JSON.parse(line) as JsonRpcResponse;
          if (message.id !== undefined) {
            this.pending.get(message.id)?.(message);
            this.pending.delete(message.id);
          }
        } catch {
          // Non-JSON stdout noise is not a protocol message.
        }
      }
    });

    await this.rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'copy-on-write-e2e', version: '1.0.0' },
    });
    this.proc.stdin?.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`
    );
  }

  private rpc(method: string, params: unknown): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, resolve);
      this.proc.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      setTimeout(
        () => reject(new Error(this.startupFailure ?? `timeout waiting for ${method}`)),
        60_000
      );
    });
  }

  async call(args: Record<string, unknown>): Promise<ToolResult> {
    const response = await this.rpc('tools/call', { name: 'resource_manager', arguments: args });
    return {
      isError: response.result?.isError === true,
      text: response.result?.content?.[0]?.text ?? '',
      structured: response.result?.structuredContent ?? {},
    };
  }

  /**
   * Awaited, because the workspace is removed straight afterwards.
   *
   * `kill()` only sends the signal. This suite drives many writes, so the server is still
   * flushing `runtime/logs/` when the signal lands, and an immediate `rm` raced it — the suite
   * reported `ENOTEMPTY ... rmdir` as a SUITE failure with every test passing, which reads like a
   * product bug rather than teardown.
   */
  async stop(): Promise<void> {
    if (this.proc === undefined || this.proc.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      this.proc.once('exit', () => resolve());
      this.proc.kill();
      // The server may already be gone, or may ignore the signal; either way teardown proceeds.
      setTimeout(resolve, 5_000);
    });
  }
}

/** Every file under `dir`, relative and sorted. */
async function filesUnder(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else out.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  }
  await walk(dir);
  return out.sort();
}

describe('editing a bundled resource copies it up losslessly (P1.1–P1.3)', () => {
  let workspace: string;
  let server: CowServer;
  let wsPrompts: string;

  beforeAll(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'copy-on-write-e2e-'));
    wsPrompts = path.join(workspace, 'resources', 'prompts');

    // A personal library holding exactly one prompt, with the bundled tree underneath. This is the
    // shape the defect needed: a writable root that does NOT already contain the prompt.
    const seed = path.join(wsPrompts, 'probecat', 'probe_only');
    await mkdir(seed, { recursive: true });
    await writeFile(
      path.join(seed, 'prompt.yaml'),
      [
        'id: probe_only',
        'name: Probe Only',
        'category: probecat',
        'description: Workspace-resident seed prompt',
        'userMessageTemplate: probe',
        '',
      ].join('\n')
    );
    await mkdir(path.join(workspace, 'resources', 'gates'), { recursive: true });
    await mkdir(path.join(workspace, 'resources', 'frameworks'), { recursive: true });

    server = new CowServer(workspace);
    await server.start();
  }, 120_000);

  afterAll(async () => {
    await server?.stop();
    // `maxRetries` covers the residual race: the log stream can flush after exit on some
    // filesystems, and a teardown failure here would mask a green run.
    if (workspace) await rm(workspace, { recursive: true, force: true, maxRetries: 5 });
  });

  describe('P1.1 — a loaded prompt reports the root it came from', () => {
    it('distinguishes a workspace-resident prompt from a bundled one', async () => {
      const workspaceResident = await server.call({
        resource_type: 'prompt',
        action: 'inspect',
        id: 'probe_only',
      });
      const bundled = await server.call({
        resource_type: 'prompt',
        action: 'inspect',
        id: 'implementation_plan',
      });

      // The falsifier as written in the plan: the overlay one reports the overlay root, the
      // bundled one reports the package root.
      expect(workspaceResident.structured['source_root']).toBe(wsPrompts);
      expect(bundled.structured['source_root']).toBe(path.join(PACKAGE_RESOURCES, 'prompts'));

      // And the consequence is stated rather than left to a comparison of two absolute paths.
      expect(workspaceResident.structured['edit_copies_on_write']).toBe(false);
      expect(bundled.structured['edit_copies_on_write']).toBe(true);
    });
  });

  describe('P1.2 — the copy carries the whole subtree, not just the fields', () => {
    it('preserves nested chain steps byte-for-byte when only `description` changes', async () => {
      const bundledDir = path.join(PACKAGE_RESOURCES, 'prompts', 'planning', 'implementation_plan');
      const copiedDir = path.join(wsPrompts, 'planning', 'implementation_plan');

      const result = await server.call({
        resource_type: 'prompt',
        action: 'update',
        id: 'implementation_plan',
        description: 'copy-on-write probe',
      });
      expect(result.isError).toBe(false);

      // Same file SET, so a step directory cannot be quietly dropped either.
      expect(await filesUnder(copiedDir)).toEqual(await filesUnder(bundledDir));

      // Every file identical except `prompt.yaml`, which is the one the update was asked to
      // change. Comparing content rather than size: a stub happened to be smaller, but the
      // property under test is "unchanged", not "large".
      for (const relative of await filesUnder(bundledDir)) {
        const source = await readFile(path.join(bundledDir, relative), 'utf8');
        const copied = await readFile(path.join(copiedDir, relative), 'utf8');
        if (relative === 'prompt.yaml') {
          expect(copied).toContain('copy-on-write probe');
        } else {
          expect({ relative, copied }).toEqual({ relative, copied: source });
        }
      }
    }, 60_000);

    it('serves the real chain step afterwards, not a scaffolded stub', async () => {
      // The user-visible half. The stub carried `description: 'Step: <name>'` and a three-line
      // body, so the prompt still resolved and still looked healthy in a listing.
      const step = await server.call({
        resource_type: 'prompt',
        action: 'inspect',
        id: 'implementation_plan/discovery',
      });

      expect(step.isError).toBe(false);
      const snapshot = step.structured['prompt'] as Record<string, unknown>;
      expect(snapshot['description']).not.toBe('Step: Discovery & Triage (Step 1)');
    });

    it("preserves a prompt's `tools/` directory, which no field describes", async () => {
      const bundledDir = path.join(PACKAGE_RESOURCES, 'prompts', 'examples', 'create_framework');
      const copiedDir = path.join(wsPrompts, 'examples', 'create_framework');

      await server.call({
        resource_type: 'prompt',
        action: 'update',
        id: 'create_framework',
        description: 'tools copy-on-write probe',
      });

      const toolFiles = (await filesUnder(bundledDir)).filter((f) => f.startsWith('tools/'));
      // Guard the guard: if the bundled prompt ever stops carrying tools, this case would pass
      // while testing nothing.
      expect(toolFiles.length).toBeGreaterThan(0);

      for (const relative of toolFiles) {
        expect(await readFile(path.join(copiedDir, relative), 'utf8')).toBe(
          await readFile(path.join(bundledDir, relative), 'utf8')
        );
      }
    }, 60_000);

    it('says out loud that the edit forked the resource', async () => {
      // Ruled by the owner 2026-08-30: copy-on-write is silent-by-default no longer. The caller
      // now owns a detached copy and bundled updates stop reaching it — a consequence invisible
      // from the file list alone.
      const result = await server.call({
        resource_type: 'prompt',
        action: 'update',
        id: 'triage',
        description: 'loud copy-on-write probe',
      });

      expect(result.text).toContain('Copied');
      expect(result.text).toContain('will no longer reach it');
    }, 60_000);

    it('updates a bundled framework instead of calling it corrupted', async () => {
      const result = await server.call({
        resource_type: 'framework',
        action: 'update',
        id: 'cageerf',
        description: 'framework copy-on-write probe',
      });

      expect(result.isError).toBe(false);
      expect(result.text).not.toContain('may be corrupted');

      // `judge-prompt.md` is the file the merge cannot reconstruct — it is not a framework field.
      const bundled = path.join(PACKAGE_RESOURCES, 'frameworks', 'cageerf', 'judge-prompt.md');
      const copied = path.join(workspace, 'resources', 'frameworks', 'cageerf', 'judge-prompt.md');
      expect(existsSync(copied)).toBe(true);
      expect(await readFile(copied, 'utf8')).toBe(await readFile(bundled, 'utf8'));
    }, 60_000);
  });

  describe('P1.3 — a refusal states the reason that is true', () => {
    it.each([
      ['prompt', 'quick_decision'],
      ['gate', 'security-awareness'],
      // Ships, but is absent from the hardcoded built-in list (P4.3) — so before this it fell
      // through to a missing-directory message rather than being refused as bundled.
      ['framework', 'focus'],
    ])(
      'refuses to delete bundled %s/%s, naming where it lives',
      async (type, id) => {
        const result = await server.call({
          resource_type: type,
          action: 'delete',
          id,
          confirm: true,
        });

        expect(result.isError).toBe(true);
        expect(result.text).toContain('ships with the server');
        expect(result.text).toContain('read-only');
        // The old messages claimed absence. That is the specific falsehood under test.
        expect(result.text).not.toContain('not found');
        // A refusal has to leave the caller somewhere to go.
        expect(result.text.toLowerCase()).toContain('update it');
      },
      60_000
    );

    it('deletes your own copy and says the bundled one is served again', async () => {
      // `create_framework` was forked into the workspace by the tools case above.
      const result = await server.call({
        resource_type: 'prompt',
        action: 'delete',
        id: 'create_framework',
        confirm: true,
      });

      expect(result.isError).toBe(false);
      expect(result.text).toContain('still resolves');
      expect(existsSync(path.join(wsPrompts, 'examples', 'create_framework'))).toBe(false);
    }, 60_000);

    it('does not claim a fallback for a prompt that has none', async () => {
      // The control for the case above. Without it, a message emitted unconditionally would pass.
      const result = await server.call({
        resource_type: 'prompt',
        action: 'delete',
        id: 'probe_only',
        confirm: true,
      });

      expect(result.isError).toBe(false);
      expect(result.text).not.toContain('still resolves');
    }, 60_000);
  });
});
