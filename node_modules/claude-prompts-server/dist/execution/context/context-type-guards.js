/**
 * Type guard functions for ExecutionContext discriminated unions
 * Phase 2: Type Refinement - Enables compile-time type narrowing
 */
/**
 * Checks if context has been parsed (parsedCommand populated)
 */
export function isParsedContext(ctx) {
    return "parsedCommand" in ctx && ctx.parsedCommand !== undefined;
}
/**
 * Checks if context has a single prompt command
 */
export function hasSinglePromptCommand(ctx) {
    return (isParsedContext(ctx) && ctx.parsedCommand.commandType === "single");
}
/**
 * Checks if context has a chain command
 */
export function hasChainCommand(ctx) {
    return isParsedContext(ctx) && ctx.parsedCommand.commandType === "chain";
}
/**
 * Checks if context has execution plan
 */
export function hasExecutionPlan(ctx) {
    return "executionPlan" in ctx && ctx.executionPlan !== undefined;
}
/**
 * Checks if context is a planned single prompt context
 */
export function isPlannedSinglePromptContext(ctx) {
    return (hasSinglePromptCommand(ctx) &&
        hasExecutionPlan(ctx) &&
        (ctx.executionPlan.strategy === "prompt" ||
            ctx.executionPlan.strategy === "template"));
}
/**
 * Checks if context is a planned chain context
 */
export function isPlannedChainContext(ctx) {
    return (hasChainCommand(ctx) &&
        hasExecutionPlan(ctx) &&
        ctx.executionPlan.strategy === "chain");
}
/**
 * Checks if context is a full single prompt context
 */
export function isSinglePromptContext(ctx) {
    return isPlannedSinglePromptContext(ctx);
}
/**
 * Checks if context is a full chain execution context
 */
export function isChainContext(ctx) {
    return (isPlannedChainContext(ctx) &&
        "sessionContext" in ctx &&
        ctx.sessionContext !== undefined);
}
/**
 * Requires parsed context or throws descriptive error
 */
export function requireParsedContext(ctx) {
    if (!isParsedContext(ctx)) {
        throw new Error("ParsedCommand not available - CommandParsingStage not executed");
    }
    return ctx;
}
/**
 * Requires execution plan or throws descriptive error
 */
export function requireExecutionPlan(ctx) {
    if (!hasExecutionPlan(ctx)) {
        throw new Error("ExecutionPlan not available - ExecutionPlanningStage not executed");
    }
    return ctx;
}
/**
 * Requires single prompt context or throws descriptive error
 */
export function requireSinglePromptContext(ctx) {
    if (!isSinglePromptContext(ctx)) {
        throw new Error("SinglePromptContext not available - not a single prompt execution");
    }
    return ctx;
}
/**
 * Requires chain context or throws descriptive error
 */
export function requireChainContext(ctx) {
    if (!isChainContext(ctx)) {
        throw new Error("ChainExecutionContext not available - not a chain execution or session not initialized");
    }
    return ctx;
}
/**
 * Command-level type guards
 */
/**
 * Checks if command is a single prompt command
 */
export function isSinglePromptCommand(cmd) {
    return cmd.commandType === "single";
}
/**
 * Checks if command is a chain command
 */
export function isChainCommand(cmd) {
    return cmd.commandType === "chain";
}
/**
 * Exhaustiveness check helper
 * Forces TypeScript to ensure all variants are handled
 */
export function assertNever(value) {
    throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
}
//# sourceMappingURL=context-type-guards.js.map