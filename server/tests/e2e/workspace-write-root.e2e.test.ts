/**
 * An empty custom workspace is where new resources are written, and everything that reads them
 * follows — end to end, over a real server on both transports.
 *
 * The Claude Code plugin runs the server with `MCP_WORKSPACE` and `MCP_RUNTIME_ROOT` set to its
 * data directory, which is empty on first start. The path resolver used to pick the first
 * resource directory that EXISTED, so that workspace resolved to the package tree and every
 * resource `resource_manager` created was written inside the install directory — which the next
 * plugin update replaced. Nothing failed; the prompt simply stopped existing after an update.
 *
 * Writing into the workspace is only half the change. The directory does not exist when the
 * server starts, so each consumer that reads it has to cope with it appearing later: the loader
 * must start without it, the index must pick it up, and the file watcher (registered at startup)
 * must begin watching it once the first write creates it. Each case below reads one of those
 * consumers, and every write assertion checks BOTH halves — present under the workspace, absent
 * from the package — since a server writing to both would pass the first half alone.
 */

import { describe, expect, it, beforeAll, afterAll } from '@jest/globals';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { buildServerEnv, createHermeticRoots } from './helpers/child-env.js';
import {
  getAvailablePort,
  startServerWithHttp,
  StreamableHttpMcpClient,
  waitForHealth,
} from './helpers/http-mcp-client.js';

const SERVER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PACKAGE_RESOURCES = path.join(SERVER_ROOT, 'resources');

const PROMPT_ID = 'workspace_root_probe';
const BUNDLED_PROMPT_ID = 'triage';
const BODY_CREATED = 'workspace root probe: created body';
const BODY_EDITED = 'workspace root probe: edited on disk';

interface ToolResult {
  isError: boolean;
  text: string;
  structured: Record<string, unknown>;
}

interface RawToolResult {
  isError?: boolean;
  content?: Array<{ text?: string }>;
  structuredContent?: Record<string, unknown>;
}

function toToolResult(result: RawToolResult | undefined): ToolResult {
  return {
    isError: result?.isError === true,
    text: (result?.content ?? []).map((part) => part.text ?? '').join('\n'),
    structured: result?.structuredContent ?? {},
  };
}

/** A live STDIO server whose workspace and runtime root are one empty directory, as the plugin sets them. */
class WorkspaceServer {
  private proc!: ChildProcess;
  private buffer = '';
  private pending = new Map<number, (message: { result?: RawToolResult }) => void>();
  private seq = 0;
  private startupFailure: string | null = null;

  constructor(readonly workspace: string) {}

  /**
   * This server's own `HOME` and runtime root, separate from `workspace` on purpose: a
   * skills_sync export writes client skill folders under `$HOME`, and folding them into the
   * workspace would put them in the same tree these tests assert about.
   */
  private readonly roots = createHermeticRoots('workspace-write-root');

