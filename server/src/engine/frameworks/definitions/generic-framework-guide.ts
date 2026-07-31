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
  type FrameworkSelection,
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
import {
  validateCompliance,
  getCombinedText,
  type PhaseQualityIndicators,
} from '../utils/compliance-validator.js';
import {
  createProcessingGuidance,
  createStepGuidance,
  type PhasesDefinition,
} from '../utils/step-generator.js';
import {
  createFrameworkEnhancement,
  convertTemplateSuggestions,
  convertFrameworkGates,
  convertProcessingSteps,
} from '../utils/template-enhancer.js';

import type { FrameworkResourceDefinition } from './framework-definition-types.js';
import type { ContentAnalysisResult } from '../../../shared/types/index.js';
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
  }

  /**
   * Guide prompt creation using the framework's structure
   */
  guidePromptCreation(intent: string, context?: Record<string, unknown>): PromptCreationGuidance {
    const elements = this.definition.frameworkElements;
    const argumentSuggestions = this.definition.argumentSuggestions || [];

    // Build structure guidance from framework elements
    const systemPromptSuggestions: string[] = [];
    const userTemplateSuggestions: string[] = [];

    if (elements) {
      // Generate suggestions based on required sections
      for (const section of elements.requiredSections) {
        const desc = elements.sectionDescriptions[section];
        if (desc) {
          systemPromptSuggestions.push(`Establish ${section.toLowerCase()}: ${desc}`);
          userTemplateSuggestions.push(`Include ${section.toLowerCase()} in the request`);
        }
      }
    }

    // Add template suggestions if available
    const templateSuggestions = this.definition.templateSuggestions || [];
    for (const suggestion of templateSuggestions) {
      if (suggestion.section === 'system') {
        systemPromptSuggestions.push(suggestion.content);
      } else if (suggestion.section === 'user') {
        userTemplateSuggestions.push(suggestion.content);
      }
    }

    return {
      structureGuidance: {
        systemPromptSuggestions,
        userTemplateSuggestions,
        argumentSuggestions: argumentSuggestions.map((arg) => ({
          name: arg.name,
          type: arg.type,
          description: arg.description,
          frameworkReason: arg.frameworkReason,
          examples: arg.examples,
        })),
      },
      frameworkElements: elements || {
        requiredSections: [],
        optionalSections: [],
        sectionDescriptions: {},
      },
      qualityGuidance: {
        clarityEnhancements: [
          'Use specific, concrete language rather than abstract concepts',
          'Define technical terms and domain-specific vocabulary',
          'Provide examples to illustrate complex concepts',
        ],
        completenessChecks: elements
          ? [`Ensure all ${this.type} phases are addressed`].concat(
              elements.requiredSections.map((s) => `Verify ${s.toLowerCase()} is complete`)
            )
          : [],
        specificityImprovements: [
          'Replace general terms with specific metrics',
          'Add quantifiable success criteria',
          'Include timeline and resource constraints',
        ],
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
    prompt: ConvertedPrompt,
    semanticAnalysis: ContentAnalysisResult
  ): StepGuidance {
    const phases = this.definition.phases;

    if (!phases) {
      return {
        stepSequence: [],
        stepEnhancements: {},
        stepValidation: {},
      };
    }

    // Use the step generator utility to create step guidance
    return createStepGuidance(phases, semanticAnalysis);
  }

  /**
   * Enhance execution with framework-specific improvements
   */
  enhanceWithFramework(
    prompt: ConvertedPrompt,
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
      enhancementMetadata: this.createEnhancementMetadata(
        0.9,
        `${this.type} framework provides systematic approach`
      ),
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
  getSystemPromptGuidance(context: Record<string, unknown>): string {
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

  /**
   * Get the raw framework definition
   * Useful for introspection and debugging
   */
  getDefinition(): FrameworkResourceDefinition {
    return this.definition;
  }

  /**
   * Get gate configuration for this framework
   */
  getGateConfiguration(): { include?: string[]; exclude?: string[] } | undefined {
    return this.definition.gates;
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
