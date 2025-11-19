// @lifecycle canonical - Shared gate core type definitions.
import type { GateReviewPrompt, ValidationResult } from '../../execution/types.js';

/**
 * Review status lifecycle for gate evaluations that require manual/LLM confirmation.
 */
export type ReviewStatus = 'pending' | 'injected' | 'responded' | 'resolved';

/**
 * Context for requesting guidance during step rendering.
 */
export interface StepGuidanceContext {
  sessionId?: string;
  stepNumber?: number;
  gateIds?: string[];
  inlineGuidanceText?: string;
  frameworkContext?: Record<string, any>;
  prompt?: Record<string, any>;
  temporaryGates?: Array<Record<string, any>>;
  executionContext?: {
    scopeId?: string;
    scope?: 'execution' | 'session' | 'chain' | 'step';
  };
}

/**
 * Structured guidance block returned by the orchestrator.
 */
export interface GuidanceBlock {
  markdown: string;
  gateIds: string[];
  hasInlineCriteria: boolean;
  source: 'orchestrator';
}

export interface GuidanceFormatInput {
  markdown: string;
  inlineGuidanceText?: string;
  gateIds: string[];
}

/**
 * Result returned after processing gate evaluations.
 */
export interface GateEvaluationOutcome {
  summary: string;
  structuredContent: Record<string, any>;
  requiresReview: boolean;
  reviewState?: PendingReviewState;
  reviewPayload?: ReviewRenderPayload;
}

/**
 * Internal representation of a scheduled gate review.
 */
export interface PendingReviewState {
  sessionId: string;
  gateIds: string[];
  prompts: GateReviewPrompt[];
  combinedPrompt: string;
  status: ReviewStatus;
  createdAt: number;
  injectedAt?: number;
  respondedAt?: number;
  resolvedAt?: number;
  hasRemainingSteps: boolean;
  metadata?: Record<string, any>;
}

/**
 * Payload returned when rendering a review prompt.
 */
export interface ReviewRenderPayload {
  combinedPrompt: string;
  prompts: GateReviewPrompt[];
  gateIds: string[];
  createdAt: number;
  metadata?: Record<string, any>;
}

/**
 * Result of parsing a review response.
 */
export interface ReviewOutcome {
  decision: 'pass' | 'fail' | 'unknown';
  reasoning: string;
  confidence: number;
  matchType: 'explicit' | 'implicit' | 'unknown';
  rawResponse: string;
  gateIds: string[];
}

/**
 * Options used when processing gate validation results.
 */
export interface GateEvaluationContext {
  sessionId: string;
  gateResults: ValidationResult[];
  hasRemainingSteps: boolean;
}
