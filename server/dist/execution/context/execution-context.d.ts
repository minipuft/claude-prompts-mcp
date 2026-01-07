import { FrameworkDecisionAuthority } from '../pipeline/decisions/index.js';
import { DiagnosticAccumulator } from '../pipeline/state/accumulators/diagnostic-accumulator.js';
import { GateAccumulator } from '../pipeline/state/accumulators/gate-accumulator.js';
import type { PipelineInternalState } from './internal-state.js';
import type { FrameworkExecutionContext } from '../../frameworks/types/index.js';
import type { Logger } from '../../logging/index.js';
import type { PendingGateReview } from '../../mcp-tools/prompt-engine/core/types.js';
import type { ConvertedPrompt, ToolResponse, McpToolRequest } from '../../types/index.js';
import type { ChainStepPrompt } from '../operators/types.js';
import type { CommandParseResult } from '../parsers/command-parser.js';
import type { GateEnforcementAuthority } from '../pipeline/decisions/index.js';
import type { ExecutionModifiers, ExecutionPlan } from '../types.js';
/**
 * Unified execution context that flows through the new pipeline
 * Replaces the six different "args" objects inside the legacy engine.
 */
export declare class ExecutionContext {
    /** Immutable MCP request data */
    readonly mcpRequest: McpToolRequest;
    parsedCommand?: ParsedCommand;
    executionPlan?: ExecutionPlan;
    frameworkContext?: FrameworkExecutionContext;
    sessionContext?: SessionContext;
    executionResults?: ExecutionResults;
    gateInstructions?: string;
    response?: ToolResponse;
    /**
     * Centralized gate accumulator for all pipeline stages.
     * Handles automatic deduplication with priority-based conflict resolution.
     * Stages should use this instead of direct array manipulation.
     */
    readonly gates: GateAccumulator;
    /**
     * Diagnostic accumulator for collecting warnings/errors across stages.
     * Useful for debugging, auditing, and user feedback.
     */
    readonly diagnostics: DiagnosticAccumulator;
    /**
     * Framework decision authority - single source of truth for framework decisions.
     * Caches the decision once made, ensuring consistency across all stages.
     */
    readonly frameworkAuthority: FrameworkDecisionAuthority;
    /**
     * Gate enforcement authority - single source of truth for gate enforcement decisions.
     * Handles verdict parsing, enforcement mode resolution, retry tracking, and gate actions.
     * Initialized by DependencyInjectionStage (requires ChainSessionService).
     */
    gateEnforcement?: GateEnforcementAuthority;
    /**
     * Typed internal state for pipeline coordination.
     * Replaces ad-hoc metadata for structured properties.
     */
    readonly state: PipelineInternalState;
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
    metadata: Record<string, unknown>;
    /**
     * Creates a new ExecutionContext with validated request data
     *
     * @param mcpRequest - Validated MCP tool request (should be pre-validated)
     * @param logger - Optional logger instance (defaults to no-op logger for tests)
     */
    constructor(mcpRequest: McpToolRequest, logger?: Logger);
    /**
     * Type-safe getter for session ID with validation
     *
     * @returns Session ID if present and valid, undefined otherwise
     */
    getSessionId(): string | undefined;
    getRequestedChainId(): string | undefined;
    /**
     * Type-safe getter for gate verdict with trimming
     *
     * @returns Trimmed gate verdict if present, undefined otherwise
     */
    getGateVerdict(): string | undefined;
    /**
     * Determines whether this execution should be treated as a chain.
     * Uses session hints first, then parsed command metadata.
     */
    isChainExecution(): boolean;
    /**
     * Returns execution modifiers resolved from parsing or planning.
     */
    getExecutionModifiers(): ExecutionModifiers | undefined;
    /**
     * Returns parsed prompt arguments, falling back to an empty object.
     */
    getPromptArgs(): Record<string, unknown>;
    /**
     * Helper that indicates whether a pending review is attached to the session.
     */
    hasPendingReview(): boolean;
    hasExplicitChainId(): boolean;
    /**
     * Determines if the request is response-only (session + user_response, no command)
     */
    isResponseOnlyMode(): boolean;
    /**
     * Sets a normalized ToolResponse and marks the pipeline as completed.
     */
    setResponse(response: ToolResponse): void;
    /**
     * Returns parsedCommand with runtime validation.
     * Throws if called before CommandParsingStage completes.
     */
    requireParsedCommand(): ParsedCommand;
    /**
     * Returns executionPlan with runtime validation.
     * Throws if called before ExecutionPlanningStage completes.
     */
    requireExecutionPlan(): ExecutionPlan;
    /**
     * Returns sessionContext with runtime validation.
     * Throws if called for non-chain execution or before SessionManagementStage.
     */
    requireSessionContext(): SessionContext;
    /**
     * Returns convertedPrompt from parsedCommand with validation.
     * Throws if not available (indicates single prompt execution without resolved prompt).
     */
    requireConvertedPrompt(): ConvertedPrompt;
    /**
     * Returns chain steps from parsedCommand with validation.
     * Throws if not available (indicates chain command without resolved steps).
     */
    requireChainSteps(): ChainStepPrompt[];
    /**
     * Type guard that narrows to chain execution context.
     * Provides compile-time type safety for chain-specific properties.
     */
    hasChainCommand(): this is ExecutionContext & {
        parsedCommand: ParsedCommand & {
            commandType: 'chain';
            steps: ChainStepPrompt[];
        };
    };
    /**
     * Type guard that narrows to single prompt execution context.
     * Provides compile-time type safety for single prompt properties.
     */
    hasSinglePromptCommand(): this is ExecutionContext & {
        parsedCommand: ParsedCommand & {
            commandType: 'single';
            convertedPrompt: ConvertedPrompt;
        };
    };
    /**
     * Type guard for checking if symbolic operators are present.
     * Useful for conditional execution logic based on operator presence.
     */
    hasSymbolicOperators(): this is ExecutionContext & {
        parsedCommand: ParsedCommand & {
            format: 'symbolic';
        };
    };
}
/**
 * Named inline gate from symbolic syntax (e.g., `:: security:"no secrets"`)
 * Also supports shell verification gates (e.g., `:: verify:"npm test"`)
 */
