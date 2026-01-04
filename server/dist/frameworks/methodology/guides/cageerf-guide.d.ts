/**
 * CAGEERF Methodology Guide (Legacy TypeScript Implementation)
 *
 * @deprecated Use data-driven YAML definition instead.
 *   - Location: methodologies/cageerf/methodology.yaml
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
 * Provides guidance for applying C.A.G.E.E.R.F methodology to prompt creation,
 * processing, and execution without hijacking semantic analysis functionality
 */
import { BaseMethodologyGuide, PromptCreationGuidance, ProcessingGuidance, StepGuidance, MethodologyEnhancement, MethodologyValidation, MethodologyToolDescriptions, JudgePromptDefinition } from '../interfaces.js';
import type { ContentAnalysisResult } from '../../../semantic/types.js';
import type { ConvertedPrompt } from '../../../types/index.js';
/**
 * CAGEERF Methodology Guide Implementation
 * Guides the application of C.A.G.E.E.R.F principles without replacing semantic analysis
 */
export declare class CAGEERFMethodologyGuide extends BaseMethodologyGuide {
    readonly frameworkId = "cageerf";
    readonly frameworkName = "C.A.G.E.E.R.F Framework";
    readonly methodology = "CAGEERF";
    readonly version = "2.0.0";
    /**
     * Guide prompt creation using CAGEERF structure
     * Helps users create prompts that follow CAGEERF methodology
     */
    guidePromptCreation(intent: string, context?: Record<string, any>): PromptCreationGuidance;
    /**
     * Guide template processing with CAGEERF methodology
     */
    guideTemplateProcessing(template: string, executionType: string): ProcessingGuidance;
    /**
     * Guide execution steps using CAGEERF methodology
     */
    guideExecutionSteps(prompt: ConvertedPrompt, semanticAnalysis: ContentAnalysisResult): StepGuidance;
    /**
     * Enhance execution with CAGEERF methodology
     */
    enhanceWithMethodology(prompt: ConvertedPrompt, context: Record<string, any>): MethodologyEnhancement;
    /**
     * Validate methodology compliance with enhanced quality gates
     */
    validateMethodologyCompliance(prompt: ConvertedPrompt): MethodologyValidation;
    /**
     * Enhanced quality assessment methods for each CAGEERF phase
     */
    private assessContextQuality;
    private assessAnalysisQuality;
    private assessGoalsQuality;
    private assessExecutionQuality;
    private assessEvaluationQuality;
    private assessRefinementQuality;
    private assessFrameworkQuality;
    /**
     * Get CAGEERF-specific system prompt guidance
     */
    getSystemPromptGuidance(context: Record<string, any>): string;
    /**
     * Get CAGEERF-specific tool descriptions
     * Emphasizes systematic analysis and structured problem-solving
     */
    getToolDescriptions(): MethodologyToolDescriptions;
    /**
     * Get CAGEERF-specific judge prompt for resource selection.
     * Emphasizes the six CAGEERF phases when selecting enhancement resources.
     */
    getJudgePrompt(): JudgePromptDefinition;
}
