// @lifecycle test - P5 row 5.1: THE phase acceptance test, driven as a client drives it.
/**
 * P5 acceptance — one run, three criteria.
 *
 * Master plan §P5 states the phase is done when (a) a step declares withheld items that a later
 * step (declaring `expose`) receives, (b) a `==>` delegated step provably does not receive the
 * withheld items and its handoff carries a names-only manifest, and (c) a gate targeted at node N
 * enters gate REVIEW only while the run stands at node N. All three are proven HERE, in a single
 * driven run, because they interact: the expose is step-scoped (so the delegated step at the end
 * of the same run must still be withheld from), and the review scope must not move when the
 * visibility decision does.
 *
 * Driven the way a client drives it — `{command}`, then `{chain_id, user_response}` and
 * `{chain_id, gate_verdict}` — against a real `SqliteEngine` and the real `ChainSessionStore`,
 * `GateEnhancementStage`, `TemporaryGateRegistrar`, `TemporaryGateRegistry`,
 * `ChainOperatorExecutor`, `decideVisibility`, `DelegationRenderer`, `ResponseAssembler`,
 * `GateEnforcementAuthority` and `ExecutionRecordStore`. Nothing in this file writes session
 * state, and every assertion reads only what a client can read: the rendered text, and the
 * pending review the store holds.
 *
 * Absence is asserted against the withheld VALUE (a sentinel string), never merely against the
 * presence of a replacement banner: a render that both announced the withholding and leaked the
 * content would pass the weaker check.
 *
 * Stubbed, and why: the gate SERVICE (`enhancePrompt`) — it decides gate TEXT, not which gates
 * apply, and wiring the real one pulls the whole gate registry/loader into a test about routing.
 * The stages this suite does not exercise (parsing, planning, framework, injection) supply this
 * request's inputs and decide nothing about visibility, review scope, or lifecycle.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { SqliteEngine } from '../../../src/infra/database/index.js';

import { ExecutionContext } from '../../../src/engine/execution/context/execution-context.js';
import { ResponseAssembler } from '../../../src/engine/execution/formatting/response-assembler.js';
import { ChainOperatorExecutor } from '../../../src/engine/execution/operators/chain-operator-executor.js';
import { renderGateVerdict } from '../../../src/engine/gates/core/gate-verdict-renderer.js';
import { TemporaryGateRegistry } from '../../../src/engine/gates/core/temporary-gate-registry.js';
import { GateEnforcementAuthority } from '../../../src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.js';
import { PromptExecutionPipeline } from '../../../src/engine/execution/pipeline/prompt-execution-pipeline.js';
import { GateEnhancementStage } from '../../../src/engine/execution/pipeline/stages/11-gate-enhancement-stage.js';
import { SessionManagementStage } from '../../../src/engine/execution/pipeline/stages/13-session-stage.js';
import { StepResponseCaptureStage } from '../../../src/engine/execution/pipeline/stages/16-response-capture-stage.js';
import { StepExecutionStage } from '../../../src/engine/execution/pipeline/stages/18-execution-stage.js';
import { GateReviewStage } from '../../../src/engine/execution/pipeline/stages/20-gate-review-stage.js';
import { ResponseFormattingStage } from '../../../src/engine/execution/pipeline/stages/21-formatting-stage.js';
import { StepCaptureService } from '../../../src/engine/execution/capture/step-capture-service.js';
import { UnknownObservationProcessor } from '../../../src/engine/execution/capture/unknown-observation-processor.js';
import { GateEnhancementService } from '../../../src/engine/gates/services/gate-enhancement-service.js';
import { GateMetricsRecorder } from '../../../src/engine/gates/services/gate-metrics-recorder.js';
import { GateVerdictProcessor } from '../../../src/engine/gates/services/gate-verdict-processor.js';
import { createRunStepViewProvider } from '../../../src/engine/gates/services/run-step-view.js';
import { TemporaryGateRegistrar } from '../../../src/engine/gates/services/temporary-gate-registrar.js';
import { ResponseFormatter } from '../../../src/mcp/tools/prompt-engine/processors/response-formatter.js';
import { ExecutionRecordStore } from '../../../src/modules/chains/execution-record-store.js';
import { ChainSessionStore } from '../../../src/modules/chains/manager.js';
import { TextReferenceStore } from '../../../src/modules/text-refs/index.js';

import type { PipelineStage } from '../../../src/engine/execution/pipeline/stage.js';
import type { ChainStepPrompt } from '../../../src/engine/execution/operators/types.js';
import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';
import type { Logger } from '../../../src/infra/logging/index.js';
import type { ChainSession } from '../../../src/shared/types/chain-session.js';

// --- fixtures -------------------------------------------------------------------------------

/** Distinctive per-step outputs. Absence of these strings IS the withholding assertion. */
const S1 = 'S1_SENTINEL_ALPHA';
const S2 = 'S2_SENTINEL_BRAVO';
const S3 = 'S3_SENTINEL_CHARLIE';

