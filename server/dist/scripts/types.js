// @lifecycle canonical - Type definitions for prompt-scoped script tools.
/**
 * Script Tools Type Definitions
 *
 * Contains all types related to prompt-scoped script tool execution.
 * Script tools allow prompts to declare external executable scripts that
 * enhance template rendering with computed results.
 *
 * @see plans/script-tools-implementation.md for the full implementation plan
 */
/**
 * Default execution configuration values.
 * Applied when tool.yaml doesn't specify execution block.
 *
 * Uses deterministic trigger system (not probabilistic confidence).
 * Confirmation is required by default (secure by default).
 */
export const DEFAULT_EXECUTION_CONFIG = {
    trigger: 'schema_match',
    confirm: true,
    strict: false,
};
//# sourceMappingURL=types.js.map