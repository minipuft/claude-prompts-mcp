import type { FrameworkExecutionContext } from "../../frameworks/types/index.js";
import type { ChainStepPrompt } from "../operators/chain-operator-executor.js";
import type { ConvertedPrompt, ToolResponse } from "../../types/index.js";
import type { McpToolRequest, ExecutionPlan, ExecutionResults, SessionContext } from "./execution-context.js";
/**
 * Discriminated union types for ExecutionContext
 * Phase 2: Type Refinement - Eliminates optional fields through type narrowing
 */
/**
 * Base context with always-present fields (Stage 0)
 * Created immediately upon receiving MCP request
 */
export interface BaseExecutionContext {
    readonly mcpRequest: McpToolRequest;
    readonly metadata: Record<string, unknown>;
}
/**
 * Single prompt command representation
 */
export interface SinglePromptCommand {
    readonly commandType: 'single';
    readonly promptId: string;
    readonly promptData: any;
    readonly convertedPrompt: ConvertedPrompt;
    readonly arguments: Record<string, unknown>;
    readonly argumentValues?: Record<string, unknown>;
    readonly promptArgs?: Record<string, unknown>;
    readonly inlineGateCriteria?: string[];
    readonly inlineGateIds?: string[];
    readonly rawArgs?: string;
    readonly format?: string;
    readonly confidence?: number;
}
/**
 * Chain command representation
 */
export interface ChainCommand {
    readonly commandType: 'chain';
    readonly promptId: string;
    readonly chainId: string;
    readonly steps: ChainStepPrompt[];
    readonly arguments: Record<string, unknown>;
    readonly argumentValues?: Record<string, unknown>;
    readonly promptArgs?: Record<string, unknown>;
    readonly inlineGateCriteria?: string[];
    readonly inlineGateIds?: string[];
    readonly rawArgs?: string;
    readonly format?: string;
    readonly confidence?: number;
}
/**
 * Discriminated union for parsed commands
 */
export type ParsedCommand = SinglePromptCommand | ChainCommand;
/**
 * Context after parsing (Stage 1 complete)
 * CommandParsingStage has populated parsedCommand
 */
export interface ParsedExecutionContext extends BaseExecutionContext {
    readonly parsedCommand: ParsedCommand;
}
/**
 * Context after planning for single prompts (Stage 2 complete)
 * ExecutionPlanningStage has determined strategy
 */
export interface PlannedSinglePromptContext extends ParsedExecutionContext {
    readonly parsedCommand: SinglePromptCommand;
    readonly executionPlan: ExecutionPlan & {
        strategy: 'prompt' | 'template';
    };
}
/**
 * Context after planning for chains (Stage 2 complete)
 * ExecutionPlanningStage has determined chain strategy
 */
export interface PlannedChainContext extends ParsedExecutionContext {
    readonly parsedCommand: ChainCommand;
    readonly executionPlan: ExecutionPlan & {
        strategy: 'chain';
    };
}
/**
 * Full single prompt execution context (Stages 3-7)
 * May have optional framework context, gate instructions, etc.
 */
export interface SinglePromptContext extends PlannedSinglePromptContext {
    frameworkContext?: FrameworkExecutionContext;
    executionResults?: ExecutionResults;
    gateInstructions?: string;
    response?: ToolResponse;
}
/**
 * Full chain execution context (Stages 3-7)
 * Always has sessionContext for chain execution
 */
export interface ChainExecutionContext extends PlannedChainContext {
    readonly sessionContext: SessionContext;
    frameworkContext?: FrameworkExecutionContext;
    executionResults?: ExecutionResults;
    gateInstructions?: string;
    response?: ToolResponse;
}
/**
 * Union type for all execution context variants
 * Enables exhaustive pattern matching and type narrowing
 */
export type ExecutionContextVariant = BaseExecutionContext | ParsedExecutionContext | PlannedSinglePromptContext | PlannedChainContext | SinglePromptContext | ChainExecutionContext;
