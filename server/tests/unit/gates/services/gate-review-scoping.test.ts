// @lifecycle canonical - Unit tests for per-step gate REVIEW scoping (P5 Tier 4, closes P4-F3).
import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { ResponseAssembler } from '../../../../src/engine/execution/formatting/response-assembler.js';
import { GateEnhancementStage } from '../../../../src/engine/execution/pipeline/stages/11-gate-enhancement-stage.js';
import { GateEnhancementService } from '../../../../src/engine/gates/services/gate-enhancement-service.js';
import { GateMetricsRecorder } from '../../../../src/engine/gates/services/gate-metrics-recorder.js';
import { TemporaryGateRegistrar } from '../../../../src/engine/gates/services/temporary-gate-registrar.js';

import type { RunStepView } from '../../../../src/engine/gates/services/run-step-view.js';

/**
 * P4-F3: a gate bound to ONE node entered EVERY step's review, because the review feed read the
 * run-wide accumulator. OQ-P5-4 answers it with a separate `state.gates.reviewGateIds` — the
 * per-step slice — leaving `accumulatedGateIds` (injection input + run-wide inheritance) alone.
 *
 * Two halves are tested here because the defect needs both to close: the WRITER must publish the
 * slice for the step the run is standing at, and the READERS must prefer it while still falling
 * back to the accumulator so the single-prompt path is untouched.
 */

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const createRegistry = () => {
  const gates: Array<Record<string, unknown>> = [];
  let autoId = 0;
  return {
    gates,
    createTemporaryGate: jest.fn((definition: Record<string, unknown>) => {
      autoId += 1;
      const id = typeof definition['id'] === 'string' ? definition['id'] : `temp_${autoId}`;
      gates.push({ ...definition, id });
      return id;
    }),
    getTemporaryGate: jest.fn(
      (gateId: string) =>
        gates.find((gate) => gate['id'] === gateId) as Record<string, unknown> | undefined
    ),
  };
};

const createGateService = () =>
  ({
    supportsValidation: jest.fn().mockReturnValue(false),
    updateConfig: jest.fn(),
    enhancePrompt: jest.fn(
      async (prompt: { userMessageTemplate: string }, gateIds: readonly string[]) => ({
        enhancedPrompt: {
          ...prompt,
          userMessageTemplate: `${prompt.userMessageTemplate}\n\nGuidance: ${gateIds.join(',')}`,
        },
        gateInstructionsInjected: true,
        injectedGateIds: gateIds,
        instructionLength: gateIds.join(',').length,
      })
    ),
  }) as never;

/** A three-step chain as the parser mints it. */
const NODE_IDS = ['draft-outline', 'write-body', 'final-review'];

/** The same chain after the mutation policy inserted an investigation node at position 2. */
const MUTATED_NODE_IDS = ['draft-outline', 'inv-cache-ttl', 'write-body', 'final-review'];

/**
 * A run standing at `currentNodeId`. `nodeIds` is the LIVE order, which is what makes the
 * mutated-run cases discriminating: `write-body` is ordinal 2 before the insertion and 3 after.
 */
const runView = (
  nodeIds: readonly string[],
  currentNodeId: string | null,
  skippedNodeIds: readonly string[] = []
): RunStepView => ({ nodeIds, skippedNodeIds, currentNodeId });

/**
 * A gate id that is NOT a temporary gate: it reaches the accumulator through the step's planned
 * gates, so `filterGatesByStepTarget` finds no registry entry and lets it through on every step.
 * This is what "run-wide inheritance" means after scoping, and the guard against a filter that
 * quietly narrows everything.
 */
const RUN_WIDE_GATE = 'run-wide-gate';

const stepPrompt = (nodeId: string, stepNumber: number, plannedGates: string[]) => ({
  stepNumber,
  nodeId,
  promptId: nodeId,
  args: {},
  metadata: {} as Record<string, unknown>,
  convertedPrompt: {
    id: nodeId,
    name: nodeId,
    description: '',
    category: '',
    userMessageTemplate: `Do ${nodeId}.`,
    systemMessage: '',
    arguments: [],
  },
  executionPlan: { gates: plannedGates },
});

