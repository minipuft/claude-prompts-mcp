// @lifecycle canonical - Type definitions for framework system.
/**
 * Framework Definition Types
 *
 * Shared type definitions used by the runtime YAML loader.
 * This file provides the canonical type definitions for framework configurations
 * loaded from YAML source files (runtime only).
 *
 * Usage:
 * - Import types from this file for type-safe framework handling
 * - RuntimeFrameworkLoader loads these types from YAML
 */

import type {
  FrameworkType,
  JudgePromptDefinition,
  FrameworkToolDescriptions,
} from '../types/framework-types.js';
import type { PhaseQualityIndicators } from '../utils/compliance-validator.js';
import type { PhasesDefinition } from '../utils/step-generator.js';

/**
 * Complete framework definition loaded from YAML source
 *
 * This is the main interface for framework configurations. Each framework
 * (built-in or custom) provides a definition file that conforms to this interface.
 * Use FrameworkManager.listFrameworks() to see registered frameworks.
 */
export interface FrameworkResourceDefinition {
  /** Unique identifier (e.g., 'cageerf', 'react', '5w1h', 'scamper') */
  id: string;
  /** Human-readable name */
  name: string;
  /** Framework type discriminator. Required — the legacy `framework:` field was removed. */
  type: FrameworkType;
  /** Version string */
  version: string;
  /** Whether this framework is enabled */
  enabled: boolean;
  /** System prompt guidance injected when framework is active */
  systemPromptGuidance: string;
  /** Gate configuration - include/exclude specific gates */
  gates?: {
    include?: string[];
    exclude?: string[];
  };
  /** Framework-specific quality gates (YAML key: `frameworkGates`) */
  frameworkGates?: FrameworkGateDefinition[];
  /** Suggestions for template improvements */
  templateSuggestions?: TemplateSuggestionDefinition[];
  /** Required/optional sections for framework */
  frameworkElements?: FrameworkElementsDefinition;
  /** Suggested arguments for prompts using this framework */
  argumentSuggestions?: ArgumentSuggestionDefinition[];
  /** Custom tool descriptions when framework is active */
  toolDescriptions?: FrameworkToolDescriptions;
  /** Execution phases and quality indicators */
  phases?: PhasesDefinition & {
    qualityIndicators?: PhaseQualityIndicators;
  };
  /** Judge prompt for resource selection */
  judgePrompt?: JudgePromptDefinition;
}

/**
 * Framework gate definition
 *
 * Defines a quality gate specific to a framework. These gates are
 * automatically applied when the framework is active.
 */
export interface FrameworkGateDefinition {
  /** Unique gate identifier */
  id: string;
  /** Human-readable gate name */
  name: string;
  /** Description of what this gate validates */
  description: string;
  /** Which framework area this gate applies to */
  frameworkArea: string;
  /** Gate priority level */
  priority: 'high' | 'medium' | 'low';
  /** Criteria for passing this gate */
  validationCriteria: string[];
}

/**
 * Template suggestion definition
 *
 * Provides framework-specific suggestions for improving templates.
 * These suggestions help prompt authors align with framework best practices.
 */
export interface TemplateSuggestionDefinition {
  /** Which section of the template to modify */
  section: 'system' | 'user' | 'arguments' | 'metadata';
  /** Type of modification */
  type: 'addition' | 'modification' | 'structure';
  /** Description of the suggestion */
  description: string;
  /** Suggested content */
  content: string;
  /** Why this change aligns with framework */
  frameworkJustification: string;
  /** Impact level of implementing this suggestion */
  impact: 'high' | 'medium' | 'low';
}

/**
 * Framework elements definition
 *
 * Defines the structural requirements for prompts using this framework.
 */
export interface FrameworkElementsDefinition {
  /** Sections that must be present */
  requiredSections: string[];
  /** Sections that are optional but recommended */
  optionalSections: string[];
  /** Descriptions explaining each section's purpose */
  sectionDescriptions: Record<string, string>;
}

/**
 * Argument suggestion definition
 *
 * Suggests arguments that prompts should include when using this framework.
 */
export interface ArgumentSuggestionDefinition {
  /** Argument name */
  name: string;
  /** Argument type (string, number, boolean, etc.) */
  type: string;
  /** Description of the argument */
  description: string;
  /** Why this argument is important for the framework */
  frameworkReason: string;
  /** Example values */
  examples: string[];
}