export interface NamedInlineGate {
    /** Explicit gate ID from symbolic syntax */
    gateId: string;
    /** Criteria associated with this named gate */
    criteria: string[];
    /** Shell verification config for Ralph Wiggum loops (when using `:: verify:"command"`) */
    shellVerify?: {
        command: string;
        timeout?: number;
        workingDir?: string;
    };
}
/**
 * Parsed command representation shared between parsing and planning stages.
 */
export interface ParsedCommand extends CommandParseResult {
    commandType?: 'single' | 'chain';
    convertedPrompt?: ConvertedPrompt;
    promptArgs?: Record<string, unknown>;
    /** Anonymous inline criteria (merged from `:: "criteria"` without explicit ID) */
    inlineGateCriteria?: string[];
    inlineGateIds?: string[];
    /** Named inline gates with explicit IDs from symbolic syntax (e.g., `:: id:"criteria"`) */
    namedInlineGates?: NamedInlineGate[];
    chainId?: string;
    steps?: ChainStepPrompt[];
    modifiers?: ExecutionModifiers;
    styleSelection?: string;
}
/**
 * Session state propagated through the pipeline.
 */
export interface SessionContext {
    sessionId: string;
    chainId?: string;
    isChainExecution: boolean;
    currentStep?: number;
    totalSteps?: number;
    pendingReview?: PendingGateReview;
    /** Result status from the previous step (for injection condition evaluation) */
    previousStepResult?: 'success' | 'failure' | 'skipped';
    /** Quality score from the previous step (0-100, if gate evaluation provided one) */
    previousStepQualityScore?: number;
}
/**
 * Holds raw execution results before formatting into ToolResponse objects.
 */
export interface ExecutionResults {
    content: unknown;
    metadata?: Record<string, unknown>;
    generatedAt?: number;
}
