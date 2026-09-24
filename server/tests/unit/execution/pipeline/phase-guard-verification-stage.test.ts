import { describe, expect, jest, test, beforeEach } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import {
  PhaseGuardVerificationStage,
  PHASE_GUARD_GATE_ID,
  createPhaseGuardVerificationStage,
} from '../../../../src/engine/execution/pipeline/stages/19-phase-guard-verification-stage.js';
import { DiagnosticAccumulator } from '../../../../src/engine/execution/pipeline/state/accumulators/diagnostic-accumulator.js';

import type { PhaseGuardsConfig } from '../../../../src/shared/types/core-config.js';
import type { ChainSessionService } from '../../../../src/shared/types/chain-session.js';
import type { Logger } from '../../../../src/infra/logging/index.js';
import type { FrameworkGuide } from '../../../../src/engine/frameworks/types/framework-types.js';

const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const createMcpRequest = (command = '>>test', user_response?: string) => ({
  command,
  arguments: {},
  ...(user_response !== undefined ? { user_response } : {}),
});

function createContext(mcpRequest = createMcpRequest()): ExecutionContext {
  return new ExecutionContext(mcpRequest, createLogger());
}

/** Attach a minimal session context so phase guards can operate (requires chain session). */
function withSession(ctx: ExecutionContext, sessionId = 'session-1'): ExecutionContext {
  ctx.sessionContext = {
    sessionId,
    isChainExecution: true,
    currentStep: 1,
    totalSteps: 2,
  };
  return ctx;
}

const defaultConfig: PhaseGuardsConfig = { mode: 'enforce', maxRetries: 2 };

function createMockGuide(steps: Array<Record<string, unknown>>): FrameworkGuide {
  return {
    enhanceWithFramework: jest.fn().mockReturnValue({
      processingEnhancements: steps,
    }),
    guidePromptCreation: jest.fn(),
    guideTemplateProcessing: jest.fn(),
    guideExecutionSteps: jest.fn(),
    validateFrameworkCompliance: jest.fn(),
    getToolDescriptions: jest.fn(),
    renderPhaseGuardOverlay: jest.fn(),
  } as unknown as FrameworkGuide;
}

function createRegistry(guide?: FrameworkGuide) {
  return {
    getFrameworkGuide: jest.fn<(id: string) => FrameworkGuide | undefined>().mockReturnValue(guide),
  };
}

/**
 * Tier 3.1: a guard may only block on a header the RENDER recorded as declared. The store is what
 * holds that record, so a store returning no declaration is a run where the model was told
 * nothing — every guard is advisory there, by design. Tests that assert enforcement must
 * therefore declare the headers their fixture guards, which is what `declaredSections` does here.
 */
function createMockSessionStore(declaredSections?: readonly string[]): ChainSessionService {
  const session =
    declaredSections === undefined
      ? null
      : {
          state: {
            stepStates: new Map([
              [
                'n1',
                { state: 'working', isPlaceholder: false, declaredSections: [...declaredSections] },
              ],
            ]),
          },
        };
  return {
    setPendingGateReview: jest
      .fn<ChainSessionService['setPendingGateReview']>()
      .mockResolvedValue(undefined),
    getReview: jest.fn().mockReturnValue(undefined),
    setReview: jest.fn<ChainSessionService['setReview']>().mockResolvedValue(undefined),
    getSession: jest.fn().mockReturnValue(session),
    createSession: jest.fn().mockResolvedValue(undefined),
    updateSession: jest.fn().mockResolvedValue(undefined),
    clearPendingGateReview: jest.fn().mockResolvedValue(undefined),
  } as unknown as ChainSessionService;
}

/** A structural review, as stage 19 opens one; the caller names its node. */
const structuralReview = () => ({
  combinedPrompt: 'fix it',
  gateIds: [PHASE_GUARD_GATE_ID],
  prompts: [],
  createdAt: 1,
  attemptCount: 1,
  maxAttempts: 3,
});

