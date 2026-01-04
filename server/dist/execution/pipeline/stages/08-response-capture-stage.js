// @lifecycle canonical - Captures model responses and lifecycle decisions.
import { StepState } from '../../../mcp-tools/prompt-engine/core/types.js';
import { BasePipelineStage } from '../stage.js';
const PLACEHOLDER_SOURCE = 'StepResponseCaptureStage';
/**
 * Pipeline Stage 8: Step Response Capture
 *
 * Captures results from previous chain steps for STDIO transport compatibility,
 * recording placeholder results to enable {{previous_step_result}} references
 * in downstream steps.
 *
 * Dependencies: context.sessionContext
 * Output: Captured step results in TextReferenceManager
 * Can Early Exit: No
 */
export class StepResponseCaptureStage extends BasePipelineStage {
    constructor(chainSessionManager, logger) {
        super(logger);
        this.chainSessionManager = chainSessionManager;
        this.name = 'StepResponseCapture';
    }
    async execute(context) {
        var _a;
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
        // Keep pipeline session context aligned with manager state (important for gate reviews)
        const updatedSessionContext = {
            sessionId,
            isChainExecution: sessionContext.isChainExecution,
        };
        if (sessionContext.chainId !== undefined) {
            updatedSessionContext.chainId = sessionContext.chainId;
        }
        if (session.state.currentStep !== undefined) {
            updatedSessionContext.currentStep = session.state.currentStep;
        }
        if (session.state.totalSteps !== undefined) {
            updatedSessionContext.totalSteps = session.state.totalSteps;
        }
        const pendingReview = session.pendingGateReview ?? sessionContext.pendingReview;
        if (pendingReview !== undefined) {
            updatedSessionContext.pendingReview = pendingReview;
        }
        if (sessionContext.previousStepResult !== undefined) {
            updatedSessionContext.previousStepResult = sessionContext.previousStepResult;
        }
        if (sessionContext.previousStepQualityScore !== undefined) {
            updatedSessionContext.previousStepQualityScore = sessionContext.previousStepQualityScore;
        }
        context.sessionContext = updatedSessionContext;
        // Always refresh chain variables for downstream template rendering
        context.state.session.chainContext = this.chainSessionManager.getChainContext(sessionId);
        const lifecycleDecision = context.state.session.lifecycleDecision;
        if (lifecycleDecision === 'create-new' || lifecycleDecision === 'create-force-restart') {
            this.logExit({ skipped: 'New session, nothing to capture' });
            return;
        }
        let userResponse = context.mcpRequest.user_response?.trim();
        const gateVerdictInput = context.getGateVerdict();
        // Use authority for verdict parsing if available (preferred), fallback to local parsing
        const parseVerdict = (raw, source) => context.gateEnforcement?.parseVerdict(raw, source) ?? this.parseGateVerdict(raw, source);
        const verdictFromUserResponse = !gateVerdictInput && userResponse ? parseVerdict(userResponse, 'user_response') : null;
        // Handle gate_action parameter (retry/skip/abort) when retry limit exceeded
        // Delegate to GateEnforcementAuthority for consistent action handling
        const gateAction = context.mcpRequest.gate_action;
        const authority = context.gateEnforcement;
        const isRetryLimitExceeded = authority
            ? authority.isRetryLimitExceeded(sessionId)
            : this.chainSessionManager.isRetryLimitExceeded(sessionId);
        if (gateAction && isRetryLimitExceeded) {
            await this.handleGateAction(context, sessionId, gateAction, sessionContext);
            // If abort, exit early
            if (gateAction === 'abort') {
                this.logExit({ gateAction: 'abort', sessionAborted: true });
                return;
            }
            // If skip or retry was handled, skip verdict processing and exit
            if (gateAction === 'skip' || gateAction === 'retry') {
                this.logExit({ gateAction, handled: true });
                return;
            }
        }
        if (session.pendingGateReview) {
            const verdictPayload = parseVerdict(gateVerdictInput ?? undefined, 'gate_verdict') ?? verdictFromUserResponse;
            if (verdictPayload) {
                const outcome = await this.chainSessionManager.recordGateReviewOutcome(sessionId, {
                    verdict: verdictPayload.verdict,
                    rationale: verdictPayload.rationale,
                    rawVerdict: verdictPayload.raw,
                    reviewer: verdictPayload.source,
                });
                // Add detection metadata for transparency and debugging
                const verdictDetection = {
                    verdict: verdictPayload.verdict,
                    source: verdictPayload.source,
                };
                if (verdictPayload.rationale !== undefined) {
                    verdictDetection.rationale = verdictPayload.rationale;
                }
                if (verdictPayload.detectedPattern !== undefined) {
                    verdictDetection.pattern = verdictPayload.detectedPattern;
                }
                verdictDetection.outcome = outcome;
                context.state.gates.verdictDetection = verdictDetection;
                if (outcome === 'cleared') {
                    delete sessionContext.pendingReview;
                }
                else {
                    const pending = this.chainSessionManager.getPendingGateReview(sessionId);
                    if (pending !== undefined) {
                        sessionContext.pendingReview = pending;
                    }
                    else {
                        delete sessionContext.pendingReview;
                    }
                    // Get enforcement mode (defaults to 'blocking')
                    const enforcementMode = context.state.gates.enforcementMode ?? 'blocking';
                    // Handle FAIL verdict based on enforcement mode
                    if (verdictPayload.verdict === 'FAIL') {
                        switch (enforcementMode) {
                            case 'blocking':
                                // Stay on step, check retry limit
                                const pendingReview = this.chainSessionManager.getPendingGateReview(sessionId);
                                if (pendingReview && this.chainSessionManager.isRetryLimitExceeded(sessionId)) {
                                    context.state.gates.retryLimitExceeded = true;
                                    context.state.gates.retryExhaustedGateIds = [...pendingReview.gateIds];
                                    context.diagnostics.warn(this.name, 'Gate retry limit exceeded', {
                                        attemptCount: pendingReview.attemptCount,
                                        maxAttempts: pendingReview.maxAttempts ?? 2,
                                        gateIds: pendingReview.gateIds,
                                    });
                                }
                                context.diagnostics.info(this.name, 'Gate FAIL - blocking mode, awaiting retry');
                                break;
                            case 'advisory':
                                // Log warning but allow advancement
                                (_a = context.state.gates).advisoryWarnings ?? (_a.advisoryWarnings = []);
                                context.state.gates.advisoryWarnings.push(`Gate ${session.pendingGateReview?.gateIds.join(', ') ?? 'unknown'} failed: ${verdictPayload.rationale}`);
                                context.diagnostics.warn(this.name, 'Gate FAIL - advisory mode, continuing', {
                                    rationale: verdictPayload.rationale,
                                });
                                // Clear pending review to allow step advancement
                                await this.chainSessionManager.clearPendingGateReview(sessionId);
                                delete sessionContext.pendingReview;
                                break;
                            case 'informational':
                                // Log only, no user impact
                                context.diagnostics.info(this.name, 'Gate FAIL - informational mode, logged only', {
                                    rationale: verdictPayload.rationale,
                                });
                                // Clear pending review to allow step advancement
                                await this.chainSessionManager.clearPendingGateReview(sessionId);
                                delete sessionContext.pendingReview;
                                break;
                        }
                    }
                }
                context.sessionContext = {
                    ...sessionContext,
                };
                if (!gateVerdictInput && verdictFromUserResponse) {
                    userResponse = undefined;
                }
                if (!userResponse) {
                    this.logExit({
                        gateVerdict: verdictPayload.verdict,
                        gateVerdictSource: verdictPayload.source,
                    });
                    return;
                }
            }
        }
        // Check if user provided a response for the current step
        const hasUserResponse = userResponse && userResponse.length > 0;
        // Determine target step number:
        // - If user_response provided: capture for CURRENT step (the one just rendered)
        // - Otherwise: capture placeholder for PREVIOUS step
        const targetStepNumber = hasUserResponse
            ? (session.state.currentStep ?? 1)
            : (session.state.currentStep ?? 1) - 1;
        if (!this.shouldCaptureStep(targetStepNumber, session.state.totalSteps)) {
            this.logExit({ skipped: 'No prior step to capture' });
            return;
        }
        const existingState = this.chainSessionManager.getStepState(sessionId, targetStepNumber);
        if (existingState?.state === StepState.COMPLETED && !existingState.isPlaceholder) {
            this.logExit({ skipped: 'Step already completed with real output' });
            return;
        }
        if (existingState?.state === StepState.COMPLETED && existingState.isPlaceholder) {
            // Check if user provided a response to advance past the placeholder
            if (hasUserResponse) {
                // User provided explicit response - capture and advance
                this.logger.debug(`User response detected for step ${targetStepNumber}, replacing placeholder with real content`);
                const outputMapping = this.getStepOutputMapping(context, targetStepNumber);
                await this.captureRealResponse(sessionId, session.chainId, targetStepNumber, userResponse, outputMapping);
                const updatedSession = this.chainSessionManager.getSession(sessionId);
                if (updatedSession) {
                    context.sessionContext = {
                        ...sessionContext,
                        currentStep: updatedSession.state.currentStep,
                        totalSteps: updatedSession.state.totalSteps,
                    };
                    context.state.session.chainContext = this.chainSessionManager.getChainContext(sessionId);
                }
                this.logExit({
                    capturedStep: targetStepNumber,
                    responseType: 'user_response',
                    advanced: true,
                });
                return;
            }
            // No response provided - placeholder already exists
            this.logExit({ skipped: 'Placeholder already recorded' });
            return;
        }
        try {
            // Check for user response before creating placeholder
            if (hasUserResponse) {
                // User provided explicit response
                const outputMapping = this.getStepOutputMapping(context, targetStepNumber);
                await this.captureRealResponse(sessionId, session.chainId, targetStepNumber, userResponse, outputMapping);
            }
            else {
                // No response - create placeholder
                await this.capturePlaceholder(sessionId, session.chainId, targetStepNumber, session.state.totalSteps);
            }
            const updatedSession = this.chainSessionManager.getSession(sessionId);
            if (updatedSession) {
                context.sessionContext = {
                    ...sessionContext,
                    currentStep: updatedSession.state.currentStep,
                    totalSteps: updatedSession.state.totalSteps,
                };
                context.state.session.chainContext = this.chainSessionManager.getChainContext(sessionId);
            }
            const responseType = userResponse ? 'user_response' : 'placeholder';
            this.logExit({
                capturedStep: targetStepNumber,
                responseType,
                advanced: !!userResponse,
            });
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
    async captureRealResponse(sessionId, chainId, stepNumber, responseContent, outputMapping) {
        this.logger.debug(`Capturing real response for step ${stepNumber} in chain ${chainId}: ${responseContent.substring(0, 50)}...`);
        await this.chainSessionManager.updateSessionState(sessionId, stepNumber, responseContent, {
            isPlaceholder: false,
            source: 'user_response',
            capturedAt: Date.now(),
            outputMapping, // Pass through for named output storage
        });
        await this.chainSessionManager.completeStep(sessionId, stepNumber, {
            preservePlaceholder: false, // Real completion, advance currentStep
        });
        this.logger.debug(`Step ${stepNumber} completed with real response, advancing to next step`);
    }
    getStepOutputMapping(context, stepNumber) {
        const steps = context.parsedCommand?.steps;
        if (!steps)
            return undefined;
        const step = steps.find((s) => s.stepNumber === stepNumber);
        return step?.outputMapping;
    }
    buildPlaceholderContent(chainId, stepNumber, totalSteps) {
        const timestamp = new Date().toISOString();
        return [
            `Step ${stepNumber}/${totalSteps} for chain "${chainId}" marked complete at ${timestamp}.`,
            'The STDIO transport cannot automatically return assistant output, so this placeholder marks the result as available for downstream templates.',
            'Continue by following the next set of chain instructions.',
        ].join(' ');
    }
    /**
     * Handle user choice action when retry limit is exceeded.
     * Delegates to GateEnforcementAuthority for session manager interactions,
     * handles context state updates locally.
     */
    async handleGateAction(context, sessionId, gateAction, sessionContext) {
        const authority = context.gateEnforcement;
        // Delegate session manager operations to authority if available
        if (authority) {
            const result = await authority.resolveAction(sessionId, gateAction);
            // Handle context state updates based on action result
            if (result.handled) {
                context.state.gates.retryLimitExceeded = false;
                context.state.gates.awaitingUserChoice = false;
                if (result.retryReset) {
                    context.diagnostics.info(this.name, 'User chose to retry after exhaustion', {
                        sessionId,
                    });
                }
                else if (result.reviewCleared) {
                    const clearedContext = { ...sessionContext };
                    delete clearedContext.pendingReview;
                    context.sessionContext = clearedContext;
                    context.diagnostics.warn(this.name, 'User chose to skip failed gate', {
                        sessionId,
                        skippedGates: context.state.gates.retryExhaustedGateIds,
                    });
                }
                else if (result.sessionAborted) {
                    context.state.session.aborted = true;
                    context.diagnostics.info(this.name, 'User chose to abort chain after gate failure', {
                        sessionId,
                        failedGates: context.state.gates.retryExhaustedGateIds,
                    });
                }
            }
            return;
        }
        // Fallback: Direct session manager interaction (legacy path)
        switch (gateAction) {
            case 'retry':
                await this.chainSessionManager.resetRetryCount(sessionId);
                context.state.gates.retryLimitExceeded = false;
                context.state.gates.awaitingUserChoice = false;
                context.diagnostics.info(this.name, 'User chose to retry after exhaustion', {
                    sessionId,
                });
                break;
            case 'skip':
                await this.chainSessionManager.clearPendingGateReview(sessionId);
                context.state.gates.retryLimitExceeded = false;
                context.state.gates.awaitingUserChoice = false;
                const clearedContext = { ...sessionContext };
                delete clearedContext.pendingReview;
                context.sessionContext = clearedContext;
                context.diagnostics.warn(this.name, 'User chose to skip failed gate', {
                    sessionId,
                    skippedGates: context.state.gates.retryExhaustedGateIds,
                });
                break;
            case 'abort':
                context.state.session.aborted = true;
                context.state.gates.retryLimitExceeded = false;
                context.state.gates.awaitingUserChoice = false;
                context.diagnostics.info(this.name, 'User chose to abort chain after gate failure', {
                    sessionId,
                    failedGates: context.state.gates.retryExhaustedGateIds,
                });
                break;
        }
    }
    parseGateVerdict(raw, source) {
        if (!raw) {
            return null;
        }
        // Multiple format support (v3.1) - try patterns in order of specificity
        const patterns = [
            // Pattern 1: Full format with hyphen (original - backward compatible)
            { regex: /^GATE_REVIEW:\s*(PASS|FAIL)\s*-\s*(.+)$/i, priority: 'primary' },
            // Pattern 2: Full format with colon separator
            { regex: /^GATE_REVIEW:\s*(PASS|FAIL)\s*:\s*(.+)$/i, priority: 'high' },
            // Pattern 3: Simplified format with hyphen
            { regex: /^GATE\s+(PASS|FAIL)\s*-\s*(.+)$/i, priority: 'high' },
            // Pattern 4: Simplified format with colon
            { regex: /^GATE\s+(PASS|FAIL)\s*:\s*(.+)$/i, priority: 'medium' },
            // Pattern 5: Minimal format (gate_verdict parameter only - prevents false positives)
            { regex: /^(PASS|FAIL)\s*[-:]\s*(.+)$/i, priority: 'fallback' },
        ];
        for (const { regex, priority } of patterns) {
            // Security: Skip minimal format for user_response to prevent false positives
            if (priority === 'fallback' && source === 'user_response') {
                continue;
            }
            const match = raw.match(regex);
            if (match) {
                const [, verdictRaw, rationaleRaw] = match;
                if (!verdictRaw) {
                    continue;
                }
                const rationale = rationaleRaw?.trim();
                // Validation: Require non-empty rationale
                if (!rationale) {
                    this.logger.warn(`Gate verdict detected but missing rationale: "${raw.substring(0, 50)}..."`);
                    continue; // Try next pattern
                }
                return {
                    verdict: verdictRaw.toUpperCase(),
                    rationale,
                    raw,
                    source,
                    detectedPattern: priority, // For telemetry and debugging
                };
            }
        }
        // No pattern matched
        return null;
    }
}
//# sourceMappingURL=08-response-capture-stage.js.map