// @lifecycle canonical - Enforces framework phase-guard verification in the execution pipeline.
/**
 * Pipeline Stage 09b: Phase Guard Verification
 *
 * Deterministic structural validation of LLM output against framework phase guards.
 * Evaluates phase markers and content rules (min_length, contains_any, etc.) without LLM cost.
 *
 * Position: After StepExecutionStage (09), before GateReviewStage (10-gate)
 *
 * Integration: On failure, creates a PendingGateReview via the gate enforcement authority
 * so the existing gate lifecycle handles persistence, advancement blocking, retry tracking,
 * and review rendering. Phase guards do NOT independently short-circuit via setResponse().
 *
 * Flow:
 * 1. Check if framework active AND framework has phases with guards
 * 2. If no guards → pass through (no-op)
 * 3. Evaluate user_response against phase markers/guards
 * 4. If all pass → merge guard summary into pending gate review (if any)
 * 5. If any fail → create PendingGateReview (gate system handles lifecycle)
 */

import {
  evaluatePhaseGuards,
  buildPhaseGuardPassSummary,
} from '../../../frameworks/phase-guards/index.js';
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '../../../../infra/logging/index.js';
import type { ChainSessionService } from '../../../../shared/types/chain-session.js';
import type { PhaseGuardsConfig } from '../../../../shared/types/core-config.js';
import type {
  ProcessingStep,
  FrameworkGuide,
} from '../../../frameworks/types/methodology-types.js';
import type { ExecutionContext } from '../../context/index.js';

/** Sentinel gate ID used for phase-guard-created pending reviews. */
export const PHASE_GUARD_GATE_ID = '__phase_guard__';

type FrameworkRegistryProvider = () =>
  | { getFrameworkGuide(id: string): FrameworkGuide | undefined }
  | undefined;

type PhaseGuardsConfigProvider = () => PhaseGuardsConfig | undefined;

/**
 * Phase Guard Verification Stage — thin orchestration layer.
 *
 * Delegates to:
 * - evaluatePhaseGuards(): Pure evaluation logic (from phase-guards module)
 * - FrameworkRegistry: Phase definitions with markers and guards
 * - ChainSessionStore: Pending review persistence (via gate lifecycle)
 * - Config: Phase guard mode
 */
export class PhaseGuardVerificationStage extends BasePipelineStage {
  readonly name = 'PhaseGuardVerification';

