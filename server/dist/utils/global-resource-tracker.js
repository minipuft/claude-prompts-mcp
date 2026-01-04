// @lifecycle canonical - Tracks Node.js timers/handles to prevent resource leaks.
/**
 * Global Resource Tracker
 *
 * Tracks all Node.js resources (timers, intervals, etc.) to prevent hanging processes
 * during testing and ensure proper cleanup on shutdown.
 */
class GlobalResourceTracker {
    constructor() {
        this.resources = new Map();
        this.nextId = 1;
        this.enabled = true;
    }
    /**
     * Enable or disable tracking (useful for production environments)
     */
    setEnabled(enabled) {
        this.enabled = enabled;
    }
    /**
     * Track a setTimeout
     */
    trackTimeout(handle, source, description) {
        if (!this.enabled)
            return '';
        const id = `timeout_${this.nextId++}`;
        const tracked = {
            id,
            type: 'timeout',
            handle,
            source,
            createdAt: new Date(),
        };
        if (description !== undefined) {
            tracked.description = description;
        }
        this.resources.set(id, tracked);
        return id;
    }
    /**
     * Track a setInterval
     */
    trackInterval(handle, source, description) {
        if (!this.enabled)
            return '';
        const id = `interval_${this.nextId++}`;
        const tracked = {
            id,
            type: 'interval',
            handle,
            source,
            createdAt: new Date(),
        };
        if (description !== undefined) {
            tracked.description = description;
        }
        this.resources.set(id, tracked);
        return id;
    }
    /**
     * Track a setImmediate
     */
    trackImmediate(handle, source, description) {
        if (!this.enabled)
            return '';
        const id = `immediate_${this.nextId++}`;
        const tracked = {
            id,
            type: 'immediate',
            handle,
            source,
            createdAt: new Date(),
        };
        if (description !== undefined) {
            tracked.description = description;
        }
        this.resources.set(id, tracked);
        return id;
    }
    /**
     * Untrack a resource (called when it's manually cleared)
     */
    untrack(id) {
        return this.resources.delete(id);
    }
    /**
     * Clear a specific resource
     */
    clearResource(id) {
        const resource = this.resources.get(id);
        if (!resource)
            return false;
        try {
            switch (resource.type) {
                case 'timeout':
                case 'interval':
                    clearTimeout(resource.handle);
                    break;
                case 'immediate':
                    clearImmediate(resource.handle);
                    break;
            }
            this.resources.delete(id);
            return true;
        }
        catch (error) {
            process.stderr.write(`Failed to clear resource ${id}: ${String(error)}\n`);
            return false;
        }
    }
    /**
     * Emergency cleanup - clear ALL tracked resources
     */
    emergencyCleanup() {
        let cleared = 0;
        for (const [id, resource] of this.resources) {
            try {
                switch (resource.type) {
                    case 'timeout':
                    case 'interval':
                        clearTimeout(resource.handle);
                        break;
                    case 'immediate':
                        clearImmediate(resource.handle);
                        break;
                }
                cleared++;
            }
            catch (error) {
                process.stderr.write(`Failed to clear resource ${id} during emergency cleanup: ${String(error)}\n`);
            }
        }
        this.resources.clear();
        return cleared;
    }
    /**
     * Get diagnostic information about active resources
     */
    getDiagnostics() {
        const resources = Array.from(this.resources.values());
        const byType = {};
        const bySource = {};
        for (const resource of resources) {
            byType[resource.type] = (byType[resource.type] || 0) + 1;
            bySource[resource.source] = (bySource[resource.source] || 0) + 1;
        }
        const sortedResources = resources.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        const diagnostics = {
            totalResources: resources.length,
            byType,
            bySource,
            resources: sortedResources,
        };
        if (sortedResources[0]) {
            diagnostics.oldestResource = sortedResources[0];
        }
        return diagnostics;
    }
    /**
     * Log diagnostic information
     * Uses stderr to avoid corrupting STDIO protocol
     */
    logDiagnostics() {
        const diagnostics = this.getDiagnostics();
        if (diagnostics.totalResources === 0) {
            process.stderr.write('✅ No active tracked resources\n');
            return;
        }
        process.stderr.write(`⚠️ ${diagnostics.totalResources} active resources preventing process exit:\n`);
        process.stderr.write(`📊 By type: ${JSON.stringify(diagnostics.byType)}\n`);
        process.stderr.write(`📊 By source: ${JSON.stringify(diagnostics.bySource)}\n`);
        if (diagnostics.oldestResource) {
            const age = Date.now() - diagnostics.oldestResource.createdAt.getTime();
            process.stderr.write(`⏰ Oldest resource: ${diagnostics.oldestResource.id} (${Math.round(age / 1000)}s old) from ${diagnostics.oldestResource.source}\n`);
        }
        // Log details of long-running resources (> 10 seconds)
        const longRunning = diagnostics.resources.filter((r) => Date.now() - r.createdAt.getTime() > 10000);
        if (longRunning.length > 0) {
            process.stderr.write('🐛 Long-running resources (>10s):\n');
            for (const resource of longRunning) {
                const age = Math.round((Date.now() - resource.createdAt.getTime()) / 1000);
                process.stderr.write(`   ${resource.id}: ${resource.type} from ${resource.source} (${age}s) - ${resource.description || 'no description'}\n`);
            }
        }
    }
}
// Global singleton instance
export const globalResourceTracker = new GlobalResourceTracker();
/**
 * Wrapper functions that automatically track resources
 * Use these instead of native setTimeout/setInterval in application code
 */
export function trackedSetTimeout(callback, delay, source, description) {
    const handle = setTimeout(() => {
        // Auto-untrack when timeout executes
        globalResourceTracker.untrack(id);
        callback();
    }, delay);
    const id = globalResourceTracker.trackTimeout(handle, source, description);
    return handle;
}
export function trackedSetInterval(callback, delay, source, description) {
    const handle = setInterval(callback, delay);
    globalResourceTracker.trackInterval(handle, source, description);
    return handle;
}
export function trackedClearTimeout(handle) {
    clearTimeout(handle);
    // Note: We don't have the ID here, so we can't untrack automatically
    // This is why the auto-untrack in trackedSetTimeout is important
}
export function trackedClearInterval(handle) {
    clearInterval(handle);
    // Note: Manual untracking would require keeping a reverse mapping
    // For now, users should call globalResourceTracker.untrack() manually if needed
}
/**
 * Add emergency cleanup to process exit handlers
 */
function setupProcessHandlers() {
    const cleanup = () => {
        const cleared = globalResourceTracker.emergencyCleanup();
        if (cleared > 0) {
            process.stderr.write(`💀 Emergency cleanup cleared ${cleared} resources\n`);
        }
    };
    // Cleanup on various exit scenarios
    process.on('exit', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('SIGINT', cleanup);
    process.on('uncaughtException', (error) => {
        process.stderr.write(`Uncaught exception: ${String(error)}\n`);
        cleanup();
        process.exit(1);
    });
    process.on('unhandledRejection', (reason, promise) => {
        process.stderr.write(`Unhandled rejection at: ${String(promise)} reason: ${String(reason)}\n`);
        cleanup();
        process.exit(1);
    });
}
// Initialize process handlers when module is loaded
setupProcessHandlers();
//# sourceMappingURL=global-resource-tracker.js.map