// @lifecycle canonical - Shared health reporting helper for runtime startup.
/**
 * Health reporting utilities reused by runtime and entrypoint monitoring.
 */
export function buildHealthReport(input) {
    const issues = [...(input.issues ?? [])];
    const healthy = input.foundation &&
        input.dataLoaded &&
        input.modulesInitialized &&
        input.serverRunning &&
        issues.length === 0;
    return {
        healthy,
        modules: {
            foundation: input.foundation,
            dataLoaded: input.dataLoaded,
            modulesInitialized: input.modulesInitialized,
            serverRunning: input.serverRunning,
        },
        details: {
            promptsLoaded: input.promptsLoaded,
            categoriesLoaded: input.categoriesLoaded,
            serverStatus: input.serverStatus,
            moduleStatus: input.moduleStatus,
        },
        issues,
    };
}
//# sourceMappingURL=health.js.map