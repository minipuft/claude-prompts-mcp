/**
 * Writes land where reads come from — end to end, over a real STDIO server.
 *
 * This is the CI coverage for D8 Arc 1 (T1.7). The unit tests in
 * `tests/unit/infra/config/resource-write-destination.test.ts` cover `ConfigLoader`'s branch; they
 * cannot cover the one-line wiring at `runtime/context.ts:113` that supplies the resolver, nor the
 * framework loader plumbing at `module-initializer.ts:219` and `registry.ts:81`. Deleting any of
 * those leaves every unit test green and silently restores the defect, which is why this file
 * drives the assembled server instead.
 *
 * The defect it pins: prompt, gate and framework WRITES each resolved their directory through a
 * separate ad-hoc chain that never consulted `PathResolver`, while READS did. Setting
 * `MCP_RESOURCES_PATH` moved every read and no write — so a prompt was served from the override
 * and edited back into the package's own `resources/`, which under an npm or `.mcpb` install is
 * inside `node_modules` and is destroyed by the next reinstall.
 *
 * It stayed invisible because the shipped `config.prompts.directory` names the same path the
 * default resolution produces. The two agreed by coincidence, and only diverge once the resources
 * root is overridden — which is exactly what this test does.
 *
 * Each case asserts BOTH halves: the file appears under the override root AND does not appear
 * under the package root. Asserting only the first would pass against a server that wrote to both.
 */

import { describe, expect, it, beforeAll, afterAll } from '@jest/globals';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildServerEnv } from './helpers/child-env.js';

const SERVER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PACKAGE_RESOURCES = path.join(SERVER_ROOT, 'resources');

interface JsonRpcResponse {
  id?: number;
  result?: { isError?: boolean; content?: Array<{ text?: string }> };
}

/** A live STDIO server rooted at an overridden resources tree. */
class ProbeServer {
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
      }),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Surface a child that dies rather than letting it read as a request timeout.
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
      clientInfo: { name: 'write-destination-e2e', version: '1.0.0' },
    });
    this.proc.stdin?.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`
    );
  }

  rpc(method: string, params: unknown): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, resolve);
      this.proc.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      setTimeout(
        () =>
          reject(
            new Error(
              this.startupFailure ?? `timeout waiting for ${method} (server never responded)`
            )
          ),
        60_000
      );
    });
  }

  async create(args: Record<string, unknown>): Promise<{ isError: boolean; text: string }> {
    const response = await this.rpc('tools/call', { name: 'resource_manager', arguments: args });
    return {
      isError: response.result?.isError === true,
      text: response.result?.content?.[0]?.text ?? '',
    };
  }

  /**
   * `kill()` only SIGNALS; it does not wait. Returning immediately let the workspace `rm` race
   * the server's own log flush, so teardown failed with `ENOTEMPTY: rmdir '<ws>/logs'` on the
   * first CI runs of #257 and #259 while every assertion had passed. Same fix as
   * resource-path-containment's ProbeServer; the timeout keeps a wedged child from hanging.
   */
  async stop(): Promise<void> {
    if (this.proc === undefined || this.proc.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      this.proc.once('exit', () => resolve());
      this.proc.kill();
      setTimeout(resolve, 5_000);
    });
  }
}

const PROMPT_ID = 'e2e_write_destination_prompt';
const GATE_ID = 'e2e_write_destination_gate';
const FRAMEWORK_ID = 'e2e_write_destination_framework';

describe('resource writes resolve through PathResolver (D8 Arc 1)', () => {
  let workspace: string;
  let server: ProbeServer;

  beforeAll(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'write-dest-e2e-'));
    // A complete resources tree the server can serve from, distinct from the package's own. The
    // override must be a real tree, because `resolveResourceSubdir` only prefers a directory that
    // exists.
    await cp(PACKAGE_RESOURCES, path.join(workspace, 'resources'), { recursive: true });
    server = new ProbeServer(workspace);
    await server.start();
  }, 120_000);

  afterAll(async () => {
    await server?.stop();
    if (workspace) await rm(workspace, { recursive: true, force: true, maxRetries: 5 });

    // If the defect regresses, these land in the package tree — the very thing the test asserts
    // against — and a red run would leave them behind as untracked files in the repo. Clean them
    // unconditionally so a failure reports a failure and nothing else.
    await Promise.all(
      [
        path.join(PACKAGE_RESOURCES, 'prompts/analysis', PROMPT_ID),
        path.join(PACKAGE_RESOURCES, 'gates', GATE_ID),
        path.join(PACKAGE_RESOURCES, 'frameworks', FRAMEWORK_ID),
      ].map((dir) => rm(dir, { recursive: true, force: true }))
    );
  });

  it('writes a created prompt under the overridden resources root, not the package', async () => {
    const id = PROMPT_ID;
    const result = await server.create({
      resource_type: 'prompt',
      action: 'create',
      id,
      name: 'Write destination probe',
      category: 'analysis',
      description: 'Asserts prompt writes honor MCP_RESOURCES_PATH.',
      user_message_template: 'probe body',
    });

    expect(result.isError).toBe(false);
    expect(existsSync(path.join(workspace, 'resources/prompts/analysis', id, 'prompt.yaml'))).toBe(
      true
    );
    expect(existsSync(path.join(PACKAGE_RESOURCES, 'prompts/analysis', id, 'prompt.yaml'))).toBe(
      false
    );
  }, 120_000);

  it('writes a created gate under the overridden resources root, not the package', async () => {
    const id = GATE_ID;
    const result = await server.create({
      resource_type: 'gate',
      action: 'create',
      id,
      name: 'Write destination gate probe',
      type: 'validation',
      description: 'Asserts gate writes honor MCP_RESOURCES_PATH.',
      guidance: 'probe guidance',
      pass_criteria: [{ type: 'inline_guidance', description: 'probe criterion' }],
    });

    expect(result.isError).toBe(false);
    expect(existsSync(path.join(workspace, 'resources/gates', id, 'gate.yaml'))).toBe(true);
    expect(existsSync(path.join(PACKAGE_RESOURCES, 'gates', id, 'gate.yaml'))).toBe(false);
  }, 120_000);

  it('writes a created framework under the overridden root, and registers it from there', async () => {
    // Frameworks exercise more than the writer. Registration reads the definition back through
    // `FrameworkRegistry`'s loader, so a create that succeeds proves writer and reader agree —
    // when only the writer was fixed, this failed with "not found on disk" and rolled back.
    const id = FRAMEWORK_ID;
    const result = await server.create({
      resource_type: 'framework',
      action: 'create',
      id,
      name: 'Write destination framework probe',
      description: 'Asserts framework writes honor MCP_RESOURCES_PATH.',
      system_prompt_guidance: 'Probe framework guidance for the write-destination check.',
      phases: [{ id: 'probe', name: 'Probe', description: 'probe phase' }],
      framework_gates: [
        {
          id: 'probe-gate',
          name: 'Probe Gate',
          description: 'Validates the probe phase',
          frameworkArea: 'probe',
          priority: 'high',
          validationCriteria: ['probe criterion'],
        },
      ],
    });

    expect(result.isError).toBe(false);
    expect(existsSync(path.join(workspace, 'resources/frameworks', id, 'framework.yaml'))).toBe(
      true
    );
    expect(existsSync(path.join(PACKAGE_RESOURCES, 'frameworks', id, 'framework.yaml'))).toBe(
      false
    );
  }, 120_000);
});
