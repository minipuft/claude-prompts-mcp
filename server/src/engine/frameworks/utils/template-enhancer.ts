// @lifecycle canonical - Data-driven template enhancement utilities.
/**
 * Template Enhancer
 *
 * Generic utility for applying framework-driven template enhancements.
 * Works with template suggestions and framework elements from YAML/JSON
 * definitions without requiring framework-specific TypeScript code.
 */

import type { ProcessingStepDefinition } from './step-generator.js';
import type {
  FrameworkGateDefinition as CanonicalGateDefinition,
  TemplateSuggestionDefinition,
} from '../definitions/framework-definition-types.js';
import type {
  FrameworkEnhancement,
  TemplateEnhancement,
  QualityGate,
  ProcessingStep,
} from '../types/framework-types.js';

// Re-export canonical types with local aliases for backwards compatibility
export type FrameworkGateDefinition = CanonicalGateDefinition;
export type TemplateSuggestion = TemplateSuggestionDefinition;

// Re-export for consumers that import from this module
export type { ProcessingStepDefinition } from './step-generator.js';

/**
 * Framework definition subset for enhancement
 */
export interface FrameworkDefinitionForEnhancement {
  id: string;
  /** Framework type discriminator (e.g. 'CAGEERF', 'ReACT') */
  type: string;
  systemPromptGuidance: string;
  templateSuggestions?: TemplateSuggestion[];
  frameworkGates?: FrameworkGateDefinition[];
  phases?: {
    processingSteps?: ProcessingStepDefinition[];
  };
}

/**
 * Converts framework template suggestions to TemplateEnhancement format
 * @param suggestions - Template suggestions from framework YAML
 * @returns Array of TemplateEnhancement objects
 */
export function convertTemplateSuggestions(
  suggestions: TemplateSuggestion[]
): TemplateEnhancement[] {
  return suggestions.map((suggestion) => ({
    section: suggestion.section,
    type: suggestion.type,
    description: suggestion.description,
    content: suggestion.content,
    frameworkJustification: suggestion.frameworkJustification,
    impact: suggestion.impact,
  }));
}

/**
 * Converts framework gate definitions to QualityGate format
 * @param gates - Gate definitions from framework YAML
 * @returns Array of QualityGate objects
 */
export function convertFrameworkGates(gates: FrameworkGateDefinition[]): QualityGate[] {
  return gates.map((gate) => ({
    id: gate.id,
    name: gate.name,
    description: gate.description,
    frameworkArea: gate.frameworkArea,
    validationCriteria: gate.validationCriteria,
    priority: gate.priority,
  }));
}

/**
 * Converts processing step definitions to ProcessingStep format
 * @param steps - Processing step definitions from framework YAML
 * @returns Array of ProcessingStep objects
 */
export function convertProcessingSteps(steps: ProcessingStepDefinition[]): ProcessingStep[] {
  return steps.map((step) => ({
    id: step.id,
    name: step.name,
    description: step.description,
    frameworkBasis: step.frameworkBasis,
    order: step.order,
    required: step.required,
    ...(step.section_header && { section_header: step.section_header }),
    ...(step.guards && { guards: step.guards }),
  }));
}

/**
 * Creates a FrameworkEnhancement from a framework definition
 * @param definition - Framework definition from YAML/JSON
 * @param _context - Execution context (currently unused, for future extensions)
 * @param confidence - Confidence score for the enhancement (default: 0.9)
 * @returns FrameworkEnhancement object
 */
export function createFrameworkEnhancement(
  definition: FrameworkDefinitionForEnhancement,
  _context: Record<string, unknown> = {},
  confidence = 0.9
): FrameworkEnhancement {
  const processingSteps = definition.phases?.processingSteps ?? [];
  const templateSuggestions = definition.templateSuggestions ?? [];
  const frameworkGates = definition.frameworkGates ?? [];

  return {
    systemPromptGuidance: definition.systemPromptGuidance,
    processingEnhancements: convertProcessingSteps(processingSteps),
    methodologyGates: convertFrameworkGates(frameworkGates),
    templateSuggestions: convertTemplateSuggestions(templateSuggestions),
    enhancementMetadata: {
      methodology: definition.type,
      confidence,
      applicabilityReason: `${definition.type} framework provides systematic approach`,
      appliedAt: new Date(),
    },
  };
}

/**
 * Gets system prompt guidance from a framework definition
 * @param definition - Framework definition
 * @param _context - Execution context (for future template interpolation)
 * @returns System prompt guidance string
 */
export function getSystemPromptGuidance(
  definition: { systemPromptGuidance: string },
  _context: Record<string, unknown> = {}
): string {
  return definition.systemPromptGuidance;
}
