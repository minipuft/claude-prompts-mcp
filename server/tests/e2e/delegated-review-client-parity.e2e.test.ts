// @lifecycle test - Native delegated review transitions agree across pinned STDIO and fresh HTTP servers.
/** Unlike the own-args control, this exercises the first blocking review and its transport identity.
 * The worker is a fixture that reads the rendered trailer; no claim about LLM obedience is made.
 * STDIO uses the repo smoke test's newline JSON-RPC pattern with the modern HTTP helper's envelope.
 */
import { afterEach, describe, expect, test } from '@jest/globals';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { BRIEF_START, BRIEF_END } from '../../src/engine/execution/delegation/brief.js';
import type { GateReview } from '../../src/shared/types/chain-execution.js';
import { runFakeWorker } from '../helpers/delegation/fake-worker.js';
import { buildServerEnv, createHermeticRoots } from './helpers/child-env.js';
import {
  getAvailablePort,
  killServer,
  ModernMcpClient,
  MODERN_META_KEYS,
  MODERN_PROTOCOL_VERSION,
  startServerWithHttp,
  waitForHealth,
} from './helpers/http-mcp-client.js';

const SERVER_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WORKER_SYSTEM = readFileSync(
  path.join(SERVER_ROOT, 'resources/prompts/development/strategic_worker/system-message.md'),
  'utf8'
).split('\n')[0]!;
const PRODUCT =
  '## done\nfixture complete\n\n## concerns\nnone\n\n## deviations\nnone\n\n## findings\nverified\n\n## feedback\nclear brief';
interface ToolReply {
  content?: Array<{ text?: string }>;
  isError?: boolean;
}
interface Result {
  text: string;
  isError: boolean;
}
type Call = (name: string, args: Record<string, unknown>) => Promise<Result>;
const resultOf = (reply: ToolReply): Result => ({
  text: (reply.content ?? []).map((part) => part.text ?? '').join('\n'),
  isError: reply.isError === true,
});
const briefOf = (text: string) => text.split(BRIEF_START)[1]?.split(BRIEF_END)[0] ?? '';
const chainOf = (text: string) => {
  const id = /chain_id="(chain-[A-Za-z0-9_#-]+)"/.exec(text)?.[1];
  if (id === undefined) throw new Error('No rendered chain ID');
  return id;
};

// A single process/connection owns all STDIO calls. Only one request is sent at a time.
function stdioClient(env: Record<string, string>) {
  const proc = spawn(
    process.execPath,
    [path.join(SERVER_ROOT, 'dist/index.js'), '--transport=stdio', '--client=codex', '--quiet'],
    { cwd: SERVER_ROOT, env: buildServerEnv(env), stdio: ['pipe', 'pipe', 'pipe'] }
  );
  let id = 0,
    buffer = '',
    stderr = '';
  const pending = new Map<
    number,
    {
      resolve: (reply: ToolReply) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  proc.stdout.setEncoding('utf8');
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-3000);
  });
  proc.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      let message: { id?: number; result?: ToolReply; error?: { message: string } };
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (message.id === undefined) continue;
      const waiting = pending.get(message.id);
      if (waiting === undefined) continue;
      clearTimeout(waiting.timer);
      pending.delete(message.id);
      if (message.error !== undefined) waiting.reject(new Error(message.error.message));
      else waiting.resolve(message.result ?? {});
    }
  });
  const rejectPending = (error: Error) => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };
  proc.on('error', rejectPending);
  proc.on('exit', (code) => rejectPending(new Error(`STDIO exited ${code}: ${stderr}`)));
  const call: Call = async (name, args) => {
    const requestId = ++id;
    const reply = await new Promise<ToolReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`STDIO request ${requestId} timed out: ${stderr}`));
      }, 45000);
      pending.set(requestId, { resolve, reject, timer });
      proc.stdin.write(
        JSON.stringify({
          jsonrpc: '2.0',
          id: requestId,
          method: 'tools/call',
          params: {
            name,
            arguments: args,
            _meta: {
              [MODERN_META_KEYS.clientInfo]: { name: 'codex-cli', version: 'parity-test' },
              [MODERN_META_KEYS.clientCapabilities]: {},
              [MODERN_META_KEYS.protocolVersion]: MODERN_PROTOCOL_VERSION,
            },
          },
        }) + '\n'
      );
    });
    return resultOf(reply);
  };
  return { proc, call };
}

