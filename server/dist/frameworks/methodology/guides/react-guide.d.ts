/**
 * ReACT Methodology Guide (Legacy TypeScript Implementation)
 *
 * @deprecated Use data-driven YAML definition instead.
 *   - Location: methodologies/react/methodology.yaml
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
 * Provides guidance for applying ReACT (Reasoning and Acting) methodology to prompt creation,
 * processing, and execution without hijacking semantic analysis functionality
 */
import { BaseMethodologyGuide, PromptCreationGuidance, ProcessingGuidance, StepGuidance, MethodologyEnhancement, MethodologyValidation, MethodologyToolDescriptions, JudgePromptDefinition } from '../interfaces.js';
import type { ContentAnalysisResult } from '../../../semantic/types.js';
import type { ConvertedPrompt } from '../../../types/index.js';
/**
 * ReACT Methodology Guide Implementation
 * Guides the application of ReACT (Reasoning and Acting) principles without replacing semantic analysis
 */
export declare class ReACTMethodologyGuide extends BaseMethodologyGuide {
    readonly frameworkId = "react";
    readonly frameworkName = "ReACT Framework";
    readonly methodology = "ReACT";
    readonly version = "1.0.0";
    /**
     * Guide prompt creation using ReACT structure
     * Helps users create prompts that follow ReACT methodology
     */
    guidePromptCreation(intent: string, context?: Record<string, any>): PromptCreationGuidance;
    /**
     * Guide template processing with ReACT methodology
     */
    guideTemplateProcessing(template: string, executionType: string): ProcessingGuidance;
    /**
     * Guide execution steps using ReACT methodology
     */
    guideExecutionSteps(prompt: ConvertedPrompt, semanticAnalysis: ContentAnalysisResult): StepGuidance;
    /**
     * Enhance execution with ReACT methodology
     */
    enhanceWithMethodology(prompt: ConvertedPrompt, context: Record<string, any>): MethodologyEnhancement;
    /**
     * Validate methodology compliance
     */
    validateMethodologyCompliance(prompt: ConvertedPrompt): MethodologyValidation;
    /**
     * Get ReACT-specific system prompt guidance
     */
    getSystemPromptGuidance(context: Record<string, any>): string;
    /**
     * Get ReACT-specific tool descriptions
     * Emphasizes iterative reasoning cycles and observational learning
     */
    getToolDescriptions(): MethodologyToolDescriptions;
    /**
     * Get ReACT-specific judge prompt for resource selection
     */
    getJudgePrompt(): JudgePromptDefinition;
}
