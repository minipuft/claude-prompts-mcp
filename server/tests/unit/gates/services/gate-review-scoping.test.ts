// @lifecycle canonical - Unit tests for per-step gate REVIEW scoping (P5 Tier 4, closes P4-F3).
import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { ResponseAssembler } from '../../../../src/engine/execution/formatting/response-assembler.js';
import { GateEnhancementStage } from '../../../../src/engine/execution/pipeline/stages/11-gate-enhancement-stage.js';
import { GateEnhancementService } from '../../../../src/engine/gates/services/gate-enhancement-service.js';
import { GateMetricsRecorder } from '../../../../src/engine/gates/services/gate-metrics-recorder.js';
import { TemporaryGateRegistrar } from '../../../../src/engine/gates/services/temporary-gate-registrar.js';

import type { RunStepView } from '../../../../src/engine/gates/services/run-step-view.js';
import type { PendingGateReview } from '../../../../src/shared/types/chain-execution.js';

/**
 * P4-F3: a gate bound to ONE node entered EVERY step's review, because the review feed read the
 * run-wide accumulator. OQ-P5-4 answers it with a separate `state.gates.reviewGateIds` — the
 * per-step slice — leaving `accumulatedGateIds` (injection input + run-wide inheritance) alone.
 *
 * Two halves are tested here because the defect needs both to close: the WRITER must publish the
 * slice for the step the run is standing at. Mandatory verdict actions read the actual pending
 * review's gate IDs; scope and accumulator arrays alone remain guidance, not review authority.
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
    // No canonical gate here: no id is refused (R100).
    canonicalIdRefusal: () => undefined,
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
    // The run holds a gate registered under its id; only the harness's run exists.
    resolveDeclared: jest.fn(
      (key: string) => gates.find((gate) => gate['id'] === key)?.['id'] as string | undefined
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
 * The mutated run standing ON the inserted node — the P5-F4 case.
 *
 * `currentNodeOrigin` is what the provider publishes only for a node the mutation policy
 * inserted; a planned node never carries it, which is what keeps every case above unchanged.
 */
const insertedRunView = (
  origin: { originUnknownId?: string; unknownTargetNodeId?: string },
  skippedNodeIds: readonly string[] = []
): RunStepView => ({
  nodeIds: MUTATED_NODE_IDS,
  skippedNodeIds,
  currentNodeId: 'inv-cache-ttl',
  currentNodeOrigin: { origin: 'inserted', ...origin },
});

/** A gate bound to the node the unknown blocked, and one bound to a node it did not. */
const BODY_GATE = { name: 'Body only', criteria: ['cite sources'], target_step_id: 'write-body' };
const FINAL_GATE = {
  name: 'Final only',
  criteria: ['check tone'],
  target_step_id: 'final-review',
};
/** Registration order decides the minted ids — `createRegistry` counts from 1. */
const BODY_GATE_ID = 'temp_1';
const FINAL_GATE_ID = 'temp_2';

/**
 * A gate id that is NOT a temporary gate: it reaches the accumulator through every step's planned
 * gates, so every planned step reviews it, which guards against a filter that quietly narrows
 * everything. Each step's own plan supplies it, so it is each step's gate (R204): an inserted node
 * inherits it only through the step its unknown names.
 */
const RUN_WIDE_GATE = 'run-wide-gate';

/** A gate the call held before the walk, as a request gate is: run-wide on every node (R204). */
const HELD_GATE = 'held-gate';

const stepPrompt = (
  nodeId: string,
  stepNumber: number,
  plannedGates: string[],
  modifiers?: { clean?: boolean }
) => ({
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
  executionPlan: { gates: plannedGates, ...(modifiers === undefined ? {} : { modifiers }) },
});

/**
 * Run stage 11 over the parse-time step list for a run standing at `view.currentNodeId`, and
 * return what the step being rendered must be reviewed against.
 */
