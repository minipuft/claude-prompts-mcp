// @lifecycle canonical - Type definitions for methodology system.
/**
 * Methodology Definition Types
 *
 * Shared type definitions used by the runtime YAML loader.
 * This file provides the canonical type definitions for methodology configurations
 * loaded from YAML source files (runtime only).
 *
 * Usage:
 * - Import types from this file for type-safe methodology handling
 * - RuntimeMethodologyLoader loads these types from YAML
 */

import type {
  FrameworkMethodology,
  FrameworkType,
  JudgePromptDefinition,
  FrameworkToolDescriptions,
} from '../types/methodology-types.js';
import type { PhaseQualityIndicators } from '../utils/compliance-validator.js';
import type { PhasesDefinition } from '../utils/step-generator.js';

/**
 * Complete methodology definition loaded from YAML source
 *
 * This is the main interface for methodology configurations. Each methodology
 * (built-in or custom) provides a definition file that conforms to this interface.
 * Use FrameworkManager.listFrameworks() to see registered frameworks.
 */
export interface FrameworkResourceDefinition {
  /** Unique identifier (e.g., 'cageerf', 'react', '5w1h', 'scamper') */
  id: string;
  /** Human-readable name */
  name: string;
  /** Framework type discriminator. Required — the legacy `methodology:` field was removed. */
  type: FrameworkType;
  /** Version string */
  version: string;
  /** Whether this methodology is enabled */
  enabled: boolean;
  /** System prompt guidance injected when methodology is active */
  systemPromptGuidance: string;
  /** Gate configuration - include/exclude specific gates */
  gates?: {
    include?: string[];
    exclude?: string[];
  };
  /** Methodology-specific quality gates */
  methodologyGates?: FrameworkGateDefinition[];
  /** Suggestions for template improvements */
  templateSuggestions?: TemplateSuggestionDefinition[];
  /** Required/optional sections for methodology */
  frameworkElements?: FrameworkElementsDefinition;
  /** Suggested arguments for prompts using this methodology */
  argumentSuggestions?: ArgumentSuggestionDefinition[];
  /** Custom tool descriptions when methodology is active */
  toolDescriptions?: FrameworkToolDescriptions;
  /** Execution phases and quality indicators */
  phases?: PhasesDefinition & {
    qualityIndicators?: PhaseQualityIndicators;
  };
  /** Judge prompt for resource selection */
  judgePrompt?: JudgePromptDefinition;
}

/**
 * Methodology gate definition
 *
 * Defines a quality gate specific to a methodology. These gates are
 * automatically applied when the methodology is active.
 */
export interface FrameworkGateDefinition {
  /** Unique gate identifier */
  id: string;
  /** Human-readable gate name */
  name: string;
  /** Description of what this gate validates */
  description: string;
  /** Which methodology area this gate applies to */
  frameworkArea: string;
  /** Gate priority level */
  priority: 'high' | 'medium' | 'low';
  /** Criteria for passing this gate */
  validationCriteria: string[];
}

/**
 * Template suggestion definition
 *
 * Provides methodology-specific suggestions for improving templates.
 * These suggestions help prompt authors align with methodology best practices.
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
  /** Why this change aligns with methodology */
  frameworkJustification: string;
  /** Impact level of implementing this suggestion */
  impact: 'high' | 'medium' | 'low';
}

/**
 * Methodology elements definition
 *
 * Defines the structural requirements for prompts using this methodology.
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
 * Suggests arguments that prompts should include when using this methodology.
 */
export interface ArgumentSuggestionDefinition {
  /** Argument name */
  name: string;
  /** Argument type (string, number, boolean, etc.) */
  type: string;
  /** Description of the argument */
  description: string;
  /** Why this argument is important for the methodology */
  frameworkReason: string;
  /** Example values */
  examples: string[];
}
