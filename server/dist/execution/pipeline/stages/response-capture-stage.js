import { StepState } from '../../../mcp-tools/prompt-engine/core/types.js';
import { BasePipelineStage } from '../stage.js';
const PLACEHOLDER_SOURCE = 'StepResponseCaptureStage';
/**
 * Stage 6: Capture the result of the previous step (placeholder-based MVP).
 *
 * Since STDIO transports cannot stream the assistant's response back into the
 * MCP invocation automatically, we record a placeholder result whenever the
 * same chain session is resumed. This keeps TextReferenceManager populated so
 * downstream steps can reference {{previous_step_result}}.
 */
export class StepResponseCaptureStage extends BasePipelineStage {
    constructor(chainSessionManager, logger) {
        super(logger);
        this.chainSessionManager = chainSessionManager;
        this.name = 'StepResponseCapture';
    }
    async execute(context) {
        this.logEntry(context);
        // Use type-safe access for session-related properties
        if (!context.sessionContext) {
            this.logExit({ skipped: 'No session context available' });
            return;
        }
        const sessionContext = context.sessionContext;
        if (!sessionContext.isChainExecution) {
            this.logExit({ skipped: 'Not a chain execution' });
            return;
        }
        const sessionId = sessionContext.sessionId;
        if (!sessionId) {
            this.logExit({ skipped: 'Missing session identifier' });
            return;
        }
        const session = this.chainSessionManager.getSession(sessionId);
        if (!session) {
            this.logExit({ skipped: 'Session not found' });
            return;
        }
        // Always refresh chain variables for downstream template rendering
        context.metadata.chainContext = this.chainSessionManager.getChainContext(sessionId);
        const lifecycleDecision = context.metadata.sessionLifecycleDecision;
        if (lifecycleDecision === 'create-new' || lifecycleDecision === 'create-force-restart') {
            this.logExit({ skipped: 'New session, nothing to capture' });
            return;
        }
        const activeStepNumber = session.state.currentStep;
        if (!this.shouldCaptureStep(activeStepNumber, session.state.totalSteps)) {
            this.logExit({ skipped: 'No prior step to capture' });
            return;
        }
        const existingState = this.chainSessionManager.getStepState(sessionId, activeStepNumber);
        if (existingState?.state === StepState.COMPLETED && !existingState.isPlaceholder) {
            this.logExit({ skipped: 'Step already completed with real output' });
            return;
        }
        if (existingState?.state === StepState.COMPLETED && existingState.isPlaceholder) {
            this.logExit({ skipped: 'Placeholder already recorded' });
            return;
        }
        try {
            await this.capturePlaceholder(sessionId, session.chainId, activeStepNumber, session.state.totalSteps);
            const updatedSession = this.chainSessionManager.getSession(sessionId);
            if (updatedSession) {
                context.sessionContext = {
                    ...sessionContext,
                    currentStep: updatedSession.state.currentStep,
                    totalSteps: updatedSession.state.totalSteps,
                };
                context.metadata.chainContext = this.chainSessionManager.getChainContext(sessionId);
            }
            this.logExit({ capturedStep: activeStepNumber, placeholder: true });
        }
        catch (error) {
            this.handleError(error, 'Failed to capture previous step result');
        }
    }
    shouldCaptureStep(stepNumber, totalSteps) {
        if (!stepNumber || stepNumber < 1) {
            return false;
        }
        if (totalSteps > 0 && stepNumber > totalSteps) {
            return false;
        }
        return true;
    }
    async capturePlaceholder(sessionId, chainId, stepNumber, totalSteps) {
        const placeholderContent = this.buildPlaceholderContent(chainId, stepNumber, totalSteps);
        await this.chainSessionManager.updateSessionState(sessionId, stepNumber, placeholderContent, {
            isPlaceholder: true,
            placeholderSource: PLACEHOLDER_SOURCE,
            capturedAt: Date.now(),
        });
        await this.chainSessionManager.completeStep(sessionId, stepNumber, {
            preservePlaceholder: true,
        });
    }
    buildPlaceholderContent(chainId, stepNumber, totalSteps) {
        const timestamp = new Date().toISOString();
        return [
            `Step ${stepNumber}/${totalSteps} for chain "${chainId}" marked complete at ${timestamp}.`,
            'The STDIO transport cannot automatically return assistant output, so this placeholder marks the result as available for downstream templates.',
            'Continue by following the next set of chain instructions.',
        ].join(' ');
    }
}
//# sourceMappingURL=response-capture-stage.js.map