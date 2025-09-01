/**
 * Stateful Framework State Manager
 * 
 * Manages the active framework methodology state and provides framework switching capabilities.
 * This is separate from execution strategy analysis - it handles WHICH framework methodology 
 * to apply (CAGEERF, ReACT, 5W1H, SCAMPER) while semantic analysis handles execution strategies.
 */

import { EventEmitter } from "events";
import { Logger } from "../logging/index.js";
import { FrameworkManager, FrameworkDefinition, FrameworkExecutionContext, FrameworkSelectionCriteria, createFrameworkManager } from "./framework-manager.js";

/**
 * Framework state information
 */
export interface FrameworkState {
  activeFramework: string;
  previousFramework: string | null;
  switchedAt: Date;
  switchReason: string;
  isHealthy: boolean;
  performanceMetrics: {
    switchCount: number;
    averageResponseTime: number;
    errorCount: number;
  };
}

/**
 * Framework switch request
 */
export interface FrameworkSwitchRequest {
  targetFramework: string;
  reason?: string;
  criteria?: FrameworkSelectionCriteria;
}

/**
 * Framework system health information
 */
export interface FrameworkSystemHealth {
  status: "healthy" | "degraded" | "error";
  activeFramework: string;
  availableFrameworks: string[];
  lastSwitchTime: Date | null;
  performanceMetrics: {
    totalSwitches: number;
    successfulSwitches: number;
    failedSwitches: number;
    averageResponseTime: number;
  };
  issues: string[];
}

/**
 * Stateful Framework State Manager Events
 */
export interface FrameworkStateManagerEvents {
  'framework-switched': (previousFramework: string, newFramework: string, reason: string) => void;
  'framework-error': (framework: string, error: Error) => void;
  'health-changed': (health: FrameworkSystemHealth) => void;
}

/**
 * Stateful Framework State Manager
 * 
 * Maintains framework state across operations and provides switching capabilities
 */
export class FrameworkStateManager extends EventEmitter {
  private logger: Logger;
  private frameworkManager: FrameworkManager | null = null;
  private currentState: FrameworkState;
  private switchHistory: Array<{ from: string; to: string; timestamp: Date; reason: string }> = [];
  private performanceMetrics = {
    totalSwitches: 0,
    successfulSwitches: 0,
    failedSwitches: 0,
    averageResponseTime: 0,
    errorCount: 0
  };
  private isInitialized: boolean = false;

  constructor(logger: Logger) {
    super();
    this.logger = logger;
    
    // Initialize with default framework state
    this.currentState = {
      activeFramework: 'CAGEERF', // Default to CAGEERF
      previousFramework: null,
      switchedAt: new Date(),
      switchReason: 'Initial framework selection',
      isHealthy: true,
      performanceMetrics: {
        switchCount: 0,
        averageResponseTime: 0,
        errorCount: 0
      }
    };
  }

  /**
   * Initialize the framework state manager
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger.debug("FrameworkStateManager already initialized");
      return;
    }

    this.logger.info("Initializing Framework State Manager...");
    
    try {
      // Initialize framework manager
      this.frameworkManager = await createFrameworkManager(this.logger);
      
      // Validate default framework exists
      const defaultFramework = this.frameworkManager.getFramework(this.currentState.activeFramework);
      if (!defaultFramework) {
        throw new Error(`Default framework '${this.currentState.activeFramework}' not found`);
      }

      this.isInitialized = true;
      this.logger.info(`Framework State Manager initialized with active framework: ${this.currentState.activeFramework}`);
      
      // Emit initial health status
      this.emit('health-changed', this.getSystemHealth());
      
    } catch (error) {
      this.logger.error("Failed to initialize Framework State Manager:", error);
      throw error;
    }
  }

  /**
   * Get current framework state
   */
  getCurrentState(): FrameworkState {
    this.ensureInitialized();
    return { ...this.currentState };
  }

  /**
   * Get active framework definition
   */
  getActiveFramework(): FrameworkDefinition {
    this.ensureInitialized();
    const framework = this.frameworkManager!.getFramework(this.currentState.activeFramework);
    if (!framework) {
      throw new Error(`Active framework '${this.currentState.activeFramework}' not found`);
    }
    return framework;
  }

  /**
   * Get all available frameworks
   */
  getAvailableFrameworks(): FrameworkDefinition[] {
    this.ensureInitialized();
    return this.frameworkManager!.listFrameworks(true); // Only enabled frameworks
  }

