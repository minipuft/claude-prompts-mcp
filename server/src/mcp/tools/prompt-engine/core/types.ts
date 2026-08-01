// @lifecycle canonical - Type definitions for prompt engine internals.
/**
 * Prompt Engine Core Types
 *
 * Contains interfaces and types used by the prompt engine system,
 * including chain execution, formatting, and classification types.
 *
 * Cross-cutting types (StepMilestone, StepMetadata, ChainState, PendingGateReview,
 * FormatterExecutionContext, GateReviewHistoryEntry) live in shared/types/chain-execution.ts
 * and are re-exported here for backward compatibility within the mcp/ layer.
 */

import type { ToolResponse } from '../../../../shared/types/index.js';
import type { ConvertedPrompt } from '../../../../engine/execution/types.js';
// Re-export cross-cutting types from shared/ (canonical location)
export {
  type StepMetadata,
  type GateReviewHistoryEntry,
  type GateReviewExecutionContext,
  type GateReviewPrompt,
  type PendingGateReview,
  type FormatterExecutionContext,
  type ChainState,
} from '../../../../shared/types/chain-execution.js';

import type { FormatterExecutionContext } from '../../../../shared/types/chain-execution.js';

/**
 * Chain step execution context
 */
export interface ChainExecutionContext {
  promptId: string;
  promptArgs: Record<string, any>;
  convertedPrompt: ConvertedPrompt;
  isChainManagement?: boolean;
  chainAction?: string;
  chainParameters?: Record<string, any>;
  /** Chain-level temporary gate IDs that child steps inherit */
  chainGateIds?: string[];
  /** Chain execution ID for scope tracking */
  chainExecutionId?: string;
  /** Whether this chain execution should inherit gates from parent */
  inheritParentGates?: boolean;
}

/**
 * Chain step arguments building context
 */
export interface StepArgumentsContext {
  stepData: any;
  originalArgs: Record<string, any>;
  contextData: Record<string, any>;
  currentStep: number;
}

/**
 * Chain management command structure
 */
export interface ChainManagementCommand {
  action: string;
  target: string;
  parameters: Record<string, any>;
}

/**
 * Chain gate information
 */
export interface ChainGateInfo {
  status: string;
  gates: Array<{
    name: string;
    location: string;
    criteria: string;
  }>;
}

/**
 * Chain execution options
 */
export interface ChainExecutionOptions {
  enableGates: boolean;
  force_restart?: boolean;
}

/**
 * Simple response formatter interface
 */
export interface SimpleResponseFormatter {
  formatResponse(content: any): ToolResponse;
  formatPromptEngineResponse(
    response: any,
    executionContext?: FormatterExecutionContext,
    options?: Record<string, any>,
    gateResults?: any
  ): ToolResponse;
  formatErrorResponse(
    error: any,
    executionContext?: FormatterExecutionContext,
    options?: Record<string, any>
  ): ToolResponse;
  setAnalyticsService(service: any): void;
}

/**
 * Prompt classification interface for execution strategy
 */
export interface PromptClassification {
  executionType: 'single' | 'chain';
  requiresExecution: boolean;
  confidence: number;
  reasoning: string[];
  suggestedGates: string[];
  framework?: string;
}

/**
 * Chain execution strategy result
 */
export interface ChainExecutionStrategy {
  mode: 'single' | 'chain';
  llmValidation: boolean;
}

/**
 * Chain validation result
 */
export interface ChainValidationResult {
  isValid: boolean;
  issues: string[];
  chainId: string;
  stepCount: number;
}

/**
 * Chain step data structure
 */
export interface ChainStepData {
  promptId: string;
  stepName: string;
  inputMapping?: Record<string, string>;
  outputMapping?: Record<string, string>;
  config?: {
    gates?: string[];
  };
  gates?: string[];
}
