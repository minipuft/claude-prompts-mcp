import { describe, expect, jest, test, beforeEach } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import {
  PhaseGuardVerificationStage,
  PHASE_GUARD_GATE_ID,
  createPhaseGuardVerificationStage,
} from '../../../../src/engine/execution/pipeline/stages/19-phase-guard-verification-stage.js';

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
    getPendingGateReview: jest.fn().mockResolvedValue(null),
    getSession: jest.fn().mockReturnValue(session),
    createSession: jest.fn().mockResolvedValue(undefined),
    updateSession: jest.fn().mockResolvedValue(undefined),
    clearPendingGateReview: jest.fn().mockResolvedValue(undefined),
  } as unknown as ChainSessionService;
}

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
    // Pre-existing phase guard review
    ctx.sessionContext!.pendingReview = {
      combinedPrompt: 'fix it',
      gateIds: [PHASE_GUARD_GATE_ID],
      prompts: [],
      createdAt: Date.now(),
      attemptCount: 1,
      maxAttempts: 3,
    };

    await stage.execute(ctx);

    expect(sessionStore.setPendingGateReview).not.toHaveBeenCalled();
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
    // Simulate existing gate review from StepResponseCaptureStage (LLM quality gate)
    ctx.sessionContext!.pendingReview = {
      combinedPrompt: 'Review against content-structure',
      gateIds: ['content-structure'],
      prompts: [],
      createdAt: Date.now(),
      attemptCount: 0,
      maxAttempts: 2,
    };

    await stage.execute(ctx);

    // Should NOT clear — should merge phase guard summary into the review
    expect(sessionStore.clearPendingGateReview).not.toHaveBeenCalled();
    expect(sessionStore.setPendingGateReview).toHaveBeenCalledTimes(1);

    const [sessionId, review] = (sessionStore.setPendingGateReview as jest.Mock).mock.calls[0] as [
      string,
      any,
    ];
    expect(sessionId).toBe('session-1');

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
    // Simulate gate review that already has phaseGuardContext (from previous cycle)
    ctx.sessionContext!.pendingReview = {
      combinedPrompt: '## Structural Verification: PASS\n\n---\n\nReview content',
      gateIds: ['content-structure'],
      prompts: [],
      createdAt: Date.now(),
      attemptCount: 1,
      maxAttempts: 3,
      metadata: {
        phaseGuardContext: { allPassed: true, phaseCount: 1, evaluatedAt: Date.now() - 1000 },
      },
    };

    await stage.execute(ctx);

    // Should NOT inject again — phaseGuardContext already present
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

    // Should also update context so GateReviewStage sees pending review
    expect(ctx.sessionContext!.pendingReview).toBeDefined();
    expect(ctx.sessionContext!.pendingReview!.gateIds).toEqual([PHASE_GUARD_GATE_ID]);
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

  test('uses default config when provider returns undefined', async () => {
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
      () => undefined,
      sessionStore,
      logger
    );
    const ctx = withSession(createContext(createMcpRequest('>>test', 'No context section.')));
    ctx.frameworkContext = { selectedFramework: { id: 'cageerf', name: 'CAGEERF' } } as any;

    await stage.execute(ctx);

    // Default is enforce mode → creates pending review
    expect(sessionStore.setPendingGateReview).toHaveBeenCalledTimes(1);
    const review = (sessionStore.setPendingGateReview as jest.Mock).mock.calls[0][1] as any;
    expect(review.maxAttempts).toBe(3); // default maxRetries=2 + 1
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

    await stage.execute(ctx);

    // The dangerous regression for this tier is losing enforcement for declared headers, so this
    // assertion is the one that must fail if the advisory filter is ever widened by accident.
    expect(store.setPendingGateReview).toHaveBeenCalledTimes(1);
  });
});
