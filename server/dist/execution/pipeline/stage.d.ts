import type { Logger } from '../../logging/index.js';
import type { ExecutionContext } from '../context/execution-context.js';
/**
 * Contract for all pipeline stages.
 */
export interface PipelineStage {
    /**
     * Human readable stage name used for logs/metrics.
     */
    readonly name: string;
    /**
     * Execute the stage using the shared ExecutionContext.
     */
    execute(context: ExecutionContext): Promise<void>;
}
/**
 * Base class that provides consistent logging and error handling.
 */
export declare abstract class BasePipelineStage implements PipelineStage {
    protected readonly logger: Logger;
    abstract readonly name: string;
    constructor(logger: Logger);
    abstract execute(context: ExecutionContext): Promise<void>;
    /**
     * Helper to log stage entry with consistent metadata.
     */
    protected logEntry(context: ExecutionContext, metadata?: Record<string, unknown>): void;
    /**
     * Helper to log completion metadata.
     */
    protected logExit(metadata?: Record<string, unknown>): void;
    /**
     * Helper to log and rethrow errors with consistent structure.
     */
    protected handleError(error: unknown, message?: string): never;
}
