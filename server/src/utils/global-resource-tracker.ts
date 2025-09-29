/**
 * Global Resource Tracker
 *
 * Tracks all Node.js resources (timers, intervals, etc.) to prevent hanging processes
 * during testing and ensure proper cleanup on shutdown.
 */

export interface TrackedResource {
  id: string;
  type: 'timeout' | 'interval' | 'immediate';
  handle: NodeJS.Timeout | NodeJS.Immediate;
  source: string; // Component or function that created it
  createdAt: Date;
  description?: string;
}

class GlobalResourceTracker {
  private resources = new Map<string, TrackedResource>();
  private nextId = 1;
  private enabled = true;

  /**
   * Enable or disable tracking (useful for production environments)
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Track a setTimeout
   */
  trackTimeout(handle: NodeJS.Timeout, source: string, description?: string): string {
    if (!this.enabled) return '';

    const id = `timeout_${this.nextId++}`;
    this.resources.set(id, {
      id,
      type: 'timeout',
      handle,
      source,
      createdAt: new Date(),
      description
    });
    return id;
  }

  /**
   * Track a setInterval
   */
  trackInterval(handle: NodeJS.Timeout, source: string, description?: string): string {
    if (!this.enabled) return '';

    const id = `interval_${this.nextId++}`;
    this.resources.set(id, {
      id,
      type: 'interval',
      handle,
      source,
      createdAt: new Date(),
      description
    });
    return id;
  }

  /**
   * Track a setImmediate
   */
  trackImmediate(handle: NodeJS.Immediate, source: string, description?: string): string {
    if (!this.enabled) return '';

    const id = `immediate_${this.nextId++}`;
    this.resources.set(id, {
      id,
      type: 'immediate',
      handle,
      source,
      createdAt: new Date(),
      description
    });
    return id;
  }

  /**
   * Untrack a resource (called when it's manually cleared)
   */
  untrack(id: string): boolean {
    return this.resources.delete(id);
  }

  /**
   * Clear a specific resource
   */
  clearResource(id: string): boolean {
    const resource = this.resources.get(id);
    if (!resource) return false;

    try {
      switch (resource.type) {
        case 'timeout':
        case 'interval':
          clearTimeout(resource.handle as NodeJS.Timeout);
          break;
        case 'immediate':
          clearImmediate(resource.handle as NodeJS.Immediate);
          break;
      }
      this.resources.delete(id);
      return true;
    } catch (error) {
      console.warn(`Failed to clear resource ${id}:`, error);
      return false;
    }
  }

  /**
   * Emergency cleanup - clear ALL tracked resources
   */
  emergencyCleanup(): number {
    let cleared = 0;

    for (const [id, resource] of this.resources) {
      try {
        switch (resource.type) {
          case 'timeout':
          case 'interval':
            clearTimeout(resource.handle as NodeJS.Timeout);
            break;
          case 'immediate':
            clearImmediate(resource.handle as NodeJS.Immediate);
            break;
        }
        cleared++;
      } catch (error) {
        console.warn(`Failed to clear resource ${id} during emergency cleanup:`, error);
      }
    }

    this.resources.clear();
    return cleared;
  }

  /**
   * Get diagnostic information about active resources
   */
  getDiagnostics(): {
    totalResources: number;
    byType: Record<string, number>;
    bySource: Record<string, number>;
    oldestResource?: TrackedResource;
    resources: TrackedResource[];
  } {
    const resources = Array.from(this.resources.values());
    const byType: Record<string, number> = {};
    const bySource: Record<string, number> = {};

    for (const resource of resources) {
      byType[resource.type] = (byType[resource.type] || 0) + 1;
      bySource[resource.source] = (bySource[resource.source] || 0) + 1;
    }

    const oldestResource = resources
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];

    return {
      totalResources: resources.length,
      byType,
      bySource,
      oldestResource,
      resources: resources.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    };
  }

  /**
   * Log diagnostic information
   */
  logDiagnostics(): void {
    const diagnostics = this.getDiagnostics();

    if (diagnostics.totalResources === 0) {
      console.log('✅ No active tracked resources');
      return;
    }

    console.log(`⚠️ ${diagnostics.totalResources} active resources preventing process exit:`);
    console.log('📊 By type:', diagnostics.byType);
    console.log('📊 By source:', diagnostics.bySource);

    if (diagnostics.oldestResource) {
      const age = Date.now() - diagnostics.oldestResource.createdAt.getTime();
      console.log(`⏰ Oldest resource: ${diagnostics.oldestResource.id} (${Math.round(age/1000)}s old) from ${diagnostics.oldestResource.source}`);
    }

    // Log details of long-running resources (> 10 seconds)
    const longRunning = diagnostics.resources.filter(r =>
      Date.now() - r.createdAt.getTime() > 10000
    );

    if (longRunning.length > 0) {
      console.log('🐛 Long-running resources (>10s):');
      for (const resource of longRunning) {
        const age = Math.round((Date.now() - resource.createdAt.getTime()) / 1000);
        console.log(`   ${resource.id}: ${resource.type} from ${resource.source} (${age}s) - ${resource.description || 'no description'}`);
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

export function trackedSetTimeout(
  callback: (...args: any[]) => void,
  delay: number,
  source: string,
  description?: string
): NodeJS.Timeout {
  const handle = setTimeout(() => {
    // Auto-untrack when timeout executes
    globalResourceTracker.untrack(id);
    callback();
  }, delay);

  const id = globalResourceTracker.trackTimeout(handle, source, description);
  return handle;
}

export function trackedSetInterval(
  callback: (...args: any[]) => void,
  delay: number,
  source: string,
  description?: string
): NodeJS.Timeout {
  const handle = setInterval(callback, delay);
  globalResourceTracker.trackInterval(handle, source, description);
  return handle;
}

export function trackedClearTimeout(handle: NodeJS.Timeout): void {
  clearTimeout(handle);
  // Note: We don't have the ID here, so we can't untrack automatically
  // This is why the auto-untrack in trackedSetTimeout is important
}

export function trackedClearInterval(handle: NodeJS.Timeout): void {
  clearInterval(handle);
  // Note: Manual untracking would require keeping a reverse mapping
  // For now, users should call globalResourceTracker.untrack() manually if needed
}

/**
 * Add emergency cleanup to process exit handlers
 */
function setupProcessHandlers(): void {
  const cleanup = () => {
    const cleared = globalResourceTracker.emergencyCleanup();
    if (cleared > 0) {
      console.log(`💀 Emergency cleanup cleared ${cleared} resources`);
    }
  };

  // Cleanup on various exit scenarios
  process.on('exit', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);
  process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    cleanup();
    process.exit(1);
  });
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled rejection at:', promise, 'reason:', reason);
    cleanup();
    process.exit(1);
  });
}

// Initialize process handlers when module is loaded
setupProcessHandlers();