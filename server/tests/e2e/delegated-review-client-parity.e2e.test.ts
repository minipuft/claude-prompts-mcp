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
import { ChainOperatorExecutor } from '../../src/engine/execution/operators/chain-operator-executor.js';
import { GateGuidanceRenderer } from '../../src/engine/gates/guidance/GateGuidanceRenderer.js';
import { GateReviewStage } from '../../src/engine/execution/pipeline/stages/20-gate-review-stage.js';
import { ExecutionContext } from '../../src/engine/execution/context/execution-context.js';
import { ResponseAssembler } from '../../src/engine/execution/formatting/response-assembler.js';
import {
  createSemanticReviewContext,
  bindSemanticReviewTarget,
  renewSemanticReviewAttempt,
  projectFrozenReview,
} from '../../src/engine/execution/pipeline/decisions/gates/semantic-review-context.js';
import {
  buildStructuredVerdictTemplate,
  describeReviewForRender,
  semanticReviewResume,
} from '../../src/engine/execution/pipeline/decisions/gates/describe-review-for-render.js';
import type { SemanticReviewDefinitionInput } from '../../src/engine/execution/pipeline/decisions/gates/semantic-review-context.js';
import type { GateDefinitionProvider } from '../../src/engine/gates/core/gate-loader.js';
import type { Logger } from '../../src/infra/logging/index.js';
import type { ChainSessionService } from '../../src/shared/types/index.js';
import type { ChainSession } from '../../src/shared/types/chain-session.js';
import type { ConvertedPrompt } from '../../src/engine/execution/types.js';
import { DEFAULT_GATES_CONFIG } from '../../src/shared/types/core-config.js';
import {
  composeStructuralReview,
  PHASE_GUARD_GATE_ID,
} from '../../src/engine/execution/pipeline/decisions/gates/structural-review-composition.js';
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

