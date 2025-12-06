/**
 * Lightweight telemetry tracker for MCP tool actions and parameter issues.
 *  collects in-memory metrics so later phases can expose them via guides or diagnostics.
 * #TODO telemetry: Persist snapshots and expose via system_control analytics once that surface lands.
 */
type ActionStatus = 'received' | 'success' | 'failure' | 'unknown';
interface ActionMetricEntry {
    readonly actionId: string;
    readonly counts: Record<ActionStatus, number>;
    lastError?: string;
}
interface ParameterIssue {
    readonly timestamp: number;
    readonly parameter: string;
    readonly message: string;
    readonly metadata?: Record<string, unknown>;
}
export declare function recordActionInvocation(toolId: string, actionId: string, status: ActionStatus, options?: {
    error?: string;
}): void;
export declare function recordParameterIssue(toolId: string, parameter: string, message: string, metadata?: Record<string, unknown>): void;
export declare function getActionUsageSnapshot(): Record<string, {
    actions: ActionMetricEntry[];
    parameterIssues: ParameterIssue[];
}>;
export {};