  /**
   * Switch to a different framework
   */
  async switchFramework(request: FrameworkSwitchRequest): Promise<boolean> {
    this.ensureInitialized();
    
    const startTime = performance.now();
    this.performanceMetrics.totalSwitches++;
    
    try {
      this.logger.info(`Attempting to switch framework from '${this.currentState.activeFramework}' to '${request.targetFramework}'`);
      
      // Validate target framework exists
      const targetFramework = this.frameworkManager!.getFramework(request.targetFramework);
      if (!targetFramework) {
        const availableFrameworks = this.frameworkManager!.listFrameworks().map(f => f.id).join(', ');
        const errorMsg = `Target framework '${request.targetFramework}' not found. Available frameworks: [${availableFrameworks}]`;
        this.logger.error(errorMsg);
        throw new Error(errorMsg);
      }

      this.logger.debug(`Target framework found: ${targetFramework.name} (${targetFramework.id})`);

      if (!targetFramework.enabled) {
        const errorMsg = `Target framework '${request.targetFramework}' (${targetFramework.name}) is disabled`;
        this.logger.error(errorMsg);
        throw new Error(errorMsg);
      }

      // Check if already active
      if (this.currentState.activeFramework === request.targetFramework) {
        this.logger.info(`Framework '${request.targetFramework}' is already active`);
        return true;
      }

      // Perform the switch
      const previousFramework = this.currentState.activeFramework;
      const switchReason = request.reason || `Switched to ${request.targetFramework}`;
      
      // Update state
      this.currentState = {
        activeFramework: request.targetFramework,
        previousFramework: previousFramework,
        switchedAt: new Date(),
        switchReason: switchReason,
        isHealthy: true,
        performanceMetrics: {
          switchCount: this.currentState.performanceMetrics.switchCount + 1,
          averageResponseTime: this.currentState.performanceMetrics.averageResponseTime,
          errorCount: this.currentState.performanceMetrics.errorCount
        }
      };

      // Record switch history
      this.switchHistory.push({
        from: previousFramework,
        to: request.targetFramework,
        timestamp: new Date(),
        reason: switchReason
      });

      // Update performance metrics
      const switchTime = performance.now() - startTime;
      this.updatePerformanceMetrics(switchTime, true);

      this.logger.info(`✅ Framework switch successful: '${previousFramework}' -> '${request.targetFramework}' (${switchTime.toFixed(1)}ms)`);
      this.logger.info(`New active framework: ${targetFramework.name} - ${targetFramework.description}`);
      
      // Emit events
      this.emit('framework-switched', previousFramework, request.targetFramework, switchReason);
      this.emit('health-changed', this.getSystemHealth());
      
      return true;

    } catch (error) {
      const switchTime = performance.now() - startTime;
      this.updatePerformanceMetrics(switchTime, false);
      this.performanceMetrics.errorCount++;
      this.currentState.performanceMetrics.errorCount++;
      this.currentState.isHealthy = false;

      this.logger.error(`Failed to switch framework to '${request.targetFramework}':`, error);
      this.emit('framework-error', request.targetFramework, error instanceof Error ? error : new Error(String(error)));
      
      return false;
    }
  }

  /**
   * Generate execution context using active framework
   */
  generateExecutionContext(prompt: any, criteria?: FrameworkSelectionCriteria): FrameworkExecutionContext {
    this.ensureInitialized();
    
    // Use framework manager to generate context with active framework
    const mergedCriteria: FrameworkSelectionCriteria = {
      userPreference: this.currentState.activeFramework as any,
      ...criteria
    };
    
    return this.frameworkManager!.generateExecutionContext(prompt, mergedCriteria);
  }

  /**
   * Get framework system health
   */
  getSystemHealth(): FrameworkSystemHealth {
    this.ensureInitialized();
    
    const issues: string[] = [];
    let status: "healthy" | "degraded" | "error" = "healthy";
    
    // Check for health issues
    if (this.currentState.performanceMetrics.errorCount > 0) {
      issues.push(`${this.currentState.performanceMetrics.errorCount} framework errors detected`);
      status = this.currentState.performanceMetrics.errorCount > 5 ? "error" : "degraded";
    }
    
    if (!this.currentState.isHealthy) {
      issues.push("Framework system is in unhealthy state");
      status = "error";
    }

    const activeFramework = this.frameworkManager!.getFramework(this.currentState.activeFramework);
    if (!activeFramework?.enabled) {
      issues.push(`Active framework '${this.currentState.activeFramework}' is disabled`);
      status = "error";
    }

    return {
      status,
      activeFramework: this.currentState.activeFramework,
      availableFrameworks: this.frameworkManager!.listFrameworks(true).map(f => f.id),
      lastSwitchTime: this.switchHistory.length > 0 ? this.switchHistory[this.switchHistory.length - 1].timestamp : null,
      performanceMetrics: { ...this.performanceMetrics },
      issues
    };
  }

  /**
   * Get framework switch history
   */
  getSwitchHistory(limit?: number): Array<{ from: string; to: string; timestamp: Date; reason: string }> {
    const history = [...this.switchHistory].reverse(); // Most recent first
    return limit ? history.slice(0, limit) : history;
  }

  /**
   * Reset performance metrics
   */
  resetMetrics(): void {
    this.performanceMetrics = {
      totalSwitches: 0,
      successfulSwitches: 0,
      failedSwitches: 0,
      averageResponseTime: 0,
      errorCount: 0
    };
    
    this.currentState.performanceMetrics = {
      switchCount: 0,
      averageResponseTime: 0,
      errorCount: 0
    };
    
    this.logger.info("Framework state manager metrics reset");
  }

  // Private helper methods

  private ensureInitialized(): void {
    if (!this.isInitialized || !this.frameworkManager) {
      throw new Error("FrameworkStateManager not initialized. Call initialize() first.");
    }
  }

  private updatePerformanceMetrics(responseTime: number, success: boolean): void {
    if (success) {
      this.performanceMetrics.successfulSwitches++;
    } else {
      this.performanceMetrics.failedSwitches++;
    }
    
    // Update average response time
    const totalOperations = this.performanceMetrics.successfulSwitches + this.performanceMetrics.failedSwitches;
    this.performanceMetrics.averageResponseTime = 
      (this.performanceMetrics.averageResponseTime * (totalOperations - 1) + responseTime) / totalOperations;
    
    this.currentState.performanceMetrics.averageResponseTime = this.performanceMetrics.averageResponseTime;
  }
}

/**
 * Create and initialize framework state manager
 */
export async function createFrameworkStateManager(logger: Logger): Promise<FrameworkStateManager> {
  const manager = new FrameworkStateManager(logger);
  await manager.initialize();
  return manager;
}