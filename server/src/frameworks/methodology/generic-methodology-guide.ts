// @lifecycle canonical - Data-driven methodology guide implementation.
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

import {
  BaseMethodologyGuide,
  type FrameworkMethodology,
  type FrameworkType,
  type PromptCreationGuidance,
  type ProcessingGuidance,
  type StepGuidance,
  type MethodologyEnhancement,
  type MethodologyValidation,
  type MethodologyToolDescriptions,
  type JudgePromptDefinition,
  type QualityGate,
  type TemplateEnhancement,
} from '../types/methodology-types.js';
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
  createMethodologyEnhancement,
  convertTemplateSuggestions,
  convertMethodologyGates,
  convertProcessingSteps,
} from '../utils/template-enhancer.js';

import type { MethodologyDefinition } from './methodology-definition-types.js';
import type { ConvertedPrompt, ExecutionType } from '../../execution/types.js';
import type { ContentAnalysisResult } from '../../semantic/types.js';

/**
 * GenericMethodologyGuide - Data-driven implementation of IMethodologyGuide
 *
 * This class can represent any methodology by loading its definition from JSON.
 * All methodology-specific behavior is derived from the JSON data.
 */
export class GenericMethodologyGuide extends BaseMethodologyGuide {
  readonly frameworkId: string;
  readonly frameworkName: string;
  /** The framework type discriminator */
  readonly type: FrameworkType;
  /** @deprecated Use `type` instead */
  readonly methodology: FrameworkMethodology;
  readonly version: string;

  private readonly definition: MethodologyDefinition;

  /**
   * Creates a GenericMethodologyGuide from a methodology definition
   * @param definition - The loaded methodology definition from JSON
   */
  constructor(definition: MethodologyDefinition) {
    super();
    this.definition = definition;
    this.frameworkId = definition.id;
    this.frameworkName = definition.name;
    // Support both 'type' and legacy 'methodology' fields in definition
    this.type = definition.type || definition.methodology;
    this.methodology = this.type; // Backward compat: methodology mirrors type
    this.version = definition.version || '1.0.0';
  }

  /**
   * Guide prompt creation using the methodology's structure
   */
  guidePromptCreation(intent: string, context?: Record<string, unknown>): PromptCreationGuidance {
    const elements = this.definition.methodologyElements;
    const argumentSuggestions = this.definition.argumentSuggestions || [];

    // Build structure guidance from methodology elements
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
          methodologyReason: arg.methodologyReason,
          examples: arg.examples,
        })),
      },
      methodologyElements: elements || {
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
          ? [`Ensure all ${this.methodology} phases are addressed`].concat(
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
   * Guide template processing with methodology-specific steps
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
   * Guide execution steps using methodology phases
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
   * Enhance execution with methodology-specific improvements
   */
  enhanceWithMethodology(
    prompt: ConvertedPrompt,
    context: Record<string, unknown>
  ): MethodologyEnhancement {
    // Convert methodology gates from definition
    const methodologyGates: QualityGate[] = this.definition.methodologyGates
      ? convertMethodologyGates(this.definition.methodologyGates)
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
      methodologyGates,
      templateSuggestions,
      enhancementMetadata: this.createEnhancementMetadata(
        0.9,
        `${this.methodology} methodology provides systematic approach`
      ),
    };
  }

  /**
   * Validate methodology compliance using quality indicators from JSON
   */
  validateMethodologyCompliance(prompt: ConvertedPrompt): MethodologyValidation {
    const qualityIndicators = this.definition.phases?.qualityIndicators;

    if (!qualityIndicators || Object.keys(qualityIndicators).length === 0) {
      // No quality indicators defined - return basic validation
      const combinedText = getCombinedText(prompt);
      const hasMethodologyMention =
        combinedText.toLowerCase().includes(this.methodology.toLowerCase()) ||
        combinedText.toLowerCase().includes(this.frameworkId.toLowerCase());

      return {
        compliant: hasMethodologyMention,
        complianceScore: hasMethodologyMention ? 0.5 : 0.2,
        strengths: hasMethodologyMention ? [`${this.methodology} methodology referenced`] : [],
        improvementAreas: hasMethodologyMention
          ? []
          : [`Consider applying ${this.methodology} methodology`],
        specificSuggestions: [],
        methodologyGaps: [],
      };
    }

    // Use the compliance validator utility with quality indicators from JSON
    const combinedText = getCombinedText(prompt);
    return validateCompliance(combinedText, qualityIndicators);
  }

  /**
   * Get methodology-specific system prompt guidance
   */
  getSystemPromptGuidance(context: Record<string, unknown>): string {
    return this.definition.systemPromptGuidance;
  }

  /**
   * Get methodology-specific tool descriptions
   */
  getToolDescriptions(): MethodologyToolDescriptions {
    // Return tool descriptions from definition or empty defaults
    return (
      this.definition.toolDescriptions ?? {
        prompt_engine: { description: '' },
        prompt_manager: { description: '' },
        system_control: { description: '' },
      }
    );
  }

  /**
   * Get methodology-specific judge prompt for resource selection
   */
  getJudgePrompt(): JudgePromptDefinition {
    // Return judge prompt from definition or generate a default based on methodology
    return (
      this.definition.judgePrompt ?? {
        systemMessage: `You are a ${this.methodology} methodology expert. Select resources that align with ${this.frameworkName} principles.`,
        userMessageTemplate: `Analyze this task using ${this.methodology} methodology:\n\n**Task:** {{command}}\n\nReturn your selections as JSON with framework, style, gates, and reasoning.`,
        outputFormat: 'structured',
      }
    );
  }

  /**
   * Get the raw methodology definition
   * Useful for introspection and debugging
   */
  getDefinition(): MethodologyDefinition {
    return this.definition;
  }

  /**
   * Get gate configuration for this methodology
   */
  getGateConfiguration(): { include?: string[]; exclude?: string[] } | undefined {
    return this.definition.gates;
  }
}

/**
 * Factory function to create a GenericMethodologyGuide from a definition
 * @param definition - The methodology definition from JSON
 * @returns A new GenericMethodologyGuide instance
 */
export function createGenericGuide(definition: MethodologyDefinition): GenericMethodologyGuide {
  return new GenericMethodologyGuide(definition);
}
