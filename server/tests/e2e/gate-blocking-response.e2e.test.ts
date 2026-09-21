// @lifecycle test - P4.94: a gate declaring blockResponseOnFail withholds output AND says why.
/**
 * `blockResponseOnFail`, driven through the real pipeline on both transports.
 *
 * Nothing here reads an accumulator or calls an emit method. Every assertion reads what a client
 * got back from a real `tools/call` against a real spawned server, with a real workspace gate.
 *
 * MEASURED on `feat/rsc-hardening` 02c7a4c1, 2026-09-20, against the same fixture: the gate IS
 * selected, `hasBlockingGates()` IS true, the step output IS withheld and
 * `notifications/gate/response_blocked` IS delivered — so P4.94's reported premise ("a blocking
 * gate does not block") did not reproduce. What did reproduce is the defect this file pins: the
 * blocked reply was 291 characters naming the gate and nothing else, because the rendered gate
 * review — criteria, guidance, required response format — was dropped on the way out. The
 * `criteria` assertions below are the ones that were red before the fix.
 *
 * The control differs in ONE key. `e2e-noblock` is a byte-for-byte twin of `e2e-block` except
 * for the `blockResponseOnFail: true` line, so "the control neither withholds nor announces" is a
 * statement about that key and not about some other difference between two gates.
 */

import { afterEach, describe, expect, test } from '@jest/globals';

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildServerEnv, createHermeticRoots } from './helpers/child-env.js';
import {
  getAvailablePort,
  killServer,
  ModernMcpClient,
  startServerWithHttp,
  waitForHealth,
  type StreamNotification,
} from './helpers/http-mcp-client.js';

const SERVER_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIST_ENTRY = path.join(SERVER_ROOT, 'dist', 'index.js');

const BLOCK_GATE = 'e2e-block';
const CONTROL_GATE = 'e2e-noblock';
const MAX_ATTEMPTS = 5;
/** Unique to this fixture's guidance, so finding it proves the CRITERIA travelled, not prose. */
const GUIDANCE_MARKER = 'E2E-BLOCK-GUIDANCE-MARKER';
/** Unique to the step output, so finding it proves the block leaked what it exists to suppress. */
const OUTPUT_MARKER = 'E2E-STEP-OUTPUT-MARKER';

/** `quick_decision`'s category — how a `registry-auto` gate attaches to it. */
const PROMPT_CATEGORY = 'examples';

interface ToolOutcome {
  text: string;
  notifications: StreamNotification[];
}

interface Session {
  callTool(name: string, args: Record<string, unknown>): Promise<ToolOutcome>;
  stop(): Promise<void>;
}

function writeFixtureGate(workspace: string, gateId: string, blocking: boolean): void {
  const dir = path.join(workspace, 'resources', 'gates', gateId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, 'gate.yaml'),
    [
      `id: ${gateId}`,
      `name: ${gateId}`,
      'type: validation',
      `description: e2e fixture gate ${gateId}`,
      'severity: high',
      `guidance: ${GUIDANCE_MARKER}`,
      ...(blocking ? ['blockResponseOnFail: true'] : []),
      'pass_criteria:',
      '  - type: inline_guidance',
      'retry_config:',
      `  max_attempts: ${MAX_ATTEMPTS}`,
      '  improvement_hints: true',
      'activation:',
      '  prompt_categories:',
      `    - ${PROMPT_CATEGORY}`,
      '',
    ].join('\n'),
    'utf8'
  );
}

/**
 * One server process over Streamable HTTP, with its own workspace holding exactly one fixture
 * gate. `MCP_WORKSPACE` (not `MCP_RESOURCES_PATH`) because only the former turns on the overlay
 * that keeps the bundled catalog loaded underneath — `quick_decision` has to still be there.
 */
