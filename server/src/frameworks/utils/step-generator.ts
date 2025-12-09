// @lifecycle canonical - Data-driven step generation utilities.
/**
 * Step Generator
 *
 * Generic utility for generating processing and execution steps from
 * methodology definitions. Works with phase and step data from YAML/JSON
 * to create step sequences and enhancements.
 */

import type { ContentAnalysisResult } from '../../semantic/types.js';
import type {
  ProcessingGuidance,
  StepGuidance,
  ProcessingStep,
  ExecutionStep,
} from '../types/methodology-types.js';

/**
 * Execution step definition from methodology YAML
 */
export interface ExecutionStepDefinition {
  id: string;
  name: string;
  action: string;
  methodologyPhase: string;
  dependencies: string[];
  expected_output: string;
}

/**
 * Template enhancements from phases YAML
 */
export interface TemplateEnhancementsDefinition {
  systemPromptAdditions?: string[];
  userPromptModifications?: string[];
  contextualHints?: string[];
}

/**
 * Execution flow from phases YAML
 */
export interface ExecutionFlowDefinition {
  preProcessingSteps?: string[];
  postProcessingSteps?: string[];
  validationSteps?: string[];
}

/**
 * Execution type enhancements from phases YAML
 */
export interface ExecutionTypeEnhancements {
  chain?: {
    advancedChain?: Record<string, string[]>;
    simpleChain?: Record<string, string[]>;
  };
}

/**
 * Processing step definition from methodology YAML
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
 * Phases definition from methodology YAML
 */
export interface PhasesDefinition {
  processingSteps?: ProcessingStepDefinition[];
  executionSteps?: ExecutionStepDefinition[];
  templateEnhancements?: TemplateEnhancementsDefinition;
  executionFlow?: ExecutionFlowDefinition;
  executionTypeEnhancements?: ExecutionTypeEnhancements;
}

/**
 * Converts processing step definitions to ProcessingStep format
 * @param steps - Processing step definitions from YAML
 * @returns Array of ProcessingStep objects sorted by order
 */
export function generateProcessingSteps(steps: ProcessingStepDefinition[]): ProcessingStep[] {
  return [...steps]
    .sort((a, b) => a.order - b.order)
    .map((step) => ({
      id: step.id,
      name: step.name,
      description: step.description,
      methodologyBasis: step.methodologyBasis,
      order: step.order,
      required: step.required,
    }));
}

/**
 * Converts execution step definitions to ExecutionStep format
 * @param steps - Execution step definitions from YAML
 * @returns Array of ExecutionStep objects
 */
export function generateExecutionSteps(steps: ExecutionStepDefinition[]): ExecutionStep[] {
  return steps.map((step) => ({
    id: step.id,
    name: step.name,
    action: step.action,
    methodologyPhase: step.methodologyPhase,
    dependencies: step.dependencies || [],
    expected_output: step.expected_output,
  }));
}

/**
 * Creates ProcessingGuidance from phases definition
 * @param phases - Phases definition from YAML
 * @param _template - Template being processed (for future analysis)
 * @param _executionType - Execution type from semantic analyzer
 * @returns ProcessingGuidance object
 */
export function createProcessingGuidance(
  phases: PhasesDefinition,
  _template = '',
  _executionType = 'single'
): ProcessingGuidance {
  // #todo: Wire processingSteps into prompt_guidance as authoring checklists/template hints; also feed into validation/analytics for missing coverage.
  const processingSteps = phases.processingSteps
    ? generateProcessingSteps(phases.processingSteps)
    : [];

  const templateEnhancements = phases.templateEnhancements ?? {};
  const executionFlow = phases.executionFlow ?? {};

  return {
    processingSteps,
    templateEnhancements: {
      systemPromptAdditions: templateEnhancements.systemPromptAdditions ?? [],
      userPromptModifications: templateEnhancements.userPromptModifications ?? [],
      contextualHints: templateEnhancements.contextualHints ?? [],
    },
    executionFlow: {
      preProcessingSteps: executionFlow.preProcessingSteps ?? [],
      postProcessingSteps: executionFlow.postProcessingSteps ?? [],
      validationSteps: executionFlow.validationSteps ?? [],
    },
  };
}

/**
 * Creates StepGuidance from phases definition with semantic analysis
 * @param phases - Phases definition from YAML
 * @param semanticAnalysis - Semantic analysis result
 * @returns StepGuidance object
 */
export function createStepGuidance(
  phases: PhasesDefinition,
  semanticAnalysis?: ContentAnalysisResult
): StepGuidance {
  // #todo: Expose executionSteps via a “methodology_steps” toolcall (akin to %judge) so the client LLM can request structured steps for the user query; currently guidance-only.
  const executionSteps = phases.executionSteps ? generateExecutionSteps(phases.executionSteps) : [];

  const stepEnhancements: Record<string, string[]> = {};
  const stepValidation: Record<string, string[]> = {};

  // Apply execution type-specific enhancements based on semantic analysis
  if (semanticAnalysis && phases.executionTypeEnhancements?.chain) {
    const chainEnhancements = phases.executionTypeEnhancements.chain;

    if (
      semanticAnalysis.executionType === 'chain' &&
      semanticAnalysis.executionCharacteristics.advancedChainFeatures?.requiresAdvancedExecution &&
      chainEnhancements.advancedChain
    ) {
      // Apply advanced chain enhancements
      for (const [stepId, enhancements] of Object.entries(chainEnhancements.advancedChain)) {
        stepEnhancements[stepId] = enhancements;
        stepValidation[stepId] = [
          'Workflow completeness check',
          'State transition validation',
          'Error handling verification',
        ];
      }
    } else if (semanticAnalysis.executionType === 'chain' && chainEnhancements.simpleChain) {
      // Apply simple chain enhancements
      for (const [stepId, enhancements] of Object.entries(chainEnhancements.simpleChain)) {
        stepEnhancements[stepId] = enhancements;
        stepValidation[stepId] = [
          'Step sequence validation',
          'Data flow verification',
          'Checkpoint adequacy assessment',
        ];
      }
    }
  }

  return {
    stepSequence: executionSteps,
    stepEnhancements,
    stepValidation,
  };
}
