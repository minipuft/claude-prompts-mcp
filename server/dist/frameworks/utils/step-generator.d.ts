/**
 * Step Generator
 *
 * Generic utility for generating processing and execution steps from
 * methodology definitions. Works with phase and step data from YAML/JSON
 * to create step sequences and enhancements.
 */
import type { ContentAnalysisResult } from '../../semantic/types.js';
import type { ProcessingGuidance, StepGuidance, ProcessingStep, ExecutionStep } from '../types/methodology-types.js';
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
export declare function generateProcessingSteps(steps: ProcessingStepDefinition[]): ProcessingStep[];
/**
 * Converts execution step definitions to ExecutionStep format
 * @param steps - Execution step definitions from YAML
 * @returns Array of ExecutionStep objects
 */
export declare function generateExecutionSteps(steps: ExecutionStepDefinition[]): ExecutionStep[];
/**
 * Creates ProcessingGuidance from phases definition
 * @param phases - Phases definition from YAML
 * @param _template - Template being processed (for future analysis)
 * @param _executionType - Execution type from semantic analyzer
 * @returns ProcessingGuidance object
 */
export declare function createProcessingGuidance(phases: PhasesDefinition, _template?: string, _executionType?: string): ProcessingGuidance;
/**
 * Creates StepGuidance from phases definition with semantic analysis
 * @param phases - Phases definition from YAML
 * @param semanticAnalysis - Semantic analysis result
 * @returns StepGuidance object
 */
export declare function createStepGuidance(phases: PhasesDefinition, semanticAnalysis?: ContentAnalysisResult): StepGuidance;
