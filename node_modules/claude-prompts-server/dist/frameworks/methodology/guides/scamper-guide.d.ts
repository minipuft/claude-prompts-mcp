/**
 * SCAMPER Methodology Guide (Legacy TypeScript Implementation)
 *
 * @deprecated Use data-driven YAML definition instead.
 *   - Location: methodologies/scamper/methodology.yaml
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
 * Provides guidance for applying SCAMPER (Substitute, Combine, Adapt, Modify, Put to other uses, Eliminate, Reverse)
 * methodology to prompt creation, processing, and execution without hijacking semantic analysis functionality
 */
import { BaseMethodologyGuide, PromptCreationGuidance, ProcessingGuidance, StepGuidance, MethodologyEnhancement, MethodologyValidation, MethodologyToolDescriptions, JudgePromptDefinition } from '../interfaces.js';
import type { ContentAnalysisResult } from '../../../semantic/types.js';
import type { ConvertedPrompt } from '../../../types/index.js';
/**
 * SCAMPER Methodology Guide Implementation
 * Guides the application of SCAMPER creative problem-solving techniques without replacing semantic analysis
 */
export declare class SCAMPERMethodologyGuide extends BaseMethodologyGuide {
    readonly frameworkId = "scamper";
    readonly frameworkName = "SCAMPER Framework";
    readonly methodology = "SCAMPER";
    readonly version = "1.0.0";
    /**
     * Guide prompt creation using SCAMPER structure
     * Helps users create prompts that follow SCAMPER methodology
     */
    guidePromptCreation(intent: string, context?: Record<string, any>): PromptCreationGuidance;
    /**
     * Guide template processing with SCAMPER methodology
     */
    guideTemplateProcessing(template: string, executionType: string): ProcessingGuidance;
    /**
     * Guide execution steps using SCAMPER methodology
     */
    guideExecutionSteps(prompt: ConvertedPrompt, semanticAnalysis: ContentAnalysisResult): StepGuidance;
    /**
     * Enhance execution with SCAMPER methodology
     */
    enhanceWithMethodology(prompt: ConvertedPrompt, context: Record<string, any>): MethodologyEnhancement;
    /**
     * Validate methodology compliance
     */
    validateMethodologyCompliance(prompt: ConvertedPrompt): MethodologyValidation;
    /**
     * Get SCAMPER-specific system prompt guidance
     */
    getSystemPromptGuidance(context: Record<string, any>): string;
    /**
     * Get SCAMPER-specific tool descriptions
     * Emphasizes creative problem-solving and alternative generation
     */
    getToolDescriptions(): MethodologyToolDescriptions;
    /**
     * Get SCAMPER-specific judge prompt for resource selection
     */
    getJudgePrompt(): JudgePromptDefinition;
}
