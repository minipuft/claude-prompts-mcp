/**
 * All three tools refuse an undeclared argument key by name, on both transports (P4.93 / R50).
 *
 * The defect is a SILENT SUCCESS, and only a real `tools/call` can see it: zod strips an unknown
 * key before the registered callback runs, so a unit test calling a router directly never crosses
 * the boundary where the key is dropped. Measured on `f711401b` against `dist/index.js`, STDIO and
 * Streamable HTTP alike:
 *
 *   prompt_engine  {command:">>listprompts", force_restrt:true} → prompt list, isError:false
 *   system_control {action:"status", previw:true}               → status,      isError:false
 *
 * The security reading is the point. A caller — or a model following a prompt-injected
 * instruction — that sends a SAFETY flag under a slightly wrong name got a success reply while
 * the server did the unguarded thing. This repo already paid that once: a `skills_sync` preview
 * wrote 33 real files because the registered schema dropped the undeclared flag.
 *
 * Transport parity is load-bearing rather than ceremonial here (CLAUDE.md §Transport Parity):
 * STDIO pins one `McpServer` per connection while HTTP builds a fresh one per request, and the
 * `prompt_engine` schema is rebuilt from runtime state on each. A refusal that read a captured
 * state would pass on one and not the other.
 *
 * Every negative assertion names WHICH guard answered — the key, and the half of the message —
 * so a refusal whose cause moves elsewhere cannot keep this green.
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildServerEnv, createHermeticRoots } from './helpers/child-env.js';
import {
  getAvailablePort,
  killServer,
  ModernMcpClient,
  startServerWithHttp,
  waitForHealth,
} from './helpers/http-mcp-client.js';

const SERVER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST_ENTRY = path.join(SERVER_ROOT, 'dist', 'index.js');

interface ToolReply {
  isError: boolean;
  text: string;
}

interface Session {
  call(tool: string, args: Record<string, unknown>): Promise<ToolReply>;
  /** The same call with a client `_meta` envelope on `params`, beside `arguments`. */
  callWithMeta(tool: string, args: Record<string, unknown>): Promise<ToolReply>;
  stop(): Promise<void>;
}

/** A client-protocol envelope, deliberately carrying a key no tool contract declares. */
const CLIENT_META = {
  'io.modelcontextprotocol/client-info': { name: 'meta-scope-probe', version: '1.0.0' },
};

function toReply(result: unknown): ToolReply {
  const shaped = (result ?? {}) as { isError?: boolean; content?: { text?: string }[] };
  return {
    isError: shaped.isError === true,
    text: (shaped.content ?? []).map((part) => part.text ?? '').join('\n'),
  };
}

async function startHttpSession(env: Record<string, string>): Promise<Session> {
  const port = await getAvailablePort();
  const baseUrl = `http://localhost:${port}`;
  const proc = startServerWithHttp(port, { env });
  await waitForHealth(baseUrl, { timeout: 20000, interval: 200 });
  const client = new ModernMcpClient(baseUrl);
  let nextId = 1;

  return {
    // `ModernMcpClient` already puts the modern `_meta` envelope on `params`, so the plain call
    // IS the meta-carrying one over HTTP; the explicit variant keeps the two sessions symmetric.
    call: async (tool, args) => toReply(await client.callTool(tool, args, nextId++)),
    callWithMeta: async (tool, args) => toReply(await client.callTool(tool, args, nextId++)),
    stop: () => killServer(proc),
  };
}

async function startStdioSession(env: Record<string, string>): Promise<Session> {
  const proc: ChildProcess = spawn('node', [DIST_ENTRY, '--transport=stdio', '--quiet'], {
    cwd: SERVER_ROOT,
    env: buildServerEnv(env),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const pending = new Map<number, (message: Record<string, unknown>) => void>();
  let buffer = '';
  let stderr = '';
  proc.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  proc.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (!line.startsWith('{')) continue;
      const message = JSON.parse(line) as Record<string, unknown>;
      const resolve = typeof message['id'] === 'number' ? pending.get(message['id']) : undefined;
      resolve?.(message);
    }
  });

  let nextId = 1;
  const request = (method: string, params: Record<string, unknown>): Promise<unknown> => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`STDIO ${method} (id ${id}) got no answer in 20s\n${stderr}`));
      }, 20000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        pending.delete(id);
        if (message['error'] != null) reject(new Error(JSON.stringify(message['error'])));
        else resolve(message['result']);
      });
      proc.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  };

  await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'undeclared-param-e2e', version: '1.0.0' },
  });
  proc.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  return {
    call: async (tool, args) =>
      toReply(await request('tools/call', { name: tool, arguments: args })),
    callWithMeta: async (tool, args) =>
      toReply(await request('tools/call', { name: tool, arguments: args, _meta: CLIENT_META })),
    stop: () => killServer(proc),
  };
}

