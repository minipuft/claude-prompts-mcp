// @lifecycle test - Tier A row A.2: a `-->` command compiles through the Workflow IR, byte-identically.
/**
 * Row A.2's OWN Verify clause, as a permanent gate.
 *
 * The row rewires `SymbolicCommandBuilder.buildSymbolicChain` so a `-->` command no longer builds
 * `ChainStepPrompt[]` on its own: it maps to Workflow IR nodes (frozen `n1..nN` ids, linear
 * edges, per-step args, `==>` → `delegated`, per-step `::` → `inlineGateCriteria`) and hands them
 * to `compileWorkflowIR`, the same compiler a submitted IR and (through A.1's derivation) a YAML
 * chain reach. The whole point is that NOTHING a run observes changes.
 *
 * The expectations below were CAPTURED AT `3a012bae`, before the rewiring, by running this file
 * against the old hand-rolled builder. They are frozen literals rather than `toMatchSnapshot()`
 * for exactly that reason — a snapshot file regenerates on `-u` and would launder the regression
 * this file exists to catch.
 *
 * WHAT IS COMPARED. Two artifacts, at two different depths:
 *
 *   - every stable column of `chain_run_nodes` (the row's named artifact), minus `session_id` and
 *     the four volatile timestamps;
 *   - the whole run blueprint's `parsedCommand.steps`, which is what `buildChainNodes` derives
 *     those rows FROM and therefore carries strictly more than they do. A field the rewiring
 *     dropped that `chain_run_nodes` has no column for — `delegated`, `inlineGateCriteria`,
 *     `subagentModel` — would pass the row check and fail here. `convertedPrompt` is projected to
 *     its id: it is a whole prompt object, deterministic, and reproducing it would bury the
 *     fields under test.
 *
 * Real collaborators: the same set `p6-acceptance.integration.test.ts` wires, minus the IR
 * command source it does not need. Stubbed: the gate SERVICE (decides gate text, not routing) and
 * planning (supplies `requiresSession` and decides nothing asserted here).
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

import { ResponseAssembler } from '../../../src/engine/execution/formatting/response-assembler.js';
import { ChainOperatorExecutor } from '../../../src/engine/execution/operators/chain-operator-executor.js';
import { TemporaryGateRegistry } from '../../../src/engine/gates/core/temporary-gate-registry.js';
import { GateEnforcementAuthority } from '../../../src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.js';
import { ChainBlueprintResolver } from '../../../src/engine/execution/parsers/chain-blueprint-resolver.js';
import { createParsingSystem } from '../../../src/engine/execution/parsers/index.js';
import { SymbolicCommandBuilder } from '../../../src/engine/execution/parsers/symbolic-command-builder.js';
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

import type { PipelineStage } from '../../../src/engine/execution/pipeline/stage.js';
import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';
import type { Logger } from '../../../src/infra/logging/index.js';
import type { ChainSession } from '../../../src/shared/types/chain-session.js';

// --- fixtures -------------------------------------------------------------------------------

const WORKSPACE_ID = 'ws-symbolic-ir-parity';

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

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
  prompt('sym_a', 'Alpha', 'Alpha does the first thing.'),
  prompt('sym_b', 'Beta', 'Beta: {{previous_step_output}}'),
  prompt('sym_c', 'Gamma', 'Gamma: {{previous_step_output}}'),
  // Declares BOTH prompt-level delegation hints. The symbolic path reads them off the resolved
  // prompt as a fallback; OQ-A2b KILLED unifying that fallback across paths, so it has to survive
  // the rewiring on this path and stay absent on the IR path. A fixture with neither field cannot
  // observe that — the blueprint's JSON round-trip erases an `undefined`-valued key either way.
  {
    ...prompt('sym_d', 'Delta', 'Delta: {{previous_step_output}}'),
    subagentModel: 'heavy',
    agentType: 'custom-agent',
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

const buildPipeline = (options: {
  sessionStore: ChainSessionStore;
  recordStore: ExecutionRecordStore;
  logger: Logger;
}): PromptExecutionPipeline => {
  const { sessionStore, recordStore, logger } = options;
  const parsingSystem = createParsingSystem(logger);
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
      new SymbolicCommandBuilder(parsingSystem.argumentParser, logger, compileWorkflowIR),
      { blueprintResolver: new ChainBlueprintResolver(sessionStore, logger) }
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
    GateReview: new GateReviewStage(chainExecutor, sessionStore, null, logger, undefined, {
      executionRecordStore: recordStore,
    }),
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
        execute: async (context) => {
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
      } as PipelineStage;
    }
    return { name, execute: async () => undefined } as PipelineStage;
  });

  return new PromptExecutionPipeline(stages, {
    logger,
    metricsProvider: () => undefined,
    gateEnforcement: new GateEnforcementAuthority(sessionStore, logger),
    executionRecordStore: recordStore,
    chainSessionStore: sessionStore,
  });
};

describe('row A.2 — a `-->` command compiles through the Workflow IR without changing the run', () => {
  let tmpDir: string;
  let engine: SqliteEngine;
  let logger: Logger;
  let store: ChainSessionStore;
  let pipeline: PromptExecutionPipeline;

  const newStore = (): ChainSessionStore =>
    new ChainSessionStore(
      logger,
      new TextReferenceStore(logger),
      { cleanupIntervalMs: 60_000, defaultScope: { workspaceId: WORKSPACE_ID } },
      engine
    );

  const awaitInit = async (target: ChainSessionStore): Promise<void> =>
    await (target as unknown as { initPromise: Promise<void> }).initPromise;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'symbolic-ir-parity-'));
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

  const onlySession = (): ChainSession => {
    const sessions = Array.from(
      (store as unknown as { activeSessions: Map<string, ChainSession> }).activeSessions.values()
    );
    expect(sessions).toHaveLength(1);
    return sessions[0] as ChainSession;
  };

  /**
   * Every stable column of `chain_run_nodes`. `session_id` and the four `*_at` timestamps are
   * excluded as volatile — everything else is the run's account of its own node list.
   */
  const nodeRows = (): Array<Record<string, unknown>> =>
    engine.query(
      'SELECT node_id, position, prompt_id, step_name, milestone, is_placeholder, origin, ' +
        'origin_unknown_id, declared_sections_json FROM chain_run_nodes ORDER BY position'
    ) as Array<Record<string, unknown>>;

  /**
   * The blueprint's compiled steps, with `convertedPrompt` projected to its id.
   *
   * Strictly finer-grained than `chain_run_nodes`: `delegated`, `inlineGateCriteria` and
   * `subagentModel` have no column there, so only this projection can observe them.
   */
  const blueprintSteps = (): Array<Record<string, unknown>> => {
    const sessionId = engine.queryOne<{ session_id: string }>(
      'SELECT session_id FROM chain_runs'
    )?.session_id;
    expect(sessionId).toBeDefined();
    const blueprint = store.getSessionBlueprint(sessionId as string, {
      workspaceId: WORKSPACE_ID,
    });
    const steps = (blueprint?.parsedCommand?.steps ?? []) as unknown as Array<
      Record<string, unknown>
    >;
    return steps.map((step) => ({
      ...step,
      convertedPrompt: (step['convertedPrompt'] as { id?: string } | undefined)?.id,
    }));
  };

  test('plain `>>a --> >>b` writes the rows and steps captured before the rewiring', async () => {
    await pipeline.execute({ command: '>>sym_a --> >>sym_b' });
    expect(onlySession()).toBeDefined();

    expect(nodeRows()).toEqual([
      {
        node_id: 'n1',
        position: 1,
        prompt_id: 'sym_a',
        step_name: 'sym_a',
        milestone: null,
        is_placeholder: null,
        origin: 'planned',
        origin_unknown_id: null,
        declared_sections_json: null,
      },
      {
        node_id: 'n2',
        position: 2,
        prompt_id: 'sym_b',
        step_name: 'sym_b',
        milestone: null,
        is_placeholder: null,
        origin: 'planned',
        origin_unknown_id: null,
        declared_sections_json: null,
      },
    ]);

    expect(blueprintSteps()).toEqual([
      {
        stepNumber: 1,
        nodeId: 'n1',
        promptId: 'sym_a',
        convertedPrompt: 'sym_a',
        args: {},
        inlineGateCriteria: [],
      },
      {
        stepNumber: 2,
        nodeId: 'n2',
        promptId: 'sym_b',
        convertedPrompt: 'sym_b',
        args: {},
        inlineGateCriteria: [],
      },
    ]);
  });

  test('`::` criteria and `==>` delegation land on their own step, unchanged', async () => {
    await pipeline.execute({ command: ">>sym_a --> >>sym_b :: 'x' ==> >>sym_c" });
    expect(onlySession()).toBeDefined();

    expect(nodeRows()).toEqual([
      {
        node_id: 'n1',
        position: 1,
        prompt_id: 'sym_a',
        step_name: 'sym_a',
        milestone: null,
        is_placeholder: null,
        origin: 'planned',
        origin_unknown_id: null,
        declared_sections_json: null,
      },
      {
        node_id: 'n2',
        position: 2,
        prompt_id: 'sym_b',
        step_name: 'sym_b',
        milestone: null,
        is_placeholder: null,
        origin: 'planned',
        origin_unknown_id: null,
        declared_sections_json: null,
      },
      {
        node_id: 'n3',
        position: 3,
        prompt_id: 'sym_c',
        step_name: 'sym_c',
        milestone: null,
        is_placeholder: null,
        origin: 'planned',
        origin_unknown_id: null,
        declared_sections_json: null,
      },
    ]);

    // `::` binds to n2 and n2 only; `==>` marks n3 and n3 only. Both are the per-step attribution
    // DEV-TA2-1 measured the run-level `gates[]` channel provably cannot express.
    expect(blueprintSteps()).toEqual([
      {
        stepNumber: 1,
        nodeId: 'n1',
        promptId: 'sym_a',
        convertedPrompt: 'sym_a',
        args: {},
        inlineGateCriteria: [],
      },
      {
        stepNumber: 2,
        nodeId: 'n2',
        promptId: 'sym_b',
        convertedPrompt: 'sym_b',
        args: {},
        inlineGateCriteria: ['x'],
      },
      {
        stepNumber: 3,
        nodeId: 'n3',
        promptId: 'sym_c',
        convertedPrompt: 'sym_c',
        args: {},
        inlineGateCriteria: [],
        delegated: true,
      },
    ]);
  });
  test('a prompt-level `subagentModel` / `agentType` still falls back onto the step', async () => {
    await pipeline.execute({ command: '>>sym_a --> >>sym_d' });
    expect(onlySession()).toBeDefined();

    // The fallback OQ-A2b refused to unify: the SYMBOLIC path reads these off the resolved
    // prompt, and `markDelegatedStepPrompts` (stage 06) turns `subagentModel` into the runtime
    // `delegated` flag. An IR node gets neither, which is the behaviour the killed row would
    // have changed.
    expect(blueprintSteps()[1]).toEqual({
      stepNumber: 2,
      nodeId: 'n2',
      promptId: 'sym_d',
      convertedPrompt: 'sym_d',
      args: {},
      inlineGateCriteria: [],
      subagentModel: 'heavy',
      agentType: 'custom-agent',
      delegated: true,
    });
  });
});
