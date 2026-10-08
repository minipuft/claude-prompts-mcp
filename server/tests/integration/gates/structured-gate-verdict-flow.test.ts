// @lifecycle test - Registered STDIO/HTTP custody of ordinary verdicts and staged report carriers.
import { spawn, type ChildProcess } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterAll, afterEach, beforeAll, describe, expect, test } from '@jest/globals';

import { buildServerEnv, createHermeticRoots } from '../../../scripts/lib/hermetic-server-env.js';
import { hashBytes } from '../../../src/shared/utils/hash.js';
import {
  getAvailablePort,
  killServer,
  ModernMcpClient,
  PROJECT_ROOT,
  startServerWithHttp,
  waitForHealth,
} from '../../e2e/helpers/http-mcp-client.js';

import { buildServerEnv as buildFreshServerEnv } from '../../e2e/helpers/child-env.js';

import type { GateReview, GateVerdictSummary } from '../../../src/shared/types/chain-execution.js';
import type { SemanticEvaluationReport } from '../../../src/shared/types/gate-evaluation.js';

const SERVER_ROOT = path.join(PROJECT_ROOT, 'server');
const GATE = 'registered-custody-check';
const OUTPUT = 'A😀e\u0301 Z';

interface ContextObservation {
  chainId: string | null;
  supplied: boolean;
  userResponse?: string;
}