describe('delegated review client parity over actual MCP transports', () => {
  let teardown: Array<() => void | Promise<void>> = [];
  const observedDatabases = new Set<string>();
  afterEach(async () => {
    for (const cleanup of teardown.reverse()) await cleanup();
    teardown = [];
  });

  async function client(transport: 'stdio' | 'http') {
    const roots = createHermeticRoots(`delegated-parity-${transport}`);
    teardown.push(roots.cleanup);
    const workspace = path.join(roots.root, 'workspace');
    mkdirSync(workspace, { recursive: true });
    const env = { HOME: roots.home, MCP_WORKSPACE: workspace, MCP_RUNTIME_ROOT: roots.runtimeRoot };
    const dbPath = path.join(roots.runtimeRoot, 'runtime-state/state.db');
    expect(observedDatabases.has(dbPath)).toBe(false);
    observedDatabases.add(dbPath);
    if (transport === 'stdio') {
      const { proc, call } = stdioClient(env);
      teardown.push(() => killServer(proc));
      return { call, dbPath, pid: proc.pid };
    }
    const port = await getAvailablePort();
    const url = `http://127.0.0.1:${port}`;
    const proc = startServerWithHttp(port, { env });
    teardown.push(() => killServer(proc));
    await waitForHealth(url, { timeout: 45000, interval: 200 });
    const http = new ModernMcpClient(url, 'codex-cli');
    let id = 0;
    const call: Call = async (name, args) =>
      resultOf((await http.callTool(name, args, ++id)) as ToolReply);
    return { call, dbPath, pid: proc.pid };
  }

  function snapshot(dbPath: string, chainId: string) {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const opened = db.prepare('PRAGMA database_list').get() as { file: string };
      expect(realpathSync(opened.file)).toBe(realpathSync(dbPath));
      const run = db
        .prepare(
          'SELECT session_id, run_status, current_node_id, run_owner_pid, state FROM chain_runs WHERE chain_id = ?'
        )
        .get(chainId) as
        | {
            session_id: string;
            run_status: string;
            current_node_id: string | null;
            run_owner_pid: string;
            state: string;
          }
        | undefined;
      if (run === undefined) throw new Error(`Missing persisted run ${chainId}`);
      return {
        ...run,
        reviews: (JSON.parse(run.state) as { reviews?: Record<string, GateReview> }).reviews ?? {},
        nodes: db
          .prepare(
            'SELECT node_id, milestone, declared_sections_json FROM chain_run_nodes WHERE session_id = ? ORDER BY position'
          )
          .all(run.session_id) as Array<{
          node_id: string;
          milestone: string;
          declared_sections_json: string | null;
        }>,
        records: db
          .prepare(
            'SELECT status, gate_verdicts_json, handoff_evidence FROM execution_records WHERE session_id = ?'
          )
          .all(run.session_id) as Array<{
          status: string;
          gate_verdicts_json: string;
          handoff_evidence: string | null;
        }>,
      };
    } finally {
      db.close();
    }
  }

  function nativeBrief(text: string, token: string, gated: boolean) {
    const brief = briefOf(text);
    expect(text).toContain('Tool: spawn_agent');
    expect(text).not.toContain('Tool: Task');
    expect(text).not.toMatch(/model:\s*"codex-|codex-(high|standard|fast)/);
    expect(brief.split(WORKER_SYSTEM)).toHaveLength(2);
    expect(brief).toContain('done · concerns · deviations · findings · feedback');
    expect(brief).toContain('This transport envelope is mandatory');
    expect(text).not.toContain('**Required Sections**');
    expect(brief).toContain(`node: ${token}`);
    expect(brief).not.toContain('**Summary**:');
    expect(brief).not.toContain('**Gate Coverage**:');
    expect(text.slice(text.indexOf(BRIEF_END))).toContain('**Summary**:');
    const parentContent = text.slice(text.indexOf(BRIEF_END));
    if (gated) expect(parentContent).toContain('**Gate Coverage**:');
    else expect(parentContent).not.toContain('**Gate Coverage**:');
    return brief;
  }

  test.each(['stdio', 'http'] as const)(
    '%s preserves native review, retry, continuation and terminal state',
    async (transport) => {
      const { call, dbPath, pid } = await client(transport);
      const status = await call('system_control', { action: 'status' });
      expect(status.isError).toBe(false);
      expect(status.text).toMatch(/Framework System.*Enabled.*CAGEERF/i);
      const start = await call('prompt_engine', {
        workflow: {
          version: 1,
          nodes: [
            {
              id: 'parity-first',
              promptId: 'strategic_worker',
              delegated: true,
              inlineGateIds: ['pr-security'],
              args: {
                task: 'fixture row one',
                files: 'server/src/engine/execution/operators/chain-operator-executor.ts',
              },
            },
            {
              id: 'parity-next',
              promptId: 'strategic_worker',
              delegated: true,
              args: { task: 'fixture row two' },
            },
          ],
        },
      });
      expect(start.isError).toBe(false);
      const chainId = chainOf(start.text);
      const brief = nativeBrief(start.text, 'parity-first', true);
      const resume = (args: Record<string, unknown>) =>
        call('prompt_engine', { chain_id: chainId, ...args });
      const initial = snapshot(dbPath, chainId);
      expect(initial.run_owner_pid).toBe(String(pid));
      expect(initial.current_node_id).toBe('parity-first');
      expect(initial.reviews['parity-first']?.phase).toBe('awaiting-verdict');
      expect(initial.nodes.map((node) => node.node_id)).toEqual(['parity-first', 'parity-next']);
      // The production registry permits NULL or [] for a node declaring no framework headers.
      expect(JSON.parse(initial.nodes[0]!.declared_sections_json ?? '[]')).toEqual([]);

      const missing = await resume({
        user_response: runFakeWorker(brief, { body: PRODUCT, omitTrailer: true }),
      });
      expect(missing.isError).toBe(true);
      expect(missing.text).toContain('no trailer');
      const refused = snapshot(dbPath, chainId);
      expect(refused.current_node_id).toBe('parity-first');
      expect(refused.records.every((row) => row.handoff_evidence === null)).toBe(true);
      expect(refused.reviews['parity-first']?.history).toHaveLength(0);
      const worker = runFakeWorker(brief, { body: PRODUCT });
      const held = await resume({ user_response: worker });
      expect(held.isError).toBe(false);
      expect(held.text).toContain('Gate Review Required');
      const waiting = snapshot(dbPath, chainId);
      expect(waiting.current_node_id).toBe('parity-first');
      expect(waiting.run_status).not.toBe('completed');
      expect(waiting.reviews['parity-first']?.attemptCount).toBe(0);
      expect(waiting.records.filter((row) => row.handoff_evidence === 'ok')).toHaveLength(1);

      const failed = await resume({ gate_verdict: 'GATE_REVIEW: FAIL - fixture needs correction' });
      expect(failed.isError).toBe(false);
      expect(failed.text).toContain('Review Context');
      expect(failed.text).not.toContain(BRIEF_START);
      expect(failed.text).not.toContain('HANDOFF INSTRUCTIONS');
      expect(failed.text).not.toContain(WORKER_SYSTEM);
      const retry = snapshot(dbPath, chainId);
      expect(retry.current_node_id).toBe('parity-first');
      expect(retry.reviews['parity-first']?.attemptCount).toBe(1);
      expect(retry.reviews['parity-first']?.history).toHaveLength(1);
      const pass = {
        overall: 'PASS',
        rationale: 'fixture reviewed',
        reminders: { satisfied: retry.reviews['parity-first']!.gateIds, not_applicable: [] },
      };
      const accepted = await resume({ gate_verdict: pass });
      expect(accepted.isError).toBe(false);
      const nextBrief = nativeBrief(accepted.text, 'parity-next', false);
      const advanced = snapshot(dbPath, chainId);
      expect(advanced.current_node_id).toBe('parity-next');
      expect(advanced.reviews['parity-first']).toBeUndefined();
      expect(advanced.reviews['parity-next']).toBeUndefined();
      expect(JSON.parse(advanced.nodes[1]!.declared_sections_json ?? '[]')).toEqual([]);
      expect(
        advanced.records.some((row) => row.gate_verdicts_json.includes('attested satisfied'))
      ).toBe(true);
      const done = await resume({
        user_response: runFakeWorker(nextBrief, { body: PRODUCT }),
        gate_verdict: 'GATE_REVIEW: PASS - final fixture reviewed',
      });
      expect(done.isError).toBe(false);
      expect(done.text).toContain('Chain complete');
      expect(done.text).not.toContain('Continue:');
      expect(done.text).not.toContain('Next: chain_id=');
      const completed = snapshot(dbPath, chainId);
      expect(completed.current_node_id).toBeNull();
      expect(completed.run_status).toBe('completed');
      expect(completed.reviews).toEqual({});
      expect(completed.nodes.map((node) => node.milestone)).toEqual(['completed', 'completed']);
    },
    180000
  );
});
