// @lifecycle canonical - Holds runtime execution context data and helpers.
import { noopLogger } from '../../logging/index.js';
import { FrameworkDecisionAuthority } from '../pipeline/decisions/index.js';
import { DiagnosticAccumulator } from '../pipeline/state/accumulators/diagnostic-accumulator.js';
import { GateAccumulator } from '../pipeline/state/accumulators/gate-accumulator.js';
import { McpToolRequestValidator } from '../validation/request-validator.js';

import type {
  NamedInlineGate,
  ParsedCommand,
  SessionContext,
  ExecutionResults,
} from './context-types.js';
import type { InitializedScriptState, PipelineInternalState } from './internal-state.js';
import type { FrameworkExecutionContext } from '../../frameworks/types/index.js';
import type { Logger } from '../../logging/index.js';
import type { ConvertedPrompt, ToolResponse, McpToolRequest } from '../../types/index.js';
import type { ChainStepPrompt } from '../operators/types.js';
import type { GateEnforcementAuthority } from '../pipeline/decisions/index.js';
import type { ExecutionModifiers, ExecutionPlan } from '../types.js';

/**
 * Unified execution context that flows through the new pipeline
 * Replaces the six different "args" objects inside the legacy engine.
 */
export class ExecutionContext {
  /** Immutable MCP request data */
  public readonly mcpRequest: McpToolRequest;
  public parsedCommand?: ParsedCommand;
  public executionPlan?: ExecutionPlan;
  public frameworkContext?: FrameworkExecutionContext;
  public sessionContext?: SessionContext;
  public executionResults?: ExecutionResults;
  public gateInstructions?: string; // Formatted gate footer from GateEnhancementStage
  public response?: ToolResponse;

  /**
   * Centralized gate accumulator for all pipeline stages.
   * Handles automatic deduplication with priority-based conflict resolution.
   * Stages should use this instead of direct array manipulation.
   */
  public readonly gates: GateAccumulator;

  /**
   * Diagnostic accumulator for collecting warnings/errors across stages.
   * Useful for debugging, auditing, and user feedback.
   */
  public readonly diagnostics: DiagnosticAccumulator;

  /**
   * Framework decision authority - single source of truth for framework decisions.
   * Caches the decision once made, ensuring consistency across all stages.
   */
  public readonly frameworkAuthority: FrameworkDecisionAuthority;

  /**
   * Gate enforcement authority - single source of truth for gate enforcement decisions.
   * Handles verdict parsing, enforcement mode resolution, retry tracking, and gate actions.
   * Initialized by DependencyInjectionStage (requires ChainSessionService).
   */
  public gateEnforcement?: GateEnforcementAuthority;

  /**
   * Typed internal state for pipeline coordination.
   * Replaces ad-hoc metadata for structured properties.
   */
  public readonly state: PipelineInternalState;

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
  public metadata: Record<string, unknown> = {};

