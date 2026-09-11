/**
 * A prompt that fails to load is repairable, unexecutable, and does not take its id dark.
 *
 * This has to drive a real server. The defect lives in the join between the loader's drop and the
 * tool's catalog lookup, and every layer above it typechecks: measured 2026-09-11 against `dist/`
 * before this change, a server that had just logged `Invalid YAML in <path>` answered
 * `Prompt not found` from `inspect` for that exact file, and `update` with a full body answered
 * `✅ **Prompt Updated**` while writing a SECOND prompt at `general/<id>` — the category
 * `canonicalPromptSnapshot` falls back to — reporting `Moved prompt … to 'general'` when nothing
 * moved, and leaving the broken file untouched. No unit test sees any of that.
 *
 * THREE CLAUSES, EACH WITH ITS PASSING TWIN. A refusal assertion alone passes just as well against
 * a server that refuses everything:
 *
 *   1. repairable    — the quarantined prompt is repaired through `resource_manager`, and the
 *                      control is that the repaired prompt then EXECUTES.
 *   2. unexecutable  — `>>broken` is refused, and the control is that `>>good` from the same
 *                      workspace runs.
 *   3. not dark      — a broken workspace file whose id a bundled prompt also defines leaves the
 *                      bundled definition serving, and the control is that the workspace copy's
 *                      own text is nowhere in the response.
 *
 * TRANSPORT PARITY. The quarantine view is bound once, at `McpToolRouter` construction, which is
 * per PROCESS. STDIO pins one `McpServer` per connection while HTTP builds a fresh one per
 * request, so a binding made per serving unit would pass STDIO and no-op over HTTP. The HTTP case
 * at the end measures that rather than assuming it.
 */

import { describe, expect, it, beforeAll, afterAll } from '@jest/globals';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildServerEnv } from './helpers/child-env.js';
import {
  getAvailablePort,
  httpPost,
  parseJsonOrSse,
  startServerWithHttp,
  waitForHealth,
} from './helpers/http-mcp-client.js';

const SERVER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** A bundled prompt id a workspace file can shadow. Present in `server/resources/prompts`. */
const BUNDLED_ID = 'minimal_prompt';
/** Text that exists ONLY in the broken workspace copy. Its appearance anywhere is a content leak. */
const WORKSPACE_ONLY_MARKER = 'QUARANTINED_INSTRUCTION_MARKER';

interface JsonRpcResponse {
  id?: number;
  result?: { isError?: boolean; content?: Array<{ text?: string }>; prompts?: Array<unknown> };
}

interface ToolResult {
  isError: boolean;
  text: string;
}

/** A live STDIO server serving a temp workspace that overlays the bundled tree. */
class QuarantineServer {
  private proc!: ChildProcess;
  private buffer = '';
  private pending = new Map<number, (m: JsonRpcResponse) => void>();
  private seq = 0;
  private startupFailure: string | null = null;

  constructor(readonly workspace: string) {}

  async start(): Promise<void> {
    this.proc = spawn('node', [path.join(SERVER_ROOT, 'dist', 'index.js'), '--transport=stdio'], {
      env: buildServerEnv({
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
      clientInfo: { name: 'prompt-quarantine-e2e', version: '1.0.0' },
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
        () => reject(new Error(this.startupFailure ?? `timeout waiting for ${method}`)),
        60_000
      );
    });
  }

  async resource(args: Record<string, unknown>): Promise<ToolResult> {
    const response = await this.rpc('tools/call', { name: 'resource_manager', arguments: args });
    return {
      isError: response.result?.isError === true,
      text: response.result?.content?.[0]?.text ?? '',
    };
  }

  async execute(command: string): Promise<ToolResult> {
    const response = await this.rpc('tools/call', {
      name: 'prompt_engine',
      arguments: { command },
    });
    return {
      isError: response.result?.isError === true,
      text: response.result?.content?.[0]?.text ?? '',
    };
  }

  /** Awaits the exit rather than only signalling — see `resource-path-containment.e2e.test.ts`. */
  async stop(): Promise<void> {
    if (this.proc === undefined || this.proc.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      this.proc.once('exit', () => resolve());
      this.proc.kill();
      setTimeout(resolve, 5_000);
    });
  }
}

