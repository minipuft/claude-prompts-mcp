/**
 * Gate System Type Definitions
 *
 * Consolidated types for the gate validation system, including lightweight gates,
 * enhanced validation, and gate orchestration. Combines types from multiple gate
 * system implementations into a unified type system.
 */

// Import unified validation types from execution domain (not re-exported to avoid conflicts)
import type { ValidationResult, ValidationCheck } from '../execution/types.js';
export type { ValidationCheck } from '../execution/types.js';

/**
 * Gate requirement types - comprehensive enumeration
 */
export type GateRequirementType =
  | 'content_length'
  | 'keyword_presence'
  | 'format_validation'
  | 'section_validation'
  | 'custom'
  // Content quality gates
  | 'readability_score'
  | 'grammar_quality'
  | 'tone_analysis'
  // Structure gates
  | 'hierarchy_validation'
  | 'link_validation'
  | 'code_quality'
  | 'structure'
  // Pattern matching gates
  | 'pattern_matching'
  // Completeness gates
  | 'required_fields'
  | 'completeness_score'
  | 'completeness'
  // Chain-specific gates
  | 'step_continuity'
  | 'framework_compliance'
  // Security gates
  | 'security_validation'
  | 'citation_validation'
  | 'security_scan'
  | 'privacy_compliance'
  | 'content_policy'
  // Workflow gates
  | 'dependency_validation'
  | 'context_consistency'
  | 'resource_availability'
  // LLM Quality Gates
  | 'llm_coherence'
  | 'llm_accuracy'
  | 'llm_helpfulness'
  | 'llm_contextual';

/**
 * Gate requirement definition
 */
export interface GateRequirement {
  type: GateRequirementType;
  criteria: any;
  weight?: number;
  required?: boolean;
  // LLM-specific extensions (backward compatible)
  llmCriteria?: {
    qualityDimensions?: ('coherent' | 'accurate' | 'helpful' | 'contextual')[];
    confidenceThreshold?: number;
    evaluationContext?: string;
    targetAudience?: 'general' | 'technical' | 'beginner' | 'expert';
    expectedStyle?: 'formal' | 'casual' | 'technical' | 'conversational';
    factCheckingEnabled?: boolean;
    usefulnessThreshold?: number;
    appropriatenessLevel?: 'strict' | 'standard' | 'relaxed';
  };
}

/**
 * Comprehensive gate definition
 * Consolidates lightweight and enhanced gate definitions
 */
export interface GateDefinition {
  /** Unique identifier for the gate */
  id: string;
  /** Human-readable name */
  name: string;
  /** Gate type */
  type: 'validation' | 'approval' | 'condition' | 'quality' | 'guidance';
  /** Description of what this gate checks/guides */
  description?: string;
  /** Requirements for this gate */
  requirements: GateRequirement[];
  /** Action to take on failure */
  failureAction: 'stop' | 'retry' | 'skip' | 'rollback';
  /** Retry policy configuration */
  retryPolicy?: {
    maxRetries: number;
    retryDelay: number;
  };

  // Lightweight gate extensions
  /** Guidance text injected into prompts */
  guidance?: string;
  /** Pass/fail criteria for validation gates */
  pass_criteria?: GatePassCriteria[];
  /** Retry configuration (lightweight format) */
  retry_config?: {
    max_attempts: number;
    improvement_hints: boolean;
    preserve_context: boolean;
  };
  /** Activation rules - when this gate should be applied */
  activation?: {
    prompt_categories?: string[];
    explicit_request?: boolean;
    framework_context?: string[];
  };
}

/**
 * Pass/fail criteria for validation (lightweight gate format)
 */
export interface GatePassCriteria {
  /** Type of check to perform */
  type: 'content_check' | 'llm_self_check' | 'pattern_check';

  // Content check options
  min_length?: number;
  max_length?: number;
  required_patterns?: string[];
  forbidden_patterns?: string[];

  // LLM self-check options
  prompt_template?: string;
  pass_threshold?: number;

  // Pattern check options
  regex_patterns?: string[];
  keyword_count?: { [keyword: string]: number };
}

// ValidationCheck now imported from execution/types.js - no need to redefine

/**
 * Gate evaluation result
 */
export interface GateEvaluationResult {
  requirementId: string;
  passed: boolean;
  score?: number;
  message?: string;
  details?: any;
}

// ValidationResult now imported from execution/types.js - provides unified validation interface

/**
 * Gate status information
 */
export interface GateStatus {
  gateId: string;
  passed: boolean;
  requirements: GateRequirement[];
  evaluationResults: GateEvaluationResult[];
  timestamp: number;
  retryCount?: number;
}

/**
 * Context for validation
 */
export interface ValidationContext {
  /** Content to validate */
  content: string;
  /** Additional metadata */
  metadata?: Record<string, any>;
  /** Execution context */
  executionContext?: {
    promptId?: string;
    stepId?: string;
    attemptNumber?: number;
    previousAttempts?: string[];
  };
}

/**
 * Gate activation result
 */
export interface GateActivationResult {
  /** Gates that should be active */
  activeGates: LightweightGateDefinition[];
  /** Guidance text to inject */
  guidanceText: string[];
  /** Validation gates to apply */
  validationGates: LightweightGateDefinition[];
}

/**
 * Lightweight gate definition (for backward compatibility)
 */
export interface LightweightGateDefinition {
  /** Unique identifier for the gate */
  id: string;
  /** Human-readable name */
  name: string;
  /** Gate type - validation enforces pass/fail, guidance provides hints */
  type: 'validation' | 'guidance';
  /** Description of what this gate checks/guides */
  description: string;
  /** Guidance text injected into prompts */
  guidance?: string;
  /** Pass/fail criteria for validation gates */
  pass_criteria?: GatePassCriteria[];
  /** Retry configuration */
  retry_config?: {
    max_attempts: number;
    improvement_hints: boolean;
    preserve_context: boolean;
  };
  /** Activation rules - when this gate should be applied */
  activation?: {
    prompt_categories?: string[];
    explicit_request?: boolean;
    framework_context?: string[];
  };
}

/**
 * Gate configuration settings
 */
export interface GatesConfig {
  /** Whether gates are enabled */
  enabled: boolean;
  /** Directory containing gate definitions */
  definitionsDirectory: string;
  /** Directory containing LLM validation templates */
  templatesDirectory: string;
  /** Default retry limit for failed validations */
  defaultRetryLimit: number;
  /** Whether to inject gate guidance into prompts */
  enableGuidanceInjection: boolean;
  /** Whether to perform gate validation */
  enableValidation: boolean;
}

/**
 * Step result with gate information
 */
export interface StepResult {
  content: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  timestamp: number;
  validationResults?: ValidationResult[];
  gateResults?: GateStatus[];
  metadata?: Record<string, string | number | boolean | null>;
}

/**
 * Gate type enumeration
 */
export enum GateType {
  VALIDATION = "validation",
  APPROVAL = "approval",
  CONDITION = "condition",
  QUALITY = "quality",
  GUIDANCE = "guidance"
}