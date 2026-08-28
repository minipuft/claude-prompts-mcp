// @lifecycle test - P6 Tier 5: a submitted Workflow IR is an ordinary chain run, or it writes nothing.
/**
 * Workflow IR through the real pipeline.
 *
 * Two claims, and they are opposites, so they are proven in one suite against one store:
 *
 *  (a) A VALID IR executes through the ordinary machinery. Proven by equivalence, not by
 *      inspection: the SAME pipeline runs an IR submission and an equivalent `>>chain` command,
 *      and the resulting `chain_runs` / `chain_run_nodes` rows are compared field by field. An
 *      assertion that merely read "an IR produced 3 nodes" would pass for an IR-specific path
 *      that happened to write 3 rows, which is exactly what the charter forbids.
 *
 *  (b) An INVALID IR writes nothing. Proven by counting rows in every table a run touches
 *      (`chain_runs`, `chain_run_nodes`, `chain_sessions`, `execution_records`) after a rejected
 *      call — a negative that observes the ABSENCES, not just the error text, because a rejection
 *      that also created a session would still return an error message.
 *
 * Real collaborators: `SqliteEngine`, `ChainSessionStore`, `RequestNormalizationStage`,
 * `CommandParsingStage` with the real `UnifiedCommandParser`, `ArgumentParser`,
 * `SymbolicCommandBuilder` and `WorkflowCommandBuilder` (wired to the real `validateWorkflowIR` /
 * `compileWorkflowIR`), `OperatorValidationStage` and `SessionManagementStage`. Nothing in this
 * file writes session state directly.
 *
 * Stubbed, and why: planning (supplies the `requiresSession` plan both halves share and decides
 * nothing this suite asserts) and formatting (the pipeline requires SOME response; the rows under
 * test are written two stages earlier). The gate stages are absent for the same reason —
 * `gates` + `target_step_id` routing is the SAME channel P5's acceptance suite already drives,
 * and re-driving it here would test the registrar, not the IR.
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

import { createParsingSystem } from '../../../src/engine/execution/parsers/index.js';
import { SymbolicCommandBuilder } from '../../../src/engine/execution/parsers/symbolic-command-builder.js';
import { WorkflowCommandBuilder } from '../../../src/engine/execution/parsers/workflow-command-builder.js';
import { PromptExecutionPipeline } from '../../../src/engine/execution/pipeline/prompt-execution-pipeline.js';
import { RequestNormalizationStage } from '../../../src/engine/execution/pipeline/stages/01-request-normalization-stage.js';
import { CommandParsingStage } from '../../../src/engine/execution/pipeline/stages/04-parsing-stage.js';
import { OperatorValidationStage } from '../../../src/engine/execution/pipeline/stages/06-operator-validation-stage.js';
import { SessionManagementStage } from '../../../src/engine/execution/pipeline/stages/13-session-stage.js';
import { ChainSessionStore } from '../../../src/modules/chains/manager.js';
import { TextReferenceStore } from '../../../src/modules/text-refs/index.js';
import { compileWorkflowIR } from '../../../src/modules/workflow-ir/compiler.js';
import { validateWorkflowIR } from '../../../src/modules/workflow-ir/validator.js';

import type { ExecutionContext } from '../../../src/engine/execution/context/execution-context.js';
import type { PipelineStage } from '../../../src/engine/execution/pipeline/stage.js';
import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';
import type { Logger } from '../../../src/infra/logging/index.js';
import type { McpToolRequest } from '../../../src/shared/types/execution.js';
import type { WorkflowIR } from '../../../src/modules/workflow-ir/types.js';

// --- fixtures -------------------------------------------------------------------------------

const NODE_1 = 'gather-sources';
const NODE_2 = 'analyze-findings';
const NODE_3 = 'write-summary';

const createLogger = (): Logger =>
  ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

const leaf = (id: string): ConvertedPrompt => ({
  id,
  name: id,
  description: id,
  category: 'analysis',
  userMessageTemplate: `Body of ${id}`,
  systemMessage: '',
  arguments: [],
});

/**
 * The YAML chain the IR must be indistinguishable from.
 *
 * Its steps declare explicit `id:`s equal to the IR's node ids, because that is the ONLY way the
 * two halves can share an id space: `mintNodeIds` uses a step's explicit `id` when it has one and
 * a slug of `stepName` otherwise. Comparing node ids across the two halves is the whole point —
 * an equivalence that first normalized the ids away would not be one.
 */
