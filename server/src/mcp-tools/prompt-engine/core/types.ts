/**
 * Prompt Engine Core Types
 *
 * Contains all interfaces and types used by the prompt engine system,
 * including chain execution, formatting, and classification types.
 */

import { ConvertedPrompt, ToolResponse } from "../../../types/index.js";

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
  formatResponse(content: any): any;
  formatPromptEngineResponse(response: any, ...args: any[]): any;
  formatErrorResponse(error: any, ...args: any[]): any;
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