/**
 * A workspace holding one valid prompt, one broken prompt, and a broken copy of a BUNDLED id.
 *
 * Not a copy of the bundled tree: a genuine personal library, which is the shape that broke.
 */
async function buildWorkspace(): Promise<string> {
  const workspace = await mkdtemp(path.join(tmpdir(), 'prompt-quarantine-e2e-'));
  const prompts = path.join(workspace, 'resources', 'prompts');

  await mkdir(path.join(prompts, 'probecat', 'good_prompt'), { recursive: true });
  await writeFile(
    path.join(prompts, 'probecat', 'good_prompt', 'prompt.yaml'),
    [
      'id: good_prompt',
      'name: Good Prompt',
      'category: probecat',
      'description: A valid workspace prompt',
      'userMessageTemplate: "Hello from the valid workspace prompt"',
      '',
    ].join('\n')
  );

  // `arguments` as a string is rejected by `PromptYamlSchema`, which is what the loader runs.
  await mkdir(path.join(prompts, 'probecat', 'broken_prompt'), { recursive: true });
  await writeFile(
    path.join(prompts, 'probecat', 'broken_prompt', 'prompt.yaml'),
    [
      'id: broken_prompt',
      'name: Broken Prompt',
      'category: probecat',
      'description: schema-invalid on purpose',
      'userMessageTemplate: "Body"',
      'arguments: "not-an-array"',
      '',
    ].join('\n')
  );

  await mkdir(path.join(prompts, 'examples', BUNDLED_ID), { recursive: true });
  await writeFile(
    path.join(prompts, 'examples', BUNDLED_ID, 'prompt.yaml'),
    [
      `id: ${BUNDLED_ID}`,
      'name: Shadowing Override',
      'category: examples',
      `description: ${WORKSPACE_ONLY_MARKER}`,
      `systemMessage: "${WORKSPACE_ONLY_MARKER}"`,
      `userMessageTemplate: "${WORKSPACE_ONLY_MARKER}"`,
      'arguments: "not-an-array"',
      '',
    ].join('\n')
  );

  await mkdir(path.join(workspace, 'runtime'), { recursive: true });
  return workspace;
}

/** Every `prompt.yaml` under the workspace prompts root, relative to it. */
async function promptFiles(workspace: string): Promise<string[]> {
  const root = path.join(workspace, 'resources', 'prompts');
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) await walk(full);
      else if (item.name === 'prompt.yaml') found.push(path.relative(root, full));
    }
  };
  await walk(root);
  return found.sort();
}

