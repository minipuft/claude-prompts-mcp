// @lifecycle canonical - Types for framework manager MCP tool.
/**
 * Framework Manager Types
 */

import type { ConfigManager } from '../../../config/index.js';
import type { FrameworkManager } from '../../../frameworks/framework-manager.js';
import type { FrameworkStateManager } from '../../../frameworks/framework-state-manager.js';
import type { Logger } from '../../../logging/index.js';

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
 * Phase definition for methodology
 */
export interface PhaseDefinition {
  id: string;
  name: string;
  description: string;
  prompts?: string[];
}

// ============================================================================
// Advanced Methodology Types (for CAGEERF-quality frameworks)
// ============================================================================

/**
 * Methodology-specific quality gate with validation criteria
 */
export interface MethodologyGate {
  id: string;
  name: string;
  description: string;
  methodologyArea: string;
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
  methodologyBasis: string;
  order: number;
  required: boolean;
}

/**
 * Execution step with dependencies and expected output
 */
export interface ExecutionStep {
  id: string;
  name: string;
  action: string;
  methodologyPhase: string;
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
  methodologyJustification: string;
  impact: 'high' | 'medium' | 'low';
}

/**
 * Methodology elements for prompt creation guidance
 */
export interface MethodologyElements {
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
  methodologyReason: string;
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
  methodology?: string;
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
  reason?: string;

  // Advanced methodology fields (not advertised in tool description for token efficiency)
  methodology_gates?: MethodologyGate[];
  template_suggestions?: TemplateSuggestion[];
  methodology_elements?: MethodologyElements;
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
  version_description?: string;
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
  frameworkStateManager?: FrameworkStateManager;
  configManager: ConfigManager;
  onRefresh?: () => Promise<void>;
  onToolsUpdate?: () => Promise<void>;
}

/**
 * Methodology validation result with structured error handling
 */
export interface MethodologyValidationResult {
  /** Whether the methodology passes validation (all required fields present) */
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
 * Methodology creation data
 */
export interface MethodologyCreationData {
  id: string;
  name: string;
  /** The framework type discriminator (e.g., 'CAGEERF', 'ReACT') */
  type?: string;
  /** @deprecated Use `type` instead. Kept for backward compatibility during migration. */
  methodology: string;
  description?: string;
  system_prompt_guidance: string;
  phases?: PhaseDefinition[];
  gates?: {
    include?: string[];
    exclude?: string[];
  };
  tool_descriptions?: FrameworkManagerInput['tool_descriptions'];
  enabled?: boolean;

  // Advanced methodology fields (for CAGEERF-quality frameworks)
  methodology_gates?: MethodologyGate[];
  template_suggestions?: TemplateSuggestion[];
  methodology_elements?: MethodologyElements;
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