/**
 * Two gates that must NOT be scoped alike.
 *
 * `NODE_SCOPED_GATE` is a temporary gate the client requests with a `target_step_id`.
 * `RUN_WIDE_GATE` reaches the accumulator through each step's PLANNED gates instead of through
 * the `gates` parameter — deliberately, and not merely to mirror the sibling unit test: an
 * untargeted temporary gate on a chain is not run-wide at all. `normalizeGateInput` gives every
 * temp gate that names no target `apply_to_steps: [currentStep]`
 * (temporary-gate-registrar.ts:496-501), so requesting one through `gates` binds it to the step
 * the request was made at, and it would be filtered off every later step — the exact opposite of
 * the inheritance this control exists to guard. Planned gates carry no registry entry, so
 * `filterGatesByStepTarget` lets them through on every step (DEV-T5-3).
 */
const RUN_WIDE_GATE = 'gate-run-wide';
const NODE_SCOPED_GATE = 'gate-node-scoped';
/**
 * Targets node 1 — the control for P5-F6: a gate scoped to the step the request STARTS on must
 * stay exactly where it already worked (pre-advance creation), unaffected by the post-advance
 * re-evaluation this run also exercises for {@link NODE_SCOPED_GATE}.
 */
const NODE1_SCOPED_GATE = 'gate-node1-scoped';

const NODE_1 = 'plan-scope';
const NODE_2 = 'analyze-data';
const NODE_3 = 'synthesize';
const NODE_4 = 'handoff-review';

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

/**
 * The REAL `TextReferenceStore`, not the stub the sibling lifecycle suite uses.
 *
 * It is the only producer of the chain-history surface (`step_results`, `stepN_result`) and of
 * the stored output `previous_step_output` resolves against, so with it stubbed every render
 * falls to the "**[CONTEXT INSTRUCTION]**: use the response you produced" branch and a withheld
 * value is absent because it never existed. Asserting the withholding against that would be
 * phantom coverage (measured: the first green-ish draft of this file passed criterion (a)'s
 * absence assertion with an empty store — DEV-T5-4).
 */
const newTextReferenceStore = (logger: Logger): TextReferenceStore =>
  new TextReferenceStore(logger);

/**
 * Decides gate TEXT, not which gates apply. The routing under test (`filterGatesByStepTarget` →
 * `reviewGateIds` → `pendingReview.gateIds`) never calls it; it is here because
 * `GateEnhancementService.isAvailable()` gates the whole stage on a non-null service.
 */
const createGateService = () =>
  ({
    supportsValidation: jest.fn().mockReturnValue(false),
    updateConfig: jest.fn(),
    enhancePrompt: jest.fn(
      async (prompt: { userMessageTemplate: string }, gateIds: readonly string[]) => ({
        enhancedPrompt: {
          ...prompt,
          userMessageTemplate: `${prompt.userMessageTemplate}\n\nGate guidance for: ${gateIds.join(',')}`,
        },
        gateInstructionsInjected: true,
        injectedGateIds: gateIds,
        instructionLength: gateIds.join(',').length,
      })
    ),
  }) as never;

