// @lifecycle canonical - Common type definitions for MCP tools.
/**
 * Shared Type Definitions for MCP Tools
 *
 * This file contains proper TypeScript interfaces to replace 'any' types
 * throughout the MCP tools system, improving type safety and development experience.
 *
 * Updated: 2025-09-28 - Consolidated with unified error handling system
 */
/**
 * Type guard functions for errors
 */
export function isTypedError(error) {
    return typeof error === 'object' && error !== null && 'name' in error && 'message' in error;
}
export function isValidationError(error) {
    return isTypedError(error) && error.name === 'ValidationError';
}
export function isExecutionError(error) {
    return isTypedError(error) && error.name === 'ExecutionError';
}
export function isConfigurationError(error) {
    return isTypedError(error) && error.name === 'ConfigurationError';
}
export function isFrameworkError(error) {
    return isTypedError(error) && error.name === 'FrameworkError';
}
//# sourceMappingURL=shared-types.js.map