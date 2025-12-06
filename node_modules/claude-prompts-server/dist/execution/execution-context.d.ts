/**
 * Execution Context Type Definitions
 *
 * Preserved for backwards compatibility after parser system simplification.
 * This type is still used by legacy code and context builders.
 */
/**
 * Execution context for command processing and argument resolution
 */
export interface ExecutionContext {
    conversationHistory?: Array<{
        role: string;
        content: string;
        timestamp?: string;
    }>;
    environmentVars?: Record<string, string>;
    promptDefaults?: Record<string, string | number | boolean | null>;
    userSession?: Record<string, string | number | boolean | null>;
    systemContext?: Record<string, string | number | boolean | null>;
}
