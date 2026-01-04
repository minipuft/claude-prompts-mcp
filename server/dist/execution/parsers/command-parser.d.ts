/**
 * Unified Command Parser
 *
 * Robust multi-strategy command parsing system that replaces fragile regex-based parsing
 * with intelligent format detection, fallback strategies, and comprehensive validation.
 *
 * Features:
 * - Multi-format detection (simple >>prompt, JSON objects, structured commands)
 * - Fallback parsing strategies with confidence scoring
 * - Comprehensive error messages with suggestions
 * - Command validation and sanitization
 */
import { Logger } from '../../logging/index.js';
import type { ConvertedPrompt } from '../../types/index.js';
import type { CommandParseResultBase } from './types/command-parse-types.js';
import type { OperatorDetectionResult, SymbolicExecutionPlan } from './types/operator-types.js';
export type CommandParseResult = CommandParseResultBase<OperatorDetectionResult, SymbolicExecutionPlan>;
/**
 * Unified Command Parser Class
 */
export declare class UnifiedCommandParser {
    private logger;
    private strategies;
    private symbolicParser;
    private stats;
    constructor(logger: Logger);
    /**
     * Extracts a single execution modifier prefix (e.g., %clean) from the command.
     * Returns the command with the modifier stripped and the normalized modifier value.
     */
    private extractModifier;
    private buildModifiers;
    /**
     * Parse command string using multi-strategy approach
     */
    parseCommand(command: string, availablePrompts: ConvertedPrompt[]): Promise<CommandParseResult>;
    private applyCommandType;
    /**
     * Initialize parsing strategies (STREAMLINED: 2 core strategies)
     */
    private initializeStrategies;
    private createSymbolicCommandStrategy;
    /**
     * Simple command strategy: >>prompt_name arguments (ENHANCED: More AI-friendly)
     */
    private createSimpleCommandStrategy;
    /**
     * JSON command strategy: {"command": ">>prompt", "args": {...}}
     */
    private createJsonCommandStrategy;
    /**
     * Validate that the prompt ID exists in available prompts
     */
    private validatePromptExists;
    /**
     * Check if command is a built-in system command
     */
    private isBuiltinCommand;
    /**
     * Generate hint for built-in commands that might have been mistyped
     */
    private getBuiltinCommandHint;
    /**
     * Generate helpful prompt suggestions for typos
     */
    private generatePromptSuggestions;
    /**
     * Simple Levenshtein distance calculation
     */
    private levenshteinDistance;
    /**
     * Generate helpful error message for parsing failures
     */
    private generateHelpfulError;
    /**
     * Update strategy usage statistics
     */
    private updateStrategyStats;
    /**
     * Update confidence statistics
     */
    private updateConfidenceStats;
    /**
     * Get parsing statistics for monitoring
     */
    getStats(): typeof this.stats;
    /**
     * Reset statistics (useful for testing or fresh starts)
     */
    resetStats(): void;
}
/**
 * Factory function to create unified command parser
 */
export declare function createUnifiedCommandParser(logger: Logger): UnifiedCommandParser;
