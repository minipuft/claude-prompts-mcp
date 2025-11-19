// @lifecycle canonical - Holds runtime execution context data and helpers.
import { McpToolRequestValidator } from '../validation/request-validator.js';
import type { FrameworkExecutionContext } from '../../frameworks/types/index.js';
import type { PendingGateReview } from '../../mcp-tools/prompt-engine/core/types.js';
import type { ConvertedPrompt, ToolResponse, McpToolRequest } from '../../types/index.js';
import type { ChainStepPrompt } from '../operators/chain-operator-executor.js';
import type { CommandParseResult } from '../parsers/unified-command-parser.js';

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
  public metadata: Record<string, unknown> = {};

  /**
   * Creates a new ExecutionContext with validated request data
   *
   * @param mcpRequest - Validated MCP tool request (should be pre-validated)
   */
  constructor(mcpRequest: McpToolRequest) {
    // Ensure immutability and validate command
    const normalizedCommand =
      mcpRequest.command !== undefined
        ? McpToolRequestValidator.validateCommand(mcpRequest.command)
        : undefined;

    this.mcpRequest = Object.freeze({
      ...mcpRequest,
      ...(normalizedCommand ? { command: normalizedCommand } : {}),
    });
  }

  /**
   * Type-safe getter for session ID with validation
   *
   * @returns Session ID if present and valid, undefined otherwise
   */
  getSessionId(): string | undefined {
    const sessionId =
      (this.metadata.resumeSessionId as string | undefined) ?? this.sessionContext?.sessionId;
    if (!sessionId) return undefined;
    return sessionId;
  }

  getRequestedChainId(): string | undefined {
    const chainId =
      this.mcpRequest.chain_id ??
      (this.metadata.resumeChainId as string | undefined) ??
      this.sessionContext?.chainId;
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
   * Check if API validation is enabled
   *
   * @returns True only when api_validation is explicitly true
   */
  hasApiValidation(): boolean {
    return this.mcpRequest.api_validation === true;
  }

  /**
   * Get the execution mode with fallback to 'auto'
   *
   * @returns Execution mode (defaults to 'auto')
   */
  getExecutionMode(): 'auto' | 'prompt' | 'template' | 'chain' {
    return this.mcpRequest.execution_mode ?? 'auto';
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
    return this.metadata['explicitChainResume'] === true;
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

// McpToolRequest interface moved to server/src/types/execution.ts
// Import from centralized types instead

/**
 * Parsed command representation shared between parsing and planning stages.
 */
export interface ParsedCommand extends CommandParseResult {
  commandType?: 'single' | 'chain';
  convertedPrompt?: ConvertedPrompt;
  promptArgs?: Record<string, unknown>;
  inlineGateCriteria?: string[];
  inlineGateIds?: string[];
  chainId?: string;
  steps?: ChainStepPrompt[];
}

/**
 * Execution plan generated by the ExecutionPlanner (Phase ).
 */
export interface ExecutionPlan {
  strategy: ExecutionStrategy;
  gates: string[];
  requiresFramework: boolean;
  requiresSession: boolean;
  apiValidationEnabled?: boolean;
  category?: string;
}

export type ExecutionStrategy = 'prompt' | 'template' | 'chain';

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
}

/**
 * Holds raw execution results before formatting into ToolResponse objects.
 */
export interface ExecutionResults {
  content: unknown;
  metadata?: Record<string, unknown>;
  generatedAt?: number;
}
