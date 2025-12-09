// @lifecycle canonical - Type definitions for prompt engine internals.
/**
 * Prompt Engine Core Types
 *
 * Contains all interfaces and types used by the prompt engine system,
 * including chain execution, formatting, and classification types.
 */

import { ConvertedPrompt, ToolResponse } from '../../../types/index.js';

import type { GateReviewPrompt, TemporaryGateDefinition } from '../../../execution/types.js';

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
 * Framework execution context for prompt processing
 */
export interface FormatterExecutionContext {
  executionId: string;
  executionType: 'single' | 'chain';
  startTime: number;
  endTime: number;
  frameworkUsed?: string;
  frameworkEnabled: boolean;
  success: boolean;
  stepsExecuted?: number;
  /** Public identifier surfaced to MCP clients */
  chainId?: string;
  /** Internal session handle retained for analytics/logging */
  sessionId?: string;
  chainProgress?: {
    currentStep?: number;
    totalSteps?: number;
    status: 'in_progress' | 'complete';
  };
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

/**
 * Chain state information with per-step lifecycle tracking.
 */
export interface ChainState {
  currentStep: number;
  totalSteps: number;
  lastUpdated: number;
  /** Map of step number -> lifecycle metadata */
  stepStates?: Map<number, StepMetadata>;
}

/**
 * Step lifecycle state values used when tracking chain execution progress.
 */
export enum StepState {
  PENDING = 'pending',
  RENDERED = 'rendered',
  RESPONSE_CAPTURED = 'response_captured',
  COMPLETED = 'completed',
}

/**
 * Metadata tracked for each chain step as it transitions through lifecycle states.
 */
export interface StepMetadata {
  state: StepState;
  isPlaceholder: boolean;
  renderedAt?: number;
  respondedAt?: number;
  completedAt?: number;
}

/**
 * History entry captured for each manual gate review attempt.
 */
export interface GateReviewHistoryEntry {
  timestamp: number;
  status: 'pending' | 'pass' | 'fail' | 'retry' | string;
  reasoning?: string;
  reviewer?: string;
}

/**
 * Pending gate review payload stored on the session manager so multi-turn
 * reviews can resume after the user responds through the MCP session.
 *
 * @remarks Infrastructure for pause/resume gate validation. Session manager APIs are
 * implemented (setPendingGateReview, getPendingGateReview) but not yet auto-populated.
 * Will be activated when semantic layer gate enforcement is implemented.
 * @see ChainSessionManager for storage APIs
 */
export interface PendingGateReview {
  combinedPrompt: string;
  gateIds: string[];
  prompts: GateReviewPrompt[];
  createdAt: number;
  attemptCount: number;
  maxAttempts: number;
  retryHints?: string[];
  previousResponse?: string;
  metadata?: Record<string, unknown>;
  history?: GateReviewHistoryEntry[];
}