  constructor(
    private readonly frameworkRegistryProvider: FrameworkRegistryProvider,
    private readonly configProvider: PhaseGuardsConfigProvider,
    private readonly chainSessionStore: ChainSessionService,
    logger: Logger
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    // 1. Get phase guard config — skip if mode is "off"
    const config = this.configProvider() ?? { mode: 'enforce' as const, maxRetries: 2 };
    if (config.mode === 'off') {
      this.logExit({ skipped: 'Phase guards disabled (mode: off)' });
      return;
    }

    // 2. Need a chain session for gate lifecycle integration
    const sessionId = context.sessionContext?.sessionId;
    if (!sessionId) {
      this.logExit({ skipped: 'No chain session (phase guards require chain context)' });
      return;
    }

    // 3. Check if framework is active (fallback to authority for chain continuation)
    const frameworkId = this.resolveFrameworkId(context);
    if (!frameworkId) {
      this.logExit({ skipped: 'No active framework' });
      return;
    }

    // 4. Get framework phases with guards
    const phases = this.getPhasesWithGuards(frameworkId);
    if (phases.length === 0) {
      this.logExit({ skipped: 'No phases with guards' });
      return;
    }

    // 5. Get the LLM's previous response (user_response from chain continuation)
    const outputText = this.extractOutputText(context);
    if (!outputText) {
      this.logExit({ skipped: 'No user_response to evaluate' });
      return;
    }

    // 6. Skip if a phase guard review is already pending (avoid duplicate reviews)
    const existingReview = context.sessionContext?.pendingReview;
    if (existingReview?.gateIds?.includes(PHASE_GUARD_GATE_ID)) {
      this.logExit({ skipped: 'Phase guard review already pending' });
      return;
    }

    // 6b. Skip if a phase guard review was just cleared by a verdict this turn.
    // Without this, Stage 08 clears the review → this stage re-evaluates the
    // new user_response (e.g. a gate verdict) → fails → recreates the review → loop.
    if (context.state.gates.phaseGuardReviewCleared) {
      this.logExit({ skipped: 'Phase guard review cleared by verdict this turn' });
      return;
    }

    // 7. Evaluate phase guards
    const result = evaluatePhaseGuards(outputText, phases);

    if (result.allPassed) {
      // Phase guards passed — merge structural verification into pending gate review.
      // Guards check structure (sections present); LLM gates check content quality.
      // Both signals compose into a single review rather than guards replacing gates.
      // See docs/architecture/overview.md "Phase Guard–Gate Review Composition".
      const pendingReview = context.sessionContext?.pendingReview;
      if (pendingReview && !pendingReview.metadata?.['phaseGuardContext']) {
        const summary = buildPhaseGuardPassSummary(result);
        pendingReview.combinedPrompt = `${summary}\n\n---\n\n${pendingReview.combinedPrompt}`;
        pendingReview.metadata = {
          ...pendingReview.metadata,
          phaseGuardContext: {
            allPassed: true,
            phaseCount: result.results.length,
            evaluatedAt: Date.now(),
          },
        };
        await this.chainSessionStore.setPendingGateReview(sessionId, pendingReview);
        context.sessionContext = { ...context.sessionContext!, pendingReview };
        context.diagnostics.info(this.name, 'Merged phase guard results into gate review', {
          phaseCount: result.results.length,
        });
      }
      this.logExit({
        passed: true,
        phases: result.results.length,
        mergedIntoGateReview: !!pendingReview,
      });
      return;
    }

    // 8. Handle failures — create PendingGateReview via gate lifecycle
    const maxAttempts = config.maxRetries + 1;
    context.diagnostics.warn(this.name, 'Phase guard failures detected', {
      failedPhases: result.failedPhases,
      maxAttempts,
      mode: config.mode,
    });

    if (config.mode === 'warn') {
      // Warn: log warning, don't block
      context.state.gates.advisoryWarnings.push(
        `[PhaseGuard] ${result.failedPhases.join(', ')} failed structural checks`
      );
      this.logExit({ passed: false, advisory: true, failedPhases: result.failedPhases });
      return;
    }

    // Enforce: create a pending gate review so Stage 10 renders feedback
    // and Stage 08 blocks advancement on the next request.
    const review = {
      combinedPrompt: result.retryFeedback,
      gateIds: [PHASE_GUARD_GATE_ID],
      prompts: [],
      createdAt: Date.now(),
      attemptCount: 0,
      maxAttempts,
      // Hint with the phase's actual section_header (e.g. "## Dissolve"), NOT the phase id
      // (e.g. "dissolve_processing"). Prefixing "## " onto the id produced a header the
      // section-splitter could never match → the model kept adding the wrong header → loop.
      retryHints: result.results
        .filter((r) => !r.passed)
        .map((r) => `Ensure your response includes the required "${r.section_header}" section`),
      previousResponse: outputText,
      metadata: {
        source: 'phase-guard-verification',
        failedPhases: result.failedPhases,
        mode: config.mode,
      },
    };

    await this.chainSessionStore.setPendingGateReview(sessionId, review);

    // Update context so Stage 10 sees the pending review this request
    if (context.sessionContext) {
      context.sessionContext = {
        ...context.sessionContext,
        pendingReview: review,
      };
    }

    this.logExit({
      passed: false,
      createdPendingReview: true,
      failedPhases: result.failedPhases,
      maxAttempts,
    });
  }

  /**
   * Resolve the active framework ID from context or cached authority decision.
   *
   * On first request: Stage 06 populates frameworkContext → read from there.
   * On chain continuation: Stage 06 skips (blueprint-restored) → fall back to
   * FrameworkDecisionAuthority which was populated by Stage 05.
   */
  private resolveFrameworkId(context: ExecutionContext): string | undefined {
    const fromContext = context.frameworkContext?.selectedFramework?.id;
    if (fromContext) return fromContext;

    const cached = context.frameworkAuthority.getCachedDecision();
    if (cached?.shouldApply && cached.frameworkId) return cached.frameworkId;

    return undefined;
  }

  /**
   * Extract processing steps that have guards from the framework guide.
   */
  private getPhasesWithGuards(frameworkId: string): ProcessingStep[] {
    const registry = this.frameworkRegistryProvider();
    if (!registry) return [];

    const guide = registry.getFrameworkGuide(frameworkId);
    if (!guide) return [];

    const enhancement = guide.enhanceWithFramework(
      { id: 'phase-guard-check', name: '', description: '', category: '' } as any,
      {}
    );

    return (enhancement?.processingEnhancements ?? []).filter(
      (step) => step.section_header && step.guards
    );
  }

  /**
   * Extract the LLM's previous response for phase guard evaluation.
   *
   * Reads `user_response` from the MCP request — the LLM's actual output
   * from the previous turn. This is what guards should validate (did the
   * LLM follow framework phases?), NOT the rendered template from Stage 09.
   */
  private extractOutputText(context: ExecutionContext): string | undefined {
    const userResponse = context.mcpRequest.user_response?.trim();
    if (typeof userResponse === 'string' && userResponse.length > 0) return userResponse;
    return undefined;
  }
}

/**
 * Factory function for creating the phase guard verification stage.
 */
export function createPhaseGuardVerificationStage(
  frameworkRegistryProvider: FrameworkRegistryProvider,
  configProvider: PhaseGuardsConfigProvider,
  chainSessionStore: ChainSessionService,
  logger: Logger
): PhaseGuardVerificationStage {
  return new PhaseGuardVerificationStage(
    frameworkRegistryProvider,
    configProvider,
    chainSessionStore,
    logger
  );
}
