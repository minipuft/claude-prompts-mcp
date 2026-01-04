/**
 * Argument Parser - Handles argument parsing and validation
 *
 * Extracted from PromptExecutionService to provide focused
 * argument parsing capabilities with clear separation of concerns.
 */
export interface ParseCommandOptions {
    executionMode?: string;
    sessionId?: string;
    forceRestart?: boolean;
}
export interface ParsedCommandResult {
    promptId: string;
    promptArgs: Record<string, any>;
    executionMode: string;
    sessionId?: string;
    forceRestart: boolean;
}
export interface ArgumentRequirement {
    name: string;
    type: string;
    required?: boolean;
}
export interface ArgumentValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}
export interface ExecutionContextOptions extends ParseCommandOptions {
    enableGates?: boolean;
    frameworkId?: string;
    contextData?: Record<string, unknown>;
}
export interface ExecutionContext {
    promptId: string;
    promptArgs: Record<string, any>;
    executionMode: string;
    sessionId: string;
    forceRestart: boolean;
    enableGates: boolean;
    frameworkId?: string;
    contextData: Record<string, unknown>;
}
export interface ExtractedOptions {
    executionMode: string;
    sessionId?: string;
    forceRestart: boolean;
    enableGates: boolean;
    frameworkId?: string;
}
/**
 * ArgumentParser handles all argument-related parsing and validation
 */
export declare class ArgumentParser {
    /**
     * Parse command and extract arguments
     */
    parseCommand(command: string, options?: ParseCommandOptions): ParsedCommandResult;
    /**
     * Validate arguments against requirements
     */
    validateArguments(promptArgs: Record<string, any>, requirements: ArgumentRequirement[]): ArgumentValidationResult;
    /**
     * Build execution context from parsed arguments
     */
    buildExecutionContext(promptId: string, promptArgs: Record<string, any>, options?: ExecutionContextOptions): ExecutionContext;
    /**
     * Check if value matches expected type
     */
    isValidType(value: unknown, expectedType: string): boolean;
    /**
     * Extract command options from arguments
     */
    extractOptions(args: Record<string, any>): ExtractedOptions;
}
