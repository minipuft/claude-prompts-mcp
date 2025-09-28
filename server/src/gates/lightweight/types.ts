/**
 * Lightweight Gate System Types
 * Simplified gate system focused on guidance + validation without complex orchestration
 */

/**
 * Basic gate definition loaded from YAML/JSON
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
 * Pass/fail criteria for validation
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

/**
 * Result of gate validation
 */
export interface ValidationResult {
  /** Gate that was validated */
  gateId: string;
  /** Overall pass/fail status */
  passed: boolean;
  /** Individual check results */
  checks: ValidationCheck[];
  /** Hints for improvement on failure */
  retryHints: string[];
  /** Validation metadata */
  metadata: {
    validationTime: number;
    checksPerformed: number;
    llmValidationUsed: boolean;
  };
}

/**
 * Individual validation check result
 */
export interface ValidationCheck {
  /** Type of check performed */
  type: string;
  /** Did this check pass */
  passed: boolean;
  /** Score if applicable (0.0-1.0) */
  score?: number;
  /** Details about the check */
  message: string;
  /** Additional context */
  details?: Record<string, any>;
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