const reviewGatesFor = async (options: {
  gateSpecs?: Array<Record<string, unknown>>;
  plannedGates?: string[];
  view: RunStepView | undefined;
  /** Node ids whose parse-time step carries `modifiers: { clean: true }` — row 4.5. */
  skipNodeIds?: readonly string[];
  /** Gates the call holds before the walk, as a request gate is. */
  heldGates?: readonly string[];
}): Promise<{ review: string[] | undefined; accumulated: string[] | undefined }> => {
  const gateSpecs = options.gateSpecs ?? [];
  const skipNodeIds = options.skipNodeIds ?? [];
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
    stepPrompt(
      nodeId,
      index + 1,
      options.plannedGates ?? [],
      skipNodeIds.includes(nodeId) ? { clean: true } : undefined
    )
  );
  // A resume's step-targeted gate is one the run already holds (R64, R65: a NEW gate targeting
  // the node the call answers, or an earlier one, is refused at this stage): an earlier call
  // registered each under the id it is re-sent with here. The call that starts a run has no run
  // to hold anything, so its gates are new.
  const sent =
    options.view === undefined
      ? gateSpecs
      : gateSpecs.map((spec, index) => {
          const held = { id: `temp_${index + 1}`, ...spec };
          registry.createTemporaryGate(held);
          return held;
        });
  const context = new ExecutionContext({ chain_id: 'chain-demo#1', gates: sent } as never);
  context.state.gates.requestedOverrides = { gates: sent };
  context.executionPlan = {
    strategy: 'chain',
    gates: [],
    requiresFramework: false,
    requiresSession: true,
    llmValidationEnabled: false,
  } as never;
  context.parsedCommand = { commandType: 'chain', steps } as never;
  context.gates.addAll(options.heldGates ?? [], 'temporary-request');

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

    test('(j) a shouldSkip current step writes no review — not a run-wide fallback', async () => {
      // Row 4.5 (P5-F4 residual, DEV-T4-10, owner-ruled 2026-08-13). A modifier-skipped step
      // produces no output, so there is nothing to review. Before this fix the field was left
      // unset for this step, and both readers' `?? accumulatedGateIds` fallback turned that into
      // a run-wide review — the last surviving fallback-to-run-wide shape. The empty array (not
      // `undefined`) is the discriminator: it is what makes the reader NOT fall back.
      const result = await reviewGatesFor({
        plannedGates: [RUN_WIDE_GATE],
        view: runView(NODE_IDS, 'write-body'),
        skipNodeIds: ['write-body'],
      });

      expect(result.review).toEqual([]);
    });

    test('(k) a shouldSkip step that is NOT current leaves the current step review untouched', async () => {
      const spec = { name: 'Body only', criteria: ['cite sources'], target_step_id: 'write-body' };

      const result = await reviewGatesFor({
        gateSpecs: [spec],
        view: runView(NODE_IDS, 'write-body'),
        skipNodeIds: ['draft-outline'],
      });

      expect(result.review).toEqual([TEMP_ID]);
    });
  });

  /**
   * P5-F4 — the last surviving P4-F3 shape. An INSERTED node has no parse-time step, so the walk
   * never visits it and (before this) nothing published a scope for it: both readers fell back to
   * the run-wide accumulator. Owner ruling 2026-08-12: it INHERITS the review of the node its
   * triggering unknown blocked.
   */
  describe('writer: an inserted node inherits its unknown’s target scope (P5-F4)', () => {
    test('(e) inherits the gates bound to the node the unknown blocked, and only those', async () => {
      const result = await reviewGatesFor({
        gateSpecs: [BODY_GATE, FINAL_GATE],
        plannedGates: [RUN_WIDE_GATE],
        view: insertedRunView({
          originUnknownId: 'cache-ttl',
          unknownTargetNodeId: 'write-body',
        }),
      });

      // The review the investigation exists to serve: the blocked node's gate.
      expect(result.review).toContain(BODY_GATE_ID);
      // Untargeted gates keep flowing — the ruling scopes only TARGETED gates.
      expect(result.review).toContain(RUN_WIDE_GATE);
      // A gate bound to a DIFFERENT node is the whole defect; run-wide fallback would include it.
      expect(result.review).not.toContain(FINAL_GATE_ID);
      // And the accumulator is untouched, so injection and inheritance still see every gate.
      expect(result.accumulated).toEqual(
        expect.arrayContaining([BODY_GATE_ID, FINAL_GATE_ID, RUN_WIDE_GATE])
      );
    });

    test('(f) an unknown that named no target inherits nothing — run-wide gates only', async () => {
      const result = await reviewGatesFor({
        gateSpecs: [BODY_GATE, FINAL_GATE],
        plannedGates: [RUN_WIDE_GATE],
        heldGates: [HELD_GATE],
        view: insertedRunView({ originUnknownId: 'cache-ttl' }),
      });

      // Nothing to inherit is NOT "inherit everything": every step's gate drops, including one
      // every step's own plan supplies (R204), while a gate the call held before the walk flows.
      expect(result.review).toEqual([HELD_GATE]);
    });

    test('(g) the skipped-node veto still applies to an inherited target', async () => {
      const result = await reviewGatesFor({
        gateSpecs: [BODY_GATE],
        plannedGates: [RUN_WIDE_GATE],
        view: insertedRunView({ originUnknownId: 'cache-ttl', unknownTargetNodeId: 'write-body' }, [
          'write-body',
        ]),
      });

      // The blocked node was retired, so its gate fires nowhere — inheriting it would attach a
      // gate to a step that will never execute.
      expect(result.review).toEqual([RUN_WIDE_GATE]);
    });

    test('(h) the branch is gated on provenance, not on the node id being unmatched', async () => {
      // Same run, same current node, but no `currentNodeOrigin` — i.e. exactly what the provider
      // publishes for a planned node. This is the pre-fix behaviour, kept as the discriminator:
      // if the inheritance branch keyed on "no parse step matched" instead of on provenance, this
      // would silently start inheriting too.
      const result = await reviewGatesFor({
        gateSpecs: [BODY_GATE, FINAL_GATE],
        plannedGates: [RUN_WIDE_GATE],
        view: runView(MUTATED_NODE_IDS, 'inv-cache-ttl'),
      });

      expect(result.review).toBeUndefined();
    });

    test('(i) planned nodes on the SAME mutated run are unchanged', async () => {
      // Regression guard for the ruling's third clause: byte-identical behaviour off the
      // inserted node. `write-body` is ordinal 3 on this run and ordinal 2 at parse time.
      const atBody = await reviewGatesFor({
        gateSpecs: [BODY_GATE, FINAL_GATE],
        plannedGates: [RUN_WIDE_GATE],
        view: runView(MUTATED_NODE_IDS, 'write-body'),
      });
      expect(atBody.review).toEqual([BODY_GATE_ID, RUN_WIDE_GATE]);

      const atFinal = await reviewGatesFor({
        gateSpecs: [BODY_GATE, FINAL_GATE],
        plannedGates: [RUN_WIDE_GATE],
        view: runView(MUTATED_NODE_IDS, 'final-review'),
      });
      expect(atFinal.review).toEqual([FINAL_GATE_ID, RUN_WIDE_GATE]);
    });
  });

  describe('reader: the actual pending review owns the verdict CTA', () => {
    const assembler = new ResponseAssembler();

    const renderCTA = (state: {
      accumulated?: string[];
      review?: string[];
      pendingReview?: PendingGateReview;
    }): string => {
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
        ...(state.pendingReview === undefined ? {} : { pendingReview: state.pendingReview }),
      };
      if (state.accumulated !== undefined) {
        context.state.gates.accumulatedGateIds = state.accumulated;
      }
      if (state.review !== undefined) {
        context.state.gates.reviewGateIds = state.review;
      }
      return assembler.formatSinglePromptResponse(context, {} as never);
    };

    const pendingReview = (gateIds: string[]): PendingGateReview => ({
      combinedPrompt: 'Review the output',
      gateIds,
      prompts: [],
      createdAt: 0,
      attemptCount: 0,
      maxAttempts: 2,
    });

    test.each([undefined, [], ['intent-quality', 'code-quality'], ['other-scope']])(
      'gate arrays with scope %j cannot demand a verdict without an actual review',
      (review) => {
        const rendered = renderCTA({ accumulated: ['intent-quality', 'code-quality'], review });
        expect(rendered).not.toContain('**Review Required**');
        expect(rendered).not.toContain('gate_verdict');
        expect(rendered).toContain('Continue:');
        expect(rendered).toContain('Re-run:');
      }
    );

    test('the pending review wins over conflicting scope and accumulated IDs', () => {
      const rendered = renderCTA({
        accumulated: ['accumulated-only'],
        review: ['scope-only'],
        pendingReview: {
          ...pendingReview(['code-quality', 'prose-hygiene']),
          gateTiers: { 'code-quality': 'check', 'prose-hygiene': 'reminder' },
          checkResults: [{ gateId: 'code-quality', passed: false, summary: 'Check failed' }],
        },
      });

      expect(rendered).toContain('**Review Required**');
      expect(rendered).toContain('**Gates**: code-quality, prose-hygiene');
      expect(rendered).not.toContain('accumulated-only');
      expect(rendered).not.toContain('scope-only');
      expect(rendered).toContain('gate_verdict=');
      expect(rendered).toContain('"index": 1');
      expect(rendered).not.toContain('"index": 2');
      expect(rendered).toContain('"passed": false');
      expect(rendered).toContain('"reminders": {"satisfied": ["prose-hygiene"]');
    });

    test('an empty scope cannot suppress an actual pending review', () => {
      const rendered = renderCTA({
        accumulated: ['accumulated-only'],
        review: [],
        pendingReview: pendingReview(['code-quality']),
      });
      expect(rendered).toContain('**Review Required**');
      expect(rendered).toContain('**Gates**: code-quality');
      expect(rendered).toContain('gate_verdict=');
      expect(rendered).not.toContain('accumulated-only');
    });
  });

  /**
   * P5-F6: a gate targeted at step N>1 (`target_step_number`/`target_step_id`) is invisible to
   * the ONE review-creation call site that used to exist (`SessionManagementStage`,
   * pre-advance) whenever a `gate_verdict` clears the prior step's review and advances INTO the
   * targeted step in the SAME request — that request renders the newly-advanced step before any
   * review-creation call runs against the post-advance step identity.
   * `GateEnhancementService.ensurePostAdvanceReview` is the second, post-advance call that
   * closes it; these tests exercise it directly against the same fake registry the writer tests
   * above use, mirroring `createReviewForStep` with a spy rather than a real
   * `GateEnforcementAuthority` — the maxAttempts/CreateReviewOptions shape it builds is not this
   * unit's concern (`gate-enforcement-authority.test.ts` territory), only WHETHER and WITH WHAT
   * gate ids it gets called.
   */
  describe('ensurePostAdvanceReview: post-advance review re-evaluation (P5-F6)', () => {
    const buildService = (registry: ReturnType<typeof createRegistry>) =>
      new GateEnhancementService(
        createGateService(),
        registry as never,
        () => undefined,
        () => undefined as never,
        undefined,
        new GateMetricsRecorder(undefined),
        createLogger() as never,
        undefined
      );

    const buildAuthority = () => ({
      createReviewForStep: jest.fn(
        async (_context: unknown, _sessionContext: unknown, _gateIds: string[]) =>
          ({ gateIds: [], maxAttempts: 2 }) as never
      ),
    });

    const buildContext = (options: {
      accumulatedGateIds: string[];
      hasBlockingGates?: boolean;
      gateEnforcement?: ReturnType<typeof buildAuthority>;
    }) => {
      const context = new ExecutionContext({ chain_id: 'chain-demo#1' } as never);
      context.state.gates.hasBlockingGates = options.hasBlockingGates ?? true;
      context.state.gates.accumulatedGateIds = options.accumulatedGateIds;
      if (options.gateEnforcement !== undefined) {
        context.gateEnforcement = options.gateEnforcement as never;
      }
      return context;
    };

    const sessionContextAt = (
      currentStep: number,
      currentNodeId: string | null,
      pendingReview?: unknown
    ) => ({
      sessionId: 'session-1',
      chainId: 'chain-demo#1',
      isChainExecution: true,
      currentStep,
      currentNodeId,
      totalSteps: 3,
      ...(pendingReview !== undefined ? { pendingReview } : {}),
    });

    test('(1) a step-targeted gate (target_step_number) creates a review for the post-advance step', async () => {
      const registry = createRegistry();
      registry.createTemporaryGate({
        name: 'Step 2 only',
        criteria: ['cite sources'],
        target_step_number: 2,
      });
      const service = buildService(registry);
      const authority = buildAuthority();
      const context = buildContext({ accumulatedGateIds: [TEMP_ID], gateEnforcement: authority });
      const sessionContext = sessionContextAt(2, 'write-body');

      await service.ensurePostAdvanceReview(context, sessionContext as never);

      expect(authority.createReviewForStep).toHaveBeenCalledTimes(1);
      expect(authority.createReviewForStep).toHaveBeenCalledWith(context, sessionContext, [
        TEMP_ID,
      ]);
    });

    test('(1d) a run past its last node opens no review — no node to key it by (R8, row 3.5)', async () => {
      // The twin of (1): the same step-3-targeted gate, the same ordinal, only the node id gone —
      // what a run held open past its end looks like. Opening one here would key it by position
      // onto the last node the run left, a step already answered.
      const registry = createRegistry();
      registry.createTemporaryGate({
        name: 'Last step only',
        criteria: ['cite sources'],
        target_step_number: 3,
      });
      const service = buildService(registry);
      const authority = buildAuthority();
      const context = buildContext({ accumulatedGateIds: [TEMP_ID], gateEnforcement: authority });

      await service.ensurePostAdvanceReview(context, sessionContextAt(3, null) as never);
      expect(authority.createReviewForStep).not.toHaveBeenCalled();

      // Positive control: standing ON that last node, the same gate opens the review.
      await service.ensurePostAdvanceReview(context, sessionContextAt(3, 'publish') as never);
      expect(authority.createReviewForStep).toHaveBeenCalledTimes(1);
    });

    test('(1b) the SAME step-targeted gate does not fire while standing at a different step', async () => {
      const registry = createRegistry();
      registry.createTemporaryGate({
        name: 'Step 2 only',
        criteria: ['cite sources'],
        target_step_number: 2,
      });
      const service = buildService(registry);
      const authority = buildAuthority();
      const context = buildContext({ accumulatedGateIds: [TEMP_ID], gateEnforcement: authority });
      const sessionContext = sessionContextAt(1, 'draft-outline');

      await service.ensurePostAdvanceReview(context, sessionContext as never);

      expect(authority.createReviewForStep).not.toHaveBeenCalled();
    });

    test('(1c) a mixed set includes the untargeted gate too — the created review is not narrowed', async () => {
      // Regression reproduced via the driven acceptance suite (2026-08-16): creating a review
      // scoped to the targeted gate ALONE, once triggered, blocked the following call's
      // full-scope creation from ever running — permanently dropping the untargeted gate from
      // that step's review. The trigger stays targeted-only; the CONTENT must not.
      const registry = createRegistry();
      registry.createTemporaryGate({
        name: 'Step 2 only',
        criteria: ['cite sources'],
        target_step_number: 2,
      });
      const service = buildService(registry);
      const authority = buildAuthority();
      const context = buildContext({
        accumulatedGateIds: [TEMP_ID, RUN_WIDE_GATE],
        gateEnforcement: authority,
      });
      const sessionContext = sessionContextAt(2, 'write-body');

      await service.ensurePostAdvanceReview(context, sessionContext as never);

      expect(authority.createReviewForStep).toHaveBeenCalledWith(
        context,
        sessionContext,
        expect.arrayContaining([TEMP_ID, RUN_WIDE_GATE])
      );
      const [, , gateIds] = authority.createReviewForStep.mock.calls[0] as [
        unknown,
        unknown,
        string[],
      ];
      expect(gateIds).toHaveLength(2);
    });

    test('(2) a review already pending short-circuits — no double-create on a same-step re-render', async () => {
      const registry = createRegistry();
      registry.createTemporaryGate({
        name: 'Step 2 only',
        criteria: ['cite sources'],
        target_step_number: 2,
      });
      const service = buildService(registry);
      const authority = buildAuthority();
      const context = buildContext({ accumulatedGateIds: [TEMP_ID], gateEnforcement: authority });
      const sessionContext = sessionContextAt(2, 'write-body', {
        gateIds: [TEMP_ID],
        attemptCount: 0,
        maxAttempts: 2,
      });

      await service.ensurePostAdvanceReview(context, sessionContext as never);

      expect(authority.createReviewForStep).not.toHaveBeenCalled();
    });

    test('(3) an untargeted (run-wide) gate is excluded — no regression for chains with no step targeting', async () => {
      const registry = createRegistry();
      const service = buildService(registry);
      const authority = buildAuthority();
      // RUN_WIDE_GATE has no registry entry at all, matching how a planned (non-temporary) gate
      // reaches the accumulator in production.
      const context = buildContext({
        accumulatedGateIds: [RUN_WIDE_GATE],
        gateEnforcement: authority,
      });
      const sessionContext = sessionContextAt(2, 'write-body');

      await service.ensurePostAdvanceReview(context, sessionContext as never);

      expect(authority.createReviewForStep).not.toHaveBeenCalled();
    });

    test('(4) a step-1-targeted gate does not leak onto step 2', async () => {
      const registry = createRegistry();
      registry.createTemporaryGate({
        name: 'Step 1 only',
        criteria: ['state the plan'],
        target_step_number: 1,
      });
      const service = buildService(registry);
      const authority = buildAuthority();
      const context = buildContext({ accumulatedGateIds: [TEMP_ID], gateEnforcement: authority });
      const sessionContext = sessionContextAt(2, 'write-body');

      await service.ensurePostAdvanceReview(context, sessionContext as never);

      expect(authority.createReviewForStep).not.toHaveBeenCalled();
    });

    test('no blocking gates on the run short-circuits before any lookup', async () => {
      const registry = createRegistry();
      registry.createTemporaryGate({
        name: 'Step 2 only',
        criteria: ['cite sources'],
        target_step_number: 2,
      });
      const service = buildService(registry);
      const authority = buildAuthority();
      const context = buildContext({
        accumulatedGateIds: [TEMP_ID],
        hasBlockingGates: false,
        gateEnforcement: authority,
      });
      const sessionContext = sessionContextAt(2, 'write-body');

      await service.ensurePostAdvanceReview(context, sessionContext as never);

      expect(authority.createReviewForStep).not.toHaveBeenCalled();
    });

    test('no GateEnforcementAuthority on the context is a no-op, not a throw', async () => {
      const registry = createRegistry();
      registry.createTemporaryGate({
        name: 'Step 2 only',
        criteria: ['cite sources'],
        target_step_number: 2,
      });
      const service = buildService(registry);
      const context = buildContext({ accumulatedGateIds: [TEMP_ID] });
      const sessionContext = sessionContextAt(2, 'write-body');

      await expect(
        service.ensurePostAdvanceReview(context, sessionContext as never)
      ).resolves.toBeUndefined();
    });
  });
});
