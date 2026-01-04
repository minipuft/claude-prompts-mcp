/**
 * Built-in Command Registry
 *
 * Centralized registry of system commands that are handled internally
 * by the prompt engine rather than being routed to user-defined prompts.
 */
/**
 * List of built-in system commands
 */
export const BUILTIN_COMMANDS = [
    'listprompts',
    'list_prompts',
    'listprompt',
    'help',
    'commands',
    'status',
    'health',
    'analytics',
    'metrics'
];
/**
 * Check if a command ID is a built-in system command
 */
export function isBuiltinCommand(promptId) {
    return BUILTIN_COMMANDS.includes(promptId.toLowerCase());
}
/**
 * Get hint for common built-in command typos
 */
export function getBuiltinCommandHint(promptId) {
    const lower = promptId.toLowerCase();
    if (lower.includes('list') && lower.includes('prompt')) {
        return '\n\nDid you mean >>listprompts?';
    }
    if (lower === 'commands' || lower === 'help') {
        return '\n\nTry >>help for available commands.';
    }
    if (lower === 'stat' || lower === 'status') {
        return '\n\nTry >>status for system status.';
    }
    return '';
}
//# sourceMappingURL=builtin-commands.js.map