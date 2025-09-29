/**
 * Methodology Guide Type Definitions
 *
 * Contains all types related to methodology guides, framework definitions,
 * and methodology-specific interfaces. This consolidates types from multiple
 * sources to eliminate duplication.
 */

import type { ConvertedPrompt } from '../../execution/types.js';
import type { ContentAnalysisResult } from '../../semantic/configurable-semantic-analyzer.js';

/**
 * Framework methodology definitions
 * Each framework provides system prompt templates and execution guidelines
 */
export type FrameworkMethodology = "CAGEERF" | "ReACT" | "5W1H" | "SCAMPER" | "AUTO";

/**
 * Framework definition structure
 */
export interface FrameworkDefinition {
  id: string;
  name: string;
  description: string;
  methodology: FrameworkMethodology;
  systemPromptTemplate: string;
  executionGuidelines: string[];
  applicableTypes: string[];
  priority: number;
  enabled: boolean;
}

/**
 * Framework execution context
 */
export interface FrameworkExecutionContext {
  selectedFramework: FrameworkDefinition;
  systemPrompt: string;
  executionGuidelines: string[];
  metadata: {
    selectionReason: string;
    confidence: number;
    appliedAt: Date;
  };
}

/**
 * Framework selection criteria
 */
export interface FrameworkSelectionCriteria {
  promptType?: string;
  complexity?: 'low' | 'medium' | 'high';
  domain?: string;
  userPreference?: FrameworkMethodology;
  executionType?: 'template' | 'chain';
}

/**
 * Guidance for creating new prompts based on methodology
 */
export interface PromptCreationGuidance {
  // Structure guidance for different methodology sections
  structureGuidance: {
    systemPromptSuggestions: string[];
    userTemplateSuggestions: string[];
    argumentSuggestions: ArgumentGuidance[];
  };

  // Methodology-specific prompt elements
  methodologyElements: {
    requiredSections: string[];
    optionalSections: string[];
    sectionDescriptions: Record<string, string>;
  };

  // Quality improvement suggestions
  qualityGuidance: {
    clarityEnhancements: string[];
    completenessChecks: string[];
    specificityImprovements: string[];
  };
}

/**
 * Guidance for processing templates during execution
 */
export interface ProcessingGuidance {
  // Methodology-specific processing steps
  processingSteps: ProcessingStep[];

  // Template enhancement suggestions
  templateEnhancements: {
    systemPromptAdditions: string[];
    userPromptModifications: string[];
    contextualHints: string[];
  };

  // Execution flow guidance
  executionFlow: {
    preProcessingSteps: string[];
    postProcessingSteps: string[];
    validationSteps: string[];
  };
}

/**
 * Guidance for step sequencing in execution
 */
export interface StepGuidance {
  // Methodology-specific step sequence
  stepSequence: ExecutionStep[];

  // Step-specific enhancements
  stepEnhancements: Record<string, string[]>;

  // Quality gates for each step
  stepValidation: Record<string, string[]>;
}

/**
 * Overall methodology enhancement for execution
 */
export interface MethodologyEnhancement {
  // System prompt enhancements
  systemPromptGuidance: string;

  // Processing enhancements
  processingEnhancements: ProcessingStep[];

  // Quality gates specific to methodology
  methodologyGates: QualityGate[];

  // Template structure suggestions
  templateSuggestions: TemplateEnhancement[];

  // Execution metadata
  enhancementMetadata: {
    methodology: string;
    confidence: number;
    applicabilityReason: string;
    appliedAt: Date;
  };
}

/**
 * Core interfaces for guidance components
 */
export interface ArgumentGuidance {
  name: string;
  type: string;
  description: string;
  methodologyReason: string;
  examples: string[];
}

export interface ProcessingStep {
  id: string;
  name: string;
  description: string;
  methodologyBasis: string;
  order: number;
  required: boolean;
}

export interface ExecutionStep {
  id: string;
  name: string;
  action: string;
  methodologyPhase: string;
  dependencies: string[];
  expected_output: string;
}

export interface QualityGate {
  id: string;
  name: string;
  description: string;
  methodologyArea: string;
  validationCriteria: string[];
  priority: 'high' | 'medium' | 'low';
}

export interface TemplateEnhancement {
  section: 'system' | 'user' | 'arguments' | 'metadata';
  type: 'addition' | 'modification' | 'structure';
  description: string;
  content: string;
  methodologyJustification: string;
  impact: 'high' | 'medium' | 'low';
}

/**
 * Tool-specific descriptions for a methodology
 */
