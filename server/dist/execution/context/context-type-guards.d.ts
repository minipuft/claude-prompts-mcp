import type { ExecutionContextVariant, ParsedExecutionContext, PlannedSinglePromptContext, PlannedChainContext, SinglePromptContext, ChainExecutionContext, SinglePromptCommand, ChainCommand, ParsedCommand } from "./context-variants.js";
/**
 * Type guard functions for ExecutionContext discriminated unions
 * Phase 2: Type Refinement - Enables compile-time type narrowing
 */
/**
 * Checks if context has been parsed (parsedCommand populated)
 */
export declare function isParsedContext(ctx: ExecutionContextVariant): ctx is ParsedExecutionContext;
/**
 * Checks if context has a single prompt command
 */
export declare function hasSinglePromptCommand(ctx: ExecutionContextVariant): ctx is ParsedExecutionContext & {
    parsedCommand: SinglePromptCommand;
};
/**
 * Checks if context has a chain command
 */
export declare function hasChainCommand(ctx: ExecutionContextVariant): ctx is ParsedExecutionContext & {
    parsedCommand: ChainCommand;
};
/**
 * Checks if context has execution plan
 */
export declare function hasExecutionPlan(ctx: ExecutionContextVariant): ctx is PlannedSinglePromptContext | PlannedChainContext | SinglePromptContext | ChainExecutionContext;
/**
 * Checks if context is a planned single prompt context
 */
export declare function isPlannedSinglePromptContext(ctx: ExecutionContextVariant): ctx is PlannedSinglePromptContext;
/**
 * Checks if context is a planned chain context
 */
export declare function isPlannedChainContext(ctx: ExecutionContextVariant): ctx is PlannedChainContext;
/**
 * Checks if context is a full single prompt context
 */
export declare function isSinglePromptContext(ctx: ExecutionContextVariant): ctx is SinglePromptContext;
/**
 * Checks if context is a full chain execution context
 */
export declare function isChainContext(ctx: ExecutionContextVariant): ctx is ChainExecutionContext;
/**
 * Requires parsed context or throws descriptive error
 */
export declare function requireParsedContext(ctx: ExecutionContextVariant): ParsedExecutionContext;
/**
 * Requires execution plan or throws descriptive error
 */
export declare function requireExecutionPlan(ctx: ExecutionContextVariant): PlannedSinglePromptContext | PlannedChainContext;
/**
 * Requires single prompt context or throws descriptive error
 */
export declare function requireSinglePromptContext(ctx: ExecutionContextVariant): SinglePromptContext;
/**
 * Requires chain context or throws descriptive error
 */
export declare function requireChainContext(ctx: ExecutionContextVariant): ChainExecutionContext;
/**
 * Command-level type guards
 */
/**
 * Checks if command is a single prompt command
 */
export declare function isSinglePromptCommand(cmd: ParsedCommand): cmd is SinglePromptCommand;
/**
 * Checks if command is a chain command
 */
export declare function isChainCommand(cmd: ParsedCommand): cmd is ChainCommand;
/**
 * Exhaustiveness check helper
 * Forces TypeScript to ensure all variants are handled
 */
export declare function assertNever(value: never): never;
