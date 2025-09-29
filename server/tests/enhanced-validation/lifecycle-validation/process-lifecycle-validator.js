/**
 * Process Lifecycle Validation System
 *
 * Eliminates the need for emergency process.exit() calls by ensuring proper
 * application shutdown and resource cleanup validation.
 */

/**
 * Process Lifecycle Validator
 *
 * Validates clean application shutdown and resource management
 */
export class ProcessLifecycleValidator {
  constructor(logger) {
    this.logger = logger;
    this.trackedResources = new Set();
    this.shutdownCallbacks = [];
  }

  /**
   * Validate that an Application instance shuts down cleanly
   */
  async validateCleanShutdown(applicationInstance, maxShutdownTime = 5000) {
    this.logger.debug('[LIFECYCLE VALIDATOR] Starting clean shutdown validation');

    const startTime = Date.now();
    const initialMemory = this.getMemorySnapshot();

    try {
      // Test that shutdown method exists
      if (typeof applicationInstance.shutdown !== 'function') {
        return {
          success: false,
          error: 'Application instance missing shutdown method',
          shutdownTime: 0,
          resourcesCleared: false,
          memoryReclaimed: false
        };
      }

      // Test shutdown with timeout
      const shutdownPromise = applicationInstance.shutdown();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Shutdown timeout')), maxShutdownTime)
      );

      await Promise.race([shutdownPromise, timeoutPromise]);

      const shutdownTime = Date.now() - startTime;

      // Allow brief time for cleanup to complete
      await new Promise(resolve => setTimeout(resolve, 100));

      const finalMemory = this.getMemorySnapshot();
      const resourcesCleared = await this.validateResourceCleanup();

      this.logger.debug('[LIFECYCLE VALIDATOR] Clean shutdown validation completed', {
        shutdownTime,
        resourcesCleared,
        memoryDelta: finalMemory.heapUsed - initialMemory.heapUsed
      });

      return {
        success: true,
        shutdownTime,
        resourcesCleared,
        memoryReclaimed: finalMemory.heapUsed <= initialMemory.heapUsed * 1.1, // Allow 10% tolerance
        initialMemory: initialMemory.heapUsed,
        finalMemory: finalMemory.heapUsed
      };

    } catch (error) {
      const shutdownTime = Date.now() - startTime;

      return {
        success: false,
        error: error.message,
        shutdownTime,
        resourcesCleared: false,
        memoryReclaimed: false
      };
    }
  }

  /**
   * Detect resource leaks by monitoring active handles
   */
  async detectResourceLeaks() {
    const activeHandles = process._getActiveHandles();
    const activeRequests = process._getActiveRequests();

    // Filter out expected system handles
    const userHandles = activeHandles.filter(handle => {
      // Keep common system handles but filter out test-related ones
      const handleType = handle.constructor?.name || 'unknown';
      return !['TTYWrap', 'SignalWrap', 'Process'].includes(handleType);
    });

    const leakReport = {
      hasLeaks: userHandles.length > 0 || activeRequests.length > 0,
      activeHandles: userHandles.length,
      activeRequests: activeRequests.length,
      handleTypes: userHandles.map(h => h.constructor?.name || 'unknown'),
      recommendations: []
    };

    if (leakReport.hasLeaks) {
      leakReport.recommendations.push('Clear all timers and intervals before test completion');
      leakReport.recommendations.push('Close all open connections and streams');
      leakReport.recommendations.push('Remove all event listeners');
    }

    this.logger.debug('[LIFECYCLE VALIDATOR] Resource leak detection completed', leakReport);

    return leakReport;
  }

  /**
   * Validate global resource cleanup using existing tracker
   */
  async validateResourceCleanup() {
    try {
      // Try to import and use the existing global resource tracker
      const { globalResourceTracker } = await import('../../../dist/utils/global-resource-tracker.js');

      const trackedResources = globalResourceTracker.getAllResources();
      const hasTrackedResources = trackedResources.length > 0;

      if (hasTrackedResources) {
        this.logger.debug(`[LIFECYCLE VALIDATOR] Found ${trackedResources.length} tracked resources`);

        // Trigger cleanup and see how many are cleared
        const clearedCount = globalResourceTracker.emergencyCleanup();

        return {
          hadTrackedResources: true,
          clearedResources: clearedCount,
          allResourcesCleared: clearedCount === trackedResources.length
        };
      }

      return {
        hadTrackedResources: false,
        clearedResources: 0,
        allResourcesCleared: true
      };

    } catch (error) {
      // If global resource tracker is not available, do basic validation
      this.logger.debug('[LIFECYCLE VALIDATOR] Global resource tracker not available, using basic validation');

      const leakReport = await this.detectResourceLeaks();
      return {
        hadTrackedResources: false,
        clearedResources: 0,
        allResourcesCleared: !leakReport.hasLeaks
      };
    }
  }

  /**
   * Enforce timeout compliance - test should complete without process.exit()
   */
  async enforceTimeoutCompliance(testFunction, maxTime = 30000) {
    const startTime = Date.now();
    let completed = false;
    let forceExitUsed = false;

    // Monitor for process.exit calls
    const originalExit = process.exit;
    process.exit = function(code) {
      forceExitUsed = true;
      completed = true;

      // Restore original exit
      process.exit = originalExit;

      throw new Error(`Test used process.exit(${code}) - should complete naturally`);
    };

    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Test timeout - should complete faster')), maxTime)
      );

      const testPromise = testFunction();

      await Promise.race([testPromise, timeoutPromise]);

      const duration = Date.now() - startTime;
      completed = true;

      // Restore original exit
      process.exit = originalExit;

      return {
        success: true,
        duration,
        forceExitUsed: false,
        completedNaturally: true
      };

    } catch (error) {
      const duration = Date.now() - startTime;

      // Restore original exit
      process.exit = originalExit;

      return {
        success: false,
        duration,
        forceExitUsed,
        completedNaturally: completed && !forceExitUsed,
        error: error.message
      };
    }
  }

  /**
   * Register cleanup callback for test teardown
   */
  registerCleanupCallback(callback) {
    this.shutdownCallbacks.push(callback);
  }

  /**
   * Execute all cleanup callbacks
   */
  async executeCleanup() {
    const results = [];

    for (const callback of this.shutdownCallbacks) {
      try {
        await callback();
        results.push({ success: true });
      } catch (error) {
        results.push({ success: false, error: error.message });
      }
    }

    return results;
  }

  /**
   * Get memory usage snapshot
   */
  getMemorySnapshot() {
    const usage = process.memoryUsage();
    return {
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024 * 100) / 100, // MB
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024 * 100) / 100, // MB
      rss: Math.round(usage.rss / 1024 / 1024 * 100) / 100, // MB
      external: Math.round(usage.external / 1024 / 1024 * 100) / 100 // MB
    };
  }

  /**
   * Comprehensive lifecycle validation report
   */
  async generateLifecycleReport(applicationInstance) {
    const startTime = Date.now();

    const shutdownResult = await this.validateCleanShutdown(applicationInstance);
    const leakReport = await this.detectResourceLeaks();
    const resourceCleanup = await this.validateResourceCleanup();

    const totalTime = Date.now() - startTime;

    return {
      timestamp: new Date(),
      totalValidationTime: totalTime,
      shutdown: shutdownResult,
      resourceLeaks: leakReport,
      resourceCleanup,
      overallSuccess: shutdownResult.success && !leakReport.hasLeaks && resourceCleanup.allResourcesCleared,
      recommendations: [
        ...leakReport.recommendations,
        ...(shutdownResult.success ? [] : ['Implement proper shutdown method']),
        ...(resourceCleanup.allResourcesCleared ? [] : ['Ensure all resources are tracked and cleaned'])
      ]
    };
  }
}

/**
 * Factory function for creating validator instance
 */
export function createProcessLifecycleValidator(logger) {
  return new ProcessLifecycleValidator(logger);
}