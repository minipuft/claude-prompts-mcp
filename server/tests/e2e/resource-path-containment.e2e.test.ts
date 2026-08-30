/**
 * A caller-supplied path segment must not steer a resource write out of the resources root.
 *
 * This has to drive a real server. The defect lived in the join between a payload field and the
 * filesystem, and every layer above it typechecked, validated and reported success — the prompt
 * case answered `✅ **Prompt Created**` while writing outside the root. Only an end-to-end call
 * that then LOOKS AT THE DISK can tell the two apart.
 *
 * Measured 2026-08-30 against `dist/`, before the guard, each with a passing benign control:
 *
 *   prompt    create(id:'trav_a', category:'../../ESCAPED')  -> <ws>/escaped/trav_a/{prompt.yaml,user-message.md}
 *   gate      create(id:'../../ESCAPED_GATE')                -> <ws>/ESCAPED_GATE/{gate.yaml,guidance.md}
 *   framework create(id:'../../ESCAPED_FW')                  -> <ws>/escaped_fw/{framework.yaml,phases.yaml,system-prompt.md}
 *
 * BOTH directions are asserted per type. A test that only proves traversal is refused passes just
 * as well against a server that refuses everything, which is the likelier regression once a guard
 * is tightened later — so every refusal case is paired with a benign create that must succeed.
 */

import { describe, expect, it, beforeAll, afterAll } from '@jest/globals';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildServerEnv } from './helpers/child-env.js';

const SERVER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

interface JsonRpcResponse {
  id?: number;
  result?: { isError?: boolean; content?: Array<{ text?: string }> };
}

interface ToolResult {
  isError: boolean;
  text: string;
}

/** A live STDIO server whose resources root is a temp workspace. */
class ContainmentServer {
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
      clientInfo: { name: 'path-containment-e2e', version: '1.0.0' },
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
    };
  }

  stop(): void {
    this.proc?.kill();
  }
}

/**
 * Every entry directly under the workspace. The resources root and the runtime root are the only
 * two the server may create — anything else is an escape, whatever the tool reported.
 */
async function strayWorkspaceEntries(workspace: string): Promise<string[]> {
  const entries = await readdir(workspace);
  return entries.filter((entry) => entry !== 'resources' && entry !== 'runtime').sort();
}

