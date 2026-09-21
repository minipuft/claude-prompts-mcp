// @lifecycle test - P4.88: the six server notifications reach a Streamable HTTP client.
/**
 * Streamable HTTP notification delivery, observed at a real client.
 *
 * Nothing here calls an `emit*` method. Every assertion reads the JSON-RPC messages that arrived
 * on a real POST's `text/event-stream` body, from a real spawned server, after a real gated chain
 * was driven through the real pipeline — because the defect this file closes was invisible to
 * every in-process test: the emitter's payloads were correct, its callers fired, and the bound
 * server it pushed through belonged to a different exchange.
 *
 * MEASURED ON `origin/main` f711401b, 2026-09-20: the identical drive delivered ZERO
 * notifications and the server log carried eight `Failed to send notification … Not connected`
 * warnings.
 *
 * The client is local rather than added to `helpers/http-mcp-client.ts` in one respect only: it
 * keeps EVERY message on the stream instead of the one matching the request id. The shared
 * client's `parseJsonOrSse` returns the first match and discards the rest, which is precisely
 * what made this class of defect unobservable from the existing helpers.
 */

import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

import path from 'path';

import {
  httpPost,
  killServer,
  getAvailablePort,
  startServerWithHttp,
  waitForHealth,
  PROJECT_ROOT,
} from './helpers/http-mcp-client.js';

import type { ChildProcess } from 'child_process';

/** One JSON-RPC message off a response stream. */
interface StreamMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: { content?: Array<{ text?: string }>; isError?: boolean };
  error?: unknown;
}

/** Everything the server wrote on one POST's stream, in arrival order. */
function allMessages(body: string): StreamMessage[] {
  const trimmed = body.trim();
  try {
    return [JSON.parse(trimmed) as StreamMessage];
  } catch {
    // SSE framing — the normal case for this server.
  }
  const out: StreamMessage[] = [];
  for (const line of trimmed.split('\n')) {
    const l = line.trim();
    if (!l.startsWith('data:')) continue;
    try {
      out.push(JSON.parse(l.slice(5).trim()) as StreamMessage);
    } catch {
      // Not a payload line.
    }
  }
  return out;
}

interface ToolOutcome {
  text: string;
  isError: boolean;
  /** Notifications delivered on THIS call's stream. */
  notifications: Array<{ method: string; params: Record<string, unknown> }>;
}

/**
 * `notifications/gate/response_blocked` is the one event with NO reachable producer over a drive,
 * so it is asserted in `tests/unit/infra/observability/request-scoped-notification-sink.test.ts`
 * instead of here — where the claim is only that the emitter routes it like its five siblings,
 * not that a client received it.
 *
 * MEASURED 2026-09-20 on this tree, with a positive control. A workspace gate carrying
 * `blockResponseOnFail: true` IS selected (it appears by id in both `gate/failed` and
 * `gate/retry_exhausted`), and still `context.gates.hasBlockingGates()` stays false, so the
 * `emitGateEvents(context, 'responseBlocked', …)` branch in `GateVerdictProcessor` is never
 * entered. The same gate's `retry_config.max_attempts: 5` is also not honored. Both values are
 * read by `readRegistryGateExecutionConfig`, whose registry lookup sits inside a bare `catch {}`
 * that defaults to `blockResponseOnFail = false` — reported under findings, out of scope here.
 */