describe('a prompt that fails to load is quarantined, not lost (P4.9)', () => {
  let workspace: string;
  let server: QuarantineServer;

  beforeAll(async () => {
    workspace = await buildWorkspace();
    server = new QuarantineServer(workspace);
    await server.start();
  }, 120_000);

  afterAll(async () => {
    await server?.stop();
    await rm(workspace, { recursive: true, force: true });
  }, 30_000);

  describe('clause 2 — a quarantined prompt is structurally unexecutable', () => {
    it('refuses to execute the quarantined prompt', async () => {
      const result = await server.execute('>>broken_prompt');

      expect(result.isError).toBe(true);
      expect(result.text).toContain('Unknown prompt');
    });

    it('POSITIVE CONTROL — the valid prompt from the same workspace executes', async () => {
      const result = await server.execute('>>good_prompt');

      expect(result.isError).toBe(false);
      expect(result.text).toContain('Hello from the valid workspace prompt');
    });

    it('does not register the quarantined prompt with prompts/list', async () => {
      const response = await server.rpc('prompts/list', {});
      const names = (response.result?.prompts ?? []).map(
        (prompt) => (prompt as { name?: string }).name
      );

      expect(names).toContain('good_prompt');
      expect(names).not.toContain('broken_prompt');
    });

    it('never ships the instruction text of a file that failed validation', async () => {
      // `prompts/list` carries every description and argument description, and
      // `list detail:"full"` returns every systemMessage — both before anything is invoked. A
      // quarantined file is precisely the one whose content has not been validated.
      const listed = JSON.stringify((await server.rpc('prompts/list', {})).result);
      const full = await server.resource({
        resource_type: 'prompt',
        action: 'list',
        detail: 'full',
      });
      const inspected = await server.resource({
        resource_type: 'prompt',
        action: 'inspect',
        id: BUNDLED_ID,
        detail: 'full',
      });

      expect(listed).not.toContain(WORKSPACE_ONLY_MARKER);
      expect(full.text).not.toContain(WORKSPACE_ONLY_MARKER);
      expect(inspected.text).not.toContain(WORKSPACE_ONLY_MARKER);
    });
  });

  describe('clause 3 — a broken workspace file does not take its id dark', () => {
    it('keeps serving the bundled definition when the workspace copy fails to load', async () => {
      const result = await server.execute(`>>${BUNDLED_ID}`);

      expect(result.isError).toBe(false);
      expect(result.text).not.toContain(WORKSPACE_ONLY_MARKER);
    });

    it('announces the skipped file on inspect, naming the root that is actually serving', async () => {
      const result = await server.resource({
        resource_type: 'prompt',
        action: 'inspect',
        id: BUNDLED_ID,
      });

      expect(result.text).toContain('A nearer file for this id failed to load');
      expect(result.text).toContain(path.join('examples', BUNDLED_ID, 'prompt.yaml'));
      expect(result.text).toContain(path.join('server', 'resources', 'prompts'));
    });

    it('reports it as shadowed on list, with the id, the path and the error', async () => {
      const result = await server.resource({ resource_type: 'prompt', action: 'list' });

      expect(result.text).toContain('Quarantined');
      expect(result.text).toContain('shadowed');
      expect(result.text).toContain(path.join('examples', BUNDLED_ID, 'prompt.yaml'));
      expect(result.text).toContain('expected array');
    });
  });

  describe('clause 1 — a schema-invalid prompt is repaired through resource_manager', () => {
    it('inspect names the file and the reason instead of "Prompt not found"', async () => {
      const result = await server.resource({
        resource_type: 'prompt',
        action: 'inspect',
        id: 'broken_prompt',
      });

      expect(result.text).toContain('Quarantined');
      expect(result.text).toContain(path.join('probecat', 'broken_prompt', 'prompt.yaml'));
      expect(result.text).toContain('expected array');
    });

    it('repairs the file in place and reports the quarantine record cleared', async () => {
      const before = await promptFiles(workspace);

      const result = await server.resource({
        resource_type: 'prompt',
        action: 'update',
        id: 'broken_prompt',
        name: 'Broken Prompt',
        description: 'repaired through the tool',
        user_message_template: 'Repaired body for {{thing}}',
        arguments: [{ name: 'thing', description: 'the thing', required: false }],
      });

      expect(result.isError).toBe(false);
      expect(result.text).toContain('Repaired');

      // The write landed on the file that was broken, in its OWN category — not on a second
      // prompt under `general/`, which is what the fallback category produced before this change.
      const after = await promptFiles(workspace);
      expect(after).toEqual(before);
      const repaired = await readFile(
        path.join(workspace, 'resources', 'prompts', 'probecat', 'broken_prompt', 'prompt.yaml'),
        'utf8'
      );
      expect(repaired).toContain('repaired through the tool');
      expect(repaired).not.toContain('not-an-array');
    });

    it('POSITIVE CONTROL — the repaired prompt now executes', async () => {
      const result = await server.execute('>>broken_prompt');

      expect(result.isError).toBe(false);
      expect(result.text).toContain('Repaired body');
    });

    it('drops the repaired record and keeps the one that is still broken', async () => {
      const result = await server.resource({ resource_type: 'prompt', action: 'list' });

      expect(result.text).not.toContain(path.join('probecat', 'broken_prompt', 'prompt.yaml'));
      expect(result.text).toContain(path.join('examples', BUNDLED_ID, 'prompt.yaml'));
    });

    it('refuses a traversal-shaped category on a repair, and writes nothing outside the root', async () => {
      // NAMED FOR WHAT IT MEASURES. This case exercises `validateCategoryName`, which refuses the
      // segment BEFORE `resolveContainedPath` is reached — measured 2026-09-11 by deleting every
      // containment call in `file-operations.ts` and re-running: all three traversal shapes
      // (category, id, nested id) were still refused, by the id regex and the category validator.
      // Containment on the repair path is therefore covered by the GATE, not by this assertion:
      // the repair reuses the one resolver every prompt update already goes through
      // (`file-operations.ts:238`), and `validate:resource-path-containment` fails that file the
      // moment the guard is removed. Calling this a containment test would measure a property it
      // does not observe, and would disagree with a correct claim about the guard.
      const result = await server.resource({
        resource_type: 'prompt',
        action: 'update',
        id: BUNDLED_ID,
        category: '../../ESCAPED',
        user_message_template: 'escape attempt',
      });

      expect(result.isError).toBe(true);
      expect(result.text).toContain('single directory name');
      expect(await readdir(workspace)).toEqual(expect.not.arrayContaining(['ESCAPED', 'escaped']));
    });
  });
});

