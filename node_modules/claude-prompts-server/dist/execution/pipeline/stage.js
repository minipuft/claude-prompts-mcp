/**
 * Base class that provides consistent logging and error handling.
 */
export class BasePipelineStage {
    constructor(logger) {
        this.logger = logger;
        if (!logger) {
            throw new Error('BasePipelineStage requires a logger instance');
        }
    }
    /**
     * Helper to log stage entry with consistent metadata.
     */
    logEntry(context, metadata = {}) {
        const commandLabel = context.mcpRequest.command ?? '<response-only>';
        this.logger.debug(`[${this.name}] Starting`, {
            command: commandLabel,
            sessionId: context.getSessionId(),
            ...metadata,
        });
    }
    /**
     * Helper to log completion metadata.
     */
    logExit(metadata = {}) {
        this.logger.debug(`[${this.name}] Complete`, metadata);
    }
    /**
     * Helper to log and rethrow errors with consistent structure.
     */
    handleError(error, message) {
        const details = error instanceof Error
            ? { message: error.message, stack: error.stack }
            : { message: String(error) };
        this.logger.error(`[${this.name}] ${message ?? 'Execution failed'}`, details);
        if (error instanceof Error) {
            throw error;
        }
        throw new Error(String(error));
    }
}
//# sourceMappingURL=stage.js.map