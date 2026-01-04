/**
 * Argument Processing Pipeline
 *
 * Advanced argument processing system that handles validation, sanitization,
 * type coercion, and enrichment based on prompt definitions and execution context.
 *
 * Features:
 * - Type-aware argument coercion based on prompt definitions
 * - Smart default resolution (replaces hardcoded {{previous_message}})
 * - Multi-source context aggregation
 * - Argument validation cascading (minLength, maxLength, pattern)
 * - Context-aware placeholder resolution
 * - Fail-fast validation with actionable retry hints
 */
import { Logger } from '../../logging/index.js';
import type { ConvertedPrompt } from '../../types/index.js';
import type { ValidationResult } from '../types.js';
type PromptDefinition = Pick<ConvertedPrompt, 'id' | 'arguments'>;
/**
 * Processing result with detailed metadata
 */
export interface ArgumentParsingResult {
    processedArgs: Record<string, string | number | boolean | null>;
    resolvedPlaceholders: Record<string, string | number | boolean | null>;
    validationResults: ValidationResult[];
    metadata: {
        parsingStrategy: string;
        appliedDefaults: string[];
        typeCoercions: Array<{
            arg: string;
            from: string;
            to: string;
        }>;
        contextSources: Record<string, string>;
        warnings: string[];
    };
}
/**
 * Execution context for argument processing
 */
export interface ExecutionContext {
    conversationHistory?: Array<{
        role: string;
        content: string;
        timestamp?: string;
    }>;
    environmentVars?: Record<string, string>;
    promptDefaults?: Record<string, string | number | boolean | null>;
    userSession?: Record<string, string | number | boolean | null>;
    systemContext?: Record<string, string | number | boolean | null>;
}
/**
 * Argument Processor Class
 */
export declare class ArgumentParser {
    private logger;
    private strategies;
    private schemaValidator;
    private stats;
    constructor(logger: Logger);
    /**
     * Process arguments through validation, sanitization, and enrichment pipeline
     */
    parseArguments(rawArgs: string, promptData: PromptDefinition, context?: ExecutionContext): Promise<ArgumentParsingResult>;
    /**
     * Initialize processing strategies
     */
    private initializeStrategies;
    /**
     * Select best processing strategy for the given arguments
     */
    private selectStrategy;
    /**
     * JSON argument processing strategy
     */
    private createJsonStrategy;
    /**
     * Key-value pair processing strategy (arg1=value1 arg2=value2)
     */
    private createKeyValueStrategy;
    /**
     * Simple text processing strategy
     */
    private createSimpleTextStrategy;
    /**
     * Fallback processing strategy
     */
    private createFallbackStrategy;
    /**
     * Apply intelligent defaults for arguments
     * ENHANCED: Smarter content mapping and auto-fill for 100% success rate
     */
    private applyIntelligentDefaults;
    /**
     * Process content specifically for an argument type
     */
    private processContentForArgument;
    /**
     * Get default from argument's defaultValue definition
     * This is the highest priority source for defaults - author-defined values
     */
    private getFromArgumentDefault;
    /**
     * Enhanced contextual default resolver
     * Simplified priority chain - no magic inference
     */
    private resolveEnhancedContextualDefault;
    /**
     * Resolve contextual default for an argument
     * Simplified priority chain - no magic inference
     */
    private resolveContextualDefault;
    /**
     * Get default from prompt-specific defaults
     */
    private getFromPromptDefaults;
    /**
     * Get default from environment variables
     */
    private getFromEnvironment;
    /**
     * Type coercion for arguments based on prompt definitions
     */
    private coerceArgumentType;
    /**
     * Create validation results for processed arguments
     */
    private createValidationResults;
    /**
     * Determine whether an argument value should be treated as missing.
     * Placeholder strings such as "[value to be provided]" are considered missing.
     */
    private isMissingArgumentValue;
    /**
     * Enrich processing result with additional validation and context
     *
     * Runs schema validation if prompt has validation rules (minLength, maxLength, pattern).
     * Throws ArgumentValidationError with retry hints on validation failure.
     */
    private enrichResult;
    /**
     * Update processing statistics
     */
    private updateProcessingStats;
    /**
     * Get processing statistics
     */
    getStats(): typeof this.stats;
    /**
     * Reset statistics
     */
    resetStats(): void;
}
/**
 * Factory function to create argument processor
 */
export declare function createArgumentParser(logger: Logger): ArgumentParser;
export {};