describe('Streamable HTTP notification delivery', () => {
  let proc: ChildProcess;
  let baseUrl: string;
  let rpcId = 100;

  const callTool = async (name: string, args: Record<string, unknown>): Promise<ToolOutcome> => {
    const id = ++rpcId;
    const response = await httpPost(
      `${baseUrl}/mcp`,
      { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } },
      { Accept: 'application/json, text/event-stream' }
    );
    expect(response.status).toBe(200);
    const messages = allMessages(response.body);
    const answer = messages.find((m) => m.id === id);
    return {
      text: (answer?.result?.content ?? []).map((part) => part.text ?? '').join('\n'),
      isError: answer?.result?.isError === true,
      notifications: messages
        .filter((m) => m.method !== undefined && m.id === undefined)
        .map((m) => ({ method: m.method as string, params: m.params ?? {} })),
    };
  };

  const methodsOf = (outcome: ToolOutcome): string[] => outcome.notifications.map((n) => n.method);

  const chainIdOf = (text: string): string => {
    const match = /chain_id="(chain-[A-Za-z0-9_#-]+)"/.exec(text);
    if (match?.[1] === undefined) {
      throw new Error(`no chain id in response: ${text.slice(0, 300)}`);
    }
    return match[1];
  };

  beforeAll(async () => {
    const port = await getAvailablePort();
    baseUrl = `http://127.0.0.1:${port}`;
    proc = startServerWithHttp(port, {
      env: { MCP_RESOURCES_PATH: path.join(PROJECT_ROOT, 'server', 'resources') },
    });
    await waitForHealth(baseUrl, { timeout: 45000 });
  }, 60000);

  afterAll(async () => {
    if (proc) await killServer(proc);
  });

  test('a gate FAIL delivers gate/failed on the causing call and on no other', async () => {
    const start = await callTool('prompt_engine', {
      command: '>>quick_decision topic:"a blocked gate"',
    });
    const chainId = chainIdOf(start.text);

    // The call that STARTED the chain caused no gate verdict, so it must carry no gate event.
    // Paired with the assertion below, this is the control that the probe sees SOMETHING.
    expect(methodsOf(start)).not.toContain('notifications/gate/failed');

    const failed = await callTool('prompt_engine', {
      chain_id: chainId,
      user_response: 'Options: one, two, three.',
      gate_verdict: 'GATE_REVIEW: FAIL - the rejected options are not named',
    });

    expect(methodsOf(failed)).toContain('notifications/gate/failed');

    // Names WHICH gate answered. `toContain` on the method alone would keep passing if the
    // payload stopped carrying the failing gate's id or its reason.
    const event = failed.notifications.find((n) => n.method === 'notifications/gate/failed');
    expect(event?.params['reason']).toBe('the rejected options are not named');
    expect(typeof event?.params['gateId']).toBe('string');
  }, 60000);

  test('an exhausted retry delivers gate/retry_exhausted on the causing call', async () => {
    const start = await callTool('prompt_engine', {
      command: '>>quick_decision topic:"an exhausted retry"',
    });
    const chainId = chainIdOf(start.text);

    const first = await callTool('prompt_engine', {
      chain_id: chainId,
      user_response: 'Options: one, two, three.',
      gate_verdict: 'GATE_REVIEW: FAIL - first attempt',
    });
    expect(methodsOf(first)).not.toContain('notifications/gate/retry_exhausted');

    const second = await callTool('prompt_engine', {
      chain_id: chainId,
      user_response: 'Options: one, two, three (again).',
      gate_verdict: 'GATE_REVIEW: FAIL - second attempt',
    });
    expect(methodsOf(second)).toContain('notifications/gate/retry_exhausted');
  }, 60000);

  test('a chain driven to terminal delivers every step_complete and chain/complete', async () => {
    const start = await callTool('prompt_engine', {
      command: '>>quick_decision topic:"pick a database"',
    });
    const chainId = chainIdOf(start.text);

    const perCall: string[][] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      const outcome = await callTool('prompt_engine', {
        chain_id: chainId,
        user_response: `Step ${attempt + 1}: PostgreSQL, SQLite, DuckDB.`,
        gate_verdict: 'GATE_REVIEW: PASS - three options with tradeoffs',
      });
      perCall.push(methodsOf(outcome));
      if (/Chain execution complete/i.test(outcome.text)) break;
    }

    const all = perCall.flat();
    const steps = all.filter((m) => m === 'notifications/chain/step_complete');
    const completes = all.filter((m) => m === 'notifications/chain/complete');

    // `quick_decision` has three steps, and each resume that captured a step announces exactly
    // one — a per-call count, not a total, so a duplicate on one call is a failure even when the
    // total happens to be right.
    expect(steps).toHaveLength(3);
    expect(completes).toHaveLength(1);
    for (const call of perCall) {
      expect(
        call.filter((m) => m === 'notifications/chain/step_complete').length
      ).toBeLessThanOrEqual(1);
    }

    // ORDERING (plan row P4.89, not fixed here): on the final step `chain/complete` is announced
    // BEFORE the last `chain/step_complete`, because advance-on-PASS latches the run terminal
    // ahead of capture. The channel must not DROP either one when the response is about to end,
    // so the assertion is that both arrived on the SAME call — which is the case that would lose
    // one if the stream closed at the first of them.
    const finalCall = perCall[perCall.length - 1] ?? [];
    expect(finalCall).toContain('notifications/chain/complete');
    expect(finalCall).toContain('notifications/chain/step_complete');
  }, 90000);

  test('a framework switch delivers framework/changed on the causing call', async () => {
    const switched = await callTool('system_control', {
      action: 'framework',
      operation: 'switch',
      framework: 'react',
    });
    expect(methodsOf(switched)).toContain('notifications/framework/changed');

    const changed = switched.notifications.find(
      (n) => n.method === 'notifications/framework/changed'
    );
    expect(changed?.params['to']).toBe('react');
  }, 60000);

  test('a concurrent client receives its own events and none of the other call’s', async () => {
    const start = await callTool('prompt_engine', {
      command: '>>quick_decision topic:"concurrent isolation"',
    });
    const chainId = chainIdOf(start.text);

    // Two calls in flight at once on independent connections. One advances a chain step; the
    // other switches the framework.
    const [stepCall, frameworkCall] = await Promise.all([
      callTool('prompt_engine', {
        chain_id: chainId,
        user_response: 'Options: one, two, three.',
        gate_verdict: 'GATE_REVIEW: PASS - three options listed',
      }),
      callTool('system_control', {
        action: 'framework',
        operation: 'switch',
        framework: 'cageerf',
      }),
    ]);

    // POSITIVE CONTROL — each call received its OWN event. Without this, the two
    // `not.toContain` assertions below would pass on a build that delivers nothing at all,
    // which is exactly the state `origin/main` is in.
    expect(methodsOf(stepCall)).toContain('notifications/chain/step_complete');
    expect(methodsOf(frameworkCall)).toContain('notifications/framework/changed');

    // Neither saw the other's.
    expect(methodsOf(stepCall)).not.toContain('notifications/framework/changed');
    expect(methodsOf(frameworkCall)).not.toContain('notifications/chain/step_complete');
  }, 90000);
});
