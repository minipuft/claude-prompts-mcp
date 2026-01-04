/**
 * Built-in Command Registry
 *
 * Centralized registry of system commands that are handled internally
 * by the prompt engine rather than being routed to user-defined prompts.
 */
/**
 * List of built-in system commands
 */
export declare const BUILTIN_COMMANDS: readonly ["listprompts", "list_prompts", "listprompt", "help", "commands", "status", "health", "analytics", "metrics"];
/**
 * Type representing valid built-in commands
 */
export type BuiltinCommand = typeof BUILTIN_COMMANDS[number];
/**
 * Check if a command ID is a built-in system command
 */
export declare function isBuiltinCommand(promptId: string): boolean;
/**
 * Get hint for common built-in command typos
 */
export declare function getBuiltinCommandHint(promptId: string): string;