export interface MethodologyToolDescription {
  description?: string;
  parameters?: Record<string, string>;
}

/**
 * Complete tool descriptions provided by a methodology guide
 */
export interface MethodologyToolDescriptions {
  prompt_engine?: MethodologyToolDescription;
  prompt_manager?: MethodologyToolDescription;
  system_control?: MethodologyToolDescription;
}

/**
 * Methodology validation results
 */
export interface MethodologyValidation {
  compliant: boolean;
  compliance_score: number; // 0.0 to 1.0
  strengths: string[];
  improvement_areas: string[];
  specific_suggestions: TemplateEnhancement[];
  methodology_gaps: string[];
}

/**
 * Main interface for methodology guides
 * Framework adapters implement this to provide guidance rather than analysis
 */
export interface IMethodologyGuide {
  // Framework identification
  readonly frameworkId: string;
  readonly frameworkName: string;
  readonly methodology: string;
  readonly version: string;

  /**
   * Guide the creation of new prompts using this methodology
   * @param intent The user's intent or goal for the prompt
   * @param context Additional context information
   * @returns Guidance for structuring the prompt according to methodology
   */
  guidePromptCreation(
    intent: string,
    context?: Record<string, any>
  ): PromptCreationGuidance;

  /**
   * Guide template processing during execution
   * @param template The template being processed
   * @param executionType The execution strategy from semantic analyzer
   * @returns Processing guidance based on methodology
   */
  guideTemplateProcessing(
    template: string,
    executionType: string
  ): ProcessingGuidance;

  /**
   * Guide execution step sequencing
   * @param prompt The prompt being executed
   * @param semanticAnalysis Results from unified semantic analyzer
   * @returns Step-by-step guidance based on methodology
   */
  guideExecutionSteps(
    prompt: ConvertedPrompt,
    semanticAnalysis: ContentAnalysisResult
  ): StepGuidance;

  /**
   * Enhance execution with methodology-specific improvements
   * @param prompt The prompt to enhance
   * @param context Current execution context
   * @returns Methodology enhancements to apply
   */
  enhanceWithMethodology(
    prompt: ConvertedPrompt,
    context: Record<string, any>
  ): MethodologyEnhancement;

  /**
   * Validate that a prompt follows methodology principles
   * @param prompt The prompt to validate
   * @returns Validation results and improvement suggestions
   */
  validateMethodologyCompliance(
    prompt: ConvertedPrompt
  ): MethodologyValidation;

  /**
   * Get methodology-specific system prompt guidance
   * @param context Execution context
   * @returns System prompt additions for this methodology
   */
  getSystemPromptGuidance(
    context: Record<string, any>
  ): string;

  /**
   * Get methodology-specific tool descriptions (optional)
   * Provides custom descriptions for MCP tools when this methodology is active
   * @returns Tool descriptions customized for this methodology
   */
  getToolDescriptions?(): MethodologyToolDescriptions;
}

/**
 * Base class for methodology guides
 * Provides common functionality for all methodology implementations
 */
export abstract class BaseMethodologyGuide implements IMethodologyGuide {
  abstract readonly frameworkId: string;
  abstract readonly frameworkName: string;
  abstract readonly methodology: string;
  abstract readonly version: string;

  abstract guidePromptCreation(
    intent: string,
    context?: Record<string, any>
  ): PromptCreationGuidance;

  abstract guideTemplateProcessing(
    template: string,
    executionType: string
  ): ProcessingGuidance;

  abstract guideExecutionSteps(
    prompt: ConvertedPrompt,
    semanticAnalysis: ContentAnalysisResult
  ): StepGuidance;

  abstract enhanceWithMethodology(
    prompt: ConvertedPrompt,
    context: Record<string, any>
  ): MethodologyEnhancement;

  abstract validateMethodologyCompliance(
    prompt: ConvertedPrompt
  ): MethodologyValidation;

  abstract getSystemPromptGuidance(
    context: Record<string, any>
  ): string;

  /**
   * Helper method to extract combined text from prompt
   */
  protected getCombinedText(prompt: ConvertedPrompt): string {
    return [
      prompt.systemMessage || '',
      prompt.userMessageTemplate || '',
      prompt.description || ''
    ].filter(text => text.trim()).join(' ');
  }

  /**
   * Helper method to create enhancement metadata
   */
  protected createEnhancementMetadata(confidence: number, reason: string) {
    return {
      methodology: this.methodology,
      confidence,
      applicabilityReason: reason,
      appliedAt: new Date()
    };
  }
}