async function startHttpSession(env: Record<string, string>): Promise<Session> {
  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const proc = startServerWithHttp(port, { env });
  await waitForHealth(baseUrl, { timeout: 45000, interval: 200 });
  const client = new ModernMcpClient(baseUrl, 'gate-blocking-e2e');
  let nextId = 1;

  return {
    callTool: async (name, args) => {
      const outcome = await client.callToolWithNotifications(name, args, nextId++);
      const result = outcome.result as { content?: Array<{ text?: string }> } | undefined;
      return {
        text: (result?.content ?? []).map((part) => part.text ?? '').join('\n'),
        notifications: outcome.notifications,
      };
    },
    stop: () => killServer(proc),
  };
}

/**
 * One server process over STDIO. Notifications are id-less messages on the same stdout stream,
 * so they are collected as they arrive and attributed to the call in flight — STDIO has no
 * per-request stream to read them off.
 */
async function startStdioSession(env: Record<string, string>): Promise<Session> {
  const proc: ChildProcess = spawn('node', [DIST_ENTRY, '--transport=stdio', '--quiet'], {
    cwd: SERVER_ROOT,
    env: buildServerEnv(env),
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const pending = new Map<number, (message: Record<string, unknown>) => void>();
  let inFlight: StreamNotification[] = [];
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
      if (typeof message['id'] === 'number') {
        pending.get(message['id'])?.(message);
      } else if (typeof message['method'] === 'string') {
        inFlight.push({
          method: message['method'],
          params: (message['params'] as Record<string, unknown>) ?? {},
        });
      }
    }
  });

  let nextId = 1;
  const request = (method: string, params: Record<string, unknown>): Promise<unknown> => {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`STDIO ${method} (id ${id}) got no answer in 45s\n${stderr}`));
      }, 45000);
      pending.set(id, (message) => {
        clearTimeout(timer);
        pending.delete(id);
        if (message['error'] != null) {
          reject(new Error(JSON.stringify(message['error'])));
        } else {
          resolve(message['result']);
        }
      });
      proc.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  };

  await request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'gate-blocking-e2e', version: '1.0.0' },
  });
  proc.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

  return {
    callTool: async (name, args) => {
      inFlight = [];
      const result = (await request('tools/call', { name, arguments: args })) as {
        content?: Array<{ text?: string }>;
      };
      // One more turn of the loop: a notification written just before the answer may still be
      // unparsed when the answer's promise settles.
      await new Promise((resolve) => setTimeout(resolve, 150));
      return {
        text: (result?.content ?? []).map((part) => part.text ?? '').join('\n'),
        notifications: inFlight,
      };
    },
    stop: () => killServer(proc),
  };
}

const methodsOf = (outcome: ToolOutcome): string[] => outcome.notifications.map((n) => n.method);

function chainIdOf(text: string): string {
  const match = /chain_id="(chain-[A-Za-z0-9_#-]+)"/.exec(text);
  if (match?.[1] === undefined) {
    throw new Error(`no chain id in response: ${text.slice(0, 400)}`);
  }
  return match[1];
}

