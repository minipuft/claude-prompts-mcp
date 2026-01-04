/**
 * Generic Methodology Guide
 *
 * A data-driven implementation of IMethodologyGuide that works with JSON
 * methodology definitions. This eliminates the need for TypeScript classes
 * per methodology - the same class works for any registered framework (built-in or custom).
 *
 * All methodology-specific behavior is driven by the JSON definition loaded
 * at runtime from resources/methodologies/.
 */
import { BaseMethodologyGuide, type FrameworkMethodology, type FrameworkType, type PromptCreationGuidance, type ProcessingGuidance, type StepGuidance, type MethodologyEnhancement, type MethodologyValidation, type MethodologyToolDescriptions, type JudgePromptDefinition } from '../types/methodology-types.js';
import type { MethodologyDefinition } from './methodology-definition-types.js';
import type { ConvertedPrompt, ExecutionType } from '../../execution/types.js';
import type { ContentAnalysisResult } from '../../semantic/types.js';
/**
 * GenericMethodologyGuide - Data-driven implementation of IMethodologyGuide
 *
 * This class can represent any methodology by loading its definition from JSON.
 * All methodology-specific behavior is derived from the JSON data.
 */
export declare class GenericMethodologyGuide extends BaseMethodologyGuide {
    readonly frameworkId: string;
    readonly frameworkName: string;
    /** The framework type discriminator */
    readonly type: FrameworkType;
    /** @deprecated Use `type` instead */
    readonly methodology: FrameworkMethodology;
    readonly version: string;
    private readonly definition;
    /**
     * Creates a GenericMethodologyGuide from a methodology definition
     * @param definition - The loaded methodology definition from JSON
     */
    constructor(definition: MethodologyDefinition);
    /**
     * Guide prompt creation using the methodology's structure
     */
    guidePromptCreation(intent: string, context?: Record<string, unknown>): PromptCreationGuidance;
    /**
     * Guide template processing with methodology-specific steps
     */
    guideTemplateProcessing(template: string, executionType: ExecutionType): ProcessingGuidance;
    /**
     * Guide execution steps using methodology phases
     */
    guideExecutionSteps(prompt: ConvertedPrompt, semanticAnalysis: ContentAnalysisResult): StepGuidance;
    /**
     * Enhance execution with methodology-specific improvements
     */
    enhanceWithMethodology(prompt: ConvertedPrompt, context: Record<string, unknown>): MethodologyEnhancement;
    /**
     * Validate methodology compliance using quality indicators from JSON
     */
    validateMethodologyCompliance(prompt: ConvertedPrompt): MethodologyValidation;
    /**
     * Get methodology-specific system prompt guidance
     */
    getSystemPromptGuidance(context: Record<string, unknown>): string;
    /**
     * Get methodology-specific tool descriptions
     */
    getToolDescriptions(): MethodologyToolDescriptions;
    /**
     * Get methodology-specific judge prompt for resource selection
     */
    getJudgePrompt(): JudgePromptDefinition;
    /**
     * Get the raw methodology definition
     * Useful for introspection and debugging
     */
    getDefinition(): MethodologyDefinition;
    /**
     * Get gate configuration for this methodology
     */
    getGateConfiguration(): {
        include?: string[];
        exclude?: string[];
    } | undefined;
}
/**
 * Factory function to create a GenericMethodologyGuide from a definition
 * @param definition - The methodology definition from JSON
 * @returns A new GenericMethodologyGuide instance
 */
export declare function createGenericGuide(definition: MethodologyDefinition): GenericMethodologyGuide;