describe('quarantine reaches the tool surface over Streamable HTTP too (P4.9)', () => {
  let workspace: string;
  let proc: ChildProcess;
  let baseUrl: string;

  beforeAll(async () => {
    workspace = await buildWorkspace();
    const port = await getAvailablePort();
    baseUrl = `http://127.0.0.1:${port}`;
    proc = startServerWithHttp(port, {
      env: {
        MCP_WORKSPACE: workspace,
        MCP_RUNTIME_ROOT: path.join(workspace, 'runtime'),
      },
    });
    await waitForHealth(baseUrl, { timeout: 60_000 });
  }, 120_000);

  afterAll(async () => {
    proc?.kill();
    await new Promise((resolve) => setTimeout(resolve, 500));
    await rm(workspace, { recursive: true, force: true });
  }, 30_000);

  /** One `resource_manager` call over Streamable HTTP, returning the response text. */
  async function inspectOverHttp(id: string, requestId: number): Promise<string> {
    const response = await httpPost(
      `${baseUrl}/mcp`,
      {
        jsonrpc: '2.0',
        id: requestId,
        method: 'tools/call',
        params: {
          name: 'resource_manager',
          arguments: { resource_type: 'prompt', action: 'inspect', id },
        },
      },
      { Accept: 'application/json, text/event-stream' }
    );
    expect(response.status).toBe(200);
    const parsed = parseJsonOrSse(response.body, requestId);
    expect(parsed.error).toBeUndefined();
    return (parsed.result as { content?: Array<{ text?: string }> }).content?.[0]?.text ?? '';
  }

  it('reports the quarantined file, on a transport that rebuilds its server shell per request', async () => {
    const text = await inspectOverHttp('broken_prompt', 1);

    expect(text).toContain('Quarantined');
    expect(text).toContain(path.join('probecat', 'broken_prompt', 'prompt.yaml'));
  }, 60_000);

  it('POSITIVE CONTROL — the same transport inspects a healthy prompt normally', async () => {
    const text = await inspectOverHttp('good_prompt', 2);

    expect(text).toContain('Prompt Inspect');
    expect(text).not.toContain('Quarantined');
  }, 60_000);
});