/**
 * Run stage 11 over the parse-time step list for a run standing at `view.currentNodeId`, and
 * return what the step being rendered must be reviewed against.
 */
const reviewGatesFor = async (options: {
  gateSpecs?: Array<Record<string, unknown>>;
  plannedGates?: string[];
  view: RunStepView | undefined;
}): Promise<{ review: string[] | undefined; accumulated: string[] | undefined }> => {
  const gateSpecs = options.gateSpecs ?? [];
  const registry = createRegistry();
  const logger = createLogger();
  const provider = options.view === undefined ? undefined : () => options.view;

  const stage = new GateEnhancementStage(
    new GateEnhancementService(
      createGateService(),
      registry as never,
      () => undefined,
      () => undefined as never,
      undefined,
      new GateMetricsRecorder(undefined),
      logger as never,
      provider as never
    ),
    new TemporaryGateRegistrar(registry as never, undefined, logger as never, provider as never),
    () => ({ enabled: true, definitionsDirectory: 'gates', enableFrameworkGates: true }),
    logger as never
  );

  const steps = NODE_IDS.map((nodeId, index) =>
    stepPrompt(nodeId, index + 1, options.plannedGates ?? [])
  );
  const context = new ExecutionContext({ chain_id: 'chain-demo#1', gates: gateSpecs } as never);
  context.state.gates.requestedOverrides = { gates: gateSpecs };
  context.executionPlan = {
    strategy: 'chain',
    gates: [],
    requiresFramework: false,
    requiresSession: true,
    llmValidationEnabled: false,
  } as never;
  context.parsedCommand = { commandType: 'chain', steps } as never;

  await stage.execute(context);

  return {
    review: context.state.gates.reviewGateIds,
    accumulated: context.state.gates.accumulatedGateIds,
  };
};

/** The id the registrar minted for the single requested gate spec, which is always `temp_1`. */
const TEMP_ID = 'temp_1';

