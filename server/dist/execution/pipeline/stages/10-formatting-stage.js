// @lifecycle canonical - Formats responses prior to gate review.
import { BasePipelineStage } from '../stage.js';
/**
 * Type guard for chain formatting context
 */
function isChainFormattingContext(context) {
    return context.executionType === 'chain';
}
/**
 * Type guard for single prompt formatting context
 */
function isSinglePromptFormattingContext(context) {
    return context.executionType === 'single';
}
/**
 * Pipeline Stage 10: Response Formatting
 *
 * Assembles final ToolResponse payloads with metadata, session information,
 * and progress tracking for different execution types (prompt/chain/template).
 *
 * Dependencies: context.executionPlan, rendered content from Stage 9
 * Output: context.response (final ToolResponse)
 * Can Early Exit: No (always runs last)
 */
export class ResponseFormattingStage extends BasePipelineStage {
    constructor(responseFormatter, logger) {
        super(logger);
        this.responseFormatter = responseFormatter;
        this.name = 'ResponseFormatting';
    }
    async execute(context) {
        this.logEntry(context);
        if (context.response) {
            this.logExit({ skipped: 'Response already set' });
            return;
        }
        if (!context.executionResults) {
            this.handleError(new Error('Execution results missing before formatting'));
        }
        try {
            const executionType = context.executionPlan?.strategy ?? 'single';
            const sessionContext = context.sessionContext;
            const formatterContext = {
                executionId: `pipeline_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                executionType,
                startTime: Date.now(),
                endTime: Date.now(),
                frameworkEnabled: Boolean(context.frameworkContext),
                success: true,
            };
            const frameworkUsed = context.frameworkContext?.selectedFramework?.name;
            if (frameworkUsed) {
                formatterContext.frameworkUsed = frameworkUsed;
            }
            if (sessionContext?.currentStep !== undefined) {
                formatterContext.stepsExecuted = sessionContext.currentStep;
            }
            if (sessionContext?.sessionId !== undefined) {
                formatterContext.sessionId = sessionContext.sessionId;
            }
            const chainId = sessionContext?.chainId ?? context.parsedCommand?.chainId;
            if (chainId !== undefined) {
                formatterContext.chainId = chainId;
            }
            if (sessionContext?.currentStep !== undefined && sessionContext.totalSteps !== undefined) {
                formatterContext.chainProgress = {
                    currentStep: sessionContext.currentStep,
                    totalSteps: sessionContext.totalSteps,
                    status: sessionContext.totalSteps > 0 && sessionContext.currentStep >= sessionContext.totalSteps
                        ? 'complete'
                        : 'in_progress',
                };
            }
            // Use variant-specific formatting logic
            let responseContent;
            if (isChainFormattingContext(formatterContext) && context.sessionContext) {
                responseContent = this.formatChainResponse(context, formatterContext);
            }
            else if (isSinglePromptFormattingContext(formatterContext)) {
                responseContent = this.formatSinglePromptResponse(context, formatterContext);
            }
            else {
                // Fallback for unknown execution types
                responseContent = this.formatSinglePromptResponse(context, formatterContext);
            }
            // Format with ResponseFormatter (adds structured metadata)
            const response = this.responseFormatter.formatPromptEngineResponse(responseContent, formatterContext, {
                includeStructuredContent: false, // Keep model input lean; clients can opt-in when needed
            });
            context.setResponse(response);
            // Record diagnostic for response formatting
            context.diagnostics.info(this.name, 'Response formatted', {
                executionType,
                hasGateInstructions: Boolean(context.gateInstructions),
                hasSession: Boolean(sessionContext),
                chainId: sessionContext?.chainId,
                contentLength: responseContent.length,
            });
            this.logExit({
                formatted: true,
                executionType,
            });
        }
        catch (error) {
            this.handleError(error, 'Response formatting failed');
        }
    }
    /**
     * Formats response for chain execution with session tracking
     */
    formatChainResponse(context, formatterContext) {
        const sections = [];
        const gateGuidanceEnabled = this.shouldInjectGateGuidance(context);
        // Add base content
        const baseContent = typeof context.executionResults.content === 'string'
            ? context.executionResults.content
            : JSON.stringify(context.executionResults.content, null, 2);
        sections.push(baseContent);
        // Add script tool confirmation request if pending
        const confirmationRequired = context.state.scripts?.confirmationRequired;
        if (confirmationRequired) {
            sections.push(this.formatConfirmationRequest(confirmationRequired));
        }
        // Add script validation errors if present (blocks auto-execute)
        const validationErrors = context.state.scripts?.validationErrors;
        if (validationErrors && validationErrors.length > 0) {
            sections.push(this.formatValidationErrors(validationErrors));
        }
        // Add gate instructions for chain execution
        if (gateGuidanceEnabled && context.gateInstructions) {
            sections.push(context.gateInstructions);
        }
        // Add advisory warnings from non-blocking gate failures
        const advisoryWarnings = context.state.gates.advisoryWarnings;
        if (advisoryWarnings && advisoryWarnings.length > 0) {
            sections.push('\n---\n**Advisory Gate Warnings:**');
            advisoryWarnings.forEach((warning) => sections.push(`- ${warning}`));
        }
        // Add chain-specific footer with session tracking
        const footer = this.buildChainFooter(context, formatterContext);
        if (footer) {
            sections.push(footer);
        }
        return sections.join('\n\n');
    }
    /**
     * Formats response for single prompt execution
     */
    formatSinglePromptResponse(context, _formatterContext) {
        const sections = [];
        const gateGuidanceEnabled = this.shouldInjectGateGuidance(context);
        // Add base content
        const baseContent = typeof context.executionResults.content === 'string'
            ? context.executionResults.content
            : JSON.stringify(context.executionResults.content, null, 2);
        sections.push(baseContent);
        // Add script tool confirmation request if pending
        const confirmationRequired = context.state.scripts?.confirmationRequired;
        if (confirmationRequired) {
            sections.push(this.formatConfirmationRequest(confirmationRequired));
        }
        // Add script validation errors if present (blocks auto-execute)
        const validationErrors = context.state.scripts?.validationErrors;
        if (validationErrors && validationErrors.length > 0) {
            sections.push(this.formatValidationErrors(validationErrors));
        }
        // Add gate instructions if present (for inline gates via ::)
        if (gateGuidanceEnabled && context.gateInstructions) {
            sections.push(context.gateInstructions);
        }
        // Add advisory warnings from non-blocking gate failures
        const advisoryWarnings = context.state.gates.advisoryWarnings;
        if (advisoryWarnings && advisoryWarnings.length > 0) {
            sections.push('\n---\n**Advisory Gate Warnings:**');
            advisoryWarnings.forEach((warning) => sections.push(`- ${warning}`));
        }
        return sections.join('\n\n');
    }
    /**
     * Formats script tool confirmation request for user approval.
     * Shows matched parameters so users can verify what will be executed.
     */
    formatConfirmationRequest(confirmation) {
        if (!confirmation)
            return '';
        const sections = [];
        for (const tool of confirmation.tools) {
            const lines = [`⚠️ **Tool Confirmation**: \`${tool.toolId}\``];
            // Show the confirmation message from tool.yaml
            if (tool.message) {
                lines.push(`> ${tool.message}`);
            }
            // Show detected parameters for transparency
            if (tool.matchedParams && tool.matchedParams.length > 0) {
                lines.push(`**Detected parameters:** ${tool.matchedParams.join(', ')}`);
            }
            // Show a summary of extracted values (concise format)
            if (tool.extractedInputs && Object.keys(tool.extractedInputs).length > 0) {
                const summary = this.formatExtractedInputsSummary(tool.extractedInputs);
                lines.push(`**Values:** ${summary}`);
            }
            lines.push(`→ To proceed: \`${tool.resumeCommand}\``);
            sections.push(lines.join('\n'));
        }
        return sections.join('\n\n');
    }
    /**
     * Formats validation errors from script tool validation.
     * Displayed when autoApproveOnValid validation fails.
     */
    formatValidationErrors(errors) {
        const lines = [
            '\n---',
            '## ❌ Validation Failed',
            '',
            'The following validation errors prevented auto-execution:',
            '',
        ];
        for (const error of errors) {
            lines.push(`- ${error}`);
        }
        lines.push('');
        lines.push('**Fix the issues above** and try again with updated parameters.');
        return lines.join('\n');
    }
    /**
     * Formats extracted inputs as a concise summary for confirmation display.
     * Truncates long values and arrays for readability.
     */
    formatExtractedInputsSummary(inputs) {
        const parts = [];
        for (const [key, value] of Object.entries(inputs)) {
            if (value === undefined || value === null)
                continue;
            let display;
            if (Array.isArray(value)) {
                display = `[${value.length} items]`;
            }
            else if (typeof value === 'object') {
                const keys = Object.keys(value);
                display = `{${keys.length} fields}`;
            }
            else if (typeof value === 'string' && value.length > 30) {
                display = `"${value.substring(0, 27)}..."`;
            }
            else {
                display = JSON.stringify(value);
            }
            parts.push(`${key}=${display}`);
        }
        return parts.join(', ') || '(none)';
    }
    /**
     * Whether gate guidance injection is enabled for the current execution.
     * Defaults to true when no decision exists.
     */
    shouldInjectGateGuidance(context) {
        return context.state.injection?.gateGuidance?.inject !== false;
    }
    /**
     * Builds footer for chain execution with session and progress tracking
     */
    buildChainFooter(context, formatterContext) {
        const lines = [];
        const sessionContext = context.sessionContext;
        const chainIdentifier = sessionContext.chainId ?? sessionContext.sessionId;
        lines.push(`Chain: ${chainIdentifier}`);
        // Chain progress
        if (sessionContext.currentStep && sessionContext.totalSteps) {
            const normalizedStep = Math.min(sessionContext.currentStep, sessionContext.totalSteps);
            const progress = `${normalizedStep}/${sessionContext.totalSteps}`;
            const isComplete = sessionContext.currentStep >= sessionContext.totalSteps;
            lines.push(isComplete ? `✓ Chain complete (${progress})` : `→ Progress ${progress}`);
        }
        const hasPendingReview = context.hasPendingReview();
        if (hasPendingReview) {
            lines.push(`Next: chain_id="${chainIdentifier}", gate_verdict="GATE_REVIEW: PASS|FAIL - <why>"`);
        }
        else if (sessionContext.currentStep && sessionContext.totalSteps) {
            const isComplete = sessionContext.currentStep >= sessionContext.totalSteps;
            if (isComplete) {
                lines.push('Next: Chain complete. No user_response needed.');
            }
            else {
                lines.push(`Next: chain_id="${chainIdentifier}", user_response="<your step output>"`);
            }
        }
        return lines.join('\n');
    }
    /**
     * Builds footer with session and execution metadata (legacy method for compatibility)
     * Shows only essential information needed to continue execution
     */
    buildFooter(context, formatterContext) {
        const lines = [];
        // Use type-safe access for session-related properties
        if (context.sessionContext) {
            const sessionContext = context.sessionContext;
            // Session ID (for chain/gate executions - needed to resume)
            lines.push(`Session: ${sessionContext.sessionId}`);
            // Chain ID (if different from session ID)
            if (sessionContext.chainId && sessionContext.chainId !== sessionContext.sessionId) {
                lines.push(`Chain: ${sessionContext.chainId}`);
            }
            // Chain progress
            if (sessionContext.currentStep && sessionContext.totalSteps) {
                const normalizedStep = Math.min(sessionContext.currentStep, sessionContext.totalSteps);
                const progress = `${normalizedStep}/${sessionContext.totalSteps}`;
                const isComplete = sessionContext.currentStep >= sessionContext.totalSteps;
                lines.push(isComplete ? `✓ Chain complete (${progress})` : `→ Continue with next step (${progress})`);
            }
        }
        // Return empty string if no footer content (simple prompts)
        return lines.length > 0 ? lines.join('\n') : '';
    }
}
//# sourceMappingURL=10-formatting-stage.js.map