  async start(): Promise<void> {
    this.proc = spawn('node', [path.join(SERVER_ROOT, 'dist', 'index.js'), '--transport=stdio'], {
      env: buildServerEnv({
        ...this.roots.env,
        MCP_WORKSPACE: this.workspace,
        MCP_RUNTIME_ROOT: this.workspace,
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
          const message = JSON.parse(line) as { id?: number; result?: RawToolResult };
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
      clientInfo: { name: 'workspace-write-root-e2e', version: '1.0.0' },
    });
    this.proc.stdin?.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`
    );
  }

  private rpc(method: string, params: unknown): Promise<{ result?: RawToolResult }> {
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

  async call(tool: string, args: Record<string, unknown>): Promise<ToolResult> {
    const response = await this.rpc('tools/call', { name: tool, arguments: args });
    return toToolResult(response.result);
  }

  /** Awaited, because the workspace holding this server's logs is removed straight afterwards. */
  async stop(): Promise<void> {
    try {
      if (this.proc === undefined || this.proc.exitCode !== null) return;
      await new Promise<void>((resolve) => {
        this.proc.once('exit', () => resolve());
        this.proc.kill();
        setTimeout(resolve, 5_000);
      });
    } finally {
      this.roots.cleanup();
    }
  }
}

/** The directory holding prompt `id` under a prompts root (`<root>/<category>/<id>`), if any. */
function findPromptDir(root: string, id: string): string | undefined {
  if (!existsSync(root)) return undefined;
  for (const category of readdirSync(root, { withFileTypes: true })) {
    const candidate = path.join(root, category.name, id);
    if (category.isDirectory() && existsSync(path.join(candidate, 'prompt.yaml'))) {
      return candidate;
    }
  }
  return undefined;
}

/** `resource_index` rows the server wrote, which is what the Python hooks read. */
function indexedRows(runtimeRoot: string): Array<{ type: string; id: string; file_path: string }> {
  const db = new DatabaseSync(path.join(runtimeRoot, 'runtime-state', 'state.db'), {
    readOnly: true,
  });
  try {
    return db.prepare('SELECT type, id, file_path FROM resource_index').all() as Array<{
      type: string;
      id: string;
      file_path: string;
    }>;
  } finally {
    db.close();
  }
}

const createPromptArgs = {
  resource_type: 'prompt',
  action: 'create',
  id: PROMPT_ID,
  name: 'Workspace root probe',
  category: 'probecat',
  description: 'Asserts a created prompt lands in an empty custom workspace.',
  user_message_template: BODY_CREATED,
};

describe('an empty custom workspace is the write root (STDIO)', () => {
  let workspace: string;
  let wsPrompts: string;
  let server: WorkspaceServer;

  beforeAll(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'workspace-write-root-e2e-'));
    wsPrompts = path.join(workspace, 'resources', 'prompts');
    server = new WorkspaceServer(workspace);
    await server.start();
  }, 120_000);

  afterAll(async () => {
    await server?.stop();
    if (workspace) await rm(workspace, { recursive: true, force: true, maxRetries: 5 });
  });

  it('starts on the bundled catalog and names the workspace as the root a write would use', async () => {
    const bundled = await server.call('resource_manager', {
      resource_type: 'prompt',
      action: 'inspect',
      id: BUNDLED_PROMPT_ID,
    });

    expect(bundled.isError).toBe(false);
    expect(existsSync(path.join(workspace, 'resources'))).toBe(false);
    expect(bundled.structured['resource_root']).toBe(wsPrompts);
    expect(bundled.structured['source_root']).toBe(path.join(PACKAGE_RESOURCES, 'prompts'));
    expect(bundled.structured['edit_copies_on_write']).toBe(true);
  }, 60_000);

  it('writes a created prompt under <workspace>/resources/prompts, and the receipt names that root', async () => {
    const created = await server.call('resource_manager', createPromptArgs);

    expect(created.isError).toBe(false);
    const receipt = created.structured['receipt'] as Record<string, unknown>;
    expect(receipt['resource_root']).toBe(wsPrompts);
    expect(receipt['loaded_after_refresh']).toBe(true);
    const affected = receipt['affected_files'] as string[];
    expect(affected.length).toBeGreaterThan(0);
    expect(affected.filter((file) => !file.startsWith(`${wsPrompts}${path.sep}`))).toEqual([]);

    expect(findPromptDir(wsPrompts, PROMPT_ID)).toBe(path.join(wsPrompts, 'probecat', PROMPT_ID));
    expect(findPromptDir(path.join(PACKAGE_RESOURCES, 'prompts'), PROMPT_ID)).toBeUndefined();
  }, 120_000);

  it('serves, inspects and indexes the created prompt from the new root', async () => {
    const inspected = await server.call('resource_manager', {
      resource_type: 'prompt',
      action: 'inspect',
      id: PROMPT_ID,
    });
    expect(inspected.structured['source_root']).toBe(wsPrompts);
    expect(inspected.structured['resource_root']).toBe(wsPrompts);
    expect(inspected.structured['edit_copies_on_write']).toBe(false);

    const rendered = await server.call('prompt_engine', { command: `>>${PROMPT_ID}` });
    expect(rendered.isError).toBe(false);
    expect(rendered.text).toContain(BODY_CREATED);

    const row = indexedRows(workspace).find((r) => r.type === 'prompt' && r.id === PROMPT_ID);
    expect(row?.file_path.startsWith(`${wsPrompts}${path.sep}`)).toBe(true);
  }, 60_000);

  it('watches the directory the first write created: an edit on disk is served without a reload', async () => {
    const messageFile = path.join(wsPrompts, 'probecat', PROMPT_ID, 'user-message.md');
    expect(existsSync(messageFile)).toBe(true);
    await writeFile(messageFile, `${BODY_EDITED}\n`, 'utf8');

    // Polled for up to 30s; the watcher's end-to-end latency has measured about 4s.
    let served = '';
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      served = (await server.call('prompt_engine', { command: `>>${PROMPT_ID}` })).text;
      if (served.includes(BODY_EDITED)) break;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
    expect(served).toContain(BODY_EDITED);
  }, 60_000);

  it('copies an edited bundled prompt into the new root and serves the copy', async () => {
    const updated = await server.call('resource_manager', {
      resource_type: 'prompt',
      action: 'update',
      id: BUNDLED_PROMPT_ID,
      description: 'workspace root copy-on-write probe',
    });
    expect(updated.isError).toBe(false);

    const bundledDir = findPromptDir(path.join(PACKAGE_RESOURCES, 'prompts'), BUNDLED_PROMPT_ID);
    const copiedDir = findPromptDir(wsPrompts, BUNDLED_PROMPT_ID);
    expect(bundledDir).toBeDefined();
    expect(copiedDir).toBe(
      path.join(wsPrompts, path.basename(path.dirname(bundledDir!)), BUNDLED_PROMPT_ID)
    );

    const inspected = await server.call('resource_manager', {
      resource_type: 'prompt',
      action: 'inspect',
      id: BUNDLED_PROMPT_ID,
    });
    expect(inspected.structured['source_root']).toBe(wsPrompts);
    expect(inspected.structured['edit_copies_on_write']).toBe(false);
  }, 120_000);

  it('writes a created gate and framework under <workspace>/resources, and loads each from there', async () => {
    const gate = await server.call('resource_manager', {
      resource_type: 'gate',
      action: 'create',
      id: 'workspace-root-gate-probe',
      name: 'Workspace root gate probe',
      type: 'validation',
      description: 'Asserts gate writes land in an empty custom workspace.',
      guidance: 'probe guidance',
      // `description` is not a declared pass-criterion field. It used to be stripped here, so
      // this fixture believed it wrote a criterion description and did not (P4.97).
      pass_criteria: [{ type: 'inline_guidance', severity: 'warn' }],
    });
    expect(gate.isError).toBe(false);
    expect(gate.text).toContain('Registered in the gate registry');
    const gateYaml = path.join('gates', 'workspace-root-gate-probe', 'gate.yaml');
    expect(existsSync(path.join(workspace, 'resources', gateYaml))).toBe(true);
    expect(existsSync(path.join(PACKAGE_RESOURCES, gateYaml))).toBe(false);

    const framework = await server.call('resource_manager', {
      resource_type: 'framework',
      action: 'create',
      id: 'workspace-root-framework-probe',
      name: 'Workspace root framework probe',
      description: 'Asserts framework writes land in an empty custom workspace.',
      system_prompt_guidance: 'Probe framework guidance for the workspace write-root check.',
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
    // Registration reads the definition back through the framework loader, so success here means
    // the loader found it in a root that did not exist when the server started.
    expect(framework.isError).toBe(false);
    const frameworkYaml = path.join(
      'frameworks',
      'workspace-root-framework-probe',
      'framework.yaml'
    );
    expect(existsSync(path.join(workspace, 'resources', frameworkYaml))).toBe(true);
    expect(existsSync(path.join(PACKAGE_RESOURCES, frameworkYaml))).toBe(false);
  }, 120_000);
});

describe('an empty custom workspace is the write root (Streamable HTTP)', () => {
  let workspace: string;
  let proc: ChildProcess;
  let client: StreamableHttpMcpClient;
  let requestId = 1;

  async function call(tool: string, args: Record<string, unknown>): Promise<ToolResult> {
    requestId += 1;
    const result = await client.request('tools/call', { name: tool, arguments: args }, requestId);
    return toToolResult(result as RawToolResult);
  }

  beforeAll(async () => {
    workspace = await mkdtemp(path.join(tmpdir(), 'workspace-write-root-http-e2e-'));
    const port = await getAvailablePort();
    proc = startServerWithHttp(port, {
      env: { MCP_WORKSPACE: workspace, MCP_RUNTIME_ROOT: workspace },
    });
    const baseUrl = `http://localhost:${port}`;
    await waitForHealth(baseUrl, { timeout: 60_000, interval: 250 });
    client = new StreamableHttpMcpClient(baseUrl);
    await client.initialize();
  }, 120_000);

  afterAll(async () => {
    await client?.close();
    if (proc !== undefined && proc.exitCode === null) {
      await new Promise<void>((resolve) => {
        proc.once('exit', () => resolve());
        proc.kill();
        setTimeout(resolve, 5_000);
      });
    }
    if (workspace) await rm(workspace, { recursive: true, force: true, maxRetries: 5 });
  });

  it('creates a prompt under <workspace>/resources/prompts and serves it back', async () => {
    const wsPrompts = path.join(workspace, 'resources', 'prompts');

    const created = await call('resource_manager', createPromptArgs);
    expect(created.isError).toBe(false);
    expect((created.structured['receipt'] as Record<string, unknown>)['resource_root']).toBe(
      wsPrompts
    );
    expect(findPromptDir(wsPrompts, PROMPT_ID)).toBe(path.join(wsPrompts, 'probecat', PROMPT_ID));
    expect(findPromptDir(path.join(PACKAGE_RESOURCES, 'prompts'), PROMPT_ID)).toBeUndefined();

    const inspected = await call('resource_manager', {
      resource_type: 'prompt',
      action: 'inspect',
      id: PROMPT_ID,
    });
    expect(inspected.structured['source_root']).toBe(wsPrompts);

    const rendered = await call('prompt_engine', { command: `>>${PROMPT_ID}` });
    expect(rendered.text).toContain(BODY_CREATED);
  }, 120_000);
});
