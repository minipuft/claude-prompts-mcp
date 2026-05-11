// @lifecycle canonical - Runs post-execution gate review workflows.
import { resolveJudgeGates, composeJudgeReviewPrompt } from '../../../gates/core/review-utils.js';
import { runGateShellVerifications } from '../../../gates/services/gate-shell-verify-runner.js';
import { formatGateShellVerifySection } from '../../../gates/shell/shell-verify-message-formatter.js';
import { BasePipelineStage } from '../stage.js';

import type { Logger } from '../../../../infra/logging/index.js';
import type { GatesConfig } from '../../../../shared/types/core-config.js';
import type { ChainSessionService } from '../../../../shared/types/index.js';
import type { GateDefinitionProvider } from '../../../gates/core/gate-loader.js';
import type { ExecutionContext } from '../../context/index.js';
import type { ChainOperatorExecutor } from '../../operators/chain-operator-executor.js';

type GatesConfigProvider = () => GatesConfig | undefined;

/**
 * Pipeline Stage: Gate Review Rendering
 *
 * Renders synthetic gate review steps when a session has a pending review.
 * When gates have `shell_verify` criteria, runs actual commands and enriches
 * the review feedback with real output (test failures, lint errors).
 */
export class GateReviewStage extends BasePipelineStage {
  readonly name = 'GateReview';

  constructor(
    private readonly chainOperatorExecutor: ChainOperatorExecutor,
    private readonly chainSessionManager: ChainSessionService,
    private readonly gateDefinitionProvider: GateDefinitionProvider | null,
    logger: Logger,
    private readonly gatesConfigProvider?: GatesConfigProvider
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    const sessionId = context.sessionContext?.sessionId;
    if (!sessionId || !context.sessionContext?.pendingReview) {
      this.logExit({ skipped: 'No pending gate review' });
      return;
    }

    const steps = context.parsedCommand?.steps;
    if (!Array.isArray(steps) || steps.length === 0) {
      this.logExit({ skipped: 'No chain steps available for gate review rendering' });
      return;
    }

    const pendingReview = this.chainSessionManager.getPendingGateReview(sessionId);
    if (!pendingReview) {
      this.logExit({ skipped: 'Pending gate review missing from session manager' });
      return;
    }

    context.sessionContext = context.sessionContext
      ? {
          ...context.sessionContext,
          pendingReview,
        }
      : context.sessionContext;

    try {
      // Run shell_verify criteria from gates to enrich review with real command output.
      // The agent's response is forwarded so gates that opt in via
      // `shell_stdin_source: 'agent_response'` can verify response-content claims
      // (file paths, line numbers, symbols) against ground truth.
      let shellSection = '';
      if (this.gateDefinitionProvider && pendingReview.gateIds.length > 0) {
        const agentResponse = context.mcpRequest?.user_response;
        const shellResults = await runGateShellVerifications(
          pendingReview.gateIds,
          this.gateDefinitionProvider,
          agentResponse !== undefined ? { agentResponse } : undefined
        );
        shellSection = formatGateShellVerifySection(shellResults);

        // Auto-pass: when all gates have shell_verify criteria and all passed (exit 0),
        // clear the review without LLM evaluation — ground-truth validated.
        if (shellResults.length > 0 && shellResults.every((r) => r.passed)) {
          const shellVerifiedGateIds = [...new Set(shellResults.map((r) => r.gateId))];
          const priorVerified = context.state.gates.shellVerifyPassedForGates ?? [];
          const allVerifiedGateIds = [...new Set([...shellVerifiedGateIds, ...priorVerified])];
          const allGatesCovered = pendingReview.gateIds.every((id) =>
            allVerifiedGateIds.includes(id)
          );

          if (allGatesCovered) {
            await this.chainSessionManager.clearPendingGateReview(sessionId);

            context.executionResults = {
              content: shellSection,
              metadata: {
                gateReview: {
                  gateIds: pendingReview.gateIds,
                  attemptCount: pendingReview.attemptCount,
                  maxAttempts: pendingReview.maxAttempts,
                  autoCleared: true,
                  verifiedBy: 'shell_verify',
                },
              },
              generatedAt: Date.now(),
            };

            context.diagnostics.info(this.name, 'Gate review auto-cleared by shell verification', {
              sessionId,
              verifiedGates: allVerifiedGateIds,
            });
            this.logExit({ autoCleared: true, verifiedGates: allVerifiedGateIds });
            return;
          }
        }
      }

      const chainContext = this.chainSessionManager.getChainContext(
        sessionId,
        context.getScopeOptions()
      );
      const renderResult = await this.chainOperatorExecutor.renderStep({
        executionType: 'gate_review',
        stepPrompts: steps,
        chainContext,
        pendingGateReview: pendingReview,
        additionalGateIds: pendingReview.gateIds,
      });

      // Resolve judge gates and compose context-isolated prompt if any gates use judge mode
      let judgeMetadata: Record<string, unknown> | undefined;
      if (this.gateDefinitionProvider && pendingReview.gateIds.length > 0) {
        const gatesConfig = this.gatesConfigProvider?.();
        const { judgeGates } = await resolveJudgeGates(
          pendingReview.gateIds,
          this.gateDefinitionProvider,
          gatesConfig?.evaluation
        );
        if (judgeGates.length > 0) {
          const output = renderResult.content;
          const judgeResult = composeJudgeReviewPrompt(judgeGates, output);
          judgeMetadata = {
            judgePrompt: judgeResult.judgePrompt,
            judgeGateIds: judgeResult.judgeGateIds,
            modelHint: judgeResult.modelHint,
          };
        }
      }

      context.executionResults = {
        content: shellSection ? `${renderResult.content}\n\n${shellSection}` : renderResult.content,
        metadata: {
          stepNumber: renderResult.stepNumber,
          totalSteps: renderResult.totalSteps,
          promptId: renderResult.promptId,
          promptName: renderResult.promptName,
          callToAction: renderResult.callToAction,
          gateReview: {
            gateIds: pendingReview.gateIds,
            attemptCount: pendingReview.attemptCount,
            maxAttempts: pendingReview.maxAttempts,
          },
          ...(judgeMetadata ? { judge: judgeMetadata } : {}),
        },
        generatedAt: Date.now(),
      };

      // Record diagnostic for gate review rendering
      context.diagnostics.info(this.name, 'Gate review step rendered', {
        sessionId,
        gateIds: pendingReview.gateIds,
        attemptCount: pendingReview.attemptCount,
        maxAttempts: pendingReview.maxAttempts,
        contentLength: renderResult.content.length,
      });

      this.logExit({
        renderedGateReview: true,
        gateCount: pendingReview.gateIds.length,
        attemptCount: pendingReview.attemptCount,
      });
    } catch (error) {
      this.handleError(error, 'Failed to render gate review step');
    }
  }
}
