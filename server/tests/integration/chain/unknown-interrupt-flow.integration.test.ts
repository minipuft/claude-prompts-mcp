// @lifecycle test - Tier 2 rows 2.1-2.4: the mid-chain blocking-unknown interrupt, end to end.
/**
 * The chain of custody for a BLOCKING unknown, composed from production units:
 *
 *   StepResponseCaptureStage → decideInterrupt → context.state.session.chainInterrupt
 *                            ↘ setPendingGateReview('__unknown_interrupt__')   (knob on)
 *                            ↘ RemainderProcessor → ChainSessionStore.replaceRemainder
 *                            ↘ GateVerdictProcessor.resolveUnknownInterrupt
 *   ResponseFormattingStage  → ResponseAssembler → text section + structuredContent
 *
 * Each unit is unit-tested in isolation. What this asserts is that they agree — and, for the
 * pause specifically, that the run can be got OUT of the hold again, which no unit test of a
 * pure policy can show.
 */

import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { StepCaptureService } from '../../../src/engine/execution/capture/step-capture-service.js';
import { RemainderProcessor } from '../../../src/engine/execution/capture/remainder-processor.js';
import { UnknownObservationProcessor } from '../../../src/engine/execution/capture/unknown-observation-processor.js';
import { ExecutionContext } from '../../../src/engine/execution/context/index.js';
import { ResponseAssembler } from '../../../src/engine/execution/formatting/response-assembler.js';
import { UNKNOWN_INTERRUPT_GATE_ID } from '../../../src/engine/execution/pipeline/decisions/index.js';
import { StepResponseCaptureStage } from '../../../src/engine/execution/pipeline/stages/16-response-capture-stage.js';
import { ResponseFormattingStage } from '../../../src/engine/execution/pipeline/stages/21-formatting-stage.js';
import { GateVerdictProcessor } from '../../../src/engine/gates/services/gate-verdict-processor.js';
import { ResponseFormatter } from '../../../src/mcp/tools/prompt-engine/processors/response-formatter.js';
import { DEFAULT_WORKFLOW_CAPS } from '../../../src/modules/workflow-ir/node-schema.js';
import { validateWorkflowIR } from '../../../src/modules/workflow-ir/validator.js';
import { ChainSessionStore } from '../../../src/modules/chains/manager.js';

import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';
import type { Logger } from '../../../src/infra/logging/index.js';
import type { ChainNode } from '../../../src/shared/types/chain-execution.js';
import type { McpToolRequest } from '../../../src/shared/types/execution.js';

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

class StubTextReferenceStore {
  storeChainStepResult = jest.fn();
  buildChainVariables = jest.fn().mockReturnValue({});
  clearChainStepResults = jest.fn();
  getChainStepMetadata = jest.fn().mockReturnValue({});
}

/** Prompts the remainder validator may resolve. `redraft` declares a required argument. */
const PROMPTS = [
  { id: 'draft', arguments: [] },
  { id: 'body', arguments: [] },
  { id: 'review', arguments: [] },
  { id: 'investigate_unknown', arguments: [] },
  { id: 'redraft', arguments: [{ name: 'brief', required: true }] },
] as unknown as ConvertedPrompt[];

const NODES: ChainNode[] = [
  { id: 'draft-outline', promptId: 'draft', stepName: 'Draft' },
  { id: 'write-body', promptId: 'body', stepName: 'Body' },
  { id: 'final-review', promptId: 'review', stepName: 'Review' },
];

const BLOCKING_DISCOVERY = {
  type: 'unknown_discovered' as const,
  id: 'cache-ttl',
  statement: 'TTL for the new cache layer is undecided',
  blocking: true,
  target_step_id: 'final-review',
};