/** Per tool: a call that must SUCCEED, and the same call with one planted key. */
const PLANTED = [
  {
    tool: 'prompt_engine',
    control: { command: '>>listprompts' },
    planted: { command: '>>listprompts', force_restrt: true },
    key: 'force_restrt',
    suggestion: "Did you mean 'force_restart'?",
  },
  {
    tool: 'system_control',
    control: { action: 'status' },
    planted: { action: 'status', previw: true },
    key: 'previw',
    suggestion: "Did you mean 'preview'?",
  },
  {
    tool: 'resource_manager',
    control: { resource_type: 'prompt', action: 'list' },
    planted: { resource_type: 'prompt', action: 'list', enforcementMode: 'advisory' },
    key: 'enforcementMode',
    suggestion: "Did you mean 'enforcement_mode'?",
  },
] as const;

describe.each([
  ['STDIO', startStdioSession],
  ['Streamable HTTP', startHttpSession],
] as const)('%s: an undeclared argument key is refused by name', (_transport, startSession) => {
  let session: Session;
  let cleanupRoots: (() => void) | undefined;

  beforeAll(async () => {
    const roots = createHermeticRoots('undeclared-parameter-refusal-e2e');
    cleanupRoots = roots.cleanup;
    session = await startSession({ ...roots.env });
  }, 60000);

  afterAll(async () => {
    await session?.stop();
    cleanupRoots?.();
  });

  it.each(PLANTED)(
    '$tool',
    async ({ tool, control, planted, key, suggestion }) => {
      // Positive control FIRST: the probe has to be shown to observe a success before an error
      // means anything. Without it, a server that failed every call would read as a passing gate.
      const clean = await session.call(tool, control);
      expect(clean.isError).toBe(false);

      const refused = await session.call(tool, planted);

      expect(refused.isError).toBe(true);
      // Names the offending key, the tool, and the correction — not merely `isError`.
      expect(refused.text).toContain(`'${key}' is not a parameter of ${tool}`);
      expect(refused.text).toContain(suggestion);
    },
    30000
  );

  it('a mistyped safety flag no longer answers success', async () => {
    // The shape that motivates the whole change: `confirmed` is close enough to the real
    // `confirm` to look deliberate, and answering it with a normal result is what let a guarded
    // action run unguarded. `prompt-authority-api.ts` strips exactly this key by hand today.
    const refused = await session.call('system_control', {
      action: 'skills_sync',
      operation: 'export',
      client: 'claude-code',
      confirmed: true,
    });

    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("'confirmed' is not a parameter of system_control");
    expect(refused.text).toContain("Did you mean 'confirm'?");
  }, 30000);

  it('a DECLARED gate parameter sent while gates are off says so, not "not a parameter"', async () => {
    const disabled = await session.call('system_control', {
      action: 'gates',
      operation: 'disable',
      reason: 'undeclared parameter e2e',
    });
    expect(disabled.isError).toBe(false);

    try {
      const refused = await session.call('prompt_engine', {
        command: '>>listprompts',
        gate_verdict: 'GATE_REVIEW: PASS - probe',
      });

      expect(refused.isError).toBe(true);
      expect(refused.text).toContain("'gate_verdict' is a parameter of prompt_engine");
      expect(refused.text).toContain('the gate system is disabled');
      // The union half answered, not the undeclared half. `gate_verdict` IS in the contract.
      expect(refused.text).not.toContain('is not a parameter');
    } finally {
      await session.call('system_control', {
        action: 'gates',
        operation: 'enable',
        reason: 'undeclared parameter e2e',
      });
    }
  }, 30000);

  it('a misspelled key INSIDE gate_verdict reaches the client with its full path (P4.103)', async () => {
    // The same class one level down, and the one place it is a safety property: `gate_verdict` is
    // a union, zod reports a union failure as ONE issue with its sub-issues nested, and the SDK
    // renders top-level issues only — so this call used to come back as exactly
    // `gate_verdict: Invalid input`, on the SAFETY REVIEW submission, where the lost key also
    // leaves `passed` absent and an absent boolean reads as FAIL.
    //
    // Positive control first: the well-formed twin, differing in the ONE identifier.
    const accepted = await session.call('prompt_engine', {
      command: '>>listprompts',
      gate_verdict: {
        overall: 'PASS',
        rationale: 'probe',
        per_gate: [{ index: 1, passed: true, rationale: 'fine' }],
      },
    });
    expect(accepted.isError).toBe(false);

    const refused = await session.call('prompt_engine', {
      command: '>>listprompts',
      gate_verdict: {
        overall: 'PASS',
        rationale: 'probe',
        per_gate: [{ index: 1, pased: true, rationale: 'fine' }],
      },
    });

    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("'gate_verdict.per_gate[0].pased' is not a declared key");
    expect(refused.text).toContain("did you mean 'passed'?");
    // Names WHICH answer this is: the bare union message is what it replaced.
    expect(refused.text).not.toContain('gate_verdict: Invalid input');
  }, 30000);

  it('CONTROL: `_meta` rides on params, never on arguments, and is not refused', async () => {
    // Scope pin. The refusal walks `arguments`; a client-protocol field sitting beside it must
    // stay reachable, or every modern client's identity envelope becomes an error. `_meta` is
    // not in any tool contract, so if it ever reached `arguments` this call would be refused.
    const clean = await session.callWithMeta('system_control', { action: 'status' });

    expect(clean.isError).toBe(false);
    expect(clean.text).not.toContain('is not a parameter');
    expect(clean.text).toContain('System Status Overview');
  }, 30000);
});
