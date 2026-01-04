/**
 * 5W1H Methodology Guide (Legacy TypeScript Implementation)
 *
 * @deprecated Use data-driven YAML definition instead.
 *   - Location: methodologies/5w1h/methodology.yaml
 *   - Migration: RuntimeMethodologyLoader loads YAML at runtime
 *   - Removal: v3.0.0
 *
 * This TypeScript class is kept as a fallback for backwards compatibility.
 * The preferred approach is loading methodology definitions from YAML files
 * via RuntimeMethodologyLoader, which provides:
 *   - No build step required
 *   - Hot reload support
 *   - Easier configuration
 *
 * Provides guidance for applying 5W1H (Who, What, When, Where, Why, How) methodology to prompt creation,
 * processing, and execution without hijacking semantic analysis functionality
 */
import { BaseMethodologyGuide, PromptCreationGuidance, ProcessingGuidance, StepGuidance, MethodologyEnhancement, MethodologyValidation, MethodologyToolDescriptions, JudgePromptDefinition } from '../interfaces.js';
import type { ContentAnalysisResult } from '../../../semantic/types.js';
import type { ConvertedPrompt } from '../../../types/index.js';
/**
 * 5W1H Methodology Guide Implementation
 * Guides the application of 5W1H systematic questioning without replacing semantic analysis
 */
export declare class FiveW1HMethodologyGuide extends BaseMethodologyGuide {
    readonly frameworkId = "5w1h";
    readonly frameworkName = "5W1H Framework";
    readonly methodology = "5W1H";
    readonly version = "1.0.0";
    /**
     * Guide prompt creation using 5W1H structure
     * Helps users create prompts that follow 5W1H methodology
     */
    guidePromptCreation(intent: string, context?: Record<string, any>): PromptCreationGuidance;
    /**
     * Guide template processing with 5W1H methodology
     */
    guideTemplateProcessing(template: string, executionType: string): ProcessingGuidance;
    /**
     * Guide execution steps using 5W1H methodology
     */
    guideExecutionSteps(prompt: ConvertedPrompt, semanticAnalysis: ContentAnalysisResult): StepGuidance;
    /**
     * Enhance execution with 5W1H methodology
     */
    enhanceWithMethodology(prompt: ConvertedPrompt, context: Record<string, any>): MethodologyEnhancement;
    /**
     * Validate methodology compliance
     */
    validateMethodologyCompliance(prompt: ConvertedPrompt): MethodologyValidation;
    /**
     * Get 5W1H-specific system prompt guidance
     */
    getSystemPromptGuidance(context: Record<string, any>): string;
    /**
     * Get 5W1H-specific tool descriptions
     * Emphasizes comprehensive questioning for requirements and investigation
     */
    getToolDescriptions(): MethodologyToolDescriptions;
    /**
     * Get 5W1H-specific judge prompt for resource selection
     */
    getJudgePrompt(): JudgePromptDefinition;
}
