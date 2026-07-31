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

import type { ValidationResult } from '../execution/types.js';
import type { JudgeEvaluationConfig } from './judge/types.js';
import type { GatePassCriteria } from './types/gate-primitives.js';
import type { GateGuide, GateActivationContext, GateRegistryStats } from './types/index.js';

export type { ValidationCheck } from '../execution/types.js';

// ============================================================================
// Registry-Based Gate Guide Types (Phase 1: Foundation)
// ============================================================================

// Re-export all gate guide types from the types/ subfolder
export type {
  // Core interface
  GateGuide,
  GateActivationRules,
  GateActivationContext,
  GateDefinitionYaml,
  GateRetryConfig,
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

// GatePassCriteria canonical definition in ./types/gate-primitives.ts
export type { GatePassCriteria } from './types/gate-primitives.js';

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
   * 'framework' gates are framework-related and can be filtered when frameworks are disabled.
   */
  gate_type?: 'framework' | 'category' | 'custom';

  /**
   * When true, gate failure (FAIL verdict) will suppress the execution response content.
   * Only the gate review instructions will be returned, not the actual output.
   * Useful for critical gates where invalid output should not be exposed to the user.
   * @default false
   */
  blockResponseOnFail?: boolean;

  /**
   * Judge evaluation configuration.
   * When mode is 'judge', gate review is delegated to a context-isolated sub-agent
   * instead of self-review. Loaded from gate.yaml `evaluation` key.
   */
  evaluation?: JudgeEvaluationConfig;
}

/**
 * Unified gate configuration settings.
 * Consolidates all gate-related config.
 */
export interface GatesConfig {
  /** Enable/disable the gate subsystem entirely */
  enabled: boolean;
  /** Directory containing gate definitions (e.g., 'gates' for server/gates/{id}/) */
  definitionsDirectory?: string;
  /** Enable framework-specific gates (auto-added based on active framework) */
  enableMethodologyGates?: boolean;
  /**
   * Execute a prompt's `inline_gate_definitions` instead of only displaying them.
   *
   * **Default `false`, and that default is the migration.** ADR 0001 (d) sequences this over two
   * releases: this release logs a warning for every malformed definition it drops so an operator
   * can see which of their workspace prompts would newly arm a gate; the next release flips this
   * default to `true`. Arming enforcement an author may have written and forgotten is the risk
   * being ramped, and workspaces overlaid via `MCP_WORKSPACE` cannot be inventoried from here.
   *
   * Retirement, per `cleanup-standards.md` — a gate that cannot be retired is a bug:
   * - **Evidence that flips it**: one release in which the warn logs show no unexpected prompts
   *   arming gates.
   * - **Commit that deletes it**: the release N+1 change bakes `true` and removes this field
   *   together with the `executeInlineGateDefinitions === true` branches. A knob parked at its
   *   baked value is a parallel system with a nicer name.
   */
  executeInlineGateDefinitions?: boolean;
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

// Primitive gate types canonical in ./types/gate-primitives.ts
export type { GateEnforcementMode, GateSeverity } from './types/gate-primitives.js';
export { SEVERITY_TO_ENFORCEMENT } from './types/gate-primitives.js';

/**
 * User action choices when retry limit is exceeded
 */
export type GateAction = 'retry' | 'skip' | 'abort';

/**
 * Interface for GateManager consumed by the gate-provider-adapter.
 * Breaks the concrete import cycle: gate-manager → registry → adapter → gate-manager.
 */
export interface IGateManager {
  get(id: string): GateGuide | undefined;
  getActiveGates(gateIds: string[], context: GateActivationContext): GateGuide[];
  list(enabledOnly?: boolean): GateGuide[];
  getStats(): GateRegistryStats;
}