describe('gate review scoping (P4-F3)', () => {
  describe('writer: reviewGateIds carries the current step only', () => {
    test('(a) a node-targeted gate is in review only while the run stands at that node', async () => {
      const spec = { name: 'Body only', criteria: ['cite sources'], target_step_id: 'write-body' };

      const atBody = await reviewGatesFor({
        gateSpecs: [spec],
        view: runView(NODE_IDS, 'write-body'),
      });
      expect(atBody.review).toEqual([TEMP_ID]);

      const atOutline = await reviewGatesFor({
        gateSpecs: [spec],
        view: runView(NODE_IDS, 'draft-outline'),
      });
      // The whole defect: before scoping this was `[temp_1]` too, because the reader took the
      // run-wide accumulator. An empty list is a positive finding — "no gate applies here" —
      // not a missing write, which is why the assertion is on `[]` and not on `undefined`.
      expect(atOutline.review).toEqual([]);

      const atReview = await reviewGatesFor({
        gateSpecs: [spec],
        view: runView(NODE_IDS, 'final-review'),
      });
      expect(atReview.review).toEqual([]);
    });

    test('(b) an untargeted gate stays in review on every step (inheritance guard)', async () => {
      for (const nodeId of NODE_IDS) {
        const result = await reviewGatesFor({
          plannedGates: [RUN_WIDE_GATE],
          view: runView(NODE_IDS, nodeId),
        });
        expect(result.review).toEqual([RUN_WIDE_GATE]);
      }
    });

    test('(c) after an insertion shifts ordinals, the gate follows its NODE', async () => {
      // `write-body` is ordinal 2 at parse time and ordinal 3 on the mutated run. A gate bound to
      // the node must review the node; an ordinal-keyed implementation reviews `final-review`.
      const spec = { name: 'Body only', criteria: ['cite sources'], target_step_id: 'write-body' };

      const atBody = await reviewGatesFor({
        gateSpecs: [spec],
        view: runView(MUTATED_NODE_IDS, 'write-body'),
      });
      expect(atBody.review).toEqual([TEMP_ID]);

      const atFinal = await reviewGatesFor({
        gateSpecs: [spec],
        view: runView(MUTATED_NODE_IDS, 'final-review'),
      });
      expect(atFinal.review).toEqual([]);
    });

    test('accumulatedGateIds keeps the run-wide list the scoping does not touch', async () => {
      const result = await reviewGatesFor({
        gateSpecs: [
          { name: 'Body only', criteria: ['cite sources'], target_step_id: 'write-body' },
        ],
        plannedGates: [RUN_WIDE_GATE],
        view: runView(NODE_IDS, 'draft-outline'),
      });

      // Injection input and inheritance record: still every gate the run picked up, even on the
      // step whose review is empty of the targeted one.
      expect(result.accumulated).toEqual(expect.arrayContaining([TEMP_ID, RUN_WIDE_GATE]));
      expect(result.review).toEqual([RUN_WIDE_GATE]);
    });

    test('the call that STARTS a chain reviews step 1, with no run to ask', async () => {
      const result = await reviewGatesFor({
        gateSpecs: [
          { name: 'Outline only', criteria: ['cite sources'], target_step_id: 'draft-outline' },
        ],
        view: undefined,
      });
      expect(result.review).toEqual([TEMP_ID]);
    });

    test('a run that has walked off its last node writes no review scope', async () => {
      const result = await reviewGatesFor({
        plannedGates: [RUN_WIDE_GATE],
        view: runView(NODE_IDS, null),
      });
      expect(result.review).toBeUndefined();
    });
  });

  describe('reader: the CTA prefers the scope and falls back to the accumulator', () => {
    const assembler = new ResponseAssembler();

    const renderCTA = (state: { accumulated?: string[]; review?: string[] }): string => {
      const context = new ExecutionContext({ command: '>>test-prompt' } as never);
      context.executionResults = { content: 'out', metadata: {}, generatedAt: 0 } as never;
      context.executionPlan = {
        strategy: 'single',
        gates: [],
        requiresFramework: false,
        requiresSession: true,
      } as never;
      context.parsedCommand = {
        promptId: 'test-prompt',
        rawArgs: '',
        format: 'symbolic',
        confidence: 1,
        convertedPrompt: {
          id: 'test-prompt',
          name: 'Test',
          description: '',
          category: '',
          userMessageTemplate: 'x',
          arguments: [],
        },
        promptArgs: {},
        metadata: {
          originalCommand: '>>test-prompt',
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
      } as never;
      context.sessionContext = {
        sessionId: 'session-1',
        chainId: 'chain-demo#1',
        isChainExecution: true,
        currentStep: 1,
        totalSteps: 3,
      };
      if (state.accumulated !== undefined) {
        context.state.gates.accumulatedGateIds = state.accumulated;
      }
      if (state.review !== undefined) {
        context.state.gates.reviewGateIds = state.review;
      }
      return assembler.formatSinglePromptResponse(context, {} as never);
    };

    test('(d) with no reviewGateIds the render is byte-identical to the accumulator render', () => {
      // The single-prompt path writes no scope; its output must not move at all.
      const fallback = renderCTA({ accumulated: ['intent-quality', 'code-quality'] });
      const explicit = renderCTA({
        accumulated: ['intent-quality', 'code-quality'],
        review: ['intent-quality', 'code-quality'],
      });

      expect(fallback).toContain('**Gates**: intent-quality, code-quality');
      expect(fallback).toBe(explicit);
    });

    test('a narrower scope wins over the accumulator', () => {
      const rendered = renderCTA({
        accumulated: ['intent-quality', 'code-quality'],
        review: ['code-quality'],
      });

      expect(rendered).toContain('**Gates**: code-quality');
      expect(rendered).not.toContain('intent-quality');
      // Verdict indices are positional over the list that is rendered, and nothing joins them
      // back to a gate id (`parseGateVerdicts` keeps a bare integer), so a shorter list renumbers
      // safely rather than mismatching.
      expect(rendered).toContain('"index": 1');
      expect(rendered).not.toContain('"index": 2');
    });

    test('an empty scope suppresses the review CTA the accumulator would have raised', () => {
      const rendered = renderCTA({ accumulated: ['intent-quality'], review: [] });
      expect(rendered).not.toContain('**Review Required**');
    });
  });
});
