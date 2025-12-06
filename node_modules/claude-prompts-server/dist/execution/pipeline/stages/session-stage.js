import { randomUUID } from 'crypto';
import { BasePipelineStage } from '../stage.js';
/**
 * Stage 4: Session management and continuity.
 */
export class SessionManagementStage extends BasePipelineStage {
    constructor(chainSessionManager, logger) {
        super(logger);
        this.chainSessionManager = chainSessionManager;
        this.name = 'SessionManagement';
    }
    async execute(context) {
        this.logEntry(context);
        if (!context.executionPlan?.requiresSession) {
            this.logExit({ skipped: 'Session not required' });
            return;
        }
        try {
            const forceRestart = Boolean(context.mcpRequest.force_restart);
            const derivedChainId = this.buildChainId(context);
            let resolvedSessionId = forceRestart ? undefined : context.getSessionId();
            let resumedViaChainMatch = false;
            let existingSession = !forceRestart &&
                resolvedSessionId &&
                this.chainSessionManager.hasActiveSession(resolvedSessionId)
                ? this.chainSessionManager.getSession(resolvedSessionId)
                : undefined;
            if (!existingSession && !forceRestart) {
                const chainSession = this.chainSessionManager.getActiveSessionForChain(derivedChainId);
                if (chainSession) {
                    existingSession = chainSession;
                    resolvedSessionId = chainSession.sessionId;
                    resumedViaChainMatch = true;
                }
            }
            if (!resolvedSessionId) {
                resolvedSessionId = this.createSessionId(context);
            }
            let sessionContext;
            let decision;
            if (existingSession) {
                sessionContext = {
                    sessionId: resolvedSessionId,
                    chainId: existingSession.chainId,
                    isChainExecution: true,
                    currentStep: existingSession.state.currentStep,
                    totalSteps: existingSession.state.totalSteps,
                    pendingReview: this.chainSessionManager.getPendingGateReview(resolvedSessionId),
                };
                decision = resumedViaChainMatch ? 'resume-chain' : 'resume-session-id';
            }
            else {
                const totalSteps = this.getTotalSteps(context);
                const chainId = derivedChainId;
                await this.chainSessionManager.createSession(resolvedSessionId, chainId, totalSteps, context.getPromptArgs());
                sessionContext = {
                    sessionId: resolvedSessionId,
                    chainId,
                    isChainExecution: true,
                    currentStep: 1,
                    totalSteps,
                };
                decision = forceRestart ? 'create-force-restart' : 'create-new';
            }
            context.sessionContext = sessionContext;
            context.metadata.sessionLifecycleDecision = decision;
            this.logExit({
                sessionId: sessionContext.sessionId,
                chainId: sessionContext.chainId,
                pendingReview: Boolean(sessionContext.pendingReview),
                decision,
            });
        }
        catch (error) {
            this.handleError(error, 'Session management failed');
        }
    }
    createSessionId(context) {
        if (context.executionPlan?.gates.length) {
            return `review-${context.parsedCommand?.promptId}-${Date.now()}`;
        }
        return randomUUID();
    }
    buildChainId(context) {
        if (context.parsedCommand?.chainId) {
            return context.parsedCommand.chainId;
        }
        if (context.parsedCommand?.promptId) {
            return `chain-${context.parsedCommand.promptId}`;
        }
        return `chain-${Date.now().toString(36)}`;
    }
    getTotalSteps(context) {
        // Use type guard for type-safe access to chain steps
        if (context.hasChainCommand()) {
            return context.parsedCommand.steps.length;
        }
        if (context.parsedCommand?.convertedPrompt?.chainSteps?.length) {
            return context.parsedCommand.convertedPrompt.chainSteps.length;
        }
        return 1;
    }
}
//# sourceMappingURL=session-stage.js.map