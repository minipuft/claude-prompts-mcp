/**
 * Template Enhancer
 *
 * Generic utility for applying methodology-driven template enhancements.
 * Works with template suggestions and methodology elements from YAML/JSON
 * definitions without requiring methodology-specific TypeScript code.
 */
import type { MethodologyGateDefinition as CanonicalGateDefinition, TemplateSuggestionDefinition } from '../methodology/methodology-definition-types.js';
import type { MethodologyEnhancement, TemplateEnhancement, QualityGate, ProcessingStep } from '../types/methodology-types.js';
export type MethodologyGateDefinition = CanonicalGateDefinition;
export type TemplateSuggestion = TemplateSuggestionDefinition;
/**
 * Processing step definition from YAML
 */
export interface ProcessingStepDefinition {
    id: string;
    name: string;
    description: string;
    methodologyBasis: string;
    order: number;
    required: boolean;
}
/**
 * Methodology definition subset for enhancement
 */
export interface MethodologyDefinitionForEnhancement {
    id: string;
    /** Framework type discriminator (preferred) */
    type?: string;
    /** @deprecated Use `type` instead */
    methodology: string;
    systemPromptGuidance: string;
    templateSuggestions?: TemplateSuggestion[];
    methodologyGates?: MethodologyGateDefinition[];
    phases?: {
        processingSteps?: ProcessingStepDefinition[];
    };
}
/**
 * Converts methodology template suggestions to TemplateEnhancement format
 * @param suggestions - Template suggestions from methodology YAML
 * @returns Array of TemplateEnhancement objects
 */
export declare function convertTemplateSuggestions(suggestions: TemplateSuggestion[]): TemplateEnhancement[];
/**
 * Converts methodology gate definitions to QualityGate format
 * @param gates - Gate definitions from methodology YAML
 * @returns Array of QualityGate objects
 */
export declare function convertMethodologyGates(gates: MethodologyGateDefinition[]): QualityGate[];
/**
 * Converts processing step definitions to ProcessingStep format
 * @param steps - Processing step definitions from methodology YAML
 * @returns Array of ProcessingStep objects
 */
export declare function convertProcessingSteps(steps: ProcessingStepDefinition[]): ProcessingStep[];
/**
 * Creates a MethodologyEnhancement from a methodology definition
 * @param definition - Methodology definition from YAML/JSON
 * @param _context - Execution context (currently unused, for future extensions)
 * @param confidence - Confidence score for the enhancement (default: 0.9)
 * @returns MethodologyEnhancement object
 */
export declare function createMethodologyEnhancement(definition: MethodologyDefinitionForEnhancement, _context?: Record<string, unknown>, confidence?: number): MethodologyEnhancement;
/**
 * Gets system prompt guidance from a methodology definition
 * @param definition - Methodology definition
 * @param _context - Execution context (for future template interpolation)
 * @returns System prompt guidance string
 */
export declare function getSystemPromptGuidance(definition: {
    systemPromptGuidance: string;
}, _context?: Record<string, unknown>): string;