const prompt = (id: string, name: string, template: string): ConvertedPrompt => ({
  id,
  name,
  description: name,
  category: 'analysis',
  userMessageTemplate: template,
  systemMessage: '',
  arguments: [],
});

/**
 * Every step past the first reaches for BOTH withheld items, so one render discriminates between
 * them. The history slot is bracketed and reaches for EVERY `stepN_result` key rather than one:
 * the naming is positional and `buildChainVariables` publishes step N's content under
 * `step${ordinal + 1}_result` while `step_results` is keyed by the ordinal itself, so a template
 * naming a single key would be asserting against that off-by-one rather than against the
 * withholding (DEV-T5-5). `History: []` is then an exact statement: no history key carried
 * anything.
 */
const HISTORY_SLOT = 'History: [{{step1_result}}{{step2_result}}{{step3_result}}]';

const PROMPTS: ConvertedPrompt[] = [
  prompt('plan', 'Plan', 'Plan the work for this run.'),
  prompt('analyze', 'Analyze', `Prior: {{previous_step_output}} / ${HISTORY_SLOT}`),
  prompt('synthesize', 'Synthesize', `Prior: {{previous_step_output}} / ${HISTORY_SLOT}`),
  prompt('handoff_review', 'Handoff Review', `Prior: {{previous_step_output}} / ${HISTORY_SLOT}`),
];

/** Every step plans the run-wide gate — see {@link RUN_WIDE_GATE}. */
const PLANNED = { gates: [RUN_WIDE_GATE] } as ChainStepPrompt['executionPlan'];

/**
 * The parsed chain: `>>plan --> >>analyze --> >>synthesize ==> >>handoff_review`.
 *
 * Step 1 withholds BOTH items from every later step. Step 3 exposes ONE of them, for itself only.
 * Step 4 is the delegated step and declares nothing — so the step-scoped nature of step 3's
 * expose is what its manifest reports back.
 */
const parsedSteps = (): ChainStepPrompt[] => [
  {
    stepNumber: 1,
    nodeId: NODE_1,
    promptId: 'plan',
    args: {},
    convertedPrompt: PROMPTS[0],
    executionPlan: PLANNED,
    visibility: { withhold: ['previous_step_output', 'chain_history'] },
  },
  {
    stepNumber: 2,
    nodeId: NODE_2,
    promptId: 'analyze',
    args: {},
    convertedPrompt: PROMPTS[1],
    executionPlan: PLANNED,
  },
  {
    stepNumber: 3,
    nodeId: NODE_3,
    promptId: 'synthesize',
    args: {},
    convertedPrompt: PROMPTS[2],
    executionPlan: PLANNED,
    visibility: { expose: ['previous_step_output'] },
  },
  {
    stepNumber: 4,
    nodeId: NODE_4,
    promptId: 'handoff_review',
    args: {},
    convertedPrompt: PROMPTS[3],
    executionPlan: PLANNED,
    delegated: true,
    agentType: 'chain-executor',
  },
];

/**
 * The `gates` parameter a client sends. Explicit ids so the SAME gate is addressed across the
 * eight calls of one run — the registrar re-uses a registered id rather than minting a second
 * (`registerTemporaryGates`: "Skipping gate already registered").
 */
const GATE_SPECS = [
  {
    id: NODE_SCOPED_GATE,
    name: 'Node scoped review',
    type: 'guidance',
    scope: 'step',
    criteria: ['cite the data source'],
    target_step_id: NODE_2,
  },
  {
    id: NODE1_SCOPED_GATE,
    name: 'Node 1 scoped review',
    type: 'guidance',
    scope: 'step',
    criteria: ['state the plan'],
    target_step_id: NODE_1,
  },
];