describe('mid-chain blocking-unknown interrupt (rows 2.1-2.3)', () => {
  let store: ChainSessionStore;
  let persistSpy: jest.SpiedFunction<() => Promise<void>>;
  let loadSpy: jest.SpiedFunction<() => Promise<void>>;
  let schedulerSpy: jest.SpiedFunction<() => void>;

  const buildStage = (): StepResponseCaptureStage => {
    const logger = createLogger();
    return new StepResponseCaptureStage(
      new GateVerdictProcessor(store, logger),
      new StepCaptureService(store, logger),
      store,
      new UnknownObservationProcessor(store, logger),
      logger,
      {
        remainderProcessor: new RemainderProcessor(
          store,
          { validate: validateWorkflowIR, defaultCaps: DEFAULT_WORKFLOW_CAPS },
          () => PROMPTS,
          logger
        ),
      }
    );
  };

  const buildContext = (request: Partial<McpToolRequest>): ExecutionContext => {
    const context = new ExecutionContext({ chain_id: 'chain-demo#1', ...request });
    context.sessionContext = {
      sessionId: 'sess-1',
      chainId: 'chain-demo#1',
      isChainExecution: true,
      currentStep: 1,
      currentNodeId: 'draft-outline',
      totalSteps: 3,
    };
    return context;
  };

  /** Turn the hard-pause knob on for the run, the way a Workflow IR submission does. */
  const declarePauseOnBlocking = async (): Promise<void> => {
    await store.updateSessionBlueprint('sess-1', {
      parsedCommand: { budget: { pauseOnBlocking: true } },
      executionPlan: {},
    } as never);
  };

  /** Drive one call that declares the blocking unknown. */
  const declareBlockingUnknown = async (): Promise<ExecutionContext> => {
    const context = buildContext({ observations: [BLOCKING_DISCOVERY] });
    await buildStage().execute(context);
    return context;
  };

  beforeEach(async () => {
    persistSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'persistSessionsOrThrow')
      .mockResolvedValue(undefined) as unknown as jest.SpiedFunction<() => Promise<void>>;
    loadSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'loadSessions')
      .mockResolvedValue(undefined) as unknown as jest.SpiedFunction<() => Promise<void>>;
    schedulerSpy = jest
      .spyOn(ChainSessionStore.prototype as any, 'startCleanupScheduler')
      .mockImplementation(() => {}) as unknown as jest.SpiedFunction<() => void>;

    store = new ChainSessionStore(createLogger(), new StubTextReferenceStore() as never, {
      serverRoot: '/tmp/test-unknown-interrupt-flow',
      cleanupIntervalMs: 60_000,
    });
    await store.createSession('sess-1', 'chain-demo#1', 3, {}, { nodes: NODES });
  });

  afterEach(async () => {
    await store.cleanup();
    persistSpy.mockRestore();
    loadSpy.mockRestore();
    schedulerSpy.mockRestore();
  });

  // ---- row 2.1 -------------------------------------------------------------------------

  test('a blocking discovery puts a soft interrupt on the context and does NOT hold the run', async () => {
    const context = await declareBlockingUnknown();

    expect(context.state.session.chainInterrupt).toMatchObject({
      reason: 'blocking_unknown',
      unknownId: 'cache-ttl',
      statement: BLOCKING_DISCOVERY.statement,
      // Declared link only (OQ-2), and only because `final-review` is strictly ahead.
      affectedStepIds: ['final-review'],
      paused: false,
    });
    // The insertion already landed, so the remaining plan the caller is invited to replace
    // includes the investigation node.
    expect(
      context.state.session.chainInterrupt?.remainingNodes.map((node) => node.promptId)
    ).toEqual(['investigate_unknown', 'body', 'review']);
    expect(store.getPendingGateReview('sess-1')).toBeUndefined();
  });

  test('a NON-blocking discovery raises no interrupt at all', async () => {
    const context = buildContext({
      observations: [{ type: 'unknown_discovered', id: 'copy-tone', statement: 'Tone unclear' }],
    });
    await buildStage().execute(context);

    expect(context.state.session.chainInterrupt).toBeUndefined();
  });

  test('the interrupt re-raises on a later call while the unknown stays open, and stops when it closes', async () => {
    await declareBlockingUnknown();

    // A bare resume declaring nothing: the run is still blocked and still says so.
    const silent = buildContext({});
    await buildStage().execute(silent);
    expect(silent.state.session.chainInterrupt?.unknownId).toBe('cache-ttl');

    const resolving = buildContext({
      observations: [
        {
          type: 'unknown_resolved',
          id: 'cache-ttl',
          statement: 'Owner picked 30s',
          resolution: 'answered',
        },
      ],
    });
    await buildStage().execute(resolving);
    expect(resolving.state.session.chainInterrupt).toBeUndefined();
  });

  test('with budget.pauseOnBlocking the run HOLDS on the synthetic review', async () => {
    await declarePauseOnBlocking();
    const context = await declareBlockingUnknown();

    expect(context.state.session.chainInterrupt?.paused).toBe(true);
    expect(store.getPendingGateReview('sess-1')?.gateIds).toEqual([UNKNOWN_INTERRUPT_GATE_ID]);
    // Stage 18 reads context, not the store — both must say the run is holding.
    expect(context.sessionContext?.pendingReview?.gateIds).toEqual([UNKNOWN_INTERRUPT_GATE_ID]);
  });

  // ---- row 2.2 -------------------------------------------------------------------------

  test('gate_action:"resume" clears the hold and leaves the run advancing', async () => {
    await declarePauseOnBlocking();
    await declareBlockingUnknown();

    const resume = buildContext({ gate_action: 'resume' });
    await buildStage().execute(resume);

    expect(resume.response).toBeUndefined();
    expect(store.getPendingGateReview('sess-1')).toBeUndefined();
    expect(resume.sessionContext?.pendingReview).toBeUndefined();
    // Still blocked in the ledger, and the payload says so — but no longer HOLDING, which is
    // what stops the pause re-arming itself on every later call.
    expect(resume.state.session.chainInterrupt?.paused).toBe(false);
  });

  test('gate_action:"accept_alternative" with a remainder replaces the rest of the plan', async () => {
    await declarePauseOnBlocking();
    await declareBlockingUnknown();

    const accept = buildContext({
      gate_action: 'accept_alternative',
      remainder: {
        mode: 'replace',
        nodes: [
          { id: 'confirm-ttl', promptId: 'investigate_unknown', stepName: 'Confirm the TTL' },
          { id: 'redraft', promptId: 'redraft', stepName: 'Redraft', args: { brief: 'x' } },
        ],
      },
    });
    await buildStage().execute(accept);

    expect(accept.response).toBeUndefined();
    expect(store.getPendingGateReview('sess-1')).toBeUndefined();
    expect(store.getSession('sess-1')?.state.nodes.map((node) => node.id)).toEqual([
      'draft-outline',
      'confirm-ttl',
      'redraft',
    ]);
    const replaced = store
      .getSession('sess-1')
      ?.state.nodes.filter((node) => node.origin === 'remainder');
    expect(replaced?.every((node) => node.originUnknownId === 'cache-ttl')).toBe(true);
  });

  test('gate_action:"accept_alternative" WITHOUT a remainder is refused by name', async () => {
    await declarePauseOnBlocking();
    await declareBlockingUnknown();

    const accept = buildContext({ gate_action: 'accept_alternative' });
    await buildStage().execute(accept);

    expect(accept.response?.isError).toBe(true);
    expect(accept.response?.content?.[0]?.text).toContain('accept_alternative');
    expect(accept.response?.content?.[0]?.text).toContain('remainder');
    // Refused means UNCHANGED: the run is still holding.
    expect(store.getPendingGateReview('sess-1')?.gateIds).toEqual([UNKNOWN_INTERRUPT_GATE_ID]);
  });

  test('an interrupt verb on an ORDINARY gate review is refused, not silently accepted', async () => {
    await store.setPendingGateReview('sess-1', {
      combinedPrompt: 'Review against the gates',
      gateIds: ['clarity'],
      prompts: [],
      createdAt: Date.now(),
      attemptCount: 0,
      maxAttempts: 3,
    });

    const resume = buildContext({ gate_action: 'resume' });
    await buildStage().execute(resume);

    expect(resume.response?.isError).toBe(true);
    expect(resume.response?.content?.[0]?.text).toContain('gate_verdict');
    // The gate review is untouched — `resume` is not a second way to skip a gate.
    expect(store.getPendingGateReview('sess-1')?.gateIds).toEqual(['clarity']);
  });

  test('an interrupt verb with nothing pending is refused', async () => {
    const resume = buildContext({ gate_action: 'resume' });
    await buildStage().execute(resume);

    expect(resume.response?.isError).toBe(true);
    expect(resume.response?.content?.[0]?.text).toContain('not holding');
  });

  // ---- row 2.3 -------------------------------------------------------------------------

  test('a remainder on an UNPAUSED run with an open blocking unknown is applied', async () => {
    await declareBlockingUnknown();

    const context = buildContext({
      remainder: {
        mode: 'replace',
        nodes: [{ id: 'confirm-ttl', promptId: 'investigate_unknown', stepName: 'Confirm' }],
      },
    });
    await buildStage().execute(context);

    expect(context.response).toBeUndefined();
    expect(store.getSession('sess-1')?.state.nodes.map((node) => node.id)).toEqual([
      'draft-outline',
      'confirm-ttl',
    ]);
  });

  test('a remainder with NO open blocking unknown is refused by name', async () => {
    const context = buildContext({
      remainder: {
        mode: 'replace',
        nodes: [{ id: 'confirm-ttl', promptId: 'investigate_unknown', stepName: 'Confirm' }],
      },
    });
    await buildStage().execute(context);

    expect(context.response?.isError).toBe(true);
    expect(context.response?.content?.[0]?.text).toContain('no blocking unknown is open');
    expect(store.getSession('sess-1')?.state.nodes.map((node) => node.id)).toEqual(
      NODES.map((node) => node.id)
    );
  });

  test('a remainder naming an unregistered prompt is refused with the IR rejection', async () => {
    await declareBlockingUnknown();

    const context = buildContext({
      remainder: {
        mode: 'replace',
        nodes: [{ id: 'confirm-ttl', promptId: 'does-not-exist', stepName: 'Confirm' }],
      },
    });
    await buildStage().execute(context);

    expect(context.response?.isError).toBe(true);
    expect(context.response?.content?.[0]?.text).toContain('unknown-prompt');
  });

  test('a remainder omitting a required argument is refused — the same bar a workflow meets', async () => {
    await declareBlockingUnknown();

    const context = buildContext({
      remainder: { mode: 'replace', nodes: [{ id: 'redraft', promptId: 'redraft' }] },
    });
    await buildStage().execute(context);

    expect(context.response?.isError).toBe(true);
    expect(context.response?.content?.[0]?.text).toContain('required-argument-missing');
  });

  test('a remainder is applied in LINEARIZED order, not declaration order', async () => {
    await declareBlockingUnknown();

    const context = buildContext({
      remainder: {
        mode: 'replace',
        nodes: [
          { id: 'second', promptId: 'review', stepName: 'Second' },
          { id: 'first', promptId: 'draft', stepName: 'First' },
        ],
        edges: [{ from: 'first', to: 'second' }],
      },
    });
    await buildStage().execute(context);

    expect(store.getSession('sess-1')?.state.nodes.map((node) => node.id)).toEqual([
      'draft-outline',
      'first',
      'second',
    ]);
  });

  // ---- row 1.4 -------------------------------------------------------------------------

  test('a persist failure while writing the ledger surfaces as an error, not silent success', async () => {
    persistSpy.mockRejectedValueOnce(new Error('disk full'));

    const context = buildContext({ observations: [BLOCKING_DISCOVERY] });

    // The stage converts only `UnknownObservationValidationError`; a persist failure propagates
    // to the pipeline error boundary, which is `architecture.md`'s single catch point.
    await expect(buildStage().execute(context)).rejects.toThrow('disk full');
    expect(context.response).toBeUndefined();
  });
});

