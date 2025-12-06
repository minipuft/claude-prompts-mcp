import type { Logger } from "../../../logging/index.js";
export interface LegacyMeasurementHandle {
    commandText: string;
    startedAt: number;
    memoryBefore: NodeJS.MemoryUsage;
}
export interface LegacyMeasurementMetadata {
    commandType?: string;
    strategy?: string;
    executionMode?: string;
    error?: unknown;
}
/**
 * Records baseline metrics for legacy execution to guide the pipeline migration.
 */
export declare class LegacyExecutionMetricsRecorder {
    private readonly logger;
    private readonly aggregates;
    constructor(logger: Logger);
    startMeasurement(commandText: string): LegacyMeasurementHandle;
    recordSuccess(handle: LegacyMeasurementHandle, metadata?: LegacyMeasurementMetadata): void;
    recordFailure(handle: LegacyMeasurementHandle | undefined, metadata?: LegacyMeasurementMetadata): void;
    private finish;
    private getOrCreateAggregate;
    private normalizeCommandType;
    private normalizeCommandText;
    private extractErrorType;
    private extractErrorMessage;
}