const STAGE_ORDER = [
  'RequestNormalization',
  'ExecutionLifecycle',
  'IdentityResolution',
  'CommandParsing',
  'InlineGateExtraction',
  'OperatorValidation',
  'ExecutionPlanning',
  'ScriptExecution',
  'ScriptAutoExecute',
  'JudgeSelection',
  'GateEnhancement',
  'FrameworkResolution',
  'SessionManagement',
  'InjectionControl',
  'PromptGuidance',
  'StepResponseCapture',
  'ShellVerification',
  'StepExecution',
  'PhaseGuardVerification',
  'GateReview',
  'ResponseFormatting',
  'PostFormattingCleanup',
] as const;

/**
 * Wire the pipeline over ONE session store and ONE temporary-gate registry.
 *
 * The registry is per-pipeline rather than per-call because a temporary gate registered on the
 * chain-start call must still be resolvable by `filterGatesByStepTarget` on every later call of
 * the same run — that is what makes the targeting observable across the walk.
 */
const buildPipeline = (options: {
  sessionStore: ChainSessionStore;
  recordStore: ExecutionRecordStore;
  logger: Logger;
  steps: () => ChainStepPrompt[];
}): PromptExecutionPipeline => {
  const { sessionStore, recordStore, logger } = options;
  const chainExecutor = new ChainOperatorExecutor(logger as never, PROMPTS);
  const gateRegistry = new TemporaryGateRegistry(logger);
  const runStepViewProvider = createRunStepViewProvider(sessionStore);
  // Shared with StepResponseCapture below (P5-F6): the post-advance review re-evaluation needs
  // the SAME registry/runStepViewProvider wiring stage 11 resolves step targets against — a
  // second instance would work identically here (the registry is a real one, not a per-call
  // fake), but production wires exactly one instance to both stages and this mirrors that.
  const gateEnhancementService = new GateEnhancementService(
    createGateService(),
    gateRegistry,
    () => undefined,
    () => undefined as never,
    undefined,
    new GateMetricsRecorder(undefined),
    logger,
    runStepViewProvider
  );

  const realStages: Record<string, PipelineStage> = {
    GateEnhancement: new GateEnhancementStage(
      gateEnhancementService,
      new TemporaryGateRegistrar(gateRegistry, undefined, logger, runStepViewProvider),
      () => ({ enabled: true, definitionsDirectory: 'gates', enableFrameworkGates: true }),
      logger
    ),
    SessionManagement: new SessionManagementStage(sessionStore, logger),
    StepResponseCapture: new StepResponseCaptureStage(
      new GateVerdictProcessor(sessionStore, logger),
      new StepCaptureService(sessionStore, logger),
      sessionStore,
      new UnknownObservationProcessor(sessionStore, logger),
      logger,
      gateEnhancementService
    ),
    StepExecution: new StepExecutionStage(
      chainExecutor,
      sessionStore,
      logger,
      undefined,
      undefined,
      recordStore
    ),
    GateReview: new GateReviewStage(
      chainExecutor,
      sessionStore,
      null,
      logger,
      undefined,
      recordStore
    ),
    ResponseFormatting: new ResponseFormattingStage(
      new ResponseFormatter(logger),
      new ResponseAssembler(),
      logger,
      recordStore,
      sessionStore
    ),
  };

  const stages: PipelineStage[] = STAGE_ORDER.map((name) => {
    const real = realStages[name];
    if (real !== undefined) return real;

    if (name === 'RequestNormalization') {
      // The one thing stage 01 does that this suite depends on: publish the request's `gates`
      // where the registrar reads them (01-request-normalization-stage.ts:146).
      return {
        name,
        execute: async (context: ExecutionContext) => {
          const requested = context.mcpRequest.gates;
          if (requested) {
            context.state.gates.requestedOverrides = { gates: [...requested] };
          }
        },
      };
    }
    if (name === 'CommandParsing') {
      return {
        name,
        execute: async (context: ExecutionContext) => {
          context.parsedCommand = {
            commandType: 'chain',
            promptId: 'plan',
            chainId: 'chain-p5-acceptance',
            steps: options.steps(),
            promptArgs: {},
            convertedPrompt: PROMPTS[0],
          } as never;
        },
      };
    }
    if (name === 'ExecutionPlanning') {
      return {
        name,
        execute: async (context: ExecutionContext) => {
          context.executionPlan = {
            strategy: 'chain',
            // Empty at the RUN level: the run-wide gate is planned per step (see PLANNED), and
            // the targeted one arrives through the client's `gates` parameter, so nothing here
            // pre-decides the review scope.
            gates: [],
            requiresFramework: false,
            requiresSession: true,
            llmValidationEnabled: false,
            category: 'analysis',
          } as never;
        },
      };
    }
    return { name, execute: async () => undefined };
  });

  return new PromptExecutionPipeline(stages, {
    logger,
    metricsProvider: () => undefined,
    gateEnforcement: new GateEnforcementAuthority(sessionStore, logger),
    executionRecordStore: recordStore,
    chainSessionStore: sessionStore,
  });
};