describe.each([
  ['STDIO', startStdioSession],
  ['Streamable HTTP', startHttpSession],
] as const)('%s: blockResponseOnFail', (_transport, startSession) => {
  let cleanup: Array<() => void | Promise<void>> = [];

  afterEach(async () => {
    for (const fn of cleanup.reverse()) await fn();
    cleanup = [];
  });

  /** A server whose workspace holds exactly one fixture gate. */
  const sessionWithGate = async (gateId: string, blocking: boolean): Promise<Session> => {
    const roots = createHermeticRoots('gate-blocking-e2e');
    const workspace = path.join(roots.root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    writeFixtureGate(workspace, gateId, blocking);
    const session = await startSession({
      HOME: roots.home,
      MCP_WORKSPACE: workspace,
      MCP_RUNTIME_ROOT: roots.runtimeRoot,
    });
    cleanup.push(() => session.stop(), roots.cleanup);
    return session;
  };

  test('a FAIL withholds the step output, returns the gate criteria, and announces response_blocked once', async () => {
    const session = await sessionWithGate(BLOCK_GATE, true);

    const start = await session.callTool('prompt_engine', {
      command: '>>quick_decision topic:"a blocked gate"',
    });
    // Positive control: the probe observes this call, which caused no verdict and must carry no
    // block. Without it, "no response_blocked on the control gate" below could be a mute probe.
    expect(methodsOf(start)).not.toContain('notifications/gate/response_blocked');
    const chainId = chainIdOf(start.text);

    const blocked = await session.callTool('prompt_engine', {
      chain_id: chainId,
      user_response: `${OUTPUT_MARKER}: one, two, three.`,
      gate_verdict: 'GATE_REVIEW: FAIL - the rejected options are not named',
    });

    // Exactly once, not merely present: a second announcement of one block is a defect.
    expect(
      methodsOf(blocked).filter((m) => m === 'notifications/gate/response_blocked')
    ).toHaveLength(1);
    const event = blocked.notifications.find(
      (n) => n.method === 'notifications/gate/response_blocked'
    );
    expect(event?.params['gateIds']).toContain(BLOCK_GATE);

    // Withheld: the step output does not come back.
    expect(blocked.text).toContain('Response Blocked');
    expect(blocked.text).not.toContain(OUTPUT_MARKER);

    // ...and the caller is told what to fix. This is the half that was missing: before the fix
    // the reply named the gate and stopped, so a blocked retry loop had nothing to act on.
    expect(blocked.text).toContain(BLOCK_GATE);
    expect(blocked.text).toContain(GUIDANCE_MARKER);
    expect(blocked.text).toContain('Required Response Format');
  }, 120000);

  test("max_attempts comes from the gate's retry_config, not the built-in default", async () => {
    const session = await sessionWithGate(BLOCK_GATE, true);

    const start = await session.callTool('prompt_engine', {
      command: '>>quick_decision topic:"an exhausted retry"',
    });
    const chainId = chainIdOf(start.text);

    const exhaustedOn: number[] = [];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS + 1; attempt++) {
      const outcome = await session.callTool('prompt_engine', {
        chain_id: chainId,
        user_response: `${OUTPUT_MARKER}: attempt ${attempt}.`,
        gate_verdict: `GATE_REVIEW: FAIL - attempt ${attempt} is not good enough`,
      });
      const event = outcome.notifications.find(
        (n) => n.method === 'notifications/gate/retry_exhausted'
      );
      if (event !== undefined) {
        exhaustedOn.push(attempt);
        expect(event.params['maxAttempts']).toBe(MAX_ATTEMPTS);
        break;
      }
    }

    // The default is 2. Landing on attempt 5 is what says the gate's own value was read; the
    // assertion is the WHOLE fact (which attempt), not "eventually exhausted".
    expect(exhaustedOn).toEqual([MAX_ATTEMPTS]);
  }, 180000);

  test('control: the twin gate without blockResponseOnFail neither withholds nor announces', async () => {
    const session = await sessionWithGate(CONTROL_GATE, false);

    const start = await session.callTool('prompt_engine', {
      command: '>>quick_decision topic:"an unblocked gate"',
    });
    const chainId = chainIdOf(start.text);

    const failed = await session.callTool('prompt_engine', {
      chain_id: chainId,
      user_response: `${OUTPUT_MARKER}: one, two, three.`,
      gate_verdict: 'GATE_REVIEW: FAIL - the rejected options are not named',
    });

    // Positive control for the two absences below: the gate IS attached and DID fail, so the
    // probe is observing a live gate review rather than a run with no gates at all.
    expect(methodsOf(failed)).toContain('notifications/gate/failed');
    expect(failed.text).toContain(GUIDANCE_MARKER);

    expect(methodsOf(failed)).not.toContain('notifications/gate/response_blocked');
    expect(failed.text).not.toContain('Response Blocked');
  }, 120000);
});
