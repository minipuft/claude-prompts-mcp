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
import { Logger } from "../../logging/index.js";
import { PromptData } from "../../types/index.js";
/**
 * Command routing result
 */
export interface CommandRouteResult {
    promptId: string;
    rawArgs: string;
    format: 'simple' | 'json';
    isBuiltin: boolean;
}
/**
 * Command Router Class
 *
 * Provides lightweight command routing optimized for LLM interactions
 */
export declare class CommandRouter {
    private logger;
    constructor(logger: Logger);
    /**
     * Route command to appropriate prompt with minimal processing
     */
    route(command: string, availablePrompts: PromptData[]): CommandRouteResult;
    /**
     * Parse command format (JSON wrapper or simple >>prompt)
     */
    private parseFormat;
    /**
     * Parse JSON wrapper format
     */
    private parseJsonFormat;
    /**
     * Parse simple >>prompt format
     */
    private parseSimpleFormat;
    /**
     * Validate that prompt exists (case-insensitive)
     */
    private validatePromptExists;
}
/**
 * Factory function to create command router
 */
export declare function createCommandRouter(logger: Logger): CommandRouter;
