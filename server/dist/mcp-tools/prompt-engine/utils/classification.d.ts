/**
 * Prompt Classifier - Handles prompt classification and analysis
 *
 * Extracted from PromptExecutionService to provide focused
 * classification capabilities with clear separation of concerns.
 */
import { ContentAnalyzer } from '../../../semantic/configurable-semantic-analyzer.js';
import { ConvertedPrompt } from '../../../types/index.js';
import { PromptClassification } from '../core/types.js';
/**
 * PromptClassifier handles all prompt classification and analysis
 *
 * This class provides:
 * - Prompt type detection (single, chain)
 * - Confidence scoring and reasoning
 * - Gate recommendation based on complexity
 * - Framework suggestion for execution
 */
export declare class PromptClassifier {
    private semanticAnalyzer;
    constructor(semanticAnalyzer: ContentAnalyzer);
    /**
     * Classify prompt and determine execution strategy
     */
    classifyPrompt(convertedPrompt: ConvertedPrompt, promptArgs?: Record<string, any>): PromptClassification;
    /**
     * Perform the actual classification logic
     */
    private performClassification;
    /**
     * Check if content has template variables
     */
    private hasTemplateVariables;
    /**
     * Suggest framework based on content
     */
    private suggestFramework;
    /**
     * Assess prompt complexity
     */
    private assessComplexity;
    /**
     * Count template variables in content
     */
    private countTemplateVariables;
}
