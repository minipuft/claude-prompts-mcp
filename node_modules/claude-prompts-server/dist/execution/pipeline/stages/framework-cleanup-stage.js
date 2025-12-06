import { BasePipelineStage } from '../stage.js';
/**
 * Stage 10: Framework Cleanup - Restore original framework after override
 *
 * This stage runs after response formatting to restore the original framework
 * when a framework override (@) was applied during execution. Uses a finally-block
 * pattern similar to GateOperatorExecutor for guaranteed cleanup.
 */
export class FrameworkCleanupStage extends BasePipelineStage {
    constructor(frameworkStateManager, logger) {
        super(logger);
        this.frameworkStateManager = frameworkStateManager;
        this.name = 'FrameworkCleanup';
    }
    async execute(context) {
        this.logEntry(context);
        // Check if framework override was applied
        const overrideApplied = context.metadata.frameworkOverrideApplied;
        if (!overrideApplied) {
            this.logExit({ skipped: 'No framework override to restore' });
            return;
        }
        if (!this.frameworkStateManager) {
            this.logger.warn('Framework state manager not available for restoration - framework override will persist');
            this.logExit({ skipped: 'Framework state manager not available' });
            return;
        }
        try {
            await this.restoreOriginalFramework(context);
        }
        catch (error) {
            // Log error but don't fail the request - the execution already succeeded
            this.logger.error('Failed to restore original framework after override', {
                error: error instanceof Error ? error.message : String(error),
                originalFramework: context.metadata.originalFrameworkId,
                overrideFramework: context.metadata.overrideFrameworkId,
            });
            this.logExit({
                restorationFailed: true,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
    /**
     * Restore the original framework that was active before override
     * Uses finally-block pattern to ensure restoration even if errors occur
     */
    async restoreOriginalFramework(context) {
        const originalFrameworkId = context.metadata.originalFrameworkId;
        const overrideFrameworkId = context.metadata.overrideFrameworkId;
        if (!originalFrameworkId) {
            this.logger.warn('Original framework ID not found in context metadata - cannot restore framework');
            return;
        }
        this.logger.info('Restoring original framework after override', {
            from: overrideFrameworkId,
            to: originalFrameworkId,
        });
        try {
            const restored = await this.frameworkStateManager.switchFramework({
                targetFramework: originalFrameworkId,
                reason: 'Restoring framework after symbolic command override',
            });
            if (!restored) {
                throw new Error(`Framework state manager rejected restoration to '${originalFrameworkId}'`);
            }
            // Clear restoration flags from context
            delete context.metadata.frameworkOverrideApplied;
            delete context.metadata.originalFrameworkId;
            delete context.metadata.overrideFrameworkId;
            this.logExit({
                restored: true,
                framework: originalFrameworkId,
            });
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.logger.error('Framework restoration failed', {
                targetFramework: originalFrameworkId,
                error: errorMessage,
            });
            // Rethrow to be caught by outer try-catch
            throw new Error(`Failed to restore framework '${originalFrameworkId}': ${errorMessage}`);
        }
    }
}
//# sourceMappingURL=framework-cleanup-stage.js.map