// @lifecycle canonical - Data-driven framework guide implementation.
/**
 * Generic Framework Guide
 *
 * A data-driven implementation of FrameworkGuide that works with JSON
 * framework definitions. This eliminates the need for TypeScript classes
 * per framework - the same class works for any registered framework (built-in or custom).
 *
 * All framework-specific behavior is driven by the JSON definition loaded
 * at runtime from resources/frameworks/.
 */

import {
  BaseFrameworkGuide,
  type FrameworkType,
  type PromptCreationGuidance,
  type ProcessingGuidance,
  type StepGuidance,
  type FrameworkEnhancement,
  type FrameworkValidation,
  type FrameworkToolDescriptions,
  type JudgePromptDefinition,
  type QualityGate,
  type TemplateEnhancement,
} from '../types/framework-types.js';
import { validateCompliance, getCombinedText } from '../utils/compliance-validator.js';
import { createProcessingGuidance, createStepGuidance } from '../utils/step-generator.js';
import {
  convertTemplateSuggestions,
  convertFrameworkGates,
  convertProcessingSteps,
} from '../utils/template-enhancer.js';

import type { ContentAnalysisResult } from '#shared/types/index.js';
import type { FrameworkResourceDefinition } from './framework-definition-types.js';
import type { ConvertedPrompt, ExecutionType } from '../../execution/types.js';

/**
 * GenericFrameworkGuide - Data-driven implementation of FrameworkGuide
 *
 * This class can represent any framework by loading its definition from JSON.
 * All framework-specific behavior is derived from the JSON data.
 */
export class GenericFrameworkGuide extends BaseFrameworkGuide {
  readonly frameworkId: string;
  readonly frameworkName: string;
  /** The framework type discriminator */
  readonly type: FrameworkType;
  readonly version: string;
  /** Root the loader read this definition from — undefined for a guide built in-process. */
  readonly sourceRoot: string | undefined;

  private readonly definition: FrameworkResourceDefinition;

  /**
   * Creates a GenericFrameworkGuide from a framework definition
   * @param definition - The loaded framework definition from JSON
   */
  constructor(definition: FrameworkResourceDefinition) {
    super();
    this.definition = definition;
    this.frameworkId = definition.id;
    this.frameworkName = definition.name;
    this.type = definition.type;
    this.version = definition.version || '1.0.0';
    this.sourceRoot = definition.sourceRoot;
  }

  /**
   * Guide prompt creation using the framework's structure
   */
  guidePromptCreation(_intent: string, _context?: Record<string, unknown>): PromptCreationGuidance {
    return {
      frameworkElements: this.definition.frameworkElements || {
        requiredSections: [],
        optionalSections: [],
        sectionDescriptions: {},
      },
    };
  }

  /**
   * Guide template processing with framework-specific steps
   */
  guideTemplateProcessing(template: string, executionType: ExecutionType): ProcessingGuidance {
    const phases = this.definition.phases;

    if (!phases) {
      // Return minimal guidance if no phases defined
      return {
        processingSteps: [],
        templateEnhancements: {
          systemPromptAdditions: [this.definition.systemPromptGuidance],
          userPromptModifications: [],
          contextualHints: [],
        },
        executionFlow: {
          preProcessingSteps: [],
          postProcessingSteps: [],
          validationSteps: [],
        },
      };
    }

    // Use the step generator utility to create processing guidance
    return createProcessingGuidance(phases, template, executionType);
  }

  /**
   * Guide execution steps using framework phases
   */
  guideExecutionSteps(
    _prompt: ConvertedPrompt,
    _semanticAnalysis: ContentAnalysisResult
  ): StepGuidance {
    const phases = this.definition.phases;

    if (!phases) {
      return {
        stepSequence: [],
      };
    }

    // Use the step generator utility to create step guidance
    return createStepGuidance(phases);
  }

  /**
   * Enhance execution with framework-specific improvements
   */
  enhanceWithFramework(
    _prompt: ConvertedPrompt,
    context: Record<string, unknown>
  ): FrameworkEnhancement {
    // Convert framework gates from definition
    const frameworkGates: QualityGate[] = this.definition.frameworkGates
      ? convertFrameworkGates(this.definition.frameworkGates)
      : [];

    // Convert template suggestions
    const templateSuggestions: TemplateEnhancement[] = this.definition.templateSuggestions
      ? convertTemplateSuggestions(this.definition.templateSuggestions)
      : [];

    // Get processing steps from phases
    const processingEnhancements = this.definition.phases?.processingSteps
      ? convertProcessingSteps(this.definition.phases.processingSteps)
      : [];

    return {
      systemPromptGuidance: this.getSystemPromptGuidance(context),
      processingEnhancements,
      frameworkGates,
      templateSuggestions,
    };
  }

  /**
   * Validate framework compliance using quality indicators from JSON
   */
  validateFrameworkCompliance(prompt: ConvertedPrompt): FrameworkValidation {
    const qualityIndicators = this.definition.phases?.qualityIndicators;

    if (!qualityIndicators || Object.keys(qualityIndicators).length === 0) {
      // No quality indicators defined - return basic validation
      const combinedText = getCombinedText(prompt);
      const hasFrameworkMention =
        combinedText.toLowerCase().includes(this.type.toLowerCase()) ||
        combinedText.toLowerCase().includes(this.frameworkId.toLowerCase());

      return {
        compliant: hasFrameworkMention,
        complianceScore: hasFrameworkMention ? 0.5 : 0.2,
        strengths: hasFrameworkMention ? [`${this.type} framework referenced`] : [],
        improvementAreas: hasFrameworkMention ? [] : [`Consider applying ${this.type} framework`],
        specificSuggestions: [],
        frameworkGaps: [],
      };
    }

    // Use the compliance validator utility with quality indicators from JSON
    const combinedText = getCombinedText(prompt);
    return validateCompliance(combinedText, qualityIndicators);
  }

  /**
   * Get framework-specific system prompt guidance
   */
  getSystemPromptGuidance(_context: Record<string, unknown>): string {
    return this.definition.systemPromptGuidance;
  }

  /**
   * Get framework-specific tool descriptions
   */
  getToolDescriptions(): FrameworkToolDescriptions {
    // Return tool descriptions from definition or empty defaults
    return (
      this.definition.toolDescriptions ?? {
        prompt_engine: { description: '' },
        resource_manager: { description: '' },
        system_control: { description: '' },
      }
    );
  }

  /**
   * Get framework-specific judge prompt for resource selection
   */
  getJudgePrompt(): JudgePromptDefinition {
    // Return judge prompt from definition or generate a default based on framework
    return (
      this.definition.judgePrompt ?? {
        systemMessage: `You are a ${this.type} framework expert. Select resources that align with ${this.frameworkName} principles.`,
        userMessageTemplate: `Analyze this task using ${this.type} framework:\n\n**Task:** {{command}}\n\nReturn your selections as JSON with framework, style, gates, and reasoning.`,
        outputFormat: 'structured',
      }
    );
  }
}

/**
 * Factory function to create a GenericFrameworkGuide from a definition
 * @param definition - The framework definition from JSON
 * @returns A new GenericFrameworkGuide instance
 */
export function createGenericGuide(definition: FrameworkResourceDefinition): GenericFrameworkGuide {
  return new GenericFrameworkGuide(definition);
}
