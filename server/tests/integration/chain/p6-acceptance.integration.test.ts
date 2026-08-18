// @lifecycle test - P6 Tier 6 row 6.1: the phase acceptance suite, real collaborators end-to-end.
/**
 * P6 acceptance — the acceptance clauses (a)-(d) of `adaptive-chain-runtime-p6-workflow-ir-
 * 2026-08-12.md`, driven against a FULLER real-collaborator pipeline than either of its two
 * sibling suites wires on its own: real `CommandParsingStage` + `WorkflowCommandBuilder` (the
 * IR command source, from `p6-workflow-ir.integration.test.ts`) AND real `GateEnhancementStage`
 * / `TemporaryGateRegistrar` / `StepExecutionStage` / `ChainOperatorExecutor` / `GateReviewStage`
 * / `ResponseFormattingStage` / `ResponseAssembler` (the gate-and-render machinery, from
 * `p5-acceptance.integration.test.ts`). Neither sibling wires both halves at once, and clause (d)
 * — "an IR node's gate binding, visibility and delegation fields REACH THE RUN" — is a claim
 * about REAL RENDERING, not about field presence in a blueprint. `p6-workflow-ir.integration.
 * test.ts`'s clause-(d) tests inspect `blueprintSteps()[i]['visibility']` etc. directly; they
 * prove the field survived compilation, not that `decideVisibility`, the gate accumulator, or the
 * delegation renderer actually acted on it. That gap is this file's reason to exist.
 *
 * Coverage map (which clause, which test, which file):
 *
 *   (a) "an IR executed through the full real pipeline ... produces ordinary rows"  — THIS file.
 *       The field-by-field equivalence to a `>>chain` twin (same columns, same node ids, same
 *       `origin`) is already proven precisely by `p6-workflow-ir.integration.test.ts`'s
 *       "an IR run and an equivalent >>chain run write structurally identical rows" — NOT
 *       reproduced here. This file's version reuses the SAME driven run as clause (d) below (no
 *       second run) and checks only that the row SHAPE survives the fuller wiring: same node ids
 *       in position order, `origin: 'planned'` on every row (no IR-specific marker), and a
 *       `chain-<promptId>#N` base-chain-id format — a distinct real-collaborator configuration is
 *       legitimate new evidence per the P7-F14 lesson, even for an already-proven claim.
 *
 *   (b) malformed IR (cycle / cap-breach / unknown-prompt) rejected, nothing written — NOT
 *       reproduced here, deliberately. Rejection happens in `CommandParsingStage` (stage 4 of 22),
 *       strictly before any of this file's ADDITIONAL real collaborators (GateEnhancement,
 *       StepExecution, GateReview, ResponseFormatting — stages 11, 18, 20, 21) ever run. A fuller
 *       downstream wiring cannot surface a defect in a path those stages never reach, so
 *       re-driving all three malformed patterns here would be the exact "assertion that duplicates
 *       an already-proven claim" this suite's brief warns against. Proof lives in
 *       `p6-workflow-ir.integration.test.ts`'s "acceptance (b)" describe block, EXTENDED in this
 *       change: the cap-breach case already asserted the full four-table zero-count with absences
 *       first; the cycle and unknown-prompt cases previously checked only `chain_runs`, and now
 *       carry the same four-table zero-count + absences-first shape.
 *
 *   (c) structural caps enforced (named reasons) + `declaredCostCeiling`/`maxInsertions` recorded
 *       on the blueprint residual, cold-load readable — NOT reproduced here, for the same reason
 *       as (b): the budget lands on `ParsedCommand.budget` inside `WorkflowCommandBuilder.build`
 *       (stage 4) and is cloned onto the session blueprint by `SessionManagementStage` (stage 13);
 *       neither write depends on which of stages 14-22 are real. Proof lives in
 *       `p6-workflow-ir.integration.test.ts`'s "acceptance (c)" describe block (cap-enforcement via
 *       the acceptance-(b) cap-breach case; recording + cold-load in its own two dedicated tests).
 *
 *   (d) gate binding / visibility / delegation reach the run AND take real effect — THIS file,
 *       the suite's core addition. One driven run to node 2, ONE render inspected three ways:
 *       node 1's declared `withhold` keeps its sentinel out of node 2's ACTUAL rendered text (not
 *       merely absent from a blueprint field); node 2's `inlineGateIds` shows up in the REAL gate
 *       accumulator (`pendingGateReview.gateIds`, populated by `GateEnhancementService` and read by
 *       `SessionManagementStage`); node 3's `subagentModel`/`agentType` produce a REAL delegation
 *       advisory on node 2's render (node 3 is next and delegated) and a REAL EXECUTION BRIEF on
 *       node 3's own render (R-1) — the same advisory-then-brief shape P5's acceptance suite
 *       demonstrated for a YAML chain, now shown for an IR-submitted one.
 *
 *   (e) YAML `subagentModel` delegates on a plain `>>chain` — Tier 6.2's dual-transport LIVE drive.
 *       Out of scope for an integration suite by the plan's own row split; not attempted here.
 *
 *   (f)(i) this suite's existence (i); (f)(ii) is Tier 6.2's live drive, out of scope here.
 *
 * Real collaborators: `SqliteEngine`, `ChainSessionStore`, `TextReferenceStore`,
 * `RequestNormalizationStage`, `CommandParsingStage` with the real `UnifiedCommandParser`,
 * `ArgumentParser`, `SymbolicCommandBuilder` and `WorkflowCommandBuilder` (wired to the real
 * `validateWorkflowIR` / `compileWorkflowIR`), `OperatorValidationStage`, `GateEnhancementStage`
 * (`GateEnhancementService` + `TemporaryGateRegistrar` + `TemporaryGateRegistry`),
 * `SessionManagementStage`, `StepResponseCaptureStage` (`GateVerdictProcessor` +
 * `StepCaptureService` + `UnknownObservationProcessor`), `StepExecutionStage`
 * (`ChainOperatorExecutor`), `GateReviewStage`, `ResponseFormattingStage` (`ResponseFormatter` +
 * `ResponseAssembler`), `ExecutionRecordStore`, `GateEnforcementAuthority`.
 *
 * Stubbed, and why: the gate SERVICE (`enhancePrompt`) — decides gate TEXT, not which gates apply
 * (same posture as `p5-acceptance.integration.test.ts`); planning (supplies `requiresSession` and
 * decides nothing this suite asserts); the framework/injection/script stages (decide nothing about
 * visibility, gate routing, or delegation).
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
import { BRIEF_END, BRIEF_START } from '../../../src/engine/execution/delegation/brief.js';
import { renderGateVerdict } from '../../../src/engine/gates/core/gate-verdict-renderer.js';
import { TemporaryGateRegistry } from '../../../src/engine/gates/core/temporary-gate-registry.js';
import { GateEnforcementAuthority } from '../../../src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.js';
import { ChainBlueprintResolver } from '../../../src/engine/execution/parsers/chain-blueprint-resolver.js';
import { createParsingSystem } from '../../../src/engine/execution/parsers/index.js';
import { SymbolicCommandBuilder } from '../../../src/engine/execution/parsers/symbolic-command-builder.js';
import { WorkflowCommandBuilder } from '../../../src/engine/execution/parsers/workflow-command-builder.js';
import { PromptExecutionPipeline } from '../../../src/engine/execution/pipeline/prompt-execution-pipeline.js';
import { RequestNormalizationStage } from '../../../src/engine/execution/pipeline/stages/01-request-normalization-stage.js';
import { CommandParsingStage } from '../../../src/engine/execution/pipeline/stages/04-parsing-stage.js';
import { OperatorValidationStage } from '../../../src/engine/execution/pipeline/stages/06-operator-validation-stage.js';
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
import { compileWorkflowIR } from '../../../src/modules/workflow-ir/compiler.js';
import { validateWorkflowIR } from '../../../src/modules/workflow-ir/validator.js';

import type { PipelineStage } from '../../../src/engine/execution/pipeline/stage.js';
import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';
import type { Logger } from '../../../src/infra/logging/index.js';
import type { ChainSession } from '../../../src/shared/types/chain-session.js';
import type { WorkflowIR } from '../../../src/modules/workflow-ir/types.js';

// --- fixtures -------------------------------------------------------------------------------

/** The withheld step's response. Absence of this string from a downstream render IS the proof. */
const S1 = 'P6_ACCEPTANCE_SENTINEL_ONE';

