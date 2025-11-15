/**
 * Prompt Engine Core Types
 *
 * Contains all interfaces and types used by the prompt engine system,
 * including chain execution, formatting, and classification types.
 */

import { ConvertedPrompt, ToolResponse } from "../../../types/index.js";
import type { TemporaryGateDefinition } from "../../../execution/types.js";

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
  session_id?: string;
  /** Execution-time temporary gates (not persisted to prompt configuration) */
  temporary_gates?: TemporaryGateDefinition[];
  /** Scope for execution-time temporary gates (default: execution) */
  gate_scope?: 'execution' | 'session' | 'chain' | 'step';
  /** Whether to inherit gates from parent chain scope (default: true) */
  inherit_chain_gates?: boolean;
  /** Built-in quality gates to apply (by name) - use system_control to discover */
  quality_gates?: string[];
  /** Custom quality checks (simplified: name + description only) */
  custom_checks?: Array<{ name: string; description: string }>;
  /** Gate validation mode: enforce, advise, or report */
  gate_mode?: 'enforce' | 'advise' | 'report';
}

/**
 * Framework execution context for prompt processing
 */
export interface FormatterExecutionContext {
  executionId: string;
  executionType: "prompt" | "template" | "chain";
  startTime: number;
  endTime: number;
  frameworkUsed?: string;
  frameworkEnabled: boolean;
  success: boolean;
  stepsExecuted?: number;
  sessionId?: string;
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
  executionType: "prompt" | "template" | "chain";
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
  mode: "prompt" | "template" | "chain";
  gateValidation: boolean;
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
 * Chain state information
 */
export interface ChainState {
  currentStep: number;
  totalSteps: number;
  lastUpdated: number;
}