describe('a caller-supplied segment cannot steer a write out of the resources root', () => {
  let workspace: string;
  let server: ContainmentServer;

  beforeAll(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'path-containment-e2e-'));

    // A minimal but real resources tree. Each subdirectory must exist for its type's root to
    // resolve to the workspace rather than the package.
    const resources = path.join(workspace, 'resources');
    const seed = path.join(resources, 'prompts', 'probecat', 'probe_only');
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
    await mkdir(path.join(resources, 'gates'), { recursive: true });
    await mkdir(path.join(resources, 'frameworks'), { recursive: true });

    server = new ContainmentServer(workspace);
    await server.start();
  }, 120_000);

  afterAll(async () => {
    server?.stop();
    if (workspace) await rm(workspace, { recursive: true, force: true });
  });

  describe('prompts — the traversal rides on `category`', () => {
    it('refuses a category that resolves outside the root, and writes nothing', async () => {
      const result = await server.call({
        resource_type: 'prompt',
        action: 'create',
        id: 'trav_prompt',
        name: 'Traversal Probe',
        category: '../../ESCAPED',
        description: 'traversal probe',
        user_message_template: 'x',
      });

      expect(result.isError).toBe(true);
      expect(await strayWorkspaceEntries(workspace)).toEqual([]);
    });

    it('refuses a category carrying a path separator', async () => {
      // Cannot escape the root (`path.join` neutralises the leading slash) but silently created a
      // nested `tmp/x/` layout the loader reads differently. A category is ONE directory name.
      const result = await server.call({
        resource_type: 'prompt',
        action: 'create',
        id: 'trav_abs',
        name: 'Traversal Probe',
        category: '/tmp/somewhere',
        description: 'traversal probe',
        user_message_template: 'x',
      });

      expect(result.isError).toBe(true);
      expect(await strayWorkspaceEntries(workspace)).toEqual([]);
    });

    it('still creates a prompt in an ordinary category', async () => {
      // The control. Without it, a server that refused every create would pass the two above.
      const result = await server.call({
        resource_type: 'prompt',
        action: 'create',
        id: 'benign_prompt',
        name: 'Benign Probe',
        category: 'development',
        description: 'benign control',
        user_message_template: 'x',
      });

      expect(result.text).toContain('benign_prompt');
      const created = await readdir(
        path.join(workspace, 'resources', 'prompts', 'development', 'benign_prompt')
      );
      expect(created.sort()).toEqual(['prompt.yaml', 'user-message.md']);
    });

    it('still slugs a spaced category rather than rejecting it', async () => {
      // Validation runs AFTER slugging, so `My Category` -> `my-category` remains legal. Checking
      // the order matters: validating first would reject a case that has always worked.
      await server.call({
        resource_type: 'prompt',
        action: 'create',
        id: 'spaced_prompt',
        name: 'Spaced Probe',
        category: 'My Category',
        description: 'spaced control',
        user_message_template: 'x',
      });

      const categories = await readdir(path.join(workspace, 'resources', 'prompts'));
      expect(categories).toContain('my-category');
    });
  });

  describe('gates and frameworks — the traversal rides on `id`', () => {
    it('refuses a gate id that resolves outside the root, and writes nothing', async () => {
      const result = await server.call({
        resource_type: 'gate',
        action: 'create',
        id: '../../ESCAPED_GATE',
        name: 'Traversal Gate',
        description: 'traversal probe',
        guidance: 'g',
      });

      expect(result.isError).toBe(true);
      expect(await strayWorkspaceEntries(workspace)).toEqual([]);
    });

    it('still creates a gate with an ordinary id', async () => {
      const result = await server.call({
        resource_type: 'gate',
        action: 'create',
        id: 'benign-gate',
        name: 'Benign Gate',
        description: 'benign control',
        guidance: 'g',
      });

      expect(result.text).toContain('benign-gate');
      const gates = await readdir(path.join(workspace, 'resources', 'gates'));
      expect(gates).toContain('benign-gate');
    });

    it('refuses a framework id that resolves outside the root, and writes nothing', async () => {
      const result = await server.call({
        resource_type: 'framework',
        action: 'create',
        id: '../../ESCAPED_FW',
        name: 'Traversal Framework',
        description: 'traversal probe',
        methodology: 'probe methodology',
        system_prompt_guidance: 'You are a probe.',
        execution_guidance: 'Run the probe.',
        phases: [{ id: 'one', name: 'One', description: 'first', order: 1 }],
        framework_gates: [
          { id: 'probe-gate', name: 'Probe Gate', description: 'd', priority: 'medium' },
        ],
      });

      expect(result.isError).toBe(true);
      expect(await strayWorkspaceEntries(workspace)).toEqual([]);
    });

    it('still creates a framework with an ordinary id', async () => {
      // This control earned its place: an earlier run of this payload failed for a MISSING FIELD,
      // not for containment, and without a control that read as the guard working.
      const result = await server.call({
        resource_type: 'framework',
        action: 'create',
        id: 'benign_fw',
        name: 'Benign Framework',
        description: 'benign control',
        methodology: 'probe methodology',
        system_prompt_guidance: 'You are a probe.',
        execution_guidance: 'Run the probe.',
        phases: [{ id: 'one', name: 'One', description: 'first', order: 1 }],
        framework_gates: [
          { id: 'probe-gate', name: 'Probe Gate', description: 'd', priority: 'medium' },
        ],
      });

      expect(result.isError).toBe(false);
      const frameworks = await readdir(path.join(workspace, 'resources', 'frameworks'));
      expect(frameworks).toContain('benign_fw');
    });
  });
});
