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
    return context.executionType === 'prompt';
}
/**
 * Type guard for template formatting context
 */
function isTemplateFormattingContext(context) {
    return context.executionType === 'template';
}
/**
 * Stage 7: Response formatting with variant-specific logic
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
            const executionType = context.executionPlan?.strategy ?? 'prompt';
            const formatterContext = {
                executionId: `pipeline_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
                executionType,
                startTime: Date.now(),
                endTime: Date.now(),
                frameworkEnabled: Boolean(context.frameworkContext),
                frameworkUsed: context.frameworkContext?.selectedFramework?.name,
                stepsExecuted: context.sessionContext?.currentStep,
                sessionId: context.sessionContext?.sessionId,
                success: true,
            };
            // Use variant-specific formatting logic
            let responseContent;
            if (isChainFormattingContext(formatterContext) && context.sessionContext) {
                responseContent = this.formatChainResponse(context, formatterContext);
            }
            else if (isTemplateFormattingContext(formatterContext)) {
                responseContent = this.formatTemplateResponse(context, formatterContext);
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
                includeStructuredContent: executionType === 'chain',
            });
            context.setResponse(response);
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
        // Add base content
        const baseContent = typeof context.executionResults.content === 'string'
            ? context.executionResults.content
            : JSON.stringify(context.executionResults.content, null, 2);
        sections.push(baseContent);
        // Add gate instructions for chain execution
        if (context.gateInstructions) {
            sections.push(context.gateInstructions);
        }
        // Add chain-specific footer with session tracking
        const footer = this.buildChainFooter(context, formatterContext);
        if (footer) {
            sections.push('---');
            sections.push(footer);
        }
        return sections.join('\n\n');
    }
    /**
     * Formats response for template execution
     */
    formatTemplateResponse(context, formatterContext) {
        const sections = [];
        // Add base content
        const baseContent = typeof context.executionResults.content === 'string'
            ? context.executionResults.content
            : JSON.stringify(context.executionResults.content, null, 2);
        sections.push(baseContent);
        // Add gate instructions if present
        if (context.gateInstructions) {
            sections.push(context.gateInstructions);
        }
        return sections.join('\n\n');
    }
    /**
     * Formats response for single prompt execution
     */
    formatSinglePromptResponse(context, formatterContext) {
        const sections = [];
        // Add base content
        const baseContent = typeof context.executionResults.content === 'string'
            ? context.executionResults.content
            : JSON.stringify(context.executionResults.content, null, 2);
        sections.push(baseContent);
        // Add gate instructions if present (for inline gates via ::)
        if (context.gateInstructions) {
            sections.push(context.gateInstructions);
        }
        return sections.join('\n\n');
    }
    /**
     * Builds footer for chain execution with session and progress tracking
     */
    buildChainFooter(context, formatterContext) {
        const lines = [];
        const sessionContext = context.sessionContext;
        // Session ID (for chain/gate executions - needed to resume)
        lines.push(`Session: ${sessionContext.sessionId}`);
        // Chain ID (if different from session ID)
        if (sessionContext.chainId &&
            sessionContext.chainId !== sessionContext.sessionId) {
            lines.push(`Chain: ${sessionContext.chainId}`);
        }
        // Chain progress
        if (sessionContext.currentStep && sessionContext.totalSteps) {
            const progress = `${sessionContext.currentStep}/${sessionContext.totalSteps}`;
            const isComplete = sessionContext.currentStep >= sessionContext.totalSteps;
            lines.push(isComplete ? `✓ Chain complete (${progress})` : `→ Continue with next step (${progress})`);
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
            if (sessionContext.chainId &&
                sessionContext.chainId !== sessionContext.sessionId) {
                lines.push(`Chain: ${sessionContext.chainId}`);
            }
            // Chain progress
            if (sessionContext.currentStep && sessionContext.totalSteps) {
                const progress = `${sessionContext.currentStep}/${sessionContext.totalSteps}`;
                const isComplete = sessionContext.currentStep >= sessionContext.totalSteps;
                lines.push(isComplete ? `✓ Chain complete (${progress})` : `→ Continue with next step (${progress})`);
            }
        }
        // Return empty string if no footer content (simple prompts)
        return lines.length > 0 ? lines.join('\n') : '';
    }
}
//# sourceMappingURL=formatting-stage.js.map