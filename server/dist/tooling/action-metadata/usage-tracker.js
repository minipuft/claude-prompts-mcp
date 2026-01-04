// @lifecycle canonical - Tracks MCP tool usage metrics in-memory.
/**
 * Lightweight telemetry tracker for MCP tool actions and parameter issues.
 *  collects in-memory metrics so later phases can expose them via guides or diagnostics.
 * #TODO telemetry: Persist snapshots and expose via system_control analytics once that surface lands.
 */
const toolMetrics = new Map();
const MAX_PARAMETER_ISSUES = 100;
function getToolMetrics(toolId) {
    let metrics = toolMetrics.get(toolId);
    if (!metrics) {
        metrics = {
            actions: new Map(),
            parameterIssues: [],
        };
        toolMetrics.set(toolId, metrics);
    }
    return metrics;
}
export function recordActionInvocation(toolId, actionId, status, options) {
    const metrics = getToolMetrics(toolId);
    let entry = metrics.actions.get(actionId);
    if (!entry) {
        entry = {
            actionId,
            counts: {
                received: 0,
                success: 0,
                failure: 0,
                unknown: 0,
            },
        };
        metrics.actions.set(actionId, entry);
    }
    entry.counts[status] += 1;
    if (options?.error) {
        entry.lastError = options.error;
    }
}
export function recordParameterIssue(toolId, parameter, message, metadata) {
    const metrics = getToolMetrics(toolId);
    const issue = metadata
        ? {
            timestamp: Date.now(),
            parameter,
            message,
            metadata,
        }
        : {
            timestamp: Date.now(),
            parameter,
            message,
        };
    metrics.parameterIssues.push(issue);
    if (metrics.parameterIssues.length > MAX_PARAMETER_ISSUES) {
        metrics.parameterIssues.splice(0, metrics.parameterIssues.length - MAX_PARAMETER_ISSUES);
    }
}
export function getActionUsageSnapshot() {
    const snapshot = {};
    for (const [toolId, metrics] of toolMetrics.entries()) {
        snapshot[toolId] = {
            actions: Array.from(metrics.actions.values()).map((entry) => ({
                actionId: entry.actionId,
                counts: { ...entry.counts },
            })),
            parameterIssues: [...metrics.parameterIssues],
        };
        snapshot[toolId].actions = snapshot[toolId].actions.map((entry) => {
            if (entry.lastError) {
                return entry;
            }
            const { lastError, ...rest } = entry;
            return rest;
        });
    }
    return snapshot;
}
//# sourceMappingURL=usage-tracker.js.map