const INLINE_GATE = 'p6-acceptance-inline-gate';

const NODE_1 = 'plan-work';
const NODE_2 = 'analyze-findings';
const NODE_3 = 'write-summary';

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

/**
 * Decides gate TEXT, not which gates apply. The routing under test (`inlineOperatorGateIds` →
 * the accumulator → `reviewGateIds` → `pendingGateReview.gateIds`) never calls it; it exists only
 * because `GateEnhancementService.isAvailable()` gates the whole stage on a non-null service.
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

const PROMPTS: ConvertedPrompt[] = [
  prompt('acc_plan', 'Plan', 'Plan the work for this run.'),
  prompt('acc_analyze', 'Analyze', 'Prior: {{previous_step_output}}'),
  prompt('acc_write', 'Write Summary', 'Prior: {{previous_step_output}}'),
];

/**
 * The IR this suite drives: node 1 withholds its own output from every later step, node 2 binds
 * an inline gate, node 3 is delegated. No `edges` — declaration order IS the run order (already
 * proven by Tier 4/5; not re-proven here), so the three fields under test are the only variable.
 */
const richIR = (): WorkflowIR => ({
  version: 1,
  nodes: [
    { id: NODE_1, promptId: 'acc_plan', visibility: { withhold: ['previous_step_output'] } },
    { id: NODE_2, promptId: 'acc_analyze', inlineGateIds: [INLINE_GATE] },
    { id: NODE_3, promptId: 'acc_write', subagentModel: 'fast', agentType: 'chain-executor' },
  ],
});

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
 * Wire the pipeline over ONE session store, ONE execution-record store and ONE temporary-gate
 * registry — the registry is per-pipeline because a run's inline gate registered on one call must
 * stay resolvable by the accumulator on the next.
 */