// Source-owner controls while public semantic loading remains staged. These do not use dist,
// an SDK client or a model; only provider/session I/O is doubled, not rendering or protocol logic.
describe('frozen semantic source rendering', () => {
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  } as Logger;
  const prompt: ConvertedPrompt = {
    id: 'source-task',
    name: 'Source Task',
    description: 'Source control',
    category: 'code',
    userMessageTemplate: 'ORIGINAL TASK',
    arguments: [],
  };
  const definition = (mode: 'self' | 'judge', mixed = false): SemanticReviewDefinitionInput => ({
    id: 'semantic-source',
    name: 'Frozen A',
    type: 'validation',
    description: 'Public criterion',
    subject: 'code',
    guidance: 'FROZEN GUIDANCE A',
    evaluation: { mode, model: 'requested-A', strict: true },
    pass_criteria: [
      {
        type: 'semantic_evaluation',
        id: 'criterion-A',
        target: { kind: 'step_output' },
        question: 'PUBLIC QUESTION A',
        result: { kind: 'boolean' },
        acceptance: { kind: 'equals', value: true },
        evidence_requirements: { min_items: 1 },
        allow_not_applicable: false,
      },
      ...(mixed ? [{ type: 'shell_verify' as const, shell_command: ['true'] }] : []),
    ],
  });

  async function fixture(
    mode: 'self' | 'judge' = 'self',
    options: {
      bound?: boolean;
      mixed?: boolean;
      retry?: boolean;
      disabled?: boolean;
      unavailable?: boolean;
      exhausted?: boolean;
      legacy?: boolean;
      noReview?: boolean;
      privateFields?: boolean;
      structural?: boolean;
      collision?: boolean;
      verificationProvider?: boolean;
    } = {}
  ) {
    let liveReads = 0;
    let verificationReads = 0;
    const liveProvider = {
      loadGates: async () => {
        verificationReads += 1;
        return [];
      },
      loadGate: async () => {
        liveReads += 1;
        if (options.unavailable === true) throw new Error('Live catalog unavailable');
        return {
          ...definition('self'),
          name: 'LIVE B',
          guidance: 'LIVE GUIDANCE B',
          evaluation: { mode: 'self', model: 'requested-B', strict: false },
        };
      },
      isGateActive: () => true,
    } as unknown as GateDefinitionProvider;
    const renderer = new GateGuidanceRenderer(logger, {
      gateLoader: liveProvider,
      gatesConfigProvider: () => ({ harnessCovers: ['code'], reminderTokenBudget: 0 }),
    });
    const executor = new ChainOperatorExecutor(logger, [prompt], renderer);
    const gateId = options.collision === true ? PHASE_GUARD_GATE_ID : 'semantic-source';
    const frozenDefinition = {
      ...definition(mode, options.mixed === true),
      id: gateId,
      ...(options.privateFields === true
        ? {
            privateCases: ['PRIVATE CASE'],
            expectedLabels: ['PRIVATE LABEL'],
            generationHistory: 'PRIVATE HISTORY',
            archivePath: '/PRIVATE ARCHIVE',
          }
        : {}),
    };
    let issued = createSemanticReviewContext('n1', 'attempt-A', [frozenDefinition]);
    if (options.bound !== false) issued = bindSemanticReviewTarget(issued, 'CAPTURED OUTPUT A Ω');
    if (options.retry === true) issued = renewSemanticReviewAttempt(issued, 'attempt-B');
    let review: GateReview = {
      nodeId: 'n1',
      kind: 'gate',
      phase: options.exhausted === true ? 'exhausted' : 'awaiting-verdict',
      combinedPrompt: 'Review',
      gateIds: [gateId],
      prompts: [{ gateId, criteriaSummary: 'PUBLIC QUESTION A' }],
      createdAt: 1,
      attemptCount: options.exhausted === true ? 3 : options.retry === true ? 1 : 0,
      maxAttempts: 3,
      semanticContext: issued,
    };
    if (options.structural === true) {
      const composed = composeStructuralReview(review, {
        gateId: PHASE_GUARD_GATE_ID,
        feedback: 'STRUCTURAL FINDING',
        retryHints: ['Structural fix'],
        failedPhases: ['phase'],
        mode: 'enforce',
        previousResponse: 'CAPTURED OUTPUT A Ω',
        reviewedStep: { nodeId: 'n1', stepNumber: 1 },
        maxAttempts: 3,
        createdAt: 2,
      });
      review = { ...composed, nodeId: 'n1', kind: review.kind, phase: review.phase };
    }
    if (options.legacy === true) {
      delete review.semanticContext;
      review.gateIds = [];
      review.prompts = [];
    }
    const run = {
      reviews: options.noReview === true ? {} : { n1: review },
      state: { currentNodeId: 'n1', nodes: [] },
    } as unknown as ChainSession;
    const store = {
      getSession: () => run,
      getReview: () => (options.noReview === true ? undefined : review),
      getChainContext: () => ({ current_step: 1, step_results: {} }),
      recordStepDeclaration: () => {},
      setPendingGateReview: async (_id: string, next: GateReview) => {
        review = next;
        run.reviews = { n1: next };
      },
    } as unknown as ChainSessionService;
    const context = new ExecutionContext({ command: '>>source-task' });
    context.parsedCommand = {
      steps: [
        { stepNumber: 1, nodeId: 'n1', promptId: prompt.id, args: {}, convertedPrompt: prompt },
      ],
    } as typeof context.parsedCommand;
    context.sessionContext = {
      sessionId: 'source-session',
      chainId: 'chain-source#1',
      isChainExecution: true,
      currentStep: 1,
      totalSteps: 2,
      ...(options.noReview === true ? {} : { pendingReview: review }),
    };
    if (options.disabled === true)
      context.executionPlan = {
        strategy: 'chain',
        requiresFramework: false,
        requiresSession: true,
        gates: [],
      };
    if (options.noReview === true)
      context.executionResults = { content: 'NORMAL SOURCE OUTPUT', metadata: {}, generatedAt: 0 };
    await new GateReviewStage(
      executor,
      store,
      options.verificationProvider === true ? liveProvider : null,
      logger,
      () => ({
        ...DEFAULT_GATES_CONFIG,
        frameworkGates: false,
        enabled: options.disabled !== true,
        evaluation: { defaultMode: 'self', defaultModel: 'requested-B', strict: false },
      })
    ).execute(context);
    const assembled = new ResponseAssembler().formatChainResponse(context, {
      isChainFormatting: true,
    } as never);
    return {
      context,
      assembled,
      review,
      renderer,
      executor,
      liveReads: () => liveReads,
      verificationReads: () => verificationReads,
    };
  }

  test.each(['self', 'judge'] as const)(
    'issued %s rubric and requested config survive changed live catalog',
    async (mode) => {
      const result = await fixture(mode);
      expect(result.assembled).toContain('PUBLIC QUESTION A');
      expect(result.assembled).toContain('FROZEN GUIDANCE A');
      expect(result.assembled).toContain('requested-A');
      expect(result.assembled).toContain('CAPTURED OUTPUT A Ω');
      expect(result.assembled).not.toContain('LIVE GUIDANCE B');
      expect(result.assembled).not.toContain('requested-B');
      expect(result.liveReads()).toBe(0);
      expect(result.assembled).toContain('Submit the structured gate_verdict report only');
      expect(result.assembled).not.toContain('A legacy string form is still accepted');
      expect(result.assembled).not.toContain('gate_verdict="GATE_REVIEW');
      expect(result.assembled).not.toContain('**GATE_REVIEW:');
      expect(result.context.executionResults?.metadata?.callToAction).not.toContain(
        'both your step output'
      );
      if (mode === 'judge') {
        expect(result.assembled).toContain('Independent Quality Audit');
        expect(result.assembled).toContain('server-captured output already included');
      }
    }
  );

  test('issued required guidance survives an unavailable provider without fallback', async () => {
    const result = await fixture('judge', { unavailable: true });
    expect(result.liveReads()).toBe(0);
    expect(result.assembled).toContain('PUBLIC QUESTION A');
    expect(result.assembled).toContain('requested-A');
  });

  test('missing captured target requests capture alone and provides no verdict template', async () => {
    const result = await fixture('judge', { bound: false });
    expect(projectFrozenReview(result.review).submission).toBe('capture-first');
    expect(result.assembled).toContain('user_response="<complete node output>"');
    expect(result.assembled).not.toContain('gate_verdict=');
    expect(result.assembled).not.toContain('Independent Quality Audit');
    expect(result.assembled).not.toContain('\"target_digest\":');
  });

  test('retry discards old target and binds the next report to the renewed server attempt', async () => {
    const result = await fixture('self', { retry: true });
    expect(result.assembled).not.toContain('gate_verdict=');
    const rebound = {
      ...result.review,
      semanticContext: bindSemanticReviewTarget(
        result.review.semanticContext!,
        'CAPTURED OUTPUT B'
      ),
    };
    const protocol = projectFrozenReview(rebound);
    expect(protocol.submission).toBe('report');
    expect(protocol.semanticReviews[0]?.binding?.attempt_id).toBe('attempt-B');
    expect(semanticReviewResume(rebound, 'chain-source#1')).toContain('CAPTURED OUTPUT B');
    expect(semanticReviewResume(rebound, 'chain-source#1')).not.toContain('CAPTURED OUTPUT A Ω');
  });

  test('mixed requirements survive harness coverage and zero reminder budget', async () => {
    const result = await fixture('self', { mixed: true });
    expect(result.assembled).toContain('FROZEN GUIDANCE A');
    expect(result.assembled).toContain('check: runs `true`');
    expect(result.assembled).toContain('PUBLIC QUESTION A');
    expect(result.assembled).toContain('"evaluation"');
  });

  test('disabled gates do not hide an existing required semantic review', async () => {
    const result = await fixture('self', { disabled: true });
    expect(result.assembled).toContain('PUBLIC QUESTION A');
    expect(result.assembled).toContain('gate_verdict=');
  });

  test('Stage20 derives issued tiers even when verification DTOs are unavailable', async () => {
    const result = await fixture('self', { verificationProvider: true });
    expect(result.verificationReads()).toBeGreaterThan(0);
    expect(result.context.sessionContext?.pendingReview?.gateTiers?.['semantic-source']).toBe(
      'evaluation'
    );
    expect(result.assembled).toContain('PUBLIC QUESTION A');
    expect(result.liveReads()).toBe(0);
  });

  test('disabled gates with no issued review do not create an obligation', async () => {
    const result = await fixture('self', { disabled: true, noReview: true });
    expect(result.context.executionResults?.content).toBe('NORMAL SOURCE OUTPUT');
    expect(result.assembled).not.toContain('PUBLIC QUESTION A');
    expect(result.liveReads()).toBe(0);
  });

  test('disabled guidance injection cannot suppress a required frozen semantic review', async () => {
    const result = await fixture();
    const rendered = await result.executor.renderStep({
      executionType: 'gate_review',
      stepPrompts: [
        { stepNumber: 1, nodeId: 'n1', promptId: prompt.id, args: {}, convertedPrompt: prompt },
      ],
      chainContext: { current_step: 1, injectionState: { gateGuidance: { inject: false } } },
      review: result.review,
      additionalGateIds: result.review.gateIds,
    });
    expect(rendered.content).toContain('FROZEN GUIDANCE A');
    expect(rendered.content).toContain('PUBLIC QUESTION A');
    expect(result.liveReads()).toBe(0);
  });

  test('public projection excludes private cases labels generation history and archive paths', async () => {
    const result = await fixture('judge', { privateFields: true });
    for (const value of ['PRIVATE CASE', 'PRIVATE LABEL', 'PRIVATE HISTORY', 'PRIVATE ARCHIVE'])
      expect(result.assembled).not.toContain(value);
    expect(result.assembled).toContain('PUBLIC QUESTION A');
    expect(result.assembled).toContain(
      'Requested evaluator configuration (not observed reviewer identity)'
    );
  });

  test('canonical structural composition keeps a synthetic missing definition beside required semantics', async () => {
    const result = await fixture('self', { structural: true, mixed: true });
    expect(result.review.gateIds).toEqual(['semantic-source', PHASE_GUARD_GATE_ID]);
    expect(result.review.structuralGateIds).toEqual([PHASE_GUARD_GATE_ID]);
    expect(result.review.semanticContext?.definitions).not.toHaveProperty(PHASE_GUARD_GATE_ID);
    expect(projectFrozenReview(result.review).submission).toBe('report');
    expect(result.assembled).toContain('Structural + Gate Review Required');
    expect(result.assembled).toContain('PUBLIC QUESTION A');
    expect(result.assembled).not.toContain('Semantic review unavailable');
    expect(result.liveReads()).toBe(0);
  });

  test('canonical authored collision retains its own frozen semantic definition and binding', async () => {
    const result = await fixture('judge', { collision: true, structural: true });
    expect(result.review.gateIds).toEqual([PHASE_GUARD_GATE_ID]);
    expect(result.review.structuralGateIds).toEqual([PHASE_GUARD_GATE_ID]);
    expect(projectFrozenReview(result.review).semanticReviews[0]?.binding?.gate_id).toBe(
      PHASE_GUARD_GATE_ID
    );
    expect(result.assembled).toContain('Structural + Gate Review Required');
    expect(result.assembled).toContain('PUBLIC QUESTION A');
    expect(result.liveReads()).toBe(0);
  });

  test('an unmarked authored canonical ID does not become a structural finding by its spelling', async () => {
    const result = await fixture('self', { collision: true });
    expect(result.review.structuralGateIds).toBeUndefined();
    expect(result.assembled).not.toContain('Structural Review Required');
    expect(result.assembled).not.toContain('Structural + Gate Review Required');
    expect(result.assembled).toContain('PUBLIC QUESTION A');
  });

  test('corrupt authority refuses rendering protocol without live fallback or minted pins', async () => {
    const result = await fixture();
    const corrupt = {
      ...result.review,
      semanticContext: { ...result.review.semanticContext!, definitions: {} },
    };
    expect(projectFrozenReview(corrupt).submission).toBe('unavailable');
    expect(semanticReviewResume(corrupt, 'chain-source#1')).toContain('No verdict can be accepted');
    expect(semanticReviewResume(corrupt, 'chain-source#1')).not.toContain('gate_verdict=');
    expect(result.liveReads()).toBe(0);
  });

  test('unknown marker cannot exempt a missing issued definition', async () => {
    const result = await fixture();
    const corrupt = {
      ...result.review,
      kind: 'structural' as const,
      gateIds: [...result.review.gateIds, 'unknown-marked'],
      structuralGateIds: ['unknown-marked'],
      metadata: { source: 'phase-guard-verification' },
    };
    expect(projectFrozenReview(corrupt).submission).toBe('unavailable');
    expect(semanticReviewResume(corrupt, 'chain-source#1')).not.toContain('gate_verdict=');
    expect(result.liveReads()).toBe(0);
  });

  test('forward canonical alias is a required missing definition despite remapped marker facts', async () => {
    const result = await fixture('self', { structural: true });
    const alias = 'forward-structural-alias';
    const remapped = {
      ...result.review,
      gateIds: result.review.gateIds.map((id) => (id === PHASE_GUARD_GATE_ID ? alias : id)),
      structuralGateIds: [alias],
    };
    expect(projectFrozenReview(remapped).submission).toBe('unavailable');
    expect(semanticReviewResume(remapped, 'chain-source#1')).not.toContain('gate_verdict=');
    expect(result.liveReads()).toBe(0);
  });

  test('detached template carries the same frozen binding and complete criterion inventory', async () => {
    const result = await fixture();
    const facts = describeReviewForRender(result.review);
    const template = JSON.parse(
      buildStructuredVerdictTemplate(
        result.review.gateIds,
        result.review.prompts,
        new Map(),
        new Map(),
        facts.protocol
      )
    );
    expect(template.per_gate[0].evaluation.binding).toEqual(
      facts.protocol.semanticReviews[0]?.binding
    );
    expect(
      template.per_gate[0].evaluation.observations.map(
        (value: { criterion_id: string }) => value.criterion_id
      )
    ).toEqual(['criterion-A']);
  });

  test('malformed issued identity and captured target kinds fail closed', async () => {
    const result = await fixture();
    for (const fields of [
      { attemptId: ['attempt-A'] },
      { target: { ...result.review.semanticContext!.target!, kind: 'artifact' } },
    ]) {
      const corrupt = {
        ...result.review,
        semanticContext: { ...result.review.semanticContext!, ...fields } as unknown as NonNullable<
          GateReview['semanticContext']
        >,
      };
      expect(projectFrozenReview(corrupt).submission).toBe('unavailable');
      expect(semanticReviewResume(corrupt, 'chain-source#1')).not.toContain('gate_verdict=');
    }
  });

  test('exhausted semantic review offers actions without rubric, judge or report', async () => {
    const result = await fixture('judge', { exhausted: true });
    expect(result.assembled).not.toContain('PUBLIC QUESTION A');
    expect(result.assembled).not.toContain('gate_verdict=');
    expect(result.assembled).not.toContain('Independent Quality Audit');
    expect(result.context.executionResults?.metadata?.callToAction).toContain(
      'no verdict is accepted'
    );
  });

  test('contextless legacy protocol and template remain unchanged', () => {
    const review: GateReview = {
      nodeId: 'n1',
      kind: 'gate',
      phase: 'awaiting-verdict',
      combinedPrompt: 'Legacy',
      gateIds: ['legacy'],
      prompts: [],
      createdAt: 0,
      attemptCount: 0,
      maxAttempts: 3,
    };
    expect(projectFrozenReview(review)).toEqual({ submission: 'legacy', semanticReviews: [] });
    expect(semanticReviewResume(review, 'chain-legacy')).toBeUndefined();
    expect(buildStructuredVerdictTemplate(['legacy'], [], new Map(), new Map())).toBe(
      '{\n  "overall": "PASS",\n  "rationale": "<overall assessment>",\n  "per_gate": [\n    {"index": 1, "passed": true, "rationale": "legacy: <why>"}\n  ]\n}'
    );
  });
});