describe('PhaseGuardVerificationStage', () => {
  let logger: Logger;
  let sessionStore: ChainSessionService;

  beforeEach(() => {
    logger = createLogger();
    // Default: every header the fixtures use is declared, so the pre-Tier-3.1 assertions keep
    // testing what they were written to test — that a declared-and-missing section blocks.
    sessionStore = createMockSessionStore([
      '## Context',
      '## Analysis',
      '## Goals',
      '## Execution',
    ]);
  });

  test('skips when phase guards mode is off', async () => {
    const stage = createPhaseGuardVerificationStage(
      () => createRegistry(),
      () => ({ mode: 'off' as const, maxRetries: 2 }),
      sessionStore,
      logger
    );
    const ctx = withSession(createContext());

    await stage.execute(ctx);

    expect(sessionStore.setPendingGateReview).not.toHaveBeenCalled();
  });

  test('skips when no chain session', async () => {
    const guide = createMockGuide([
      { id: 'context', name: 'Context', section_header: '## Context', guards: { required: true } },
    ]);
    const stage = createPhaseGuardVerificationStage(
      () => createRegistry(guide),
      () => defaultConfig,
      sessionStore,
      logger
    );
    const ctx = createContext(createMcpRequest('>>test', '## Context\nSome output.'));
    ctx.frameworkContext = { selectedFramework: { id: 'cageerf', name: 'CAGEERF' } } as any;
    // No sessionContext — phase guards require chain context

    await stage.execute(ctx);

    expect(sessionStore.setPendingGateReview).not.toHaveBeenCalled();
  });

  test('skips when no active framework from context or authority', async () => {
    const stage = createPhaseGuardVerificationStage(
      () => createRegistry(),
      () => defaultConfig,
      sessionStore,
      logger
    );
    const ctx = withSession(createContext());
    // No frameworkContext AND authority has no cached decision

    await stage.execute(ctx);

    expect(sessionStore.setPendingGateReview).not.toHaveBeenCalled();
  });

  test('resolves framework from authority when frameworkContext is empty (chain continuation)', async () => {
    const guide = createMockGuide([
      {
        id: 'context',
        name: 'Context',
        section_header: '## Context',
        guards: { required: true },
      },
    ]);
    const stage = createPhaseGuardVerificationStage(
      () => createRegistry(guide),
      () => defaultConfig,
      sessionStore,
      logger
    );
    const ctx = withSession(createContext(createMcpRequest('>>test', 'No context section here.')));
    // Simulate chain continuation: no frameworkContext (FrameworkResolutionStage skipped)
    // but authority has cached decision from GateEnhancementStage
    ctx.frameworkAuthority.decide({
      globalActiveFramework: 'cageerf',
    });
    ctx.state.session.capturedStep = { nodeId: 'n1', ordinal: 1 };

    await stage.execute(ctx);

    // Should have resolved framework from authority and run phase guards
    expect(sessionStore.setPendingGateReview).toHaveBeenCalledTimes(1);
    const review = (sessionStore.setPendingGateReview as jest.Mock).mock.calls[0][1] as any;
    expect(review.gateIds).toEqual([PHASE_GUARD_GATE_ID]);
    expect(review.metadata.failedPhases).toContain('context');
  });

  test('skips when no phases have guards', async () => {
    const guide = createMockGuide([
      { id: 'step1', name: 'Step 1' }, // no marker or guards
    ]);
    const stage = createPhaseGuardVerificationStage(
      () => createRegistry(guide),
      () => defaultConfig,
      sessionStore,
      logger
    );
    const ctx = withSession(createContext());
    ctx.frameworkContext = { selectedFramework: { id: 'cageerf', name: 'CAGEERF' } } as any;

    await stage.execute(ctx);

    expect(sessionStore.setPendingGateReview).not.toHaveBeenCalled();
  });

  test('skips when no user_response in request', async () => {
    const guide = createMockGuide([
      { id: 'context', name: 'Context', section_header: '## Context', guards: { required: true } },
    ]);
    const stage = createPhaseGuardVerificationStage(
      () => createRegistry(guide),
      () => defaultConfig,
      sessionStore,
      logger
    );
    const ctx = withSession(createContext());
    ctx.frameworkContext = { selectedFramework: { id: 'cageerf', name: 'CAGEERF' } } as any;

    await stage.execute(ctx);

    expect(sessionStore.setPendingGateReview).not.toHaveBeenCalled();
  });

  test('skips when phase guard review already pending', async () => {
    const guide = createMockGuide([
      { id: 'context', name: 'Context', section_header: '## Context', guards: { required: true } },
    ]);
    const stage = createPhaseGuardVerificationStage(
      () => createRegistry(guide),
      () => defaultConfig,
      sessionStore,
      logger
    );
    const ctx = withSession(createContext(createMcpRequest('>>test', 'No context section.')));
    ctx.frameworkContext = { selectedFramework: { id: 'cageerf', name: 'CAGEERF' } } as any;
    ctx.state.session.capturedStep = { nodeId: 'n1', ordinal: 1 };
    // The CAPTURED node's review already carries a structural finding (R16).
    (sessionStore.getReview as jest.Mock).mockImplementation((_sid, nodeId) =>
      nodeId === 'n1' ? { ...structuralReview(), nodeId: 'n1' } : undefined
    );

    await stage.execute(ctx);

    expect(sessionStore.getReview).toHaveBeenCalledWith('session-1', 'n1');
    expect(sessionStore.setPendingGateReview).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenLastCalledWith('[PhaseGuardVerification] Complete', {
      skipped: 'Phase guard review already pending',
    });
  });

  test("TWIN: a structural review SHOWN for an earlier step does not skip grading this step's answer", async () => {
    const guide = createMockGuide([
      { id: 'context', name: 'Context', section_header: '## Context', guards: { required: true } },
    ]);
    const stage = createPhaseGuardVerificationStage(
      () => createRegistry(guide),
      () => defaultConfig,
      sessionStore,
      logger
    );
    const ctx = withSession(createContext(createMcpRequest('>>test', 'No context section.')));
    ctx.frameworkContext = { selectedFramework: { id: 'cageerf', name: 'CAGEERF' } } as any;
    ctx.state.session.capturedStep = { nodeId: 'n1', ordinal: 1 };
    ctx.sessionContext!.pendingReview = { ...structuralReview(), nodeId: 'n0' };

    await stage.execute(ctx);

    const [, review] = (sessionStore.setPendingGateReview as jest.Mock).mock.calls[0] as [
      string,
      { nodeId: string; gateIds: string[] },
    ];
    expect(review.nodeId).toBe('n1');
    expect(review.gateIds).toEqual([PHASE_GUARD_GATE_ID]);
  });

  test('passes when all phase guards pass', async () => {
    const guide = createMockGuide([
      {
        id: 'context',
        name: 'Context',
        section_header: '## Context',
        guards: { required: true, min_length: 10 },
      },
    ]);
    const stage = createPhaseGuardVerificationStage(
      () => createRegistry(guide),
      () => defaultConfig,
      sessionStore,
      logger
    );
    const ctx = withSession(
      createContext(
        createMcpRequest(
          '>>test',
          '## Context\n\nThis is a sufficiently long context section that passes min_length.'
        )
      )
    );
    ctx.frameworkContext = { selectedFramework: { id: 'cageerf', name: 'CAGEERF' } } as any;

    await stage.execute(ctx);

    expect(sessionStore.setPendingGateReview).not.toHaveBeenCalled();
    expect(ctx.response).toBeUndefined();
  });

  test('merges phase guard results into existing gate review when phase guards pass', async () => {
    const guide = createMockGuide([
      {
        id: 'context',
        name: 'Context',
        section_header: '## Context',
        guards: { required: true, min_length: 10 },
      },
    ]);
    const stage = createPhaseGuardVerificationStage(
      () => createRegistry(guide),
      () => defaultConfig,
      sessionStore,
      logger
    );
    const ctx = withSession(
      createContext(
        createMcpRequest(
          '>>test',
          '## Context\n\nThis is a sufficiently long context section that passes min_length.'
        )
      )
    );
    ctx.frameworkContext = { selectedFramework: { id: 'cageerf', name: 'CAGEERF' } } as any;
    // The captured step's own gate review, which is also the one shown
    const gateReview = {
      combinedPrompt: 'Review against content-structure',
      gateIds: ['content-structure'],
      prompts: [],
      createdAt: Date.now(),
      attemptCount: 0,
      maxAttempts: 2,
      nodeId: 'n1',
    };
    ctx.state.session.capturedStep = { nodeId: 'n1', ordinal: 1 };
    (sessionStore.getReview as jest.Mock).mockReturnValue({ ...gateReview });
    ctx.sessionContext!.pendingReview = gateReview as any;

    await stage.execute(ctx);

    // Should NOT clear — should merge phase guard summary into the review
    expect(sessionStore.clearPendingGateReview).not.toHaveBeenCalled();
    expect(sessionStore.setReview).toHaveBeenCalledTimes(1);

    const [sessionId, review] = (sessionStore.setReview as jest.Mock).mock.calls[0] as [
      string,
      any,
    ];
    expect(sessionId).toBe('session-1');
    expect(review.nodeId).toBe('n1');

    // Combined prompt starts with phase guard summary
    expect(review.combinedPrompt).toContain('## Structural Verification: PASS');
    // Original prompt is preserved after separator
    expect(review.combinedPrompt).toContain('Review against content-structure');
    // Phase Guard context metadata attached
    expect(review.metadata.phaseGuardContext).toBeDefined();
    expect(review.metadata.phaseGuardContext.allPassed).toBe(true);
    expect(review.metadata.phaseGuardContext.phaseCount).toBe(1);

    // Context fast-path signal updated
    expect(ctx.sessionContext!.pendingReview).toBeDefined();
    expect(ctx.sessionContext!.pendingReview!.combinedPrompt).toContain(
      '## Structural Verification: PASS'
    );
  });

  test("TWIN: the pass summary joins the CAPTURED step's review, never the one shown for an earlier step", async () => {
    const guide = createMockGuide([
      { id: 'context', name: 'Context', section_header: '## Context', guards: { required: true } },
    ]);
    const stage = createPhaseGuardVerificationStage(
      () => createRegistry(guide),
      () => defaultConfig,
      sessionStore,
      logger
    );
    const ctx = withSession(
      createContext(createMcpRequest('>>test', '## Context\nThe situation, in enough words.'))
    );
    ctx.frameworkContext = { selectedFramework: { id: 'cageerf', name: 'CAGEERF' } } as any;
    ctx.state.session.capturedStep = { nodeId: 'n1', ordinal: 1 };
    const shown = { combinedPrompt: 'Check n0.', gateIds: ['g'], prompts: [], createdAt: 1 };
    ctx.sessionContext!.pendingReview = { ...shown, attemptCount: 0, maxAttempts: 2, nodeId: 'n0' };
    (sessionStore.getReview as jest.Mock).mockImplementation((_sid, nodeId) =>
      nodeId === 'n1'
        ? { ...shown, combinedPrompt: 'Check n1.', attemptCount: 0, maxAttempts: 2, nodeId: 'n1' }
        : undefined
    );

    await stage.execute(ctx);

    expect(sessionStore.setPendingGateReview).not.toHaveBeenCalled();
    const [, review] = (sessionStore.setReview as jest.Mock).mock.calls[0] as [string, any];
    expect(review.nodeId).toBe('n1');
    expect(review.combinedPrompt).toMatch(/^## Structural Verification: PASS[\s\S]*Check n1\.$/);
    // The shown review, another step's, is left alone.
    expect(ctx.sessionContext!.pendingReview!.nodeId).toBe('n0');
    expect(ctx.sessionContext!.pendingReview!.combinedPrompt).toBe('Check n0.');
  });

  test('does not double-inject phaseGuardContext on retry', async () => {
    const guide = createMockGuide([
      {
        id: 'context',
        name: 'Context',
        section_header: '## Context',
        guards: { required: true, min_length: 10 },
      },
    ]);
    const stage = createPhaseGuardVerificationStage(
      () => createRegistry(guide),
      () => defaultConfig,
      sessionStore,
      logger
    );
    const ctx = withSession(
      createContext(
        createMcpRequest(
          '>>test',
          '## Context\n\nThis is a sufficiently long context section that passes min_length.'
        )
      )
    );
    ctx.frameworkContext = { selectedFramework: { id: 'cageerf', name: 'CAGEERF' } } as any;
    ctx.state.session.capturedStep = { nodeId: 'n1', ordinal: 1 };
    // Simulate gate review that already has phaseGuardContext (from previous cycle)
    (sessionStore.getReview as jest.Mock).mockReturnValue({
      nodeId: 'n1',
      combinedPrompt: '## Structural Verification: PASS\n\n---\n\nReview content',
      gateIds: ['content-structure'],
      prompts: [],
      createdAt: Date.now(),
      attemptCount: 1,
      maxAttempts: 3,
      metadata: {
        phaseGuardContext: { allPassed: true, phaseCount: 1, evaluatedAt: Date.now() - 1000 },
      },
    });

    await stage.execute(ctx);

    // Should NOT inject again — phaseGuardContext already present
    expect(sessionStore.setReview).not.toHaveBeenCalled();
    expect(sessionStore.setPendingGateReview).not.toHaveBeenCalled();
  });

  test('creates pending gate review on enforce failure', async () => {
    const guide = createMockGuide([
      {
        id: 'context',
        name: 'Context',
        section_header: '## Context',
        guards: { required: true },
      },
    ]);
    const stage = createPhaseGuardVerificationStage(
      () => createRegistry(guide),
      () => defaultConfig,
      sessionStore,
      logger
    );
    const ctx = withSession(createContext(createMcpRequest('>>test', 'No context section here.')));
    ctx.frameworkContext = { selectedFramework: { id: 'cageerf', name: 'CAGEERF' } } as any;
    // Row 2.11: what StepResponseCapture wrote earlier in the SAME call — the only record of
    // which step's output is being graded, since the run may already have advanced past it.
    ctx.state.session.capturedStep = { nodeId: 'n1', ordinal: 1 };

    await stage.execute(ctx);

    // Should persist pending review via chain session store
    expect(sessionStore.setPendingGateReview).toHaveBeenCalledTimes(1);
    const [sessionId, review] = (sessionStore.setPendingGateReview as jest.Mock).mock.calls[0] as [
      string,
      any,
    ];
    expect(sessionId).toBe('session-1');
    expect(review.gateIds).toEqual([PHASE_GUARD_GATE_ID]);
    expect(review.attemptCount).toBe(0);
    expect(review.maxAttempts).toBe(3); // maxRetries(2) + 1
    expect(review.retryHints).toBeDefined();
    expect(review.retryHints.length).toBeGreaterThan(0);
    expect(review.previousResponse).toBe('No context section here.');
    expect(review.metadata.source).toBe('phase-guard-verification');
    expect(review.metadata.failedPhases).toContain('context');
    // Row 2.11: the review carries the identity of the step it GRADED, both keys.
    expect(review.metadata.stepNumber).toBe(1);
    expect(review.metadata.nodeId).toBe('n1');

    // Should also update context so GateReviewStage sees pending review
    expect(ctx.sessionContext!.pendingReview).toBeDefined();
    expect(ctx.sessionContext!.pendingReview!.gateIds).toEqual([PHASE_GUARD_GATE_ID]);
  });

  /**
   * R103 / P4.156: a structural failure on a gated step JOINS the gate review open for that step.
   * The twin below differs in the answer only: sectioned, it reaches the gate review unchanged.
   */
  describe('a structural failure merges into the open gate review (R103)', () => {
    const openGateReview = () => ({
      combinedPrompt: '',
      gateIds: ['e2e-block'],
      prompts: [{ gateId: 'e2e-block', gateName: 'e2e-block', criteriaSummary: 'GATE-CRITERIA' }],
      createdAt: 1,
      attemptCount: 1,
      maxAttempts: 5,
      retryHints: ['gate hint'],
      history: [{ timestamp: 2, status: 'fail', reasoning: 'first try missed it' }],
      metadata: { sessionId: 'session-1', stepNumber: 1 },
    });

    const gradeWithOpenReview = async (answer: string) => {
      const guide = createMockGuide([
        {
          id: 'context',
          name: 'Context',
          section_header: '## Context',
          guards: { required: true },
        },
      ]);
      const open = openGateReview();
      (sessionStore.getReview as jest.Mock).mockReturnValue(open);
      const stage = createPhaseGuardVerificationStage(
        () => createRegistry(guide),
        () => defaultConfig,
        sessionStore,
        logger
      );
      const ctx = withSession(createContext(createMcpRequest('>>test', answer)));
      ctx.frameworkContext = { selectedFramework: { id: 'cageerf', name: 'CAGEERF' } } as any;
      ctx.sessionContext!.pendingReview = open as any;
      ctx.state.session.capturedStep = { nodeId: 'n1', ordinal: 1 };
      await stage.execute(ctx);
      return ctx;
    };

    test('a one-line answer yields ONE review carrying the gate and the missing section', async () => {
      const ctx = await gradeWithOpenReview('one line answer');

      expect(sessionStore.setPendingGateReview).toHaveBeenCalledTimes(1);
      const review = (sessionStore.setPendingGateReview as jest.Mock).mock.calls[0][1] as any;
      expect(review.gateIds).toEqual(['e2e-block', PHASE_GUARD_GATE_ID]);
      // The gate's own criteria, retry budget, spent attempts and history survive.
      expect(review.prompts).toEqual(openGateReview().prompts);
      expect(review.maxAttempts).toBe(5);
      expect(review.attemptCount).toBe(1);
      expect(review.history).toEqual(openGateReview().history);
      // The structural finding joins it.
      expect(review.retryHints[0]).toContain('## Context');
      expect(review.retryHints).toContain('gate hint');
      expect(review.metadata.failedPhases).toEqual(['context']);
      expect(review.previousResponse).toBe('one line answer');
      expect(ctx.sessionContext!.pendingReview).toBe(review);
    });

    test('TWIN: the same step answered in sections reaches the gate review unchanged', async () => {
      const ctx = await gradeWithOpenReview(
        '## Context\nThe situation is described here in enough words to count as a section.'
      );

      const review = ctx.sessionContext!.pendingReview!;
      expect(review.gateIds).toEqual(['e2e-block']);
      expect(review.maxAttempts).toBe(5);
      expect(review.attemptCount).toBe(1);
      expect(review.retryHints).toEqual(['gate hint']);
    });
  });

  /**
   * Row 2.11 attribution. Stage 19 grades the `user_response` of the step stage 16 just
   * CAPTURED, but it runs after stage 16 already advanced the run to the next node — so the
   * only thing that can name the graded step is what the capture recorded. These two cases pin
   * both polarities: stamped when the identity exists, ABSENT when it does not, because
   * `resolveReviewStep`'s `current_step` fallback is a documented path (a call that captured
   * nothing has no graded step to name) and a guessed ordinal there would be wrong exactly on
   * the calls where advancement did not happen.
   */
  describe('reviewed-step attribution (row 2.11)', () => {
    const failingGuide = () =>
      createMockGuide([
        {
          id: 'context',
          name: 'Context',
          section_header: '## Context',
          guards: { required: true },
        },
      ]);

    const runFailingGuard = async (capturedStep?: {
      nodeId: string;
      ordinal: number;
    }): Promise<Record<string, unknown>> => {
      const stage = createPhaseGuardVerificationStage(
        () => createRegistry(failingGuide()),
        () => defaultConfig,
        sessionStore,
        logger
      );
      const ctx = withSession(createContext(createMcpRequest('>>test', 'No context section.')));
      ctx.frameworkContext = { selectedFramework: { id: 'cageerf', name: 'CAGEERF' } } as any;
      // The run stands on step 2 — stage 16 advanced it before this stage ran. Every assertion
      // below is about the review NOT inheriting this number.
      ctx.sessionContext = { ...ctx.sessionContext!, currentStep: 2, currentNodeId: 'n2' };
      if (capturedStep !== undefined) {
        ctx.state.session.capturedStep = capturedStep;
      }

      await stage.execute(ctx);

      const [, review] = (sessionStore.setPendingGateReview as jest.Mock).mock.calls[0] as [
        string,
        { metadata: Record<string, unknown> },
      ];
      return review.metadata;
    };

    test('the review names the CAPTURED step, not the node the run advanced to', async () => {
      const metadata = await runFailingGuard({ nodeId: 'n1', ordinal: 1 });

      expect(metadata['stepNumber']).toBe(1);
      expect(metadata['nodeId']).toBe('n1');
      expect(metadata['stepNumber']).not.toBe(2);
    });

    test('the review is keyed by the CAPTURED node (R8), not the node the run stands on', async () => {
      await runFailingGuard({ nodeId: 'n1', ordinal: 1 });

      const [, review] = (sessionStore.setPendingGateReview as jest.Mock).mock.calls[0] as [
        string,
        { nodeId?: string },
      ];
      expect(review.nodeId).toBe('n1');
    });

    test('a call that captured nothing opens no review — no node to key it by (R8, row 3.5)', async () => {
      const stage = createPhaseGuardVerificationStage(
        () => createRegistry(failingGuide()),
        () => defaultConfig,
        sessionStore,
        logger
      );
      const ctx = withSession(createContext(createMcpRequest('>>test', 'No context section.')));
      ctx.frameworkContext = { selectedFramework: { id: 'cageerf', name: 'CAGEERF' } } as any;
      ctx.sessionContext = { ...ctx.sessionContext!, currentStep: 2, currentNodeId: 'n2' };
      const warn = jest.spyOn(ctx.diagnostics, 'warn');

      await stage.execute(ctx);

      expect(sessionStore.setPendingGateReview).not.toHaveBeenCalled();
      // No captured node, no review read (R16).
      expect(sessionStore.getReview).not.toHaveBeenCalled();
      expect(ctx.sessionContext?.pendingReview).toBeUndefined();
      // The failure was found and said, not skipped before grading.
      expect(warn).toHaveBeenCalledWith(
        'PhaseGuardVerification',
        'Structural failure on a call that captured no step',
        expect.anything()
      );
    });
  });

  test('warn mode appends warning without creating review', async () => {
    const guide = createMockGuide([
      {
        id: 'context',
        name: 'Context',
        section_header: '## Context',
        guards: { required: true },
      },
    ]);
    const stage = createPhaseGuardVerificationStage(
      () => createRegistry(guide),
      () => ({ mode: 'warn' as const, maxRetries: 2 }),
      sessionStore,
      logger
    );
    const ctx = withSession(createContext(createMcpRequest('>>test', 'No context section.')));
    ctx.frameworkContext = { selectedFramework: { id: 'cageerf', name: 'CAGEERF' } } as any;

    await stage.execute(ctx);

    expect(sessionStore.setPendingGateReview).not.toHaveBeenCalled();
    expect(ctx.state.gates.advisoryWarnings.length).toBeGreaterThan(0);
    expect(ctx.state.gates.advisoryWarnings[0]).toContain('PhaseGuard');
    expect(ctx.state.gates.advisoryWarnings[0]).toContain('context');
  });

  test('skips when framework registry provider returns undefined', async () => {
    const stage = createPhaseGuardVerificationStage(
      () => undefined,
      () => defaultConfig,
      sessionStore,
      logger
    );
    const ctx = withSession(createContext(createMcpRequest('>>test', '## Context\nSome output.')));
    ctx.frameworkContext = { selectedFramework: { id: 'cageerf', name: 'CAGEERF' } } as any;

    await stage.execute(ctx);

    expect(sessionStore.setPendingGateReview).not.toHaveBeenCalled();
  });

  test('skips when framework guide returns undefined', async () => {
    const registry = {
      getFrameworkGuide: jest
        .fn<(id: string) => FrameworkGuide | undefined>()
        .mockReturnValue(undefined),
    };
    const stage = createPhaseGuardVerificationStage(
      () => registry,
      () => defaultConfig,
      sessionStore,
      logger
    );
    const ctx = withSession(createContext(createMcpRequest('>>test', '## Context\nSome output.')));
    ctx.frameworkContext = { selectedFramework: { id: 'unknown', name: 'Unknown' } } as any;

    await stage.execute(ctx);

    expect(sessionStore.setPendingGateReview).not.toHaveBeenCalled();
  });

  test('skips when phaseGuardReviewCleared flag is set (verdict cleared review this turn)', async () => {
    const guide = createMockGuide([
      { id: 'context', name: 'Context', section_header: '## Context', guards: { required: true } },
    ]);
    const stage = createPhaseGuardVerificationStage(
      () => createRegistry(guide),
      () => defaultConfig,
      sessionStore,
      logger
    );
    const ctx = withSession(
      createContext(createMcpRequest('>>test', 'GATE_REVIEW: PASS - looks good'))
    );
    ctx.frameworkContext = { selectedFramework: { id: 'cageerf', name: 'CAGEERF' } } as any;
    // StepResponseCaptureStage set this flag after clearing an phase guard review via verdict
    ctx.state.gates.phaseGuardReviewCleared = true;

    await stage.execute(ctx);

    // Should skip — no re-evaluation, no new pending review
    expect(sessionStore.setPendingGateReview).not.toHaveBeenCalled();
  });

  test('evaluates multiple phases correctly', async () => {
    const guide = createMockGuide([
      {
        id: 'context',
        name: 'Context',
        section_header: '## Context',
        guards: { required: true, min_length: 10 },
      },
      {
        id: 'analysis',
        name: 'Analysis',
        section_header: '## Analysis',
        guards: { required: true, min_length: 10 },
      },
    ]);
    const stage = createPhaseGuardVerificationStage(
      () => createRegistry(guide),
      () => defaultConfig,
      sessionStore,
      logger
    );
    const ctx = withSession(
      createContext(
        createMcpRequest(
          '>>test',
          '## Context\n\nThis is the context section with sufficient length.\n\n## Analysis\n\nThis is the analysis section with sufficient length.'
        )
      )
    );
    ctx.frameworkContext = { selectedFramework: { id: 'cageerf', name: 'CAGEERF' } } as any;

    await stage.execute(ctx);

    expect(sessionStore.setPendingGateReview).not.toHaveBeenCalled();
  });

  test('factory function creates stage correctly', () => {
    const stage = createPhaseGuardVerificationStage(
      () => createRegistry(),
      () => defaultConfig,
      sessionStore,
      logger
    );

    expect(stage).toBeInstanceOf(PhaseGuardVerificationStage);
    expect(stage.name).toBe('PhaseGuardVerification');
  });

  test('includes retry hints in pending review', async () => {
    const guide = createMockGuide([
      { id: 'context', name: 'Context', section_header: '## Context', guards: { required: true } },
      {
        id: 'analysis',
        name: 'Analysis',
        section_header: '## Analysis',
        guards: { required: true },
      },
    ]);
    const stage = createPhaseGuardVerificationStage(
      () => createRegistry(guide),
      () => defaultConfig,
      sessionStore,
      logger
    );
    const ctx = withSession(
      createContext(createMcpRequest('>>test', 'Output with no phase headers at all.'))
    );
    ctx.frameworkContext = { selectedFramework: { id: 'cageerf', name: 'CAGEERF' } } as any;
    ctx.state.session.capturedStep = { nodeId: 'n1', ordinal: 1 };

    await stage.execute(ctx);

    const review = (sessionStore.setPendingGateReview as jest.Mock).mock.calls[0][1] as any;
    expect(review.retryHints).toHaveLength(2);
    // Hints must name the configured SECTION_HEADER ("## Context"), NOT the phase id ("context").
    // The old code did `## ${id}` → "## context", a header the splitter never matched → loop.
    expect(review.retryHints[0]).toContain('## Context');
    expect(review.retryHints[1]).toContain('## Analysis');
    expect(review.metadata.failedPhases).toEqual(expect.arrayContaining(['context', 'analysis']));
  });
  // ---- Tier 3.1/3.2: a guard may only block on a header the prompt actually declared ----

  test('a guard on an UNDECLARED header is advisory — it warns and does not block', async () => {
    const guide = createMockGuide([
      { id: 'context', name: 'Context', section_header: '## Context', guards: { required: true } },
    ]);
    // The run recorded a declaration, but not for this header — so the model was never told to
    // emit `## Context`. Blocking on it would be unsatisfiable, which is the defect Tier 3 closes.
    const store = createMockSessionStore(['## Something Else']);
    const stage = createPhaseGuardVerificationStage(
      () => createRegistry(guide),
      () => defaultConfig,
      store,
      logger
    );
    const ctx = withSession(createContext(createMcpRequest('>>test', 'No context section here.')));
    ctx.frameworkContext = { selectedFramework: { id: 'cageerf', name: 'CAGEERF' } } as any;

    await stage.execute(ctx);

    expect(store.setPendingGateReview).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  test('a run with NO recorded declaration blocks nothing', async () => {
    const guide = createMockGuide([
      { id: 'context', name: 'Context', section_header: '## Context', guards: { required: true } },
    ]);
    // No record at all. The change can only make enforcement rarer, never stricter — so an
    // unrecorded render is treated as having declared nothing rather than as having declared all.
    const store = createMockSessionStore(undefined);
    const stage = createPhaseGuardVerificationStage(
      () => createRegistry(guide),
      () => defaultConfig,
      store,
      logger
    );
    const ctx = withSession(createContext(createMcpRequest('>>test', 'No context section here.')));
    ctx.frameworkContext = { selectedFramework: { id: 'cageerf', name: 'CAGEERF' } } as any;

    await stage.execute(ctx);

    expect(store.setPendingGateReview).not.toHaveBeenCalled();
  });

  test('a DECLARED-and-missing section still blocks — enforcement is not lost', async () => {
    const guide = createMockGuide([
      { id: 'context', name: 'Context', section_header: '## Context', guards: { required: true } },
    ]);
    const store = createMockSessionStore(['## Context']);
    const stage = createPhaseGuardVerificationStage(
      () => createRegistry(guide),
      () => defaultConfig,
      store,
      logger
    );
    const ctx = withSession(createContext(createMcpRequest('>>test', 'No context section here.')));
    ctx.frameworkContext = { selectedFramework: { id: 'cageerf', name: 'CAGEERF' } } as any;
    ctx.state.session.capturedStep = { nodeId: 'n1', ordinal: 1 };

    await stage.execute(ctx);

    // The dangerous regression for this tier is losing enforcement for declared headers, so this
    // assertion is the one that must fail if the advisory filter is ever widened by accident.
    expect(store.setPendingGateReview).toHaveBeenCalledTimes(1);
  });

  // ---- P4.113: a retry hint says what actually failed ----

  /**
   * The two fixtures below differ in ONE thing — the number of characters in the `## Context`
   * body — and in nothing else: same guards, same header, same store, same framework. That is
   * what makes the short one evidence about LENGTH rather than about the header being absent.
   */
  const SHORT_CONTEXT_OUTPUT = '## Context\n\nToo short.';
  const LONG_CONTEXT_OUTPUT = `## Context\n\n${'Substantive context. '.repeat(12)}`;
  const MIN_LENGTH_GUARDS = { required: true, min_length: 120 };

  function runContextGuard(output: string) {
    const guide = createMockGuide([
      {
        id: 'context',
        name: 'Context',
        section_header: '## Context',
        guards: MIN_LENGTH_GUARDS,
      },
    ]);
    const store = createMockSessionStore(['## Context']);
    const stage = createPhaseGuardVerificationStage(
      () => createRegistry(guide),
      () => defaultConfig,
      store,
      logger
    );
    const ctx = withSession(createContext(createMcpRequest('>>test', output)));
    ctx.frameworkContext = { selectedFramework: { id: 'cageerf', name: 'CAGEERF' } } as any;
    ctx.state.session.capturedStep = { nodeId: 'n1', ordinal: 1 };
    return { stage, store, ctx };
  }

  test('a PRESENT-but-short section is told its length, not told to add the header', async () => {
    const { stage, store, ctx } = runContextGuard(SHORT_CONTEXT_OUTPUT);

    await stage.execute(ctx);

    const review = (store.setPendingGateReview as jest.Mock).mock.calls[0][1] as any;
    const hints = (review.retryHints as string[]).join('\n');
    // The section IS in the output, so a hint telling the model to include it is false, and it
    // contradicts the retry feedback directly above it, which names the measured length.
    expect(hints).not.toContain('includes the required');
    expect(hints).toContain('## Context');
    expect(hints).toContain(`${SHORT_CONTEXT_OUTPUT.length - '## Context\n\n'.length} chars`);
    expect(hints).toContain('at least 120 characters');
  });

  test('an ABSENT section is told to add the header — the two messages differ', async () => {
    const { stage, store, ctx } = runContextGuard('Prose with no headers at all, long enough.');

    await stage.execute(ctx);

    const review = (store.setPendingGateReview as jest.Mock).mock.calls[0][1] as any;
    const hints = (review.retryHints as string[]).join('\n');
    expect(hints).toContain('includes the required "## Context" section');
    expect(hints).not.toContain('chars');
  });

  test('positive control: the same fixture, long enough, raises no review at all', async () => {
    const { stage, store, ctx } = runContextGuard(LONG_CONTEXT_OUTPUT);

    await stage.execute(ctx);

    expect(store.setPendingGateReview).not.toHaveBeenCalled();
  });
});

/**
 * P4.111 / R85. The declared-header set is per NODE, not run-wide.
 *
 * Run-wide meant a step was graded on its SIBLINGS' vocabulary — headers a different prompt was
 * shown. A chain step that declines the framework is never shown any of them, so it was blocked
 * on a contract it was never given, which is precisely the unsatisfiable guard the declaration
 * record exists to prevent.
 *
 * The three cases below differ only in what the GRADED node has on record, and the sibling's
 * declaration is held constant so the union is never empty — without that, "does not block" would
 * pass on a store that declares nothing anywhere.
 */
function createMultiNodeStore(
  stepStates: Array<[string, { declaredSections?: readonly string[] }]>
): ChainSessionService {
  const session = {
    state: {
      stepStates: new Map(
        stepStates.map(([nodeId, meta]) => [
          nodeId,
          {
            state: 'working',
            isPlaceholder: false,
            ...(meta.declaredSections === undefined
              ? {}
              : { declaredSections: [...meta.declaredSections] }),
          },
        ])
      ),
    },
  };
  // Only `setPendingGateReview` is a jest.fn: it is the one call these cases assert on, and a
  // plain stub for the rest keeps this helper off the tests typecheck ratchet.
  return {
    setPendingGateReview: jest
      .fn<ChainSessionService['setPendingGateReview']>()
      .mockResolvedValue(undefined),
    getReview: () => undefined,
    getSession: () => session,
    createSession: async () => undefined,
    updateSession: async () => undefined,
    clearPendingGateReview: async () => undefined,
  } as unknown as ChainSessionService;
}

describe('the declared-header set is per node (P4.111)', () => {
  /** Grades a reply with NO `## Context` section, against the store the case supplies. */
  const gradeMissingContext = async (
    store: ChainSessionService,
    capturedNodeId: string | undefined
  ): Promise<ChainSessionService> => {
    const guide = createMockGuide([
      { id: 'context', name: 'Context', section_header: '## Context', guards: { required: true } },
    ]);
    const stage = createPhaseGuardVerificationStage(
      () => createRegistry(guide),
      () => defaultConfig,
      store,
      createLogger()
    );
    const ctx = withSession(createContext(createMcpRequest('>>test', 'No context section here.')));
    ctx.frameworkContext = { selectedFramework: { id: 'cageerf', name: 'CAGEERF' } } as never;
    if (capturedNodeId !== undefined) {
      ctx.state.session.capturedStep = { nodeId: capturedNodeId, ordinal: 2 };
    }

    await stage.execute(ctx);
    return store;
  };

  test('CONTROL: the graded node declared the header, so the guard blocks', async () => {
    const store = await gradeMissingContext(
      createMultiNodeStore([
        ['n1', { declaredSections: ['## Context'] }],
        ['n2', { declaredSections: ['## Context'] }],
      ]),
      'n2'
    );

    expect(store.setPendingGateReview).toHaveBeenCalledTimes(1);
  });

  test('a node that declared NOTHING is not blocked on its sibling`s header', async () => {
    const store = await gradeMissingContext(
      createMultiNodeStore([
        ['n1', { declaredSections: ['## Context'] }],
        ['n2', { declaredSections: [] }],
      ]),
      'n2'
    );

    expect(store.setPendingGateReview).not.toHaveBeenCalled();
  });

  /**
   * An ABSENT record is not an empty one. A gated chain step renders only through the gate-review
   * path, which declares its headers and records nothing, so its node carries no array at all —
   * and that still falls back to the run, as it did before this row. Reading absent as empty
   * would silently stop enforcing on every gated step.
   */
  test('a node with NO recorded declaration falls back to the run-wide union', async () => {
    const store = await gradeMissingContext(
      createMultiNodeStore([
        ['n1', { declaredSections: ['## Context'] }],
        ['n2', {}],
      ]),
      'n2'
    );

    expect(store.setPendingGateReview).toHaveBeenCalledTimes(1);
  });

  /**
   * With no captured step there is no node to key a review by (R8), so the union's only effect
   * left is that the guard is evaluated and its failure reported, where an empty set would skip
   * grading altogether.
   */
  test('a call that captured no step at all falls back to the run-wide union', async () => {
    const warn = jest.spyOn(DiagnosticAccumulator.prototype, 'warn');
    const store = await gradeMissingContext(
      createMultiNodeStore([
        ['n1', { declaredSections: ['## Context'] }],
        ['n2', { declaredSections: [] }],
      ]),
      undefined
    );

    expect(store.setPendingGateReview).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      'PhaseGuardVerification',
      'Structural failure on a call that captured no step',
      expect.anything()
    );
    warn.mockRestore();
  });
});

describe('gradeLateReport (row 3.8)', () => {
  const SECTIONED = '## Context\nThe claim.\n\n## Analysis\nThe evidence.';
  const guide = createMockGuide([
    { id: 'context', name: 'Context', section_header: '## Context', guards: { required: true } },
    { id: 'analysis', name: 'Analysis', section_header: '## Analysis', guards: { required: true } },
  ]);
  const node = { nodeId: 'rev', stepNumber: 2 };

  /** The detached node `rev` declared both headers; the captured step `n1` declared none. */
  const storeFor = (): ChainSessionService =>
    ({
      getSession: jest.fn().mockReturnValue({
        state: {
          stepStates: new Map([
            ['n1', { state: 'completed', isPlaceholder: false, declaredSections: [] }],
            [
              'rev',
              {
                state: 'completed',
                isPlaceholder: false,
                declaredSections: ['## Context', '## Analysis'],
              },
            ],
          ]),
        },
      }),
      setReview: jest.fn<ChainSessionService['setReview']>().mockResolvedValue(undefined),
      clearPendingGateReview: jest
        .fn<ChainSessionService['clearPendingGateReview']>()
        .mockResolvedValue(undefined),
    }) as unknown as ChainSessionService;

  const grade = async (callText: string, recordedOutput: string) => {
    const store = storeFor();
    const stage = new PhaseGuardVerificationStage(
      () => createRegistry(guide),
      () => defaultConfig,
      store,
      createLogger()
    );
    const ctx = withSession(createContext(createMcpRequest('>>test', callText)));
    ctx.frameworkContext = { selectedFramework: { id: 'cageerf', name: 'CAGEERF' } } as any;
    // The captured step graded nothing declared: only the detached node's record can block.
    ctx.state.session.capturedStep = { nodeId: 'n1', ordinal: 1 } as any;
    return {
      review: await stage.gradeLateReport(ctx, 'session-1', node, null, recordedOutput),
      store,
    };
  };

  test("grades the recorded output against the node's own declaration, never the call's text", async () => {
    const { review, store } = await grade(SECTIONED, 'one line');
    expect(review).toMatchObject({
      nodeId: 'rev',
      kind: 'detached',
      phase: 'awaiting-verdict',
      gateIds: [PHASE_GUARD_GATE_ID],
      reviewedOutput: 'one line',
    });
    expect(store.setReview).toHaveBeenCalledWith('session-1', review!);
  });

  test('twin: a sectioned recorded output opens nothing, whatever the call carried', async () => {
    const { review, store } = await grade('one line', SECTIONED);
    expect(review).toBeNull();
    expect(store.setReview).not.toHaveBeenCalled();
  });
});