const buildPipeline = (options: {
  sessionStore: ChainSessionStore;
  recordStore: ExecutionRecordStore;
  logger: Logger;
}): PromptExecutionPipeline => {
  const { sessionStore, recordStore, logger } = options;
  const parsingSystem = createParsingSystem(logger);
  const workflowCommandBuilder = new WorkflowCommandBuilder(
    { validate: validateWorkflowIR, compile: compileWorkflowIR },
    logger
  );
  const chainExecutor = new ChainOperatorExecutor(logger as never, PROMPTS);
  const gateRegistry = new TemporaryGateRegistry(logger);
  const runStepViewProvider = createRunStepViewProvider(sessionStore);

  const realStages: Record<string, PipelineStage> = {
    RequestNormalization: new RequestNormalizationStage(null, null, logger),
    CommandParsing: new CommandParsingStage(
      parsingSystem.commandParser,
      parsingSystem.argumentParser,
      () => PROMPTS,
      logger,
      new SymbolicCommandBuilder(parsingSystem.argumentParser, logger),
      {
        workflowCommandBuilder,
        blueprintResolver: new ChainBlueprintResolver(sessionStore, logger),
      }
    ),
    OperatorValidation: new OperatorValidationStage(null, logger),
    GateEnhancement: new GateEnhancementStage(
      new GateEnhancementService(
        createGateService(),
        gateRegistry,
        () => undefined,
        () => undefined as never,
        undefined,
        new GateMetricsRecorder(undefined),
        logger,
        runStepViewProvider
      ),
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
      logger
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

    if (name === 'ExecutionPlanning') {
      return {
        name,
        execute: async (context: ExecutionContext) => {
          if (!context.parsedCommand) return;
          context.executionPlan = {
            strategy: 'chain',
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

describe('P6 acceptance: gate binding, visibility and delegation take real effect for an IR-submitted run', () => {
  let tmpDir: string;
  let engine: SqliteEngine;
  let logger: Logger;
  let store: ChainSessionStore;
  let pipeline: PromptExecutionPipeline;

  const newStore = (): ChainSessionStore =>
    new ChainSessionStore(
      logger,
      new TextReferenceStore(logger),
      { cleanupIntervalMs: 60_000, defaultScope: { workspaceId: 'ws-p6-acceptance' } },
      engine
    );

  const awaitInit = async (target: ChainSessionStore): Promise<void> =>
    await (target as unknown as { initPromise: Promise<void> }).initPromise;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'p6-acceptance-'));
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

  /** The gate list the OPEN review is scoped to — exactly what a client's next call would see. */
  const openReviewGateIds = (): readonly string[] => onlySession().pendingGateReview?.gateIds ?? [];

  /** The delegated step's own EXECUTION BRIEF — everything between the R-1 delimiters. */
  const briefSectionOf = (text: string): string => {
    const start = text.indexOf(BRIEF_START);
    const end = text.indexOf(BRIEF_END);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    return text.slice(start, end);
  };

  const passVerdict = renderGateVerdict({
    overall: 'PASS',
    rationale: 'meets the gates',
    per_gate: [{ index: 1, passed: true, rationale: 'satisfied' }],
  });

  /**
   * Drive the IR to node 2's render. Node 1 declares no gates, so its response is captured and
   * the run advances to node 2 in the SAME call — no gate_verdict needed in between.
   */
  const driveToNode2 = async (): Promise<{ atNode2: string; chainId: string }> => {
    const start = textOf(await pipeline.execute({ workflow: richIR() }));
    expect(start).toContain('Plan the work for this run.');
    const { chainId } = onlySession();

    const atNode2 = textOf(await pipeline.execute({ chain_id: chainId, user_response: S1 }));
    return { atNode2, chainId };
  };

  describe('acceptance (a) — an IR run through the full real pipeline still produces ordinary rows', () => {
    test('node ids, position order and origin carry no IR-specific marker', async () => {
      await driveToNode2();

      const nodes = engine.query(
        'SELECT node_id, position, origin, origin_unknown_id FROM chain_run_nodes ORDER BY position'
      ) as Array<Record<string, unknown>>;
      expect(nodes.map((row) => row['node_id'])).toEqual([NODE_1, NODE_2, NODE_3]);
      expect(nodes.map((row) => row['position'])).toEqual([1, 2, 3]);
      // 'planned' — never a mutation-inserted node — and no unknown-id provenance, on every row.
      expect(nodes.every((row) => row['origin'] === 'planned')).toBe(true);
      expect(nodes.every((row) => row['origin_unknown_id'] == null)).toBe(true);

      const run = engine.queryOne<{ chain_id: string; base_chain_id: string }>(
        'SELECT chain_id, base_chain_id FROM chain_runs'
      );
      // Same format an equivalent >>chain / symbolic run produces — `chain-<first-prompt>#N`.
      expect(run?.base_chain_id).toBe('chain-acc_plan');
      expect(run?.chain_id).toMatch(/^chain-acc_plan#\d+$/);
    });
  });

  describe('acceptance (d) — gate binding, visibility and delegation reach the run AND take real effect', () => {
    test('one driven run proves all three: withheld sentinel absent, inline gate in the review list, delegation advised then briefed', async () => {
      const { atNode2, chainId } = await driveToNode2();

      // --- visibility: node 1's withhold keeps S1 out of node 2's ACTUAL rendered text --------
      // The withheld VALUE, not merely a banner: a render that announced withholding and leaked
      // the content would pass a banner-only check.
      expect(atNode2).toContain('Prior: **[CONTEXT WITHHELD]**');
      expect(atNode2).not.toContain(S1);

      // --- delegation, part 1: node 3 (subagentModel + agentType) is next and delegated, so
      // node 2's render carries the R-1 one-line ADVISORY — a real `DelegationRenderer` line,
      // not a blueprint flag. The full handoff no longer renders in this position (S7): the
      // authoritative handoff arrives with node 3's own brief, asserted below.
      expect(atNode2).toContain('⚡ Note: Step 3');
      expect(atNode2).toContain('is delegated');
      expect(atNode2).not.toContain('HANDOFF INSTRUCTIONS');
      expect(atNode2).not.toContain('CONTEXT WITHHELD (names only');

      // --- gate binding: node 2's inlineGateIds entered the REAL accumulator, not just the
      // blueprint field. `GateEnhancementService` recomputes the review list for whichever node
      // is CURRENT at the START of a call — which, immediately after `driveToNode2`, is still
      // node 1 (StepExecution only advances `currentNodeId` to node 2 partway through THAT same
      // call, after GateEnhancement already ran). One more call is what makes node 2 the step
      // GateEnhancement evaluates, and that call's own response is what the review is FOR — an
      // accumulator recomputed on every call, observed on the call scoped to the node under test.
      await pipeline.execute({ chain_id: chainId, user_response: 'node-2-response' });
      expect(openReviewGateIds()).toContain(INLINE_GATE);

      // --- delegation, part 2: clearing node 2's review advances onto node 3, whose OWN render
      // is the authoritative handoff — a delimited EXECUTION BRIEF carrying the names-only
      // manifest, followed by HANDOFF INSTRUCTIONS (R-1). Sliced between the delimiters so the
      // assertions cannot be satisfied by text outside the sub-agent's prompt.
      const atNode3 = textOf(
        await pipeline.execute({ chain_id: chainId, gate_verdict: passVerdict })
      );
      const brief = briefSectionOf(atNode3);
      expect(brief).toContain(
        'CONTEXT WITHHELD (names only, values not provided): previous_step_output'
      );
      // The withheld VALUE (node 2's output) is absent from the brief, while chain history —
      // never declared withheld — is admitted: only the declared item moved.
      expect(brief).not.toContain('node-2-response');
      expect(brief).toContain(S1);
      expect(atNode3).toContain('HANDOFF: Execute Step 3');
      expect(atNode3).toContain('HANDOFF INSTRUCTIONS');
    });

    test('control: an IR with no visibility, gate or delegation declarations renders none of the three', async () => {
      // The negative half — without it, a suite that always found withholding/gates/handoffs
      // (a broken accumulator that never clears, say) would pass every assertion above too.
      await pipeline.execute({
        workflow: {
          version: 1,
          nodes: [
            { id: NODE_1, promptId: 'acc_plan' },
            { id: NODE_2, promptId: 'acc_analyze' },
          ],
        },
      });
      const { chainId } = onlySession();
      const atNode2 = textOf(await pipeline.execute({ chain_id: chainId, user_response: S1 }));

      expect(atNode2).toContain(`Prior: ${S1}`);
      expect(atNode2).not.toContain('[CONTEXT WITHHELD]');
      expect(openReviewGateIds()).toEqual([]);
      expect(atNode2).not.toContain('⚡ Note');
      expect(atNode2).not.toContain('HANDOFF');
      expect(atNode2).not.toContain('EXECUTION BRIEF');
    });
  });
});