/** Test-only child preload: observe the real context and always run the original stage. */
function contextObserverOptions(tracePath: string): string {
  const bootstrap = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
  const stage = pathToFileURL(
    path.join(SERVER_ROOT, 'src/engine/execution/pipeline/stages/01-request-normalization-stage.ts')
  ).href;
  const source = `
    await import(${JSON.stringify(bootstrap)});
    const { appendFileSync } = await import('node:fs');
    const { RequestNormalizationStage } = await import(${JSON.stringify(stage)});
    const original = RequestNormalizationStage.prototype.execute;
    RequestNormalizationStage.prototype.execute = async function(context) {
      const request = context.mcpRequest;
      appendFileSync(${JSON.stringify(tracePath)}, JSON.stringify({
        chainId: request.chain_id ?? null,
        supplied: Object.prototype.hasOwnProperty.call(request, 'user_response'),
        userResponse: request.user_response
      }) + String.fromCharCode(10));
      return await original.call(this, context);
    };
  `;
  return `--import=data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
}

function observedContexts(tracePath: string, chainId: string): ContextObservation[] {
  if (!existsSync(tracePath)) return [];
  return readFileSync(tracePath, 'utf8')
    .trim()
    .split(String.fromCharCode(10))
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ContextObservation)
    .filter((entry) => entry.chainId === chainId);
}

interface ToolReply {
  text: string;
  isError: boolean;
}
class RpcRefusal extends Error {
  constructor(
    readonly code: number,
    message: string
  ) {
    super(message);
  }
}
function toolReply(value: unknown): ToolReply {
  if (typeof value !== 'object' || value === null) throw new Error('No MCP tool result');
  const result = value as { content?: Array<{ text?: string }>; isError?: boolean };
  return {
    text: (result.content ?? []).map((part) => part.text ?? '').join('\n'),
    isError: result.isError === true,
  };
}

/** Real newline-delimited JSON-RPC, including the initialize/initialized exchange. */
class SourceStdioClient {
  private readonly proc: ChildProcess;
  private nextId = 1;
  private buffered = '';
  private stderr = '';
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(env: NodeJS.ProcessEnv, built = false) {
    this.proc = spawn(
      process.execPath,
      built
        ? [path.join(SERVER_ROOT, 'dist/index.js'), '--transport=stdio', '--quiet']
        : [
            '--import',
            'tsx',
            path.join(SERVER_ROOT, 'src/index.ts'),
            `--server-root=${SERVER_ROOT}`,
            '--transport=stdio',
            '--quiet',
          ],
      { cwd: SERVER_ROOT, env, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    this.proc.stderr?.on('data', (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-4000);
    });
    this.proc.stdout?.on('data', (chunk: Buffer) => {
      this.buffered += chunk.toString();
      let boundary: number;
      while ((boundary = this.buffered.indexOf('\n')) >= 0) {
        const line = this.buffered.slice(0, boundary);
        this.buffered = this.buffered.slice(boundary + 1);
        let message: { id?: number; result?: unknown; error?: { code: number; message: string } };
        try {
          message = JSON.parse(line);
        } catch {
          continue;
        }
        if (message.id === undefined) continue;
        const waiter = this.pending.get(message.id);
        if (waiter === undefined) continue;
        this.pending.delete(message.id);
        clearTimeout(waiter.timer);
        if (message.error !== undefined)
          waiter.reject(new RpcRefusal(message.error.code, message.error.message));
        else waiter.resolve(message.result);
      }
    });
    this.proc.on('error', (error) => this.rejectPending(error));
    this.proc.on('exit', () =>
      this.rejectPending(new Error(`Source STDIO exited: ${this.stderr}`))
    );
  }
  private rejectPending(error: Error): void {
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.pending.clear();
  }
  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`STDIO ${method} timed out: ${this.stderr}`));
      }, 30000);
      this.pending.set(id, { resolve, reject, timer });
      this.proc.stdin?.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }
  async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'registered-custody-stdio', version: '1' },
    });
    this.proc.stdin?.write(
      `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`
    );
  }
  get pid(): number {
    if (this.proc.pid === undefined) throw new Error('No spawned server PID');
    return this.proc.pid;
  }
  close(): Promise<void> {
    return killServer(this.proc);
  }
}

/** Private sender falsifier: drop the actual report before registered transport decoding. */
function wireArguments(args: Record<string, unknown>): Record<string, unknown> {
  if (process.env['SEMANTIC_WIRE_DROP_REPORT'] !== '1') return args;
  const copy = structuredClone(args);
  const verdict = copy['gate_verdict'];
  if (
    typeof verdict === 'object' &&
    verdict !== null &&
    'per_gate' in verdict &&
    Array.isArray(verdict.per_gate)
  ) {
    verdict.per_gate = verdict.per_gate.map(({ evaluation: _evaluation, ...entry }) => entry);
  }
  return copy;
}

/** Only read actual server-issued reviews; cold SQLite reads never construct server authority. */
function issuedState(
  runtimeRoot: string,
  chainId: string
): { currentNode: string | null; status: string; reviews: Record<string, GateReview> } {
  const db = new DatabaseSync(path.join(runtimeRoot, 'runtime-state/state.db'), { readOnly: true });
  try {
    const row = db
      .prepare('SELECT current_node_id, run_status, state FROM chain_runs WHERE chain_id = ?')
      .get(chainId) as { current_node_id: string | null; run_status: string; state: string };
    return {
      currentNode: row.current_node_id,
      status: row.run_status,
      reviews: (JSON.parse(row.state) as { reviews?: Record<string, GateReview> }).reviews ?? {},
    };
  } finally {
    db.close();
  }
}
function issuedReport(review: GateReview, passed = true): SemanticEvaluationReport {
  const issued = review.semanticContext;
  if (issued?.target === undefined) throw new Error('No server captured target');
  return {
    binding: {
      gate_id: GATE,
      node_id: issued.nodeId,
      attempt_id: issued.attemptId,
      definition_digest: issued.definitions[GATE]!.definitionDigest,
      target_digest: issued.target.digest,
    },
    observations: [
      {
        criterion_id: 'preserves-contract',
        state: passed ? 'met' : 'unmet',
        value: passed,
        evidence: [
          {
            target_digest: issued.target.digest,
            start: 0,
            end: issued.target.content.length,
            quote: issued.target.content,
          },
        ],
        rationale: 'Synthetic contract observation, not model accuracy.',
      },
    ],
  };
}
function submitted(report?: SemanticEvaluationReport) {
  return {
    overall: 'PASS',
    rationale: 'Client claim',
    per_gate: [
      {
        index: 1,
        passed: true,
        rationale: 'Client entry claim',
        ...(report === undefined ? {} : { evaluation: report }),
      },
    ],
  };
}

/** Hold immutable source/resource bytes through every spawned source or built host in this suite. */
function sourceTreeSnapshot(): Record<string, string> {
  const files: Record<string, string> = {};
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else files[path.relative(SERVER_ROOT, file)] = hashBytes(readFileSync(file));
    }
  };
  for (const directory of ['src', 'resources']) visit(path.join(SERVER_ROOT, directory));
  return files;
}
let sourceBefore: Record<string, string>;
beforeAll(() => {
  sourceBefore = sourceTreeSnapshot();
});
afterAll(() => {
  expect(sourceTreeSnapshot()).toEqual(sourceBefore);
});

type Call = (name: string, args: Record<string, unknown>) => Promise<ToolReply>;
describe.each(['stdio', 'http'] as const)(
  'registered %s: separate source custody and built semantic acceptance',
  (transport) => {
    const cleanup: Array<() => void | Promise<void>> = [];
    afterEach(async () => {
      for (const dispose of cleanup.splice(0).reverse()) await dispose();
    });

    async function fixture(
      options: {
        built?: boolean;
        tool?: boolean;
        mode?: 'blocking' | 'advisory';
        detached?: boolean;
        disabled?: boolean;
      } = {}
    ): Promise<{
      call: Call;
      chainId: string;
      runtimeRoot: string;
      contextTrace: string;
      rollingHandoff: (token: string) => Promise<{ oldPid: number; newPid: number }>;
    }> {
      const roots = createHermeticRoots(`registered-custody-${transport}`);
      const workspace = path.join(roots.root, 'workspace');
      mkdirSync(workspace);
      cleanup.push(roots.cleanup);
      const contextTrace = path.join(roots.root, 'context-custody.jsonl');
      const overrides = {
        ...roots.env,
        MCP_WORKSPACE: workspace,
        ...(options.built === true ? {} : { NODE_OPTIONS: contextObserverOptions(contextTrace) }),
        MCP_SHELL_VERIFY_ALLOWLIST: `${process.execPath} *`,
      };
      if (options.disabled === true) {
        const config = path.join(roots.root, 'disabled.json');
        writeFileSync(config, JSON.stringify({ version: 5, gates: { enabled: false } }));
        Object.assign(overrides, { MCP_CONFIG_PATH: config });
      }
      const env =
        options.built === true ? buildFreshServerEnv(overrides) : buildServerEnv(overrides);
      async function connect(): Promise<{ call: Call; close: () => Promise<void>; pid: number }> {
        let call: Call;
        if (transport === 'stdio') {
          const client = new SourceStdioClient(env, options.built === true);
          cleanup.push(() => client.close());
          await client.initialize();
          call = async (name, args) => {
            try {
              return toolReply(await client.request('tools/call', { name, arguments: args }));
            } catch (error) {
              if (error instanceof RpcRefusal)
                return { text: `RPC ${error.code}: ${error.message}`, isError: true };
              throw error;
            }
          };
          return { call, close: () => client.close(), pid: client.pid };
        } else {
          const port = await getAvailablePort();
          const baseUrl = `http://127.0.0.1:${port}`;
          const proc = startServerWithHttp(port, {
            source: options.built !== true,
            env: overrides,
          });
          cleanup.push(() => killServer(proc));
          await waitForHealth(baseUrl, { timeout: 30000 });
          const client = new ModernMcpClient(baseUrl, 'registered-custody-http');
          let id = 1;
          call = async (name, args) =>
            toolReply(
              await client.request('tools/call', { name, arguments: args }, id++, {
                toolName: name,
              })
            );
          if (proc.pid === undefined) throw new Error('No spawned HTTP PID');
          return { call, close: () => killServer(proc), pid: proc.pid };
        }
      }
      let host = await connect();
      const call: Call = (name, args) =>
        host.call(name, options.built === true ? wireArguments(args) : args);
      expect(
        (await call('system_control', { action: 'framework', operation: 'disable' })).isError
      ).toBe(false);
      const gate = await call('resource_manager', {
        resource_type: 'gate',
        action: 'create',
        id: GATE,
        name: GATE,
        description:
          options.built === true
            ? 'Actual required semantic review'
            : 'Ordinary failing tool check used only as a report carrier',
        guidance: 'Review the captured output.',
        enforcement_mode: options.mode ?? 'blocking',
        retry_config: { max_attempts: 6 },
        ...(options.built === true
          ? {
              calibration_suite_id: '../opaque-public-association',
              evaluation: { mode: 'self', strict: true },
            }
          : {}),
        pass_criteria:
          options.built === true
            ? [
                {
                  type: 'semantic_evaluation',
                  id: 'preserves-contract',
                  target: { kind: 'step_output' },
                  question: 'Does the output preserve the contract?',
                  evidence_requirements: { min_items: 1 },
                  result: { kind: 'boolean' },
                  acceptance: { kind: 'equals', value: true },
                },
                ...(options.tool === true
                  ? [
                      {
                        type: 'shell_verify',
                        shell_command: [process.execPath, '-e', 'process.exit(0)'],
                      },
                    ]
                  : []),
              ]
            : [
                {
                  type: 'shell_verify',
                  shell_command: [process.execPath, '-e', 'process.exit(1)'],
                },
              ],
      });
      expect(gate.isError).toBe(false);
      const prompt = await call('resource_manager', {
        resource_type: 'prompt',
        action: 'create',
        id: 'registered_custody',
        name: 'Registered custody',
        category: 'general',
        description: 'Hermetic ordinary review',
        user_message_template: 'REGISTERED-CUSTODY-OUTPUT',
        gate_configuration: { exclude: ['content-structure'], framework_gates: false },
      });
      expect(prompt.isError).toBe(false);
      const started = await call(
        'prompt_engine',
        options.detached === true
          ? {
              workflow: {
                version: 1,
                nodes: [
                  {
                    id: 'reviewed-worker',
                    promptId: 'registered_custody',
                    delegated: true,
                    await: 'run',
                    inlineGateIds: [GATE],
                  },
                  { id: 'current-parent', promptId: 'registered_custody' },
                ],
              },
            }
          : options.built === true
            ? {
                workflow: {
                  version: 1,
                  nodes: [
                    { id: 'reviewed-node', promptId: 'registered_custody', inlineGateIds: [GATE] },
                  ],
                },
              }
            : { command: '>>registered_custody', gates: [GATE] }
      );
      expect(started.isError).toBe(false);
      const chainId = /chain_id="(chain-[A-Za-z0-9_#-]+)"/.exec(started.text)?.[1];
      if (chainId === undefined) throw new Error(`No registered chain id: ${started.text}`);
      if (process.env['SEMANTIC_WIRE_TRACE'] !== undefined)
        appendFileSync(
          process.env['SEMANTIC_WIRE_TRACE'],
          JSON.stringify({ transport, built: options.built === true, root: roots.root, chainId }) +
            '\n'
        );
      return {
        call,
        chainId,
        runtimeRoot: roots.runtimeRoot,
        contextTrace,
        rollingHandoff: async (token) => {
          const oldPid = host.pid;
          const fresh = await connect(); // Startup must see a live owner; dead-owner runs are pruned.
          expect(fresh.pid).not.toBe(oldPid);
          await host.close();
          host = fresh;
          expect(
            (await call('system_control', { action: 'framework', operation: 'disable' })).isError
          ).toBe(false);
          expect((await call('prompt_engine', { claim_token: token })).isError).toBe(false);
          return { oldPid, newPid: host.pid };
        },
      };
    }
    function captured(runtimeRoot: string, chainId: string): GateVerdictSummary[] {
      const db = new DatabaseSync(path.join(runtimeRoot, 'runtime-state/state.db'), {
        readOnly: true,
      });
      try {
        const rows = db
          .prepare(
            'SELECT gate_verdicts_json FROM execution_records WHERE chain_id = ? ORDER BY execution_id'
          )
          .all(chainId) as unknown as Array<{ gate_verdicts_json: string }>;
        return rows.flatMap((row) => JSON.parse(row.gate_verdicts_json) as GateVerdictSummary[]);
      } finally {
        db.close();
      }
    }

    function answeredNodes(
      runtimeRoot: string,
      chainId: string
    ): { nodes: number; answered: number } {
      const db = new DatabaseSync(path.join(runtimeRoot, 'runtime-state/state.db'), {
        readOnly: true,
      });
      try {
        return db
          .prepare(
            'SELECT COUNT(*) AS nodes, COUNT(n.responded_at) AS answered FROM chain_run_nodes n JOIN chain_runs r ON r.session_id = n.session_id WHERE r.chain_id = ?'
          )
          .get(chainId) as unknown as { nodes: number; answered: number };
      } finally {
        db.close();
      }
    }

    test('built server pins survive persisted retry, refuse stale/body changes, then accept a fresh report', async () => {
      const { call, chainId, runtimeRoot } = await fixture({ built: true });
      const resume = (args: Record<string, unknown>) =>
        call('prompt_engine', { chain_id: chainId, ...args });
      const unbound = Object.values(issuedState(runtimeRoot, chainId).reviews)[0]!;
      expect(unbound.semanticContext?.target).toBeUndefined();
      expect((await resume({ gate_verdict: submitted() })).isError).toBe(true);
      expect(issuedState(runtimeRoot, chainId).reviews[unbound.nodeId]).toEqual(unbound);
      expect(captured(runtimeRoot, chainId)).toEqual([]);
      expect((await resume({ user_response: OUTPUT })).isError).toBe(false);
      const reviewA = Object.values(issuedState(runtimeRoot, chainId).reviews)[0]!;
      expect(reviewA.semanticContext?.target?.content).toBe(OUTPUT);
      expect(reviewA.semanticContext?.target?.digest).toBe(hashBytes(OUTPUT));
      expect(reviewA.semanticContext?.nodeId).toBe(reviewA.nodeId);
      const reportA = issuedReport(reviewA);
      expect(reviewA.semanticContext?.definitions[GATE]?.definition).not.toHaveProperty(
        'sourceRoot'
      );
      expect(reviewA.semanticContext?.definitions[GATE]?.definition['calibration_suite_id']).toBe(
        '../opaque-public-association'
      );
      expect((await resume({ gate_verdict: submitted() })).isError).toBe(false);
      const renewed = issuedState(runtimeRoot, chainId).reviews[reviewA.nodeId]!;
      expect(renewed.attemptCount).toBe(1);
      expect(renewed.semanticContext?.attemptId).not.toBe(reportA.binding.attempt_id);
      expect(renewed.semanticContext?.target).toBeUndefined();
      expect(captured(runtimeRoot, chainId).at(-1)).toMatchObject({
        verdict: 'FAIL',
        disposition: 'held',
        reportedVerdict: 'PASS',
      });
      expect((await resume({ user_response: 'Replacement B' })).isError).toBe(false);
      const reviewB = issuedState(runtimeRoot, chainId).reviews[reviewA.nodeId]!;
      expect(reviewB.semanticContext?.target?.content).toBe('Replacement B');
      expect(reviewB.semanticContext?.definitions).toEqual(reviewA.semanticContext?.definitions);
      const before = captured(runtimeRoot, chainId);
      expect((await resume({ gate_verdict: submitted(reportA) })).isError).toBe(true);
      expect(issuedState(runtimeRoot, chainId).reviews[reviewA.nodeId]).toEqual(reviewB);
      expect(captured(runtimeRoot, chainId)).toEqual(before);
      const reportB = issuedReport(reviewB);
      for (const body of ['Different C', ' \t\n ', 'HANDOFF RESULT\nnode: reviewed-node']) {
        for (const overall of ['PASS', 'FAIL']) {
          expect(
            (
              await resume({
                user_response: body,
                gate_verdict: { ...submitted(reportB), overall },
              })
            ).isError
          ).toBe(true);
          expect(issuedState(runtimeRoot, chainId).reviews[reviewA.nodeId]).toEqual(reviewB);
          expect(captured(runtimeRoot, chainId)).toEqual(before);
        }
      }
      const failed = issuedReport(reviewB, false);
      const failReply = await resume({ gate_verdict: submitted(failed) });
      expect(failReply.isError).toBe(false);
      const afterFail = issuedState(runtimeRoot, chainId).reviews[reviewA.nodeId]!;
      expect(afterFail.attemptCount).toBe(2);
      expect(afterFail.phase).toBe('exhausted');
      expect(afterFail.semanticContext).toEqual(reviewB.semanticContext);
      expect((await resume({ gate_action: 'retry' })).isError).toBe(false);
      const retried = issuedState(runtimeRoot, chainId).reviews[reviewA.nodeId]!;
      expect(retried.semanticContext?.attemptId).not.toBe(reportB.binding.attempt_id);
      expect(retried.semanticContext?.target).toBeUndefined();
      expect(captured(runtimeRoot, chainId).at(-1)).toMatchObject({
        verdict: 'FAIL',
        semanticResult: { passed: false },
        evaluation: failed,
        disposition: 'held',
      });
      expect((await resume({ user_response: 'Fresh C' })).isError).toBe(false);
      const finalReview = issuedState(runtimeRoot, chainId).reviews[reviewA.nodeId]!;
      const valid = issuedReport(finalReview);
      expect((await resume({ gate_verdict: submitted(valid) })).isError).toBe(false);
      expect(issuedState(runtimeRoot, chainId).reviews[reviewA.nodeId]).toBeUndefined();
      expect(issuedState(runtimeRoot, chainId).status).toBe('completed');
      expect(captured(runtimeRoot, chainId).at(-1)).toMatchObject({
        verdict: 'PASS',
        semanticResult: { valid: true, passed: true },
        evaluation: valid,
        reviewBinding: valid.binding,
        requestedEvaluation: { mode: 'self', strict: true },
      });
      expect(captured(runtimeRoot, chainId).at(-1)?.evaluation).not.toHaveProperty('reviewer');
    }, 90000);

    test('built rolling cold hydration retains frozen authority after private catalog changes', async () => {
      const { call, chainId, runtimeRoot, rollingHandoff } = await fixture({ built: true });
      await call('prompt_engine', { chain_id: chainId, user_response: OUTPUT });
      const before = Object.values(issuedState(runtimeRoot, chainId).reviews)[0]!;
      const report = issuedReport(before);
      const criteria = before.semanticContext!.definitions[GATE]!.definition['pass_criteria'];
      if (!Array.isArray(criteria)) throw new Error('No actual frozen criteria');
      expect(
        (
          await call('resource_manager', {
            resource_type: 'gate',
            action: 'update',
            id: GATE,
            pass_criteria: criteria.map((criterion) => ({
              ...criterion,
              acceptance: { kind: 'equals', value: false },
            })),
          })
        ).isError
      ).toBe(false);
      expect(
        (await call('resource_manager', { resource_type: 'gate', action: 'inspect', id: GATE }))
          .text
      ).toContain('"value": false');
      const minted = await call('prompt_engine', { chain_id: chainId, handoff: true });
      const token = /Token: `(hnd_[^`]+)`/.exec(minted.text)?.[1];
      if (token === undefined) throw new Error('No server handoff token');
      const pids = await rollingHandoff(token);
      const hydrated = issuedState(runtimeRoot, chainId).reviews[before.nodeId]!;
      expect(hydrated.semanticContext).toEqual(before.semanticContext);
      const db = new DatabaseSync(path.join(runtimeRoot, 'runtime-state/state.db'), {
        readOnly: true,
      });
      try {
        expect(
          db.prepare('SELECT run_owner_pid FROM chain_runs WHERE chain_id = ?').get(chainId)
        ).toEqual({ run_owner_pid: String(pids.newPid) });
      } finally {
        db.close();
      }
      if (process.env['SEMANTIC_WIRE_TRACE'] !== undefined)
        appendFileSync(
          process.env['SEMANTIC_WIRE_TRACE'],
          JSON.stringify({
            transport,
            diagnostic: 'rolling-cold-hydration',
            ...pids,
            before: before.semanticContext,
            after: hydrated.semanticContext,
          }) + '\n'
        );
      expect(
        (await call('resource_manager', { resource_type: 'gate', action: 'inspect', id: GATE }))
          .text
      ).toContain('"value": false');
      expect(
        (await call('prompt_engine', { chain_id: chainId, gate_verdict: submitted(report) }))
          .isError
      ).toBe(false);
      expect(captured(runtimeRoot, chainId).at(-1)).toMatchObject({
        verdict: 'PASS',
        evaluation: report,
        reviewBinding: report.binding,
      });
      expect(issuedState(runtimeRoot, chainId).reviews[before.nodeId]).toBeUndefined();
    }, 90000);

    test('built identical canonical body FAIL renews without old-body recapture', async () => {
      const { call, chainId, runtimeRoot } = await fixture({ built: true });
      await call('prompt_engine', { chain_id: chainId, user_response: OUTPUT });
      const review = Object.values(issuedState(runtimeRoot, chainId).reviews)[0]!;
      const failed = issuedReport(review, false);
      const reply = await call('prompt_engine', {
        chain_id: chainId,
        user_response: `  ${OUTPUT}\n`,
        gate_verdict: submitted(failed),
      });
      expect(reply.isError).toBe(false);
      const renewed = issuedState(runtimeRoot, chainId).reviews[review.nodeId]!;
      if (process.env['SEMANTIC_WIRE_TRACE'] !== undefined)
        appendFileSync(
          process.env['SEMANTIC_WIRE_TRACE'],
          JSON.stringify({
            transport,
            diagnostic: 'same-body-fail',
            before: review,
            after: renewed,
            reply,
            ledger: captured(runtimeRoot, chainId),
          }) + '\n'
        );
      expect(renewed.phase).toBe('awaiting-verdict');
      expect(renewed.attemptCount).toBe(1);
      expect(renewed.semanticContext?.attemptId).not.toBe(failed.binding.attempt_id);
      expect(renewed.semanticContext?.target).toBeUndefined();
      expect(captured(runtimeRoot, chainId).at(-1)).toMatchObject({
        verdict: 'FAIL',
        evaluation: failed,
        semanticResult: { valid: true, passed: false },
      });
    }, 90000);

    test('built equivalent surrounding whitespace preserves canonical report acceptance', async () => {
      const { call, chainId, runtimeRoot } = await fixture({ built: true });
      await call('prompt_engine', { chain_id: chainId, user_response: OUTPUT });
      const review = Object.values(issuedState(runtimeRoot, chainId).reviews)[0]!;
      const report = issuedReport(review);
      const reply = await call('prompt_engine', {
        chain_id: chainId,
        user_response: `  ${OUTPUT}\n`,
        gate_verdict: submitted(report),
      });
      expect(reply.isError).toBe(false);
      expect(captured(runtimeRoot, chainId).at(-1)).toMatchObject({
        verdict: 'PASS',
        evaluation: report,
        reviewBinding: report.binding,
      });
      expect(issuedState(runtimeRoot, chainId).reviews[review.nodeId]).toBeUndefined();
    }, 90000);

    test('built mixed tool success cannot substitute semantic evidence', async () => {
      const { call, chainId, runtimeRoot } = await fixture({ built: true, tool: true });
      expect(
        (await call('prompt_engine', { chain_id: chainId, user_response: OUTPUT })).isError
      ).toBe(false);
      const review = Object.values(issuedState(runtimeRoot, chainId).reviews)[0]!;
      expect(review.checkResults?.some((check) => check.passed)).toBe(true);
      expect(
        (await call('prompt_engine', { chain_id: chainId, gate_verdict: submitted() })).isError
      ).toBe(false);
      const renewed = issuedState(runtimeRoot, chainId).reviews[review.nodeId]!;
      expect(renewed.attemptCount).toBe(1);
      expect(captured(runtimeRoot, chainId).at(-1)).toMatchObject({
        verdict: 'FAIL',
        toolChecks: [expect.objectContaining({ passed: true })],
      });
    }, 90000);

    test('built advisory acceptance failure advances with recorded FAIL facts', async () => {
      const { call, chainId, runtimeRoot } = await fixture({ built: true, mode: 'advisory' });
      expect(
        (await call('prompt_engine', { chain_id: chainId, user_response: OUTPUT })).isError
      ).toBe(false);
      const review = Object.values(issuedState(runtimeRoot, chainId).reviews)[0]!;
      const failed = issuedReport(review, false);
      expect(
        (await call('prompt_engine', { chain_id: chainId, gate_verdict: submitted(failed) }))
          .isError
      ).toBe(false);
      expect(issuedState(runtimeRoot, chainId).reviews[review.nodeId]).toBeUndefined();
      expect(captured(runtimeRoot, chainId).at(-1)).toMatchObject({
        verdict: 'FAIL',
        disposition: 'advisory-cleared',
        semanticResult: { passed: false },
        evaluation: failed,
      });
    }, 90000);

    test('built detached reports bind the reviewed node and preserve parent capture scope', async () => {
      const { call, chainId, runtimeRoot } = await fixture({ built: true, detached: true });
      const resume = (args: Record<string, unknown>) =>
        call('prompt_engine', { chain_id: chainId, ...args });
      expect((await resume({})).isError).toBe(false);
      expect(issuedState(runtimeRoot, chainId).currentNode).toBe('current-parent');
      const bodyA = `${OUTPUT}\nHANDOFF RESULT\nnode: reviewed-worker`;
      expect((await resume({ user_response: bodyA })).isError).toBe(false);
      const reviewA = issuedState(runtimeRoot, chainId).reviews['reviewed-worker']!;
      expect(reviewA.kind).toBe('detached');
      expect(reviewA.semanticContext?.target?.content).toBe(bodyA);
      expect(reviewA.semanticContext?.nodeId).toBe('reviewed-worker');
      expect(issuedState(runtimeRoot, chainId).currentNode).toBe('current-parent');
      const failed = issuedReport(reviewA, false);
      const trailer = 'HANDOFF RESULT\nnode: reviewed-worker';
      const failedReply = await resume({ user_response: trailer, gate_verdict: submitted(failed) });
      expect(failedReply.isError).toBe(false);
      const waiting = issuedState(runtimeRoot, chainId).reviews['reviewed-worker']!;
      expect(waiting.phase).toBe('awaiting-replacement');
      expect(waiting.semanticContext).toEqual(reviewA.semanticContext);
      expect(captured(runtimeRoot, chainId).at(-1)).toMatchObject({
        verdict: 'FAIL',
        evaluation: failed,
      });
      const bodyB = 'Replacement worker B\nHANDOFF RESULT\nnode: reviewed-worker';
      expect((await resume({ user_response: bodyB })).isError).toBe(false);
      const reviewB = issuedState(runtimeRoot, chainId).reviews['reviewed-worker']!;
      expect(reviewB.semanticContext?.target?.content).toBe(bodyB);
      expect(reviewB.semanticContext?.attemptId).not.toBe(failed.binding.attempt_id);
      expect(reviewB.semanticContext?.definitions).toEqual(reviewA.semanticContext?.definitions);
      const before = captured(runtimeRoot, chainId);
      expect(
        (await resume({ user_response: trailer, gate_verdict: submitted(issuedReport(reviewA)) }))
          .isError
      ).toBe(true);
      expect(issuedState(runtimeRoot, chainId).reviews['reviewed-worker']).toEqual(reviewB);
      expect(captured(runtimeRoot, chainId)).toEqual(before);
      const valid = issuedReport(reviewB);
      expect(
        (
          await resume({
            user_response: `\`\`\`\n${trailer}\n\`\`\``,
            gate_verdict: submitted(valid),
          })
        ).isError
      ).toBe(false);
      expect(issuedState(runtimeRoot, chainId).reviews['reviewed-worker']).toBeUndefined();
      expect(issuedState(runtimeRoot, chainId).currentNode).toBe('current-parent');
      expect(captured(runtimeRoot, chainId).at(-1)).toMatchObject({
        verdict: 'PASS',
        evaluation: valid,
        reviewBinding: valid.binding,
      });
      expect(answeredNodes(runtimeRoot, chainId).answered).toBe(1);
    }, 90000);

    test('built artifact declarations remain unavailable at review rendering', async () => {
      const { call, chainId, runtimeRoot } = await fixture({ built: true });
      const update = await call('resource_manager', {
        resource_type: 'gate',
        action: 'update',
        id: GATE,
        pass_criteria: [
          {
            type: 'semantic_evaluation',
            id: 'artifact-contract',
            target: { kind: 'artifact', id: '../opaque-reference' },
            question: 'Is the artifact supported?',
            evidence_requirements: { min_items: 1 },
            result: { kind: 'boolean' },
            acceptance: { kind: 'equals', value: true },
          },
        ],
      });
      expect(update.isError).toBe(false);
      expect(
        (await call('resource_manager', { resource_type: 'gate', action: 'inspect', id: GATE }))
          .text
      ).toContain('../opaque-reference');
      const refusal = await call('prompt_engine', {
        workflow: {
          version: 1,
          nodes: [{ id: 'artifact-node', promptId: 'registered_custody', inlineGateIds: [GATE] }],
        },
      });
      expect(refusal.isError).toBe(true);
      expect(refusal.text).toContain('Artifact semantic capture is unavailable');
      expect(captured(runtimeRoot, chainId)).toEqual([]);
    }, 90000);

    test('built disabled gates retain ordinary capture without fabricated semantic acceptance', async () => {
      const { call, chainId, runtimeRoot } = await fixture({ built: true, disabled: true });
      expect(
        (await call('prompt_engine', { chain_id: chainId, user_response: OUTPUT })).isError
      ).toBe(false);
      expect(issuedState(runtimeRoot, chainId).reviews).toEqual({});
      expect(answeredNodes(runtimeRoot, chainId).answered).toBe(1);
      expect(captured(runtimeRoot, chainId)).toEqual([]);
    }, 90000);

    test('supplied whitespace reaches the real context as empty while report-only omission stays absent', async () => {
      const { call, chainId, runtimeRoot, contextTrace } = await fixture();
      const before = answeredNodes(runtimeRoot, chainId);
      expect(before.nodes).toBeGreaterThan(0);
      expect(before.answered).toBe(0);
      const whitespace = await call('prompt_engine', {
        chain_id: chainId,
        user_response: String.fromCharCode(32, 9, 10, 32),
        gate_verdict: 'GATE_REVIEW: FAIL - No replacement output',
      });
      expect(whitespace.isError).toBe(false);
      const supplied = observedContexts(contextTrace, chainId).at(-1);
      expect(supplied).toMatchObject({ supplied: true, userResponse: '' });
      expect(answeredNodes(runtimeRoot, chainId)).toEqual(before);
      const omitted = await call('prompt_engine', {
        chain_id: chainId,
        gate_verdict: 'GATE_REVIEW: FAIL - Report-only review',
      });
      expect(omitted.isError).toBe(false);
      const absent = observedContexts(contextTrace, chainId).at(-1);
      expect(absent).toMatchObject({ supplied: false });
      expect(absent).not.toHaveProperty('userResponse');
      expect(answeredNodes(runtimeRoot, chainId)).toEqual(before);
    }, 90000);

    test('the SDK refuses literal empty response before context while nonempty Unicode retains canonical bytes', async () => {
      const { call, chainId, runtimeRoot, contextTrace } = await fixture();
      const before = observedContexts(contextTrace, chainId).length;
      const invalid = {
        chain_id: chainId,
        user_response: '',
        gate_verdict: 'GATE_REVIEW: FAIL - Empty input',
      };
      const refused = await call('prompt_engine', invalid);
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain('User response cannot be empty');
      expect(observedContexts(contextTrace, chainId)).toHaveLength(before);
      expect(answeredNodes(runtimeRoot, chainId).answered).toBe(0);
      const unicode = String.fromCodePoint(0x41, 0x1f600, 0x65, 0x301, 0x20, 0x5a);
      const accepted = await call('prompt_engine', {
        chain_id: chainId,
        user_response: `  ${unicode}${String.fromCharCode(10)}`,
        gate_verdict: 'GATE_REVIEW: FAIL - Unicode output supplied',
      });
      expect(accepted.isError).toBe(false);
      expect(observedContexts(contextTrace, chainId).at(-1)).toMatchObject({
        supplied: true,
        userResponse: unicode,
      });
      expect(answeredNodes(runtimeRoot, chainId).answered).toBe(1);
    }, 90000);

    test('rich carrier survives actual registration, capture and persisted history', async () => {
      const { call, chainId, runtimeRoot } = await fixture();
      expect(captured(runtimeRoot, chainId)).toEqual([]);
      const targetDigest = hashBytes(OUTPUT);
      // Client claims for a staged carrier, not server-issued authority or semantic acceptance.
      const evaluation: SemanticEvaluationReport = {
        binding: {
          gate_id: GATE,
          node_id: 'fixture-node',
          attempt_id: 'fixture-attempt',
          definition_digest: hashBytes('ordinary carrier definition'),
          target_digest: targetDigest,
        },
        observations: [
          {
            criterion_id: 'carrier-observation',
            state: 'unmet',
            value: false,
            evidence: [{ target_digest: targetDigest, start: 1, end: 5, quote: '😀e\u0301' }],
            rationale: 'Unicode citation retained.\nMultiline report rationale.',
          },
        ],
        reviewer: {
          provenance: 'client_reported',
          provider: ' claimed-provider ',
          model: 'claimed-model',
          revision: 'claimed-revision',
          context: 'isolated_judge',
        },
      };
      const reply = await call('prompt_engine', {
        chain_id: chainId,
        user_response: OUTPUT,
        gate_verdict: {
          overall: 'FAIL',
          rationale: 'Carrier review failed',
          per_gate: [{ index: 1, passed: false, rationale: 'Carrier criterion unmet', evaluation }],
        },
      });
      expect(reply.isError).toBe(false);
      const entries = captured(runtimeRoot, chainId);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        gateId: GATE,
        verdict: 'FAIL',
        rationale: 'Carrier criterion unmet',
      });
      expect(entries[0]?.evaluation).toEqual(evaluation);
      const history = await call('system_control', {
        action: 'execution_history',
        operation: 'steps',
        session_id: chainId,
      });
      expect(history.isError).toBe(false);
      expect(history.text).toContain(GATE);
      expect(history.text).toContain('Carrier criterion unmet');
      // Public rich history rendering is later; exact JSON above observes actual persistence.
    }, 90000);

    test('legacy string control reaches the same registered capture path', async () => {
      const { call, chainId, runtimeRoot } = await fixture();
      const reply = await call('prompt_engine', {
        chain_id: chainId,
        user_response: OUTPUT,
        gate_verdict:
          'GATE_REVIEW: FAIL - Legacy carrier\n\nGATE_VERDICTS:\n[1] FAIL - Legacy criterion',
      });
      expect(reply.isError).toBe(false);
      const entries = captured(runtimeRoot, chainId);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        gateId: GATE,
        verdict: 'FAIL',
        rationale: 'Legacy criterion',
      });
      expect(entries[0]).not.toHaveProperty('evaluation');
    }, 90000);
  }
);