// ---- row 2.4 ---------------------------------------------------------------------------

describe('interrupt rendering: text section and structuredContent (row 2.4)', () => {
  const buildChainContext = (): ExecutionContext => {
    const context = new ExecutionContext({ chain_id: 'chain-demo#1' });
    context.executionPlan = { strategy: 'chain', gates: [] } as never;
    context.sessionContext = {
      sessionId: 'sess-1',
      chainId: 'chain-demo#1',
      isChainExecution: true,
      currentStep: 1,
      totalSteps: 3,
    };
    context.executionResults = { content: 'Step output', generatedAt: Date.now() };
    return context;
  };

  const formattingStage = (): ResponseFormattingStage =>
    new ResponseFormattingStage(
      new ResponseFormatter(createLogger()),
      new ResponseAssembler(),
      createLogger()
    );

  const render = async (paused: boolean): Promise<{ text: string; structured: unknown }> => {
    const context = buildChainContext();
    if (paused) {
      // A paused run is HOLDING on the synthetic review — that is what stage 16 wrote, and the
      // footer branches on it. Rendering the paused variant without it would snapshot a state
      // no run is ever in.
      context.sessionContext = {
        ...context.sessionContext!,
        pendingReview: {
          combinedPrompt: 'A blocking unknown stopped this run',
          gateIds: [UNKNOWN_INTERRUPT_GATE_ID],
          prompts: [],
          createdAt: 0,
          attemptCount: 0,
          maxAttempts: 1,
        },
      };
    }
    context.state.session.chainInterrupt = {
      reason: 'blocking_unknown',
      unknownId: 'cache-ttl',
      statement: 'TTL for the new cache layer is undecided',
      affectedStepIds: ['final-review'],
      remainingNodes: [
        { id: 'inv-cache-ttl', promptId: 'investigate_unknown', stepName: 'Investigate: TTL' },
        { id: 'final-review', promptId: 'review', stepName: 'Review' },
      ],
      paused,
    };

    await formattingStage().execute(context);
    return {
      text: context.response?.content?.[0]?.text ?? '',
      structured: context.response?.structuredContent?.['chain_interrupt'],
    };
  };

  test('the SOFT variant renders the interrupt and the four base verbs', async () => {
    const { text } = await render(false);

    expect(text).toMatchInlineSnapshot(`
      "Step output


      ---

      **Blocking Unknown**

      TTL for the new cache layer is undecided

      Affected steps (declared): final-review

      Remaining plan:
      - \`inv-cache-ttl\` — Investigate: TTL (investigate_unknown)
      - \`final-review\` — Review (review)

      Resolve with \`chain_id="chain-demo#1"\` plus one of:

      - answer the step
      - remainder
      - gate_action:abort
      - cancel

      Chain: chain-demo#1
      → Progress 1/3
      Next: chain_id="chain-demo#1", user_response="<your step output>""
    `);
  });

  test('the PAUSED variant lists the resolution verbs ONLY — no step to answer', async () => {
    const { text } = await render(true);

    expect(text).toMatchInlineSnapshot(`
      "Step output


      ---

      **Chain Paused — Blocking Unknown**

      TTL for the new cache layer is undecided

      Affected steps (declared): final-review

      Remaining plan:
      - \`inv-cache-ttl\` — Investigate: TTL (investigate_unknown)
      - \`final-review\` — Review (review)

      Resolve with \`chain_id="chain-demo#1"\` plus one of:

      - gate_action:resume
      - gate_action:accept_alternative (with remainder)
      - gate_action:abort
      - cancel

      Chain: chain-demo#1
      → Progress 1/3
      Next: chain_id="chain-demo#1", gate_action="resume" | gate_action="accept_alternative" (with remainder) | gate_action="abort""
    `);
  });

  test('structuredContent.chain_interrupt is the plan payload, asserted as parsed JSON', async () => {
    const { structured } = await render(false);

    // Round-tripped through JSON deliberately: the assertion has to be about what a CLIENT
    // receives over the wire, and a substring match on the rendered text would pass for a
    // payload no JSON parser could read.
    expect(JSON.parse(JSON.stringify(structured))).toEqual({
      kind: 'chain_interrupt',
      reason: 'blocking_unknown',
      unknown: { id: 'cache-ttl', statement: 'TTL for the new cache layer is undecided' },
      affected_step_ids: ['final-review'],
      remaining_nodes: [
        { id: 'inv-cache-ttl', promptId: 'investigate_unknown', stepName: 'Investigate: TTL' },
        { id: 'final-review', promptId: 'review', stepName: 'Review' },
      ],
      paused: false,
      resume: {
        chain_id: 'chain-demo#1',
        verbs: ['answer the step', 'remainder', 'gate_action:abort', 'cancel'],
      },
    });
  });

  test('the paused payload carries the resolution verbs only and paused:true', async () => {
    const { structured } = await render(true);

    const payload = JSON.parse(JSON.stringify(structured)) as {
      paused: boolean;
      resume: { verbs: string[] };
    };

    expect(payload).toMatchObject({
      paused: true,
      resume: {
        verbs: [
          'gate_action:resume',
          'gate_action:accept_alternative (with remainder)',
          'gate_action:abort',
          'cancel',
        ],
      },
    });
    // The row's own flip condition (2.6): a paused run issues no step, so advertising a verb that
    // answers one is advertising an exit the run refuses. Asserted as an absence rather than left
    // implicit in the list above, because a later append would satisfy `toMatchObject` on order
    // alone and this is the property the row exists for.
    expect(payload.resume.verbs).not.toContain('answer the step');
  });

  test('a GATED SINGLE PROMPT with a session renders the interrupt too', async () => {
    // Found by the live drive, not by the suite: `>>strategicImplement` is a single prompt that
    // gets a session, so it reaches `formatSinglePromptResponse` — which rendered no interrupt
    // section while stage 21 still attached `structuredContent.chain_interrupt`. The two halves
    // of one payload disagreed.
    const context = buildChainContext();
    context.executionPlan = { strategy: 'single', gates: [] } as never;
    context.state.session.chainInterrupt = {
      reason: 'blocking_unknown',
      unknownId: 'cache-ttl',
      statement: 'TTL for the new cache layer is undecided',
      affectedStepIds: [],
      remainingNodes: [],
      paused: false,
    };

    await formattingStage().execute(context);

    const text = context.response?.content?.[0]?.text ?? '';
    expect(text).toContain('**Blocking Unknown**');
    expect(context.response?.structuredContent?.['chain_interrupt']).toBeDefined();
  });

  test('a response with no interrupt carries no chain_interrupt key at all', async () => {
    // The positive control for every assertion above: the same stage, the same context, one
    // field absent. Without it, a `structuredContent` that was always populated would satisfy
    // the payload assertions just as well.
    const context = buildChainContext();
    await formattingStage().execute(context);

    expect(context.response?.structuredContent).toBeUndefined();
  });
});
