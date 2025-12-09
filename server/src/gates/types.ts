// @lifecycle canonical - Top-level gate type definitions.
/**
 * Gate System Type Definitions
 *
 * Consolidated types for the gate validation system, including lightweight gates,
 * enhanced validation, and gate orchestration. Combines types from multiple gate
 * system implementations into a unified type system.
 *
 * Registry-based gate guide types are exported from ./types/ subfolder.
 */

// Import unified validation types from execution domain (not re-exported to avoid conflicts)
import type { ValidationResult, ValidationCheck } from '../execution/types.js';

export type { ValidationCheck } from '../execution/types.js';

// ============================================================================
// Registry-Based Gate Guide Types (Phase 1: Foundation)
// ============================================================================

// Re-export all gate guide types from the types/ subfolder
export type {
  // Core interface
  IGateGuide,
  GateActivationRules,
  GateActivationContext,
  GateDefinitionYaml,
  GateRetryConfig,
  GateValidationResult,
  // Registry types
  GateSource,
  GateGuideEntry,
  GateRegistryStats,
  // Selection types
  GateSelectionContext,
  GateSelectionResult,
} from './types/index.js';

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
  /** Gate type: 'validation' runs checks, 'guidance' only provides instructional text */
  type: 'validation' | 'guidance';
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
  type: 'content_check' | 'llm_self_check' | 'pattern_check' | 'methodology_compliance';

  // Content check options
  min_length?: number;
  max_length?: number;
  required_patterns?: string[];
  forbidden_patterns?: string[];

  // Methodology compliance options
  methodology?: string;
  min_compliance_score?: number;
  severity?: 'warn' | 'fail';
  quality_indicators?: Record<
    string,
    {
      keywords?: string[];
      patterns?: string[];
    }
  >;

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
  /** Severity level for prioritization (defaults to 'medium') */
  severity?: 'critical' | 'high' | 'medium' | 'low';
  /** Enforcement mode override (defaults to severity-based mapping) */
  enforcementMode?: 'blocking' | 'advisory' | 'informational';
  /** Path to external guidance file (relative to gate directory, e.g., 'guidance.md') */
  guidanceFile?: string;
  /** Guidance text injected into prompts (loaded from guidanceFile if specified) */
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
  /**
   * Gate type classification for dynamic identification.
   * 'framework' gates are methodology-related and can be filtered when frameworks are disabled.
   */
  gate_type?: 'framework' | 'category' | 'custom';
}

/**
 * Unified gate configuration settings.
 * Consolidates all gate-related config (previously split across gates, frameworks, and injection).
 */
export interface GatesConfig {
  /** Enable/disable the gate subsystem entirely */
  enabled: boolean;
  /** Directory containing gate definitions (e.g., 'gates' for server/gates/{id}/) */
  definitionsDirectory: string;
  /** Enable methodology-specific gates (auto-added based on active framework) */
  enableMethodologyGates: boolean;
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
 * - VALIDATION: Runs validation checks against content
 * - GUIDANCE: Only provides instructional text, no validation
 */
export enum GateType {
  VALIDATION = 'validation',
  GUIDANCE = 'guidance',
}

/**
 * Gate enforcement mode determines behavior on validation failure.
 * - blocking: Execution pauses until gate criteria are met (default for critical)
 * - advisory: Logs warning but allows advancement (default for high/medium)
 * - informational: Logs only, no user impact (default for low)
 */
export type GateEnforcementMode = 'blocking' | 'advisory' | 'informational';

/**
 * Gate severity levels for prioritization
 */
export type GateSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Default mapping from severity to enforcement mode
 */
export const SEVERITY_TO_ENFORCEMENT: Record<GateSeverity, GateEnforcementMode> = {
  critical: 'blocking',
  high: 'advisory',
  medium: 'advisory',
  low: 'informational',
};

/**
 * User action choices when retry limit is exceeded
 */
export type GateAction = 'retry' | 'skip' | 'abort';
