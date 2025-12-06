/**
 * Execution Routing Module
 *
 * Exports lightweight command routing functionality optimized for LLM interactions.
 */
export { BUILTIN_COMMANDS, type BuiltinCommand, isBuiltinCommand, getBuiltinCommandHint } from "./builtin-commands.js";
export { CommandRouter, createCommandRouter, type CommandRouteResult } from "./command-router.js";
