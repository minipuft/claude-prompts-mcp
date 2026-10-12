import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { GateEnforcementAuthority } from '../../../../src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.js';
import { GateReviewStage } from '../../../../src/engine/execution/pipeline/stages/20-gate-review-stage.js';
import { GateLoader } from '../../../../src/engine/gates/core/gate-loader.js';
import { ChainSessionStore } from '../../../../src/modules/chains/manager.js';

import type { LightweightGateDefinition } from '../../../../src/engine/gates/types.js';

/** A run standing on `n1` whose one review is `review` — what stage 20 reads its target off. */
const runReviewing = (review: Record<string, unknown>) => ({
  reviews: { n1: { ...review, nodeId: 'n1' } },
  state: { currentNodeId: 'n1', nodes: [] },
});

const createExecutionResult = () => ({
  stepNumber: 2,
  totalSteps: 2,
  promptId: '__gate_review__',
  promptName: 'Quality Gate Validation',
  content: 'Gate review content',
  callToAction: 'Return with GATE_REVIEW: PASS or FAIL.',
});

describe('GateReviewStage', () => {
  test('renders gate review content when pending review exists', async () => {
    const chainOperatorExecutor = {
      renderStep: jest.fn().mockResolvedValue(createExecutionResult()),
    } as any;

    const review = {
      nodeId: 'n1',
      combinedPrompt: 'Review prompt',
      gateIds: ['inline_gate_focus'],
      prompts: [],
      createdAt: Date.now(),
      attemptCount: 1,
      maxAttempts: 3,
    };
    const chainSessionStore = {
      getReview: jest.fn().mockReturnValue(review),
      getChainContext: jest.fn().mockReturnValue({ step_results: {} }),
      // The review is the one the RUN's reviews name (row 3.12), and the body is resolved against
      // the run's node list (P4 row 3.4). An empty node list exercises the parse-time fallback.
      getSession: jest.fn().mockReturnValue(runReviewing(review)),
    } as any;

    const stage = new GateReviewStage(
      chainOperatorExecutor,
      chainSessionStore,
      null,
      {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as any,
      () => undefined
    );

    const context = new ExecutionContext({ command: '>>chain' });
    context.parsedCommand = {
      steps: [{ stepNumber: 1, promptId: 'analyze', args: {} }],
    } as any;
    context.sessionContext = {
      sessionId: 'session-1',
      chainId: 'chain-1',
      isChainExecution: true,
      currentStep: 2,
      totalSteps: 2,
      pendingReview: true,
    };

    await stage.execute(context);

    expect(chainOperatorExecutor.renderStep).toHaveBeenCalledWith(
      expect.objectContaining({ executionType: 'gate_review' })
    );
    expect(context.executionResults?.content).toContain('Gate review content');
    expect(context.executionResults?.metadata?.callToAction).toContain('GATE_REVIEW');
    expect(context.sessionContext?.pendingReview).toEqual(
      expect.objectContaining({
        gateIds: ['inline_gate_focus'],
      })
    );
  });

  test('skips when no pending review data exists', async () => {
    const stage = new GateReviewStage(
      {
        renderStep: jest.fn(),
      } as any,
      {
        getReview: jest.fn().mockReturnValue(undefined),
        getChainContext: jest.fn(),
      } as any,
      null,
      { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any,
      () => undefined
    );

    const context = new ExecutionContext({ command: 'noop' });
    context.sessionContext = {
      sessionId: 'session-1',
      chainId: 'chain-1',
      isChainExecution: true,
      currentStep: 1,
      totalSteps: 1,
    };

    await stage.execute(context);

    expect(context.executionResults).toBeUndefined();
  });
});

/**
 * Ruling B4: a check's result has to outlive the call that ran it.
 *
 * The verdict arrives on a LATER request, where this call's context is gone, so a result left
 * only in `shellSection` prose is a result the verdict processor cannot read — which is how a
 * model PASS came to override a recorded shell failure. The write goes onto the pending review
 * itself, and only on the path where a verdict is still owed.
 */
describe('GateReviewStage — recording check evidence on the pending review', () => {
  const failingGate = {
    id: 'test-suite',
    name: 'Test Suite',
    description: 'Runs the suite',
    pass_criteria: [{ type: 'shell_verify', shell_command: ['npm', 'test'] }],
  };

  const reminderGate = {
    id: 'code-quality',
    name: 'Code Quality',
    description: 'Reminder only',
    pass_criteria: [{ type: 'inline_guidance' }],
  };

  const createStore = (review: Record<string, unknown>) => ({
    getReview: jest.fn().mockReturnValue({ ...review, nodeId: 'n1' }),
    setPendingGateReview: jest.fn().mockResolvedValue(undefined as never),
    clearReview: jest.fn().mockResolvedValue(undefined as never),
    getChainContext: jest.fn().mockReturnValue({ step_results: {} }),
    getSession: jest.fn().mockReturnValue(runReviewing(review)),
  });

  const createContext = (review: Record<string, unknown>) => {
    const context = new ExecutionContext({ command: '>>chain' });
    context.parsedCommand = {
      steps: [{ stepNumber: 1, promptId: 'analyze', args: {} }],
    } as any;
    context.sessionContext = {
      sessionId: 'session-1',
      chainId: 'chain-1',
      isChainExecution: true,
      currentStep: 1,
      totalSteps: 1,
      pendingReview: review as any,
    };
    return context;
  };

  const logger = () =>
    ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as any;

  test('records the failing result and every gate tier when coverage is not satisfied', async () => {
    const review = {
      combinedPrompt: 'Review prompt',
      gateIds: ['test-suite', 'code-quality'],
      prompts: [],
      createdAt: 1,
      attemptCount: 1,
      maxAttempts: 3,
    };
    const store = createStore(review);
    const stage = new GateReviewStage(
      { renderStep: jest.fn().mockResolvedValue(createExecutionResult() as never) } as any,
      store as any,
      { loadGates: jest.fn().mockResolvedValue([failingGate, reminderGate] as never) } as any,
      logger(),
      () => undefined,
      {
        shellVerifyExecutor: {
          execute: jest.fn().mockResolvedValue({
            passed: false,
            exitCode: 1,
            stdout: '',
            stderr: '3 failing',
            durationMs: 12,
            command: 'npm test',
          } as never),
        } as any,
      }
    );

    const context = createContext(review);
    await stage.execute(context);

    expect(store.setPendingGateReview).toHaveBeenCalledTimes(1);
    const [sessionId, written] = store.setPendingGateReview.mock.calls[0] as [string, any];
    expect(sessionId).toBe('session-1');
    expect(written.checkResults).toEqual([
      { gateId: 'test-suite', passed: false, summary: 'npm test exit 1' },
    ]);
    expect(written.gateTiers).toEqual({ 'test-suite': 'check', 'code-quality': 'reminder' });
    // Everything else survives the re-set — the store persists what it is handed.
    expect(written.attemptCount).toBe(1);
    expect(written.combinedPrompt).toBe('Review prompt');
    // The same call renders the CTA, so the context copy must carry the evidence too.
    expect(context.sessionContext?.pendingReview?.checkResults).toEqual(written.checkResults);
  });

  test('records nothing when coverage is satisfied — the auto-clear path is untouched', async () => {
    const review = {
      combinedPrompt: 'Review prompt',
      gateIds: ['test-suite'],
      prompts: [],
      createdAt: 1,
      attemptCount: 1,
      maxAttempts: 3,
    };
    const store = createStore(review);
    const stage = new GateReviewStage(
      { renderStep: jest.fn() } as any,
      store as any,
      { loadGates: jest.fn().mockResolvedValue([failingGate] as never) } as any,
      logger(),
      () => undefined,
      {
        shellVerifyExecutor: {
          execute: jest.fn().mockResolvedValue({
            passed: true,
            exitCode: 0,
            stdout: 'ok',
            stderr: '',
            durationMs: 9,
            command: 'npm test',
          } as never),
        } as any,
      }
    );

    const context = createContext(review);
    await stage.execute(context);

    expect(store.clearReview).toHaveBeenCalledWith('session-1', 'n1');
    expect(store.setPendingGateReview).not.toHaveBeenCalled();
    expect(context.executionResults?.metadata?.gateReview).toEqual(
      expect.objectContaining({ autoCleared: true })
    );
  });
});

/**
 * Row 3.12: stage 20 renders the review a bare verdict answers (`resolveReviewTarget`) and, when
 * ground truth covers it, clears THAT node's review — never "the" review of the run. The store is
 * real, so two reviews are open at once: step 1's, opened FIRST, and the review of step 2, the
 * node the run stands on.
 */
describe('GateReviewStage — renders and clears the review of the node it names', () => {
  const coveredGate: LightweightGateDefinition = {
    id: 'test-suite',
    name: 'Test Suite',
    type: 'validation',
    description: 'Runs the suite',
    pass_criteria: [{ type: 'shell_verify', shell_command: ['npm', 'test'] }],
  };
  const logger = () =>
    ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as any;
  const spies: Array<{ mockRestore: () => void }> = [];
  let store: ChainSessionStore;

  beforeEach(async () => {
    spies.push(
      jest.spyOn(ChainSessionStore.prototype as any, 'saveSessions').mockResolvedValue(undefined),
      jest.spyOn(ChainSessionStore.prototype as any, 'loadSessions').mockResolvedValue(undefined),
      jest
        .spyOn(ChainSessionStore.prototype as any, 'startCleanupScheduler')
        .mockImplementation(() => {})
    );
    store = new ChainSessionStore(logger(), { buildChainVariables: () => ({}) } as any, {
      cleanupIntervalMs: 60_000,
    });
    await store.createSession('s1', 'chain-1', 2);
    (store as any).activeSessions.get('s1').state.currentNodeId = 'n2';
    const definitions: LightweightGateDefinition[] = [
      {
        id: 'step-one-gate',
        name: 'Step One Review',
        type: 'guidance',
        description: 'Review the first node',
        pass_criteria: [{ type: 'inline_guidance' }],
      },
      coveredGate,
    ];
    const loader = new GateLoader(logger());
    jest
      .spyOn(loader, 'loadGates')
      .mockImplementation(async (ids) => definitions.filter((gate) => ids.includes(gate.id)));
    const authority = new GateEnforcementAuthority(store, logger(), loader, () => ({
      evaluation: {},
    }));
    const first = await authority.createReview('s1', 'gate', 'n1', {
      gateIds: ['step-one-gate'],
      instructions: 'Check step 1.',
    });
    const second = await authority.createReview('s1', 'gate', 'n2', {
      gateIds: ['test-suite'],
      instructions: 'Check step 2.',
    });
    const issued = new Map([
      ['n1', first.semanticContext],
      ['n2', second.semanticContext],
    ]);
    const getReview = store.getReview.bind(store);
    // Jest's host structuredClone crosses realms. Keep the real store's lifecycle reads, but
    // return the exact public authority JSON issued in this realm rather than its host clone.
    spies.push(
      jest.spyOn(store, 'getReview').mockImplementation((sessionId, nodeId) => {
        const review = getReview(sessionId, nodeId);
        return review === undefined
          ? undefined
          : { ...review, semanticContext: issued.get(nodeId) };
      })
    );
  });

  afterEach(async () => {
    await store.cleanup();
    spies.splice(0).forEach((spy) => spy.mockRestore());
  });

  const contextOnStep2 = () => {
    const context = new ExecutionContext({ command: '>>chain' });
    context.parsedCommand = {
      steps: [
        { stepNumber: 1, promptId: 'draft', args: {} },
        { stepNumber: 2, promptId: 'analyze', args: {} },
      ],
    } as any;
    context.sessionContext = {
      sessionId: 's1',
      chainId: 'chain-1',
      isChainExecution: true,
      currentStep: 2,
      currentNodeId: 'n2',
      totalSteps: 2,
      pendingReview: store.getReview('s1', 'n2')!,
    };
    return context;
  };

  test('two open reviews: it renders the review of the node the run stands on', async () => {
    const renderStep = jest.fn().mockResolvedValue(createExecutionResult() as never);
    const stage = new GateReviewStage(
      { renderStep } as any,
      store,
      null,
      logger(),
      () => undefined
    );

    const context = contextOnStep2();
    await stage.execute(context);

    const rendered = (renderStep.mock.calls[0]?.[0] as any)?.review;
    expect([rendered?.nodeId, rendered?.gateIds]).toEqual(['n2', ['test-suite']]);
    expect(context.sessionContext?.pendingReview?.nodeId).toBe('n2');
  });

  test("ground truth covering the rendered review clears only that node's review", async () => {
    const stage = new GateReviewStage(
      { renderStep: jest.fn() } as any,
      store,
      { loadGates: jest.fn().mockResolvedValue([coveredGate] as never) } as any,
      logger(),
      () => undefined,
      {
        shellVerifyExecutor: {
          execute: jest.fn().mockResolvedValue({
            passed: true,
            exitCode: 0,
            stdout: 'ok',
            stderr: '',
            durationMs: 9,
            command: 'npm test',
          } as never),
        } as any,
      }
    );

    const context = contextOnStep2();
    await stage.execute(context);

    // Positive control: the auto-clear path ran.
    expect(context.executionResults?.metadata?.gateReview).toEqual(
      expect.objectContaining({ autoCleared: true, gateIds: ['test-suite'] })
    );
    expect(Object.keys(store.getSession('s1')?.reviews ?? {})).toEqual(['n1']);
  });

  test('a failing check on a frozen review records tiers from the issued definitions, not the provider', async () => {
    const loadGates = jest.fn().mockResolvedValue([coveredGate] as never);
    const stage = new GateReviewStage(
      { renderStep: jest.fn().mockResolvedValue(createExecutionResult() as never) } as any,
      store,
      { loadGates } as any,
      logger(),
      () => undefined,
      {
        shellVerifyExecutor: {
          execute: jest.fn().mockResolvedValue({
            passed: false,
            exitCode: 1,
            stdout: '',
            stderr: '3 failing',
            durationMs: 9,
            command: 'npm test',
          } as never),
        } as any,
      }
    );

    const context = contextOnStep2();
    await stage.execute(context);

    const recorded = store.getReview('s1', 'n2');
    expect(recorded?.gateTiers).toEqual({ 'test-suite': 'check' });
    expect(recorded?.checkResults).toEqual([
      { gateId: 'test-suite', passed: false, summary: 'npm test exit 1' },
    ]);
    // Tier derivation never asked the provider: only the check run (and judge lookup) loaded.
    expect(loadGates).toHaveBeenCalledTimes(1);
  });
});

/**
 * Review metadata variants: what the stage records about HOW a review was cleared (`verifiedBy`),
 * what it refuses to render (an unreadable frozen authority), and which fields it leaves off
 * when nothing applies. The mock store keeps one review so each test reads exactly one branch.
 */
describe('GateReviewStage — review metadata variants', () => {
  const shellGate = {
    id: 'shell-gate',
    name: 'Shell Gate',
    description: 'Runs the suite',
    pass_criteria: [{ type: 'shell_verify', shell_command: ['npm', 'test'] }],
  };
  const scriptGate = {
    id: 'script-gate',
    name: 'Script Gate',
    description: 'Runs a registered tool',
    pass_criteria: [{ type: 'script_tool', script_tool_id: 'lint-check' }],
  };
  const reminderGate = {
    id: 'code-quality',
    name: 'Code Quality',
    description: 'Reminder only',
    pass_criteria: [{ type: 'inline_guidance' }],
  };
  const judgeGate = {
    id: 'judge-gate',
    name: 'Judge Gate',
    description: 'Graded by a judge',
    evaluation: { mode: 'judge' },
    pass_criteria: [{ type: 'inline_guidance' }],
  };

  const logger = () =>
    ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as any;

  const passingShell = () => ({
    execute: jest.fn().mockResolvedValue({
      passed: true,
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      durationMs: 5,
      command: 'npm test',
    } as never),
  });

  const failingShell = () => ({
    execute: jest.fn().mockResolvedValue({
      passed: false,
      exitCode: 1,
      stdout: '',
      stderr: '3 failing',
      durationMs: 5,
      command: 'npm test',
    } as never),
  });

  /** A registered, non-confirming tool whose structured verdict is `passed`. */
  const scriptRuntime = (passed: boolean) => () => ({
    loader: {
      loadScript: jest.fn().mockReturnValue({ promptId: 'p', execution: { confirm: false } }),
    },
    executor: {
      execute: jest.fn().mockResolvedValue({
        success: true,
        output: { passed, reason: passed ? 'lint clean' : 'lint dirty' },
        durationMs: 3,
        exitCode: 0,
        stderr: '',
      } as never),
    },
  });

  const makeReview = (gateIds: string[], extra: Record<string, unknown> = {}) => ({
    nodeId: 'n1',
    combinedPrompt: 'Review prompt',
    gateIds,
    prompts: [],
    createdAt: 1,
    attemptCount: 1,
    maxAttempts: 3,
    ...extra,
  });

  const makeStore = (review: Record<string, unknown>, run?: Record<string, unknown>) => ({
    getReview: jest.fn().mockReturnValue(review),
    setPendingGateReview: jest.fn().mockResolvedValue(undefined as never),
    clearReview: jest.fn().mockResolvedValue(undefined as never),
    recordStepDeclaration: jest.fn(),
    getChainContext: jest.fn().mockReturnValue({ step_results: {} }),
    getSession: jest.fn().mockReturnValue(run ?? runReviewing(review)),
  });

  const makeContext = (review: Record<string, unknown>, request: Record<string, unknown> = {}) => {
    const context = new ExecutionContext({ command: '>>chain', ...request });
    context.parsedCommand = {
      steps: [{ stepNumber: 1, promptId: 'analyze', args: {} }],
    } as any;
    context.sessionContext = {
      sessionId: 'session-1',
      chainId: 'chain-1',
      isChainExecution: true,
      currentStep: 1,
      totalSteps: 1,
      pendingReview: review as any,
    };
    return context;
  };

  const makeStage = (
    store: ReturnType<typeof makeStore>,
    gates: unknown[] | null,
    collaborators: Record<string, unknown> = {},
    renderStep: unknown = jest.fn().mockResolvedValue(createExecutionResult() as never),
    gatesConfig: () => any = () => undefined
  ) =>
    new GateReviewStage(
      { renderStep } as any,
      store as any,
      gates === null ? null : ({ loadGates: jest.fn().mockResolvedValue(gates as never) } as any),
      logger(),
      gatesConfig,
      collaborators
    );

  describe('verifiedBy names the mechanism that cleared the review', () => {
    test('shell_verify alone clears as "shell_verify"', async () => {
      const review = makeReview(['shell-gate']);
      const context = makeContext(review);
      await makeStage(makeStore(review), [shellGate], {
        shellVerifyExecutor: passingShell(),
      }).execute(context);

      expect(context.executionResults?.metadata?.gateReview).toEqual(
        expect.objectContaining({ autoCleared: true, verifiedBy: 'shell_verify' })
      );
    });

    test('script_tool alone clears as "script_tool"', async () => {
      const review = makeReview(['script-gate']);
      const store = makeStore(review);
      const context = makeContext(review);
      await makeStage(store, [scriptGate], { scriptToolRuntime: scriptRuntime(true) }).execute(
        context
      );

      expect(store.clearReview).toHaveBeenCalledWith('session-1', 'n1');
      expect(context.executionResults?.metadata?.gateReview).toEqual(
        expect.objectContaining({ autoCleared: true, verifiedBy: 'script_tool' })
      );
      expect(context.executionResults?.content).toContain('lint clean');
    });

    test('a shell gate and a script gate together clear as "shell_verify+script_tool"', async () => {
      const review = makeReview(['shell-gate', 'script-gate']);
      const context = makeContext(review);
      await makeStage(makeStore(review), [shellGate, scriptGate], {
        shellVerifyExecutor: passingShell(),
        scriptToolRuntime: scriptRuntime(true),
      }).execute(context);

      expect(context.executionResults?.metadata?.gateReview).toEqual(
        expect.objectContaining({
          autoCleared: true,
          gateIds: ['shell-gate', 'script-gate'],
          verifiedBy: 'shell_verify+script_tool',
        })
      );
    });

    test('a failing script_tool does not clear: no autoCleared, no verifiedBy, verdict still owed', async () => {
      const review = makeReview(['script-gate']);
      const store = makeStore(review);
      const renderStep = jest.fn().mockResolvedValue(createExecutionResult() as never);
      const context = makeContext(review);
      await makeStage(
        store,
        [scriptGate],
        { scriptToolRuntime: scriptRuntime(false) },
        renderStep
      ).execute(context);

      expect(store.clearReview).not.toHaveBeenCalled();
      expect(renderStep).toHaveBeenCalledTimes(1);
      const gateReview = context.executionResults?.metadata?.gateReview as Record<string, unknown>;
      expect(gateReview).not.toHaveProperty('autoCleared');
      expect(gateReview).not.toHaveProperty('verifiedBy');
      const [, written] = store.setPendingGateReview.mock.calls[0] as [string, any];
      expect(written.checkResults).toEqual([
        { gateId: 'script-gate', passed: false, summary: expect.stringContaining('lint dirty') },
      ]);
    });
  });

  describe('what the stage records onto the pending review', () => {
    test('a reminder-only review records tiers but no checkResults', async () => {
      const review = makeReview(['code-quality']);
      const store = makeStore(review);
      const context = makeContext(review);
      await makeStage(store, [reminderGate], { shellVerifyExecutor: passingShell() }).execute(
        context
      );

      const [, written] = store.setPendingGateReview.mock.calls[0] as [string, any];
      expect(written.gateTiers).toEqual({ 'code-quality': 'reminder' });
      expect(written).not.toHaveProperty('checkResults');
      expect(context.executionResults?.metadata?.gateReview).not.toHaveProperty('autoCleared');
    });

    test('no check ran and no gate loads: nothing is written back and the review still renders', async () => {
      const review = makeReview(['ghost-gate']);
      const store = makeStore(review);
      const renderStep = jest.fn().mockResolvedValue(createExecutionResult() as never);
      const context = makeContext(review);
      await makeStage(store, [], {}, renderStep).execute(context);

      expect(store.setPendingGateReview).not.toHaveBeenCalled();
      expect(renderStep).toHaveBeenCalledTimes(1);
      expect(context.executionResults?.content).toBe('Gate review content');
    });

    test('a provider that stops loading after the checks ran still records the results, with no tiers', async () => {
      const review = makeReview(['shell-gate']);
      const store = makeStore(review);
      const loadGates = jest
        .fn()
        .mockResolvedValueOnce([shellGate] as never) // the check run
        .mockRejectedValueOnce(new Error('registry offline') as never) // tier derivation
        .mockResolvedValue([shellGate] as never); // judge metadata
      const log = logger();
      const stage = new GateReviewStage(
        { renderStep: jest.fn().mockResolvedValue(createExecutionResult() as never) } as any,
        store as any,
        { loadGates } as any,
        log,
        () => undefined,
        { shellVerifyExecutor: failingShell() as any }
      );
      await stage.execute(makeContext(review));

      const [, written] = store.setPendingGateReview.mock.calls[0] as [string, any];
      expect(written.checkResults).toEqual([
        { gateId: 'shell-gate', passed: false, summary: 'npm test exit 1' },
      ]);
      expect(written).not.toHaveProperty('gateTiers');
      expect(log.warn).toHaveBeenCalledWith(
        '[GateReview] Failed to derive gate tiers for pending review',
        expect.objectContaining({ gateIds: ['shell-gate'], error: 'registry offline' })
      );
    });
  });

  describe('legacy path: no provider applies', () => {
    test('with no gate provider no check runs, nothing is recorded, and the render carries no judge or autoClear fields', async () => {
      const review = makeReview(['inline_gate_focus']);
      const store = makeStore(review);
      const shell = passingShell();
      const context = makeContext(review);
      await makeStage(store, null, { shellVerifyExecutor: shell }).execute(context);

      expect(shell.execute).not.toHaveBeenCalled();
      expect(store.setPendingGateReview).not.toHaveBeenCalled();
      expect(store.clearReview).not.toHaveBeenCalled();
      expect(context.executionResults?.metadata).toEqual(
        expect.objectContaining({
          gateReview: { gateIds: ['inline_gate_focus'], attemptCount: 1, maxAttempts: 3 },
        })
      );
      expect(context.executionResults?.metadata).not.toHaveProperty('judge');
    });

    test('a provider with a review that names no gates skips the checks entirely', async () => {
      const review = makeReview([]);
      const store = makeStore(review);
      const shell = passingShell();
      const context = makeContext(review);
      await makeStage(store, [shellGate], { shellVerifyExecutor: shell }).execute(context);

      expect(shell.execute).not.toHaveBeenCalled();
      expect(context.executionResults?.metadata).not.toHaveProperty('judge');
      expect(context.executionResults?.content).toBe('Gate review content');
    });
  });

  describe('judge metadata', () => {
    test('a judge-mode gate publishes its prompt and gate ids on metadata.judge', async () => {
      const review = makeReview(['judge-gate']);
      const context = makeContext(review);
      await makeStage(makeStore(review), [judgeGate], {}, undefined, () => ({
        evaluation: {},
      })).execute(context);

      const judge = context.executionResults?.metadata?.judge as any;
      expect(judge.judgeGateIds).toEqual(['judge-gate']);
      expect(typeof judge.judgePrompt).toBe('string');
      expect(judge.judgePrompt.length).toBeGreaterThan(0);
    });

    test('control: a self-evaluated gate publishes no metadata.judge', async () => {
      const review = makeReview(['code-quality']);
      const context = makeContext(review);
      await makeStage(makeStore(review), [reminderGate]).execute(context);

      expect(context.executionResults?.metadata).not.toHaveProperty('judge');
    });
  });

  describe('unreadable frozen authority', () => {
    test('a semanticContext that names another node refuses to render and surfaces the reason', async () => {
      const review = makeReview(['shell-gate'], {
        semanticContext: { nodeId: 'other-node', attemptId: 'a1', definitions: {} },
      });
      const store = makeStore(review);
      const renderStep = jest.fn();
      const shell = passingShell();
      const log = logger();
      const stage = new GateReviewStage(
        { renderStep } as any,
        store as any,
        { loadGates: jest.fn().mockResolvedValue([shellGate] as never) } as any,
        log,
        () => undefined,
        { shellVerifyExecutor: shell as any }
      );
      const context = makeContext(review);

      await expect(stage.execute(context)).rejects.toThrow(
        'Issued review identity is inconsistent'
      );

      expect(renderStep).not.toHaveBeenCalled();
      expect(shell.execute).not.toHaveBeenCalled();
      expect(store.clearReview).not.toHaveBeenCalled();
      expect(context.executionResults).toBeUndefined();
      expect(log.error).toHaveBeenCalledWith(
        '[GateReview] Failed to render gate review step',
        expect.objectContaining({ message: 'Issued review identity is inconsistent' })
      );
    });

    test('control: the same review with no semanticContext renders', async () => {
      const review = makeReview(['shell-gate']);
      const renderStep = jest.fn().mockResolvedValue(createExecutionResult() as never);
      const context = makeContext(review);
      await makeStage(
        makeStore(review),
        [shellGate],
        { shellVerifyExecutor: failingShell() },
        renderStep
      ).execute(context);

      expect(renderStep).toHaveBeenCalledTimes(1);
    });
  });

  describe('single-prompt review: nothing to render a review against', () => {
    test.each([
      ['an empty steps array', []],
      ['no steps at all', undefined],
    ])('%s: skips, rendering nothing and clearing nothing', async (_label, steps) => {
      const review = makeReview(['shell-gate']);
      const store = makeStore(review);
      const renderStep = jest.fn();
      const shell = passingShell();
      const context = makeContext(review);
      context.parsedCommand = { steps } as any;
      await makeStage(store, [shellGate], { shellVerifyExecutor: shell }, renderStep).execute(
        context
      );

      expect(renderStep).not.toHaveBeenCalled();
      expect(shell.execute).not.toHaveBeenCalled();
      expect(store.getReview).not.toHaveBeenCalled();
      expect(store.clearReview).not.toHaveBeenCalled();
      expect(context.executionResults).toBeUndefined();
    });

    test('control: the same review with one step renders', async () => {
      const review = makeReview(['shell-gate']);
      const renderStep = jest.fn().mockResolvedValue(createExecutionResult() as never);
      const context = makeContext(review);
      await makeStage(
        makeStore(review),
        [shellGate],
        { shellVerifyExecutor: failingShell() },
        renderStep
      ).execute(context);

      expect(renderStep).toHaveBeenCalledTimes(1);
    });

    test('a run whose shown review the store no longer holds skips without rendering', async () => {
      const review = makeReview(['shell-gate']);
      const store = makeStore(review);
      store.getReview.mockReturnValue(undefined);
      const renderStep = jest.fn();
      const context = makeContext(review);
      await makeStage(store, [shellGate], {}, renderStep).execute(context);

      expect(store.getReview).toHaveBeenCalledWith('session-1', 'n1');
      expect(renderStep).not.toHaveBeenCalled();
      expect(context.executionResults).toBeUndefined();
    });

    test('a session without a pending review flag skips before reading the store', async () => {
      const review = makeReview(['shell-gate']);
      const store = makeStore(review);
      const context = makeContext(review);
      context.sessionContext = { ...context.sessionContext!, pendingReview: undefined };
      await makeStage(store, [shellGate]).execute(context);

      expect(store.getSession).not.toHaveBeenCalled();
      expect(context.executionResults).toBeUndefined();
    });
  });

  describe('render details around the review', () => {
    test('a render of a different node is carried ahead of the shell section, not discarded', async () => {
      const review = makeReview(['shell-gate']);
      const run = {
        reviews: { n1: review },
        state: { currentNodeId: 'n2', nodes: [] },
      };
      const context = makeContext(review);
      context.executionResults = {
        content: 'Step 2 render from stage 18',
        metadata: {},
        generatedAt: 1,
      } as any;
      await makeStage(makeStore(review, run), [shellGate], {
        shellVerifyExecutor: failingShell(),
      }).execute(context);

      const content = context.executionResults?.content as string;
      expect(content.startsWith('Gate review content\n\nStep 2 render from stage 18\n\n')).toBe(
        true
      );
      expect(content).toContain('npm test');
    });

    test('a blank render of a different node has nothing worth carrying', async () => {
      const review = makeReview(['shell-gate']);
      const run = { reviews: { n1: review }, state: { currentNodeId: 'n2', nodes: [] } };
      const context = makeContext(review);
      context.executionResults = { content: '  \n ', metadata: {}, generatedAt: 1 } as any;
      await makeStage(makeStore(review, run), [shellGate], {
        shellVerifyExecutor: failingShell(),
      }).execute(context);

      expect((context.executionResults?.content as string).startsWith('Gate review content')).toBe(
        true
      );
      expect(context.executionResults?.content).not.toMatch(/^\s|\n\n\n/);
    });

    test('control: a render of the reviewed node itself is replaced, not carried', async () => {
      const review = makeReview(['shell-gate']);
      const context = makeContext(review);
      context.executionResults = {
        content: 'Step 1 render from stage 18',
        metadata: {},
        generatedAt: 1,
      } as any;
      await makeStage(makeStore(review), [shellGate], {
        shellVerifyExecutor: failingShell(),
      }).execute(context);

      expect(context.executionResults?.content).not.toContain('Step 1 render from stage 18');
    });

    test("the render's declared sections are recorded against the reviewed node", async () => {
      const review = makeReview(['shell-gate']);
      const store = makeStore(review);
      const renderStep = jest.fn().mockResolvedValue({
        ...createExecutionResult(),
        declaredNodeId: 'n1',
        declaredSections: ['Findings'],
      } as never);
      await makeStage(
        store,
        [shellGate],
        { shellVerifyExecutor: failingShell() },
        renderStep
      ).execute(makeContext(review));

      expect(store.recordStepDeclaration).toHaveBeenCalledWith('session-1', 'n1', ['Findings']);
    });

    test('control: a render declaring nothing records nothing', async () => {
      const review = makeReview(['shell-gate']);
      const store = makeStore(review);
      await makeStage(store, [shellGate], { shellVerifyExecutor: failingShell() }).execute(
        makeContext(review)
      );

      expect(store.recordStepDeclaration).not.toHaveBeenCalled();
    });

    test("the call's agent response reaches an opted-in shell gate as stdin; an empty one does not", async () => {
      const stdinGate = {
        ...shellGate,
        pass_criteria: [
          {
            type: 'shell_verify',
            shell_command: ['grep', 'ok'],
            shell_stdin_source: 'agent_response',
          },
        ],
      };
      const review = makeReview(['shell-gate']);
      const withResponse = failingShell();
      await makeStage(makeStore(review), [stdinGate], {
        shellVerifyExecutor: withResponse,
      }).execute(makeContext(review, { user_response: 'the agent answer' }));
      const withoutResponse = failingShell();
      await makeStage(makeStore(review), [stdinGate], {
        shellVerifyExecutor: withoutResponse,
      }).execute(makeContext(review, { user_response: '' }));

      expect((withResponse.execute.mock.calls[0] as any[])[0].stdin).toBe('the agent answer');
      expect((withoutResponse.execute.mock.calls[0] as any[])[0].stdin).toBeUndefined();
    });
  });

  describe('first rendered step is ledgered', () => {
    const lifecycle = (decision: string | undefined) => {
      const review = makeReview(['shell-gate']);
      const context = makeContext(review);
      context.state.session.lifecycleDecision = decision;
      context.sessionContext = { ...context.sessionContext!, currentNodeId: 'n1' };
      return { review, context };
    };

    test.each(['create-new', 'create-force-restart'])(
      'a %s call appends one working row for the step it rendered',
      async (decision) => {
        const { review, context } = lifecycle(decision);
        const append = jest.fn();
        await makeStage(makeStore(review), [shellGate], {
          shellVerifyExecutor: failingShell(),
          executionRecordStore: { append } as any,
        }).execute(context);

        expect(append).toHaveBeenCalledTimes(1);
        expect(append.mock.calls[0]?.[0]).toEqual(
          expect.objectContaining({
            sessionId: 'session-1',
            chainId: 'chain-1',
            stepNumber: 1,
            nodeId: 'n1',
            status: 'working',
          })
        );
      }
    );

    test('the auto-clear path owes the same row', async () => {
      const { review, context } = lifecycle('create-new');
      const append = jest.fn();
      await makeStage(makeStore(review), [shellGate], {
        shellVerifyExecutor: passingShell(),
        executionRecordStore: { append } as any,
      }).execute(context);

      expect(context.executionResults?.metadata?.gateReview).toEqual(
        expect.objectContaining({ autoCleared: true })
      );
      expect(append).toHaveBeenCalledTimes(1);
    });

    test.each([
      ['a resume call', 'resume', true],
      ['no ledger writer wired', 'create-new', false],
    ])('%s appends nothing', async (_label, decision, wired) => {
      const { review, context } = lifecycle(decision);
      const append = jest.fn();
      await makeStage(makeStore(review), [shellGate], {
        shellVerifyExecutor: failingShell(),
        ...(wired ? { executionRecordStore: { append } as any } : {}),
      }).execute(context);

      expect(append).not.toHaveBeenCalled();
      expect(context.executionResults?.content).toContain('Gate review content');
    });
  });
});