describe('P5 acceptance: withhold/expose, delegated non-receipt and targeted-gate scoping in ONE run', () => {
  let tmpDir: string;
  let engine: SqliteEngine;
  let logger: Logger;
  let store: ChainSessionStore;
  let pipeline: PromptExecutionPipeline;

  const newStore = (): ChainSessionStore =>
    new ChainSessionStore(
      logger,
      newTextReferenceStore(logger) as never,
      { cleanupIntervalMs: 60_000, defaultScope: { workspaceId: 'ws-p5-acceptance' } },
      engine
    );

  const awaitInit = async (target: ChainSessionStore): Promise<void> =>
    await (target as unknown as { initPromise: Promise<void> }).initPromise;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'p5-acceptance-'));
    logger = createLogger();
    engine = await SqliteEngine.getInstance(tmpDir, logger);
    await engine.initialize();
  });

  afterAll(async () => {
    await engine.shutdown();
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  });

  beforeEach(async () => {
    engine.run('DELETE FROM chain_run_nodes');
    engine.run('DELETE FROM chain_runs');
    engine.run('DELETE FROM chain_sessions');
    engine.run('DELETE FROM execution_records');

    store = newStore();
    await awaitInit(store);
    pipeline = buildPipeline({
      sessionStore: store,
      recordStore: new ExecutionRecordStore(engine, logger),
      logger,
      steps: parsedSteps,
    });
  });

  afterEach(async () => {
    await store.cleanup();
  });

  const textOf = (response: { content: Array<{ text?: string }> }): string =>
    response.content.map((part) => part.text ?? '').join('\n');

  const onlySession = (): ChainSession => {
    const sessions = Array.from(
      (store as unknown as { activeSessions: Map<string, ChainSession> }).activeSessions.values()
    );
    expect(sessions).toHaveLength(1);
    return sessions[0] as ChainSession;
  };

  /** The gate list the OPEN review is scoped to — exactly what `buildGateReviewCTA` renders. */
  const openReviewGateIds = (): readonly string[] => onlySession().pendingGateReview?.gateIds ?? [];

  const passVerdict = renderGateVerdict({
    overall: 'PASS',
    rationale: 'meets the gates',
    per_gate: [{ index: 1, passed: true, rationale: 'satisfied' }],
  });

  /** Everything from the delegation header on — the sub-agent's whole handoff. */
  const handoffSectionOf = (text: string): string => {
    const marker = text.indexOf('HANDOFF: Execute Step 4');
    expect(marker).toBeGreaterThanOrEqual(0);
    return text.slice(marker);
  };

  test('one driven run proves (a) withhold→expose, (b) delegated non-receipt, (c) targeted-gate review scoping', async () => {
    // --- the run ------------------------------------------------------------------------------
    // Every call carries the client's `gates` parameter, as a real client does: temporary gates
    // are request-scoped, and the registrar re-uses the registered id rather than minting again.
    const start = textOf(
      await pipeline.execute({
        command: '>>plan --> >>analyze --> >>synthesize',
        gates: GATE_SPECS,
      } as never)
    );
    const { chainId } = onlySession();
    const reviewAtNode1 = [...openReviewGateIds()];
    expect(start).toContain('Plan the work for this run.');

    // Step 1 answers, then clears its review — the run advances onto node 2 and renders it.
    await pipeline.execute({ chain_id: chainId, user_response: S1, gates: GATE_SPECS } as never);
    const atNode2 = textOf(
      await pipeline.execute({
        chain_id: chainId,
        gate_verdict: passVerdict,
        gates: GATE_SPECS,
      } as never)
    );

    // P5-F6: the step-2 review must exist in THIS SAME response — the one that ALSO cleared
    // step 1's review, advanced onto node 2, and rendered node 2's content. This is exactly the
    // request shape the defect made structurally incapable of creating a review for: the only
    // review-creation call that used to exist ran pre-advance, one stage before this render.
    const reviewAtNode2Immediate = [...openReviewGateIds()];
    const pendingReviewImmediate = onlySession().pendingGateReview;

    // Step 2 answers; its review is open while the run stands at node 2.
    await pipeline.execute({ chain_id: chainId, user_response: S2, gates: GATE_SPECS } as never);
    const reviewAtNode2 = [...openReviewGateIds()];
    const pendingReviewAfterRerender = onlySession().pendingGateReview;
    const atNode3 = textOf(
      await pipeline.execute({
        chain_id: chainId,
        gate_verdict: passVerdict,
        gates: GATE_SPECS,
      } as never)
    );

    // Step 3 answers; its review is open while the run stands at node 3.
    await pipeline.execute({ chain_id: chainId, user_response: S3, gates: GATE_SPECS } as never);
    const reviewAtNode3 = [...openReviewGateIds()];
    const atNode4 = textOf(
      await pipeline.execute({
        chain_id: chainId,
        gate_verdict: passVerdict,
        gates: GATE_SPECS,
      } as never)
    );

    // Step 4 (the delegated one) answers; its review is open while the run stands at node 4.
    await pipeline.execute({
      chain_id: chainId,
      user_response: 'SUB_AGENT_RESULT',
      gates: GATE_SPECS,
    } as never);
    const reviewAtNode4 = [...openReviewGateIds()];

    // --- (a) a prior withhold reaches a later step, and a later `expose` overrides it ----------
    //
    // The withheld VALUE, not merely the banner: a render that announced the withholding and
    // leaked the content would pass a banner-only check.
    expect(atNode2).toContain('Prior: **[CONTEXT WITHHELD]**');
    expect(atNode2).not.toContain(S1);
    expect(atNode2).toContain("Step 1 (Plan)'s output was withheld");

    // `chain_history` is the OTHER declared item and is withheld for the same step: every
    // history key renders empty rather than re-publishing what the first item hid.
    expect(atNode2).toContain('History: []');

    // The exposing step receives the item again — and only it does.
    expect(atNode3).toContain(`Prior: ${S2}`);
    expect(atNode3).not.toContain('[CONTEXT WITHHELD]');
    // ...while the item it did NOT expose stays withheld on the very same render. This is also
    // what makes the two `History: []` assertions non-vacuous: `previous_step_output` resolves
    // out of `step_results`, the same surface `chain_history` strips, so a run whose step
    // results were never populated could not have produced the S2 above.
    expect(atNode3).toContain('History: []');
    expect(atNode3).not.toContain(S1);

    // --- (b) the delegated step provably receives neither withheld item -----------------------
    //
    // The handoff is rendered on the call that lands on node 3, because the NEXT step is the
    // delegated one. Sliced from the delegation header so the assertion cannot be satisfied by
    // text belonging to the step the main thread is executing.
    const handoff = handoffSectionOf(atNode3);
    expect(handoff).toContain(
      'CONTEXT WITHHELD (names only, values not provided): previous_step_output, chain_history'
    );
    expect(handoff).not.toContain(S1);
    expect(handoff).not.toContain(S2);

    // The delegated step's OWN render carries no withheld value either — which is also the proof
    // that step 3's `expose` was step-scoped: it did not survive onto step 4.
    expect(atNode4).toContain('Prior: **[CONTEXT WITHHELD]**');
    expect(atNode4).not.toContain(S3);
    expect(atNode4).not.toContain(S1);
    expect(atNode4).not.toContain(S2);

    // --- (c) the node-targeted gate enters REVIEW at its node and nowhere else ----------------
    expect(reviewAtNode2).toContain(NODE_SCOPED_GATE);
    expect(reviewAtNode1).not.toContain(NODE_SCOPED_GATE);
    expect(reviewAtNode3).not.toContain(NODE_SCOPED_GATE);
    expect(reviewAtNode4).not.toContain(NODE_SCOPED_GATE);

    // Control: an untargeted gate keeps the run-wide inheritance the scoping must not narrow.
    // Without this, "review is empty everywhere" would satisfy the assertions above.
    expect(reviewAtNode1).toContain(RUN_WIDE_GATE);
    expect(reviewAtNode2).toContain(RUN_WIDE_GATE);
    expect(reviewAtNode3).toContain(RUN_WIDE_GATE);
    expect(reviewAtNode4).toContain(RUN_WIDE_GATE);

    // --- (c-i) P5-F6: the review exists in the SAME response that performed the advance --------
    //
    // Falsifiable against `GateEnhancementService.ensurePostAdvanceReview` being a no-op: without
    // it, `reviewAtNode2Immediate` is `[]` because node 2's review is not created until the NEXT
    // call (`StepResponseCaptureStage`'s bare-`user_response` capture path resumes at stage 13
    // with `currentNodeId` already persisted onto node 2, so the pre-existing pre-advance path
    // creates it one call late) — this suite's OTHER assertions above read `reviewAtNode2` only
    // after that next call, which is why they pass with or without the fix.
    expect(reviewAtNode2Immediate).toContain(NODE_SCOPED_GATE);
    expect(reviewAtNode2Immediate).toContain(RUN_WIDE_GATE);

    // --- (c-ii) no double-create on a same-step re-render (bare user_response while pending) ----
    //
    // Node 2's response (S2) is submitted while its review is already open; that call must not
    // mint a second review — `createdAt`/`attemptCount` prove it is the SAME review object the
    // advancing call already created, not a freshly reset one.
    expect(pendingReviewImmediate).toBeDefined();
    expect(pendingReviewAfterRerender?.createdAt).toBe(pendingReviewImmediate?.createdAt);
    expect(pendingReviewAfterRerender?.attemptCount).toBe(pendingReviewImmediate?.attemptCount);

    // --- (c-iii) control: a step-1-targeted gate is unaffected by the post-advance path ---------
    //
    // Byte-for-byte regression guard: the pre-advance creation path this gate exercises (the
    // request STARTS on node 1, no advance involved) must render identically to before P5-F6.
    expect(reviewAtNode1).toContain(NODE1_SCOPED_GATE);
    expect(reviewAtNode2).not.toContain(NODE1_SCOPED_GATE);
    expect(reviewAtNode3).not.toContain(NODE1_SCOPED_GATE);
    expect(reviewAtNode4).not.toContain(NODE1_SCOPED_GATE);

    // The run really walked its four nodes — the three criteria above are about ONE run that got
    // to the end, not about three renders that happened to be produced.
    expect(onlySession().state.nodes.map((node) => node.id)).toEqual([
      NODE_1,
      NODE_2,
      NODE_3,
      NODE_4,
    ]);
  });
});
