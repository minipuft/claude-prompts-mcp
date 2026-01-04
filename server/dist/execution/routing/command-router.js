/**
 * Command Router
 *
 * Lightweight command routing with minimal processing optimized for LLM interactions.
 * Replaces complex multi-strategy parser with simple format detection and validation.
 *
 * Key simplifications:
 * - No typo correction (LLMs don't make typos)
 * - No type coercion (LLMs send correct types)
 * - No smart content mapping (LLMs use schema descriptions)
 * - Simple format detection (JSON wrapper or >>prompt format)
 */
import { ValidationError, PromptError, safeJsonParse } from "../../utils/index.js";
import { isBuiltinCommand, getBuiltinCommandHint } from "./builtin-commands.js";
/**
 * Command Router Class
 *
 * Provides lightweight command routing optimized for LLM interactions
 */
export class CommandRouter {
    constructor(logger) {
        this.logger = logger;
    }
    /**
     * Route command to appropriate prompt with minimal processing
     */
    route(command, availablePrompts) {
        if (!command || command.trim().length === 0) {
            throw new ValidationError("Command cannot be empty");
        }
        // Parse format
        const { promptId, rawArgs, format } = this.parseFormat(command);
        // Check if builtin
        const isBuiltin = isBuiltinCommand(promptId);
        // Validate prompt exists (if not builtin)
        if (!isBuiltin) {
            this.validatePromptExists(promptId, availablePrompts);
        }
        this.logger.debug(`Routed command to prompt: ${promptId} (format: ${format}, builtin: ${isBuiltin})`);
        return { promptId, rawArgs, format, isBuiltin };
    }
    /**
     * Parse command format (JSON wrapper or simple >>prompt)
     */
    parseFormat(command) {
        const trimmed = command.trim();
        // JSON wrapper format: {"command": ">>prompt", "args": {...}}
        if (trimmed.startsWith('{')) {
            return this.parseJsonFormat(trimmed);
        }
        // Simple format: >>prompt_name arguments
        return this.parseSimpleFormat(trimmed);
    }
    /**
     * Parse JSON wrapper format
     */
    parseJsonFormat(command) {
        const parseResult = safeJsonParse(command);
        if (!parseResult.success || !parseResult.data) {
            throw new ValidationError("Invalid JSON format. Check JSON syntax and structure.");
        }
        const data = parseResult.data;
        const actualCommand = data.command || data.prompt;
        if (!actualCommand) {
            throw new ValidationError('JSON format must include "command" or "prompt" field');
        }
        // Extract prompt ID from command (remove >> or / prefix)
        const promptId = actualCommand.replace(/^(?:>>|\/)/, '').toLowerCase();
        // Handle args (string or object)
        const rawArgs = typeof data.args === 'string' ? data.args : JSON.stringify(data.args || {});
        return { promptId, rawArgs, format: 'json' };
    }
    /**
     * Parse simple >>prompt format
     */
    parseSimpleFormat(command) {
        // Match >>prompt_name or /prompt_name with optional arguments
        const match = command.match(/^(?:>>|\/)([a-zA-Z0-9_-]+)\s*(.*)$/);
        if (!match) {
            throw new ValidationError(`Invalid command format: ${command}\n\n` +
                'Supported formats:\n' +
                '  >>prompt_name arguments\n' +
                '  Or JSON: {"command": ">>prompt_name", "args": {...}}');
        }
        return {
            promptId: match[1].toLowerCase(),
            rawArgs: match[2] || '',
            format: 'simple'
        };
    }
    /**
     * Validate that prompt exists (case-insensitive)
     */
    validatePromptExists(promptId, availablePrompts) {
        const found = availablePrompts.find(p => p.id.toLowerCase() === promptId.toLowerCase() ||
            p.name?.toLowerCase() === promptId.toLowerCase());
        if (!found) {
            const builtinHint = getBuiltinCommandHint(promptId);
            throw new PromptError(`Unknown prompt: "${promptId}".${builtinHint}\n\n` +
                `Use >>listprompts to see available prompts.`);
        }
    }
}
/**
 * Factory function to create command router
 */
export function createCommandRouter(logger) {
    return new CommandRouter(logger);
}
//# sourceMappingURL=command-router.js.map