const EQUIVALENT_CHAIN: ConvertedPrompt = {
  ...leaf('ir_equivalent_chain'),
  name: 'IR Equivalent Chain',
  userMessageTemplate: 'Run the equivalent chain.',
  chainSteps: [
    { id: NODE_1, promptId: 'research_docs', stepName: 'Gather sources' },
    { id: NODE_2, promptId: 'analyze_data', stepName: 'Analyze findings' },
    { id: NODE_3, promptId: 'write_report', stepName: 'Write summary' },
  ],
};

const PROMPTS: ConvertedPrompt[] = [
  leaf('research_docs'),
  leaf('analyze_data'),
  leaf('write_report'),
  EQUIVALENT_CHAIN,
];

/**
 * The same three steps as {@link EQUIVALENT_CHAIN}, expressed as a graph.
 *
 * Declared in a DIFFERENT order from the run order, with edges that force the run order back to
 * the chain's. If the linearizer were a no-op the equivalence assertion would fail on position,
 * so this fixture also proves the edges did something.
 */
const equivalentIR = (): WorkflowIR => ({
  version: 1,
  nodes: [
    { id: NODE_3, promptId: 'write_report' },
    { id: NODE_1, promptId: 'research_docs' },
    { id: NODE_2, promptId: 'analyze_data' },
  ],
  edges: [
    { from: NODE_1, to: NODE_2 },
    { from: NODE_2, to: NODE_3 },
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

const buildPipeline = (
  sessionStore: ChainSessionStore,
  logger: Logger
): PromptExecutionPipeline => {
  const parsingSystem = createParsingSystem(logger);
  const workflowCommandBuilder = new WorkflowCommandBuilder(
    { validate: validateWorkflowIR, compile: compileWorkflowIR },
    logger
  );

  const realStages: Record<string, PipelineStage> = {
    RequestNormalization: new RequestNormalizationStage(null, null, logger),
    CommandParsing: new CommandParsingStage(
      parsingSystem.commandParser,
      parsingSystem.argumentParser,
      () => PROMPTS,
      logger,
      new SymbolicCommandBuilder(parsingSystem.argumentParser, logger),
      { workflowCommandBuilder }
    ),
    OperatorValidation: new OperatorValidationStage(null, logger),
    SessionManagement: new SessionManagementStage(sessionStore, logger),
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
    if (name === 'ResponseFormatting') {
      return {
        name,
        execute: async (context: ExecutionContext) => {
          context.setResponse({
            content: [{ type: 'text', text: 'run started' }],
            isError: false,
          });
        },
      };
    }
    return { name, execute: async () => undefined };
  });

  return new PromptExecutionPipeline(stages, {
    logger,
    metricsProvider: () => undefined,
    chainSessionStore: sessionStore,
  });
};

// --- suite ----------------------------------------------------------------------------------

describe('P6 Tier 5: a Workflow IR run is an ordinary chain run — or it writes nothing', () => {
  let tmpDir: string;
  let engine: SqliteEngine;
  let logger: Logger;
  let store: ChainSessionStore;
  let pipeline: PromptExecutionPipeline;

  const awaitInit = async (target: ChainSessionStore): Promise<void> =>
    await (target as unknown as { initPromise: Promise<void> }).initPromise;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'p6-workflow-ir-'));
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

  const clearRuns = (): void => {
    engine.run('DELETE FROM chain_run_nodes');
    engine.run('DELETE FROM chain_runs');
    engine.run('DELETE FROM chain_sessions');
    engine.run('DELETE FROM execution_records');
  };

  beforeEach(async () => {
    clearRuns();
    store = new ChainSessionStore(
      logger,
      new TextReferenceStore(logger) as never,
      { cleanupIntervalMs: 60_000, defaultScope: { workspaceId: 'ws-p6-workflow-ir' } },
      engine
    );
    await awaitInit(store);
    pipeline = buildPipeline(store, logger);
  });

  afterEach(async () => {
    await store.cleanup();
  });

  const run = async (request: McpToolRequest) => await pipeline.execute(request);

  const textOf = (response: { content: Array<{ text?: string }> }): string =>
    response.content.map((part) => part.text ?? '').join('\n');

  /** Node rows for the single run in the database, in position order. */
  const nodeRows = (): Array<Record<string, unknown>> =>
    engine.query(
      'SELECT node_id, position, prompt_id, step_name, origin, origin_unknown_id FROM chain_run_nodes ORDER BY position'
    ) as Array<Record<string, unknown>>;

  const runRows = (): Array<Record<string, unknown>> =>
    engine.query(
      'SELECT chain_id, base_chain_id, run_status, current_node_id FROM chain_runs'
    ) as Array<Record<string, unknown>>;

  const countOf = (table: string): number =>
    engine.queryOne<{ n: number }>(`SELECT COUNT(*) AS n FROM ${table}`)?.n ?? 0;

  const allCounts = (): Record<string, number> => ({
    chain_runs: countOf('chain_runs'),
    chain_run_nodes: countOf('chain_run_nodes'),
    chain_sessions: countOf('chain_sessions'),
    execution_records: countOf('execution_records'),
  });

  describe('acceptance (a) — no IR-specific execution path', () => {
    test('an IR run and an equivalent >>chain run write structurally identical rows', async () => {
      await run({ command: '>>ir_equivalent_chain' });
      const chainNodes = nodeRows();
      const chainRun = runRows();
      expect(chainNodes).toHaveLength(3);
      expect(chainRun).toHaveLength(1);

      // Second run, same pipeline, same store — cleared so the two are compared in isolation.
      clearRuns();
      store = new ChainSessionStore(
        logger,
        new TextReferenceStore(logger) as never,
        { cleanupIntervalMs: 60_000, defaultScope: { workspaceId: 'ws-p6-workflow-ir' } },
        engine
      );
      await awaitInit(store);
      pipeline = buildPipeline(store, logger);

      await run({ workflow: equivalentIR() });
      const irNodes = nodeRows();
      const irRun = runRows();

      // Node identity, order and prompt binding are the equivalence claim.
      expect(irNodes.map((row) => row['node_id'])).toEqual([NODE_1, NODE_2, NODE_3]);
      expect(irNodes.map((row) => [row['node_id'], row['position'], row['prompt_id']])).toEqual(
        chainNodes.map((row) => [row['node_id'], row['position'], row['prompt_id']])
      );
      // Provenance too: an IR node is `planned`, exactly like a YAML chain's, so a later
      // `nodes_inserted` telemetry read cannot mistake a submitted node for a mutation.
      expect(irNodes.map((row) => [row['origin'], row['origin_unknown_id']])).toEqual(
        chainNodes.map((row) => [row['origin'], row['origin_unknown_id']])
      );
      expect(irRun[0]?.['run_status']).toBe(chainRun[0]?.['run_status']);
      expect(irRun[0]?.['current_node_id']).toBe(chainRun[0]?.['current_node_id']);
    });

    test('the run order comes from the edges, not from the declaration order', async () => {
      // `equivalentIR()` declares write-summary FIRST. Without linearization the rows would open
      // with it, and the equivalence above would be passing on a coincidence.
      await run({ workflow: equivalentIR() });
      expect(nodeRows().map((row) => row['node_id'])).toEqual([NODE_1, NODE_2, NODE_3]);
    });

    test('with no edges the run order is nodes[] exactly as written', async () => {
      await run({
        workflow: {
          version: 1,
          nodes: [
            { id: NODE_3, promptId: 'write_report' },
            { id: NODE_1, promptId: 'research_docs' },
          ],
        },
      });
      expect(nodeRows().map((row) => row['node_id'])).toEqual([NODE_3, NODE_1]);
    });

    test('the base chain id reads like an equivalent ad-hoc chain, from the first step', async () => {
      await run({ workflow: equivalentIR() });
      expect(runRows()[0]?.['base_chain_id']).toBe('chain-research_docs');
    });
  });

  describe('acceptance (b) — a rejected IR writes nothing', () => {
    test('a cap breach is rejected with a named reason AND creates no rows anywhere', async () => {
      // Cap breach rather than an unresolvable prompt id: every node here is well-formed and
      // every prompt resolves, so the ONLY thing standing between this submission and a created
      // run is the cap check. A mutation that skipped validation would compile this IR happily
      // and the row counts below would be the assertion that notices.
      const response = await run({
        workflow: {
          version: 1,
          nodes: Array.from({ length: 4 }, (_, index) => ({
            id: `node-${index + 1}`,
            promptId: 'research_docs',
          })),
          budget: { maxNodes: 2 },
        },
      });

      // Absences FIRST. The error text and the absences are different claims, and asserting the
      // text first means a mutation that both errored AND created a run would report the weaker
      // failure — the property under test here is that nothing was written.
      expect(allCounts()).toEqual({
        chain_runs: 0,
        chain_run_nodes: 0,
        chain_sessions: 0,
        execution_records: 0,
      });
      expect(response.isError).toBe(true);
      expect(textOf(response)).toContain('[cap-exceeded]');
    });

    test('an unknown prompt is rejected, addressed to the node that named it', async () => {
      const response = await run({
        workflow: {
          version: 1,
          nodes: [
            { id: NODE_1, promptId: 'research_docs' },
            { id: 'ghost-step', promptId: 'no_such_prompt' },
          ],
        },
      });

      // Absences FIRST — see the cap-breach test above for why this order is the assertion.
      expect(allCounts()).toEqual({
        chain_runs: 0,
        chain_run_nodes: 0,
        chain_sessions: 0,
        execution_records: 0,
      });
      expect(response.isError).toBe(true);
      expect(textOf(response)).toContain('[unknown-prompt]');
      expect(textOf(response)).toContain('ghost-step');
    });

    test('a cycle is rejected, naming the nodes that could not be ordered', async () => {
      const response = await run({
        workflow: {
          version: 1,
          nodes: [
            { id: NODE_1, promptId: 'research_docs' },
            { id: NODE_2, promptId: 'analyze_data' },
          ],
          edges: [
            { from: NODE_1, to: NODE_2 },
            { from: NODE_2, to: NODE_1 },
          ],
        },
      });

      // Absences FIRST — see the cap-breach test above for why this order is the assertion.
      expect(allCounts()).toEqual({
        chain_runs: 0,
        chain_run_nodes: 0,
        chain_sessions: 0,
        execution_records: 0,
      });
      expect(response.isError).toBe(true);
      expect(textOf(response)).toContain('[cycle]');
    });

    test('every rejection line names its subject and its reason', async () => {
      const response = await run({
        workflow: {
          version: 1,
          nodes: [{ id: 'ghost-step', promptId: 'no_such_prompt' }],
        },
      });
      for (const line of textOf(response)
        .split('\n')
        .filter((text) => text.startsWith('•'))) {
        expect(line).toMatch(/^• \[[a-z-]+] (node "|edge |workflow)/);
      }
    });
  });

  describe('mutual exclusivity — three command sources, never two', () => {
    test('workflow + command is rejected, naming the conflicting parameter, writing nothing', async () => {
      const response = await run({
        command: '>>ir_equivalent_chain',
        workflow: equivalentIR(),
      });

      expect(response.isError).toBe(true);
      expect(textOf(response)).toContain('[mutually-exclusive-source]');
      expect(textOf(response)).toContain("'command'");
      expect(allCounts()).toEqual({
        chain_runs: 0,
        chain_run_nodes: 0,
        chain_sessions: 0,
        execution_records: 0,
      });
    });

    test('workflow + chain_id is rejected, naming chain_id', async () => {
      const response = await run({
        chain_id: 'chain-ir_equivalent_chain#1',
        workflow: equivalentIR(),
      });

      expect(response.isError).toBe(true);
      expect(textOf(response)).toContain("'chain_id'");
      expect(allCounts().chain_runs).toBe(0);
    });

    test('a workflow on its own is NOT rejected — the guard bounds itself', async () => {
      // The negative half of the exclusivity check: without it, a guard that rejected every
      // workflow would pass all three assertions above.
      const response = await run({ workflow: equivalentIR() });
      expect(response.isError).toBe(false);
      expect(allCounts().chain_runs).toBe(1);
    });
  });

  describe('acceptance (d) — every declared field is observable in the run', () => {
    const richIR = (): WorkflowIR => ({
      version: 1,
      nodes: [
        {
          id: NODE_1,
          promptId: 'research_docs',
          args: { topic: 'caching' },
          outputMapping: { findings: NODE_1 },
          inlineGateIds: ['source-quality'],
        },
        {
          id: NODE_2,
          promptId: 'analyze_data',
          inputMapping: { prior: 'step1_result' },
          visibility: { withhold: ['chain_history'] },
          subagentModel: 'fast',
          agentType: 'general-purpose',
          framework: 'CAGEERF',
          retries: 2,
        },
      ],
      edges: [{ from: NODE_1, to: NODE_2 }],
      budget: { maxInsertions: 1, declaredCostCeiling: 50_000 },
    });

    const blueprintSteps = (): Array<Record<string, unknown>> => {
      const sessionId = engine.queryOne<{ session_id: string }>(
        'SELECT session_id FROM chain_runs'
      )?.session_id;
      expect(sessionId).toBeDefined();
      const blueprint = store.getSessionBlueprint(sessionId as string, {
        workspaceId: 'ws-p6-workflow-ir',
      });
      return (blueprint?.parsedCommand?.steps ?? []) as unknown as Array<Record<string, unknown>>;
    };

    test('node id, mappings, gate binding, visibility and delegation all reach the run blueprint', async () => {
      await run({ workflow: richIR() });
      const steps = blueprintSteps();

      expect(steps.map((step) => step['nodeId'])).toEqual([NODE_1, NODE_2]);
      expect(steps[0]?.['outputMapping']).toEqual({ findings: NODE_1 });
      expect(steps[0]?.['inlineGateIds']).toEqual(['source-quality']);
      expect(steps[1]?.['inputMapping']).toEqual({ prior: 'step1_result' });
      expect(steps[1]?.['visibility']).toEqual({ withhold: ['chain_history'] });
      expect(steps[1]?.['subagentModel']).toBe('fast');
      expect(steps[1]?.['agentType']).toBe('general-purpose');
      expect(steps[1]?.['framework']).toBe('CAGEERF');
      expect(steps[1]?.['retries']).toBe(2);
    });

    test('a subagentModel node is marked delegated by stage 06, on this path too', async () => {
      // P5-F5's lesson, re-checked on the third command source: delegation is derived by the
      // operator-validation stage from `subagentModel`, and the IR path has an empty operator
      // set exactly like a direct `>>chain` does.
      await run({ workflow: richIR() });
      expect(blueprintSteps()[1]?.['delegated']).toBe(true);
    });
  });

  describe('acceptance (c) — declared budget: caps enforced, cost recorded', () => {
    test('the declared insertion cap and cost ceiling survive onto the run, and only those two', async () => {
      await run({
        workflow: {
          version: 1,
          nodes: [{ id: NODE_1, promptId: 'research_docs' }],
          budget: { maxNodes: 4, maxFanOut: 2, maxInsertions: 1, declaredCostCeiling: 50_000 },
        },
      });

      const sessionId = engine.queryOne<{ session_id: string }>(
        'SELECT session_id FROM chain_runs'
      )?.session_id;
      const blueprint = store.getSessionBlueprint(sessionId as string, {
        workspaceId: 'ws-p6-workflow-ir',
      });
      expect(blueprint?.parsedCommand?.budget).toEqual({
        maxInsertions: 1,
        declaredCostCeiling: 50_000,
      });
    });

    test('the recorded budget survives a cold load from rows', async () => {
      // `declaredCostCeiling` is record-only, which makes it exactly the kind of field that can
      // be written and never read back. Reading it off a store that has never seen this run in
      // memory is what proves it is recorded rather than merely held.
      await run({
        workflow: {
          version: 1,
          nodes: [{ id: NODE_1, promptId: 'research_docs' }],
          budget: { maxInsertions: 0, declaredCostCeiling: 1234 },
        },
      });
      const sessionId = engine.queryOne<{ session_id: string }>('SELECT session_id FROM chain_runs')
        ?.session_id as string;

      const coldStore = new ChainSessionStore(
        logger,
        new TextReferenceStore(logger) as never,
        { cleanupIntervalMs: 60_000, defaultScope: { workspaceId: 'ws-p6-workflow-ir' } },
        engine
      );
      await awaitInit(coldStore);
      try {
        expect(
          coldStore.getSessionBlueprint(sessionId, { workspaceId: 'ws-p6-workflow-ir' })
            ?.parsedCommand?.budget
        ).toEqual({ maxInsertions: 0, declaredCostCeiling: 1234 });
      } finally {
        await coldStore.cleanup();
      }
    });

    test('a >>chain run carries no budget at all — absence means server defaults', async () => {
      await run({ command: '>>ir_equivalent_chain' });
      const sessionId = engine.queryOne<{ session_id: string }>('SELECT session_id FROM chain_runs')
        ?.session_id as string;
      expect(
        store.getSessionBlueprint(sessionId, { workspaceId: 'ws-p6-workflow-ir' })?.parsedCommand
          ?.budget
      ).toBeUndefined();
    });
  });
});
