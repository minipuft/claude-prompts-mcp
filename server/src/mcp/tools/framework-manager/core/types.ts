// @lifecycle canonical - Types for framework manager MCP tool.
/**
 * Framework Manager Types
 */

import type { FrameworkManager } from '#engine/frameworks/framework-manager.js';
import type { FrameworkStateStore } from '#engine/frameworks/framework-state-store.js';
import type { ConfigManager, Logger } from '#shared/types/index.js';

/**
 * Framework manager action identifiers
 */
export type FrameworkManagerActionId =
  | 'create'
  | 'update'
  | 'delete'
  | 'list'
  | 'inspect'
  | 'reload'
  | 'switch'
  | 'history'
  | 'rollback'
  | 'compare';

/**
 * Phase definition for framework
 */
export interface PhaseDefinition {
  id: string;
  name: string;
  description: string;
  prompts?: string[];
}

// ============================================================================
// Advanced Framework Types (for CAGEERF-quality frameworks)
// ============================================================================

/**
 * Framework-specific quality gate with validation criteria
 */
export interface FrameworkGate {
  id: string;
  name: string;
  description: string;
  frameworkArea: string;
  priority: 'high' | 'medium' | 'low';
  validationCriteria: string[];
}

/**
 * Processing step used in template processing
 */
export interface ProcessingStep {
  id: string;
  name: string;
  description: string;
  frameworkBasis: string;
  order: number;
  required: boolean;
  /** Header marker for section detection (e.g., "## Context") */
  marker?: string;
  /** Deterministic phase guards evaluated against the section under this marker */
  guards?: Record<string, unknown>;
}

/**
 * Execution step with dependencies and expected output
 */
export interface ExecutionStep {
  id: string;
  name: string;
  action: string;
  frameworkPhase: string;
  dependencies: string[];
  expected_output: string;
}

/**
 * Template suggestion for prompt enhancement
 */
export interface TemplateSuggestion {
  section: 'system' | 'user';
  type: 'addition' | 'structure' | 'modification';
  description: string;
  content: string;
  frameworkJustification: string;
  impact: 'high' | 'medium' | 'low';
}

/**
 * Framework elements for prompt creation guidance
 */
export interface FrameworkElements {
  requiredSections: string[];
  optionalSections?: string[];
  sectionDescriptions: Record<string, string>;
}

/**
 * Argument suggestion for prompt creation
 */
export interface ArgumentSuggestion {
  name: string;
  type: 'string' | 'array' | 'object' | 'boolean' | 'number';
  description: string;
  frameworkReason: string;
  examples: string[];
}

/**
 * Execution type-specific step enhancements
 */
export interface ExecutionTypeEnhancements {
  chain?: {
    advancedChain?: Record<string, string[]>;
    simpleChain?: Record<string, string[]>;
  };
}

/**
 * Template enhancements for processing guidance
 */
export interface TemplateEnhancements {
  systemPromptAdditions?: string[];
  userPromptModifications?: string[];
  contextualHints?: string[];
}

/**
 * Execution flow hooks
 */
export interface ExecutionFlow {
  preProcessingSteps?: string[];
  postProcessingSteps?: string[];
  validationSteps?: string[];
}

/**
 * Quality indicators for compliance validation
 */
export interface QualityIndicatorPhase {
  keywords: string[];
  patterns: string[];
}

export type QualityIndicators = Record<string, QualityIndicatorPhase>;

/**
 * Framework manager input parameters
 */
export interface FrameworkManagerInput {
  action: FrameworkManagerActionId;
  id?: string;
  name?: string;
  framework?: string;
  description?: string;
  system_prompt_guidance?: string;
  phases?: PhaseDefinition[];
  gates?: {
    include?: string[];
    exclude?: string[];
  };
  tool_descriptions?: Record<
    string,
    {
      description?: string;
      parameters?: Record<string, string>;
    }
  >;
  enabled?: boolean;
  enabled_only?: boolean;
  persist?: boolean;
  confirm?: boolean;
  /**
   * Preview a destructive action instead of performing it.
   *
   * Honoured on `rollback` and `delete`. A preview returns before the version row is recorded and
   * before any file is touched, so neither of the two side-effect surfaces moves.
   */
  dry_run?: boolean;
  /** Workspace whose version history to READ. Honoured by `history`/`compare`; the router
   * refuses it on `rollback`. */
  source_workspace?: string;
  reason?: string;

  // Advanced framework fields (not advertised in tool description for token efficiency)
  framework_gates?: FrameworkGate[];
  template_suggestions?: TemplateSuggestion[];
  framework_elements?: FrameworkElements;
  argument_suggestions?: ArgumentSuggestion[];
  judge_prompt?: string;

  // Advanced phases fields
  processing_steps?: ProcessingStep[];
  execution_steps?: ExecutionStep[];
  execution_type_enhancements?: ExecutionTypeEnhancements;
  template_enhancements?: TemplateEnhancements;
  execution_flow?: ExecutionFlow;
  quality_indicators?: QualityIndicators;

  // Versioning fields
  /** Skip automatic version saving for this update */
  skip_version?: boolean;
  /** Optional description for the version entry */
  /** Target version for rollback action */
  version?: number;
  /** Starting version for compare action */
  from_version?: number;
  /** Ending version for compare action */
  to_version?: number;
  /** Maximum number of versions to show in history */
  limit?: number;
}

/**
 * Dependencies for framework manager
 */
export interface FrameworkManagerDependencies {
  logger: Logger;
  frameworkManager: FrameworkManager;
  frameworkStateStore?: FrameworkStateStore;
  configManager: ConfigManager;
  onRefresh?: () => Promise<void>;
  onToolsUpdate?: () => Promise<void>;
}

/**
 * Framework validation result with structured error handling
 */
export interface FrameworkDraftValidationResult {
  /** Whether the framework passes validation (all required fields present) */
  valid: boolean;
  /** Quality level based on field coverage */
  level: 'incomplete' | 'standard' | 'full';
  /** Score from 0-100 based on field coverage */
  score: number;
  /** Blocking errors that prevent creation */
  errors: string[];
  /** Non-blocking recommendations for improvement */
  warnings: string[];
  /** Single focused next action for the user */
  nextStep?: string;
}

/**
 * Framework creation data
 */
export interface FrameworkCreationData {
  id: string;
  name: string;
  /** The framework type discriminator (e.g., 'CAGEERF', 'ReACT') */
  type: string;
  description?: string;
  system_prompt_guidance: string;
  phases?: PhaseDefinition[];
  gates?: {
    include?: string[];
    exclude?: string[];
  };
  tool_descriptions?: FrameworkManagerInput['tool_descriptions'];
  enabled?: boolean;

  // Advanced framework fields (for CAGEERF-quality frameworks)
  framework_gates?: FrameworkGate[];
  template_suggestions?: TemplateSuggestion[];
  framework_elements?: FrameworkElements;
  argument_suggestions?: ArgumentSuggestion[];
  judge_prompt?: string;

  // Advanced phases fields
  processing_steps?: ProcessingStep[];
  execution_steps?: ExecutionStep[];
  execution_type_enhancements?: ExecutionTypeEnhancements;
  template_enhancements?: TemplateEnhancements;
  execution_flow?: ExecutionFlow;
  quality_indicators?: QualityIndicators;
}
