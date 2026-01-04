// @lifecycle canonical - Holds runtime execution context data and helpers.
import { FrameworkDecisionAuthority } from '../pipeline/decisions/index.js';
import { DiagnosticAccumulator } from '../pipeline/state/accumulators/diagnostic-accumulator.js';
import { GateAccumulator } from '../pipeline/state/accumulators/gate-accumulator.js';
import { McpToolRequestValidator } from '../validation/request-validator.js';
/**
 * No-op logger for tests and cases where logging isn't needed.
 */
const noopLogger = {
    debug: () => { },
    info: () => { },
    warn: () => { },
    error: () => { },
};
/**
 * Unified execution context that flows through the new pipeline
 * Replaces the six different "args" objects inside the legacy engine.
 */
export class ExecutionContext {
    /**
     * Creates a new ExecutionContext with validated request data
     *
     * @param mcpRequest - Validated MCP tool request (should be pre-validated)
     * @param logger - Optional logger instance (defaults to no-op logger for tests)
     */
    constructor(mcpRequest, logger = noopLogger) {
        /**
         * Legacy metadata bag - INFRASTRUCTURE USE ONLY.
         *
         * @deprecated Pipeline coordination properties have moved to `state`.
         * Only infrastructure keys remain here:
         * - `pipelineDependencies` - Runtime dependency injection
         * - `executionOptions` - Request-level options passed through
         *
         * For typed state access, use:
         * - `state.lifecycle` - Execution timing and cleanup handlers
         * - `state.injection` - System prompt/gate/style injection control
         * - `state.framework` - Framework selection and guidance results
         * - `state.session` - Chain session and lifecycle decisions
         * - `state.gates` - Gate enforcement and validation state
         */
        this.metadata = {};
        // Ensure immutability and validate command
        const normalizedCommand = mcpRequest.command !== undefined
            ? McpToolRequestValidator.validateCommand(mcpRequest.command)
            : undefined;
        this.mcpRequest = Object.freeze({
            ...mcpRequest,
            ...(normalizedCommand ? { command: normalizedCommand } : {}),
        });
        // Initialize pipeline state accumulators and authorities
        this.gates = new GateAccumulator(logger);
        this.diagnostics = new DiagnosticAccumulator(logger);
        this.frameworkAuthority = new FrameworkDecisionAuthority(logger);
        // Initialize typed state with defaults
        this.state = {
            // Lifecycle state for execution timing and cleanup
            lifecycle: {},
            // Modular injection state - controlled by InjectionControlStage (07b)
            injection: {},
            // Framework state for judge selection and style guidance
            framework: {
                judgePhaseTriggered: false,
                styleEnhancementApplied: false,
                systemPromptApplied: false,
            },
            normalization: {
                completed: false,
                isCanonical: false,
            },
            session: {
                isBlueprintRestored: false,
                isExplicitChainResume: false,
            },
            gates: {
                temporaryGateIds: [],
                methodologyGateIds: [],
                canonicalGateIdsFromTemporary: [],
                registeredInlineGateIds: [],
            },
        };
    }
    /**
     * Type-safe getter for session ID with validation
     *
     * @returns Session ID if present and valid, undefined otherwise
     */
    getSessionId() {
        const sessionId = this.state.session.resumeSessionId ?? this.sessionContext?.sessionId;
        if (!sessionId)
            return undefined;
        return sessionId;
    }
    getRequestedChainId() {
        const chainId = this.mcpRequest.chain_id ?? this.state.session.resumeChainId ?? this.sessionContext?.chainId;
        if (!chainId) {
            return undefined;
        }
        return chainId;
    }
    /**
     * Type-safe getter for gate verdict with trimming
     *
     * @returns Trimmed gate verdict if present, undefined otherwise
     */
    getGateVerdict() {
        const verdict = this.mcpRequest.gate_verdict?.trim();
        return verdict && verdict.length > 0 ? verdict : undefined;
    }
    /**
     * Determines whether this execution should be treated as a chain.
     * Uses session hints first, then parsed command metadata.
     */
    isChainExecution() {
        if (this.mcpRequest.chain_id) {
            return true;
        }
        if (this.parsedCommand?.commandType === 'chain') {
            return true;
        }
        if (this.executionPlan?.strategy === 'chain') {
            return true;
        }
        if (this.sessionContext?.isChainExecution) {
            return true;
        }
        return Boolean(this.parsedCommand?.chainId || this.parsedCommand?.steps?.length);
    }
    /**
     * Returns execution modifiers resolved from parsing or planning.
     */
    getExecutionModifiers() {
        if (this.executionPlan?.modifiers) {
            return this.executionPlan.modifiers;
        }
        if (this.parsedCommand?.modifiers) {
            return this.parsedCommand.modifiers;
        }
        return undefined;
    }
    /**
     * Returns parsed prompt arguments, falling back to an empty object.
     */
    getPromptArgs() {
        return this.parsedCommand?.promptArgs ?? {};
    }
    /**
     * Helper that indicates whether a pending review is attached to the session.
     */
    hasPendingReview() {
        return Boolean(this.sessionContext?.pendingReview);
    }
    hasExplicitChainId() {
        if (typeof this.mcpRequest.chain_id === 'string' && this.mcpRequest.chain_id.length > 0) {
            return true;
        }
        return this.state.session.isExplicitChainResume === true;
    }
    /**
     * Determines if the request is response-only (session + user_response, no command)
     */
    isResponseOnlyMode() {
        const hasCommand = typeof this.mcpRequest.command === 'string' && this.mcpRequest.command.length > 0;
        const response = this.mcpRequest.user_response?.trim();
        const hasResumeToken = Boolean(this.mcpRequest.chain_id);
        return !hasCommand && hasResumeToken;
    }
    /**
     * Sets a normalized ToolResponse and marks the pipeline as completed.
     */
    setResponse(response) {
        this.response = response;
    }
    /**
     * Returns parsedCommand with runtime validation.
     * Throws if called before CommandParsingStage completes.
     */
    requireParsedCommand() {
        if (!this.parsedCommand) {
            throw new Error('ParsedCommand not available - CommandParsingStage not executed');
        }
        return this.parsedCommand;
    }
    /**
     * Returns executionPlan with runtime validation.
     * Throws if called before ExecutionPlanningStage completes.
     */
    requireExecutionPlan() {
        if (!this.executionPlan) {
            throw new Error('ExecutionPlan not available - ExecutionPlanningStage not executed');
        }
        return this.executionPlan;
    }
    /**
     * Returns sessionContext with runtime validation.
     * Throws if called for non-chain execution or before SessionManagementStage.
     */
    requireSessionContext() {
        if (!this.sessionContext) {
            throw new Error('SessionContext not available - required for chain execution');
        }
        return this.sessionContext;
    }
    /**
     * Returns convertedPrompt from parsedCommand with validation.
     * Throws if not available (indicates single prompt execution without resolved prompt).
     */
    requireConvertedPrompt() {
        const parsedCommand = this.requireParsedCommand();
        if (!parsedCommand.convertedPrompt) {
            throw new Error('ConvertedPrompt not available - single prompt not resolved');
        }
        return parsedCommand.convertedPrompt;
    }
    /**
     * Returns chain steps from parsedCommand with validation.
     * Throws if not available (indicates chain command without resolved steps).
     */
    requireChainSteps() {
        const parsedCommand = this.requireParsedCommand();
        if (!parsedCommand.steps) {
            throw new Error('Chain steps not available - chain command not parsed');
        }
        return parsedCommand.steps;
    }
    /**
     * Type guard that narrows to chain execution context.
     * Provides compile-time type safety for chain-specific properties.
     */
    hasChainCommand() {
        return this.parsedCommand?.commandType === 'chain' && Array.isArray(this.parsedCommand.steps);
    }
    /**
     * Type guard that narrows to single prompt execution context.
     * Provides compile-time type safety for single prompt properties.
     */
    hasSinglePromptCommand() {
        return (this.parsedCommand?.commandType === 'single' &&
            this.parsedCommand.convertedPrompt !== undefined);
    }
    /**
     * Type guard for checking if symbolic operators are present.
     * Useful for conditional execution logic based on operator presence.
     */
    hasSymbolicOperators() {
        return this.parsedCommand?.format === 'symbolic';
    }
}
//# sourceMappingURL=execution-context.js.map