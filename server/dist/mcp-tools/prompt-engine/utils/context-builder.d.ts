/**
 * Context Builder - Handles execution context building
 *
 * Extracted from PromptExecutionService to provide focused
 * context building capabilities with clear separation of concerns.
 */
import { ExecutionContext } from '../../../execution/parsers/index.js';
import { FrameworkManager } from '../../../frameworks/framework-manager.js';
import { FrameworkStateManager } from '../../../frameworks/framework-state-manager.js';
import { FrameworkExecutionContext } from '../../../frameworks/types/index.js';
import { ConvertedPrompt } from '../../../types/index.js';
export interface EnhancedExecutionContext extends ExecutionContext {
    promptId: string;
    promptArgs: Record<string, any>;
    sessionId: string;
    forceRestart: boolean;
    enableGates: boolean;
    frameworkId?: string;
    contextData: Record<string, any>;
    frameworkContext?: FrameworkExecutionContext;
    metadata?: Record<string, any>;
    performance?: {
        startTime: number;
        memoryUsage?: number;
    };
}
/**
 * ContextBuilder handles all execution context building
 *
 * This class provides:
 * - Execution context creation and enhancement
 * - Framework integration and context injection
 * - Performance tracking and metadata collection
 * - Context validation and preparation
 */
export declare class ContextBuilder {
    private frameworkManager;
    private frameworkStateManager;
    constructor(frameworkManager?: FrameworkManager, frameworkStateManager?: FrameworkStateManager);
    /**
     * Build enhanced execution context
     */
    buildExecutionContext(promptId: string, promptArgs: Record<string, any>, convertedPrompt: ConvertedPrompt, options?: Record<string, any>): EnhancedExecutionContext;
    /**
     * Build framework-specific execution context
     */
    private buildFrameworkContext;
    /**
     * Build execution metadata
     */
    private buildMetadata;
    /**
     * Generate unique session ID
     */
    private generateSessionId;
    /**
     * Generate unique execution ID
     */
    private generateExecutionId;
    /**
     * Get current memory usage
     */
    private getMemoryUsage;
    /**
     * Validate execution context
     */
    validateContext(context: EnhancedExecutionContext): {
        isValid: boolean;
        errors: string[];
        warnings: string[];
    };
    /**
     * Clone context for reuse
     */
    cloneContext(context: EnhancedExecutionContext, overrides?: Partial<EnhancedExecutionContext>): EnhancedExecutionContext;
}
