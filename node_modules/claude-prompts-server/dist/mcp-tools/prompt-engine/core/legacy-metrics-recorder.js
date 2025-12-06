/**
 * Records baseline metrics for legacy execution to guide the pipeline migration.
 */
export class LegacyExecutionMetricsRecorder {
    constructor(logger) {
        this.logger = logger;
        this.aggregates = new Map();
    }
    startMeasurement(commandText) {
        return {
            commandText,
            startedAt: Date.now(),
            memoryBefore: process.memoryUsage(),
        };
    }
    recordSuccess(handle, metadata = {}) {
        this.finish(handle, {
            ...metadata,
            status: "success",
            normalizedCommandType: this.normalizeCommandType(metadata.commandType) ??
                this.normalizeCommandText(handle.commandText),
        });
    }
    recordFailure(handle, metadata = {}) {
        if (!handle) {
            return;
        }
        this.finish(handle, {
            ...metadata,
            status: "failure",
            normalizedCommandType: this.normalizeCommandType(metadata.commandType) ??
                this.normalizeCommandText(handle.commandText),
        });
    }
    finish(handle, metadata) {
        const stats = this.getOrCreateAggregate(metadata.normalizedCommandType);
        const durationMs = Math.max(0, Date.now() - handle.startedAt);
        const memoryAfter = process.memoryUsage();
        stats.count += 1;
        stats.totalDurationMs += durationMs;
        stats.averageDurationMs = Math.round(stats.totalDurationMs / stats.count);
        stats.lastHeapUsed = memoryAfter.heapUsed;
        stats.lastRss = memoryAfter.rss;
        stats.lastHeapDelta = memoryAfter.heapUsed - handle.memoryBefore.heapUsed;
        stats.lastRssDelta = memoryAfter.rss - handle.memoryBefore.rss;
        if (metadata.status === "failure") {
            stats.errorCount += 1;
            stats.lastErrorType = this.extractErrorType(metadata.error);
            stats.lastErrorMessage = this.extractErrorMessage(metadata.error);
        }
        this.logger.info("[LegacyMetrics] Execution measurement", {
            commandType: metadata.commandType ?? metadata.normalizedCommandType,
            strategy: metadata.strategy ?? "unspecified",
            executionMode: metadata.executionMode ?? "unknown",
            status: metadata.status,
            durationMs,
            averages: {
                durationMs: stats.averageDurationMs,
                errorRate: Number((stats.errorCount / stats.count).toFixed(3)),
            },
            memory: {
                heapUsed: stats.lastHeapUsed,
                rss: stats.lastRss,
                heapDelta: stats.lastHeapDelta,
                rssDelta: stats.lastRssDelta,
            },
            errors: {
                total: stats.errorCount,
                lastErrorType: stats.lastErrorType,
                lastErrorMessage: stats.lastErrorMessage,
            },
        });
    }
    getOrCreateAggregate(commandType) {
        let stats = this.aggregates.get(commandType);
        if (!stats) {
            stats = {
                count: 0,
                errorCount: 0,
                totalDurationMs: 0,
                averageDurationMs: 0,
                lastHeapUsed: 0,
                lastRss: 0,
                lastHeapDelta: 0,
                lastRssDelta: 0,
            };
            this.aggregates.set(commandType, stats);
        }
        return stats;
    }
    normalizeCommandType(value) {
        const trimmed = value?.trim();
        return trimmed && trimmed.length > 0 ? trimmed.toLowerCase() : undefined;
    }
    normalizeCommandText(commandText) {
        const trimmed = commandText.trim();
        if (!trimmed) {
            return "unknown";
        }
        return trimmed.split(/\s+/)[0]?.toLowerCase() ?? "unknown";
    }
    extractErrorType(error) {
        if (!error) {
            return undefined;
        }
        if (error instanceof Error) {
            return error.name ?? "Error";
        }
        return typeof error;
    }
    extractErrorMessage(error) {
        if (!error) {
            return undefined;
        }
        if (error instanceof Error) {
            return error.message;
        }
        return String(error);
    }
}
//# sourceMappingURL=legacy-metrics-recorder.js.map