  /**
   * Creates a new ExecutionContext with validated request data
   *
   * @param mcpRequest - Validated MCP tool request (should be pre-validated)
   * @param logger - Optional logger instance (defaults to no-op logger for tests)
   */
  constructor(mcpRequest: McpToolRequest, logger: Logger = noopLogger) {
    // Ensure immutability and validate command
    const normalizedCommand =
      mcpRequest.command !== undefined
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
        advisoryWarnings: [],
      },
    };
  }

  /**
   * Type-safe getter for session ID with validation
   *
   * @returns Session ID if present and valid, undefined otherwise
   */
  getSessionId(): string | undefined {
    const sessionId = this.state.session.resumeSessionId ?? this.sessionContext?.sessionId;
    if (!sessionId) return undefined;
    return sessionId;
  }

  getRequestedChainId(): string | undefined {
    const chainId =
      this.mcpRequest.chain_id ?? this.state.session.resumeChainId ?? this.sessionContext?.chainId;
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
  getGateVerdict(): string | undefined {
    const verdict = this.mcpRequest.gate_verdict?.trim();
    return verdict && verdict.length > 0 ? verdict : undefined;
  }

  /**
   * Determines whether this execution should be treated as a chain.
   * Uses session hints first, then parsed command metadata.
   */
  isChainExecution(): boolean {
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
  getExecutionModifiers(): ExecutionModifiers | undefined {
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
  getPromptArgs(): Record<string, unknown> {
    return this.parsedCommand?.promptArgs ?? {};
  }

  /**
   * Helper that indicates whether a pending review is attached to the session.
   */
  hasPendingReview(): boolean {
    return Boolean(this.sessionContext?.pendingReview);
  }

  hasExplicitChainId(): boolean {
    if (typeof this.mcpRequest.chain_id === 'string' && this.mcpRequest.chain_id.length > 0) {
      return true;
    }
    return this.state.session.isExplicitChainResume === true;
  }

  /**
   * Determines if the request is response-only (session + user_response, no command)
   */
  isResponseOnlyMode(): boolean {
    const hasCommand =
      typeof this.mcpRequest.command === 'string' && this.mcpRequest.command.length > 0;
    const response = this.mcpRequest.user_response?.trim();
    const hasResumeToken = Boolean(this.mcpRequest.chain_id);
    return !hasCommand && hasResumeToken;
  }

  /**
   * Sets a normalized ToolResponse and marks the pipeline as completed.
   */
  setResponse(response: ToolResponse): void {
    this.response = response;
  }

  /**
   * Returns parsedCommand with runtime validation.
   * Throws if called before CommandParsingStage completes.
   */
  requireParsedCommand(): ParsedCommand {
    if (!this.parsedCommand) {
      throw new Error('ParsedCommand not available - CommandParsingStage not executed');
    }
    return this.parsedCommand;
  }

  /**
   * Ensures script state is initialized and returns a typed reference.
   * Guarantees results and autoExecuteResults Maps exist.
   * Use this instead of `context.state.scripts ??= {}` to centralize initialization.
   */
  ensureScriptState(): InitializedScriptState {
    if (!this.state.scripts) {
      this.state.scripts = {
        results: new Map(),
        autoExecuteResults: new Map(),
      };
    }
    // Type assertion is safe because we guarantee both maps are initialized
    return this.state.scripts as InitializedScriptState;
  }

  /**
   * Returns executionPlan with runtime validation.
   * Throws if called before ExecutionPlanningStage completes.
   */
  requireExecutionPlan(): ExecutionPlan {
    if (!this.executionPlan) {
      throw new Error('ExecutionPlan not available - ExecutionPlanningStage not executed');
    }
    return this.executionPlan;
  }

  /**
   * Returns sessionContext with runtime validation.
   * Throws if called for non-chain execution or before SessionManagementStage.
   */
  requireSessionContext(): SessionContext {
    if (!this.sessionContext) {
      throw new Error('SessionContext not available - required for chain execution');
    }
    return this.sessionContext;
  }

  /**
   * Returns convertedPrompt from parsedCommand with validation.
   * Throws if not available (indicates single prompt execution without resolved prompt).
   */
  requireConvertedPrompt(): ConvertedPrompt {
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
  requireChainSteps(): ChainStepPrompt[] {
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
  hasChainCommand(): this is ExecutionContext & {
    parsedCommand: ParsedCommand & { commandType: 'chain'; steps: ChainStepPrompt[] };
  } {
    return this.parsedCommand?.commandType === 'chain' && Array.isArray(this.parsedCommand.steps);
  }

  /**
   * Type guard that narrows to single prompt execution context.
   * Provides compile-time type safety for single prompt properties.
   */
  hasSinglePromptCommand(): this is ExecutionContext & {
    parsedCommand: ParsedCommand & { commandType: 'single'; convertedPrompt: ConvertedPrompt };
  } {
    return (
      this.parsedCommand?.commandType === 'single' &&
      this.parsedCommand.convertedPrompt !== undefined
    );
  }

  /**
   * Type guard for checking if symbolic operators are present.
   * Useful for conditional execution logic based on operator presence.
   */
  hasSymbolicOperators(): this is ExecutionContext & {
    parsedCommand: ParsedCommand & { format: 'symbolic' };
  } {
    return this.parsedCommand?.format === 'symbolic';
  }
}

// ExecutionPlan and ExecutionStrategyType are imported from ../types.js
