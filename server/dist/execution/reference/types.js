// @lifecycle canonical - Type definitions for prompt reference resolution.
/**
 * Prompt Reference Resolution Types
 *
 * Types for resolving {{ref:prompt_id}} template references.
 * Enables modular prompt composition where templates can include
 * other prompts by ID, with automatic script execution.
 */
/**
 * Default options for reference resolution.
 */
export const DEFAULT_RESOLUTION_OPTIONS = {
    maxDepth: 10,
    throwOnMissing: true,
    executeScripts: true,
    scriptTimeout: 5000,
};
//# sourceMappingURL=types.js.map