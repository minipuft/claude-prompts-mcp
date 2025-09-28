/**
 * Stateful Framework State Manager
 * 
 * Manages the active framework methodology state and provides framework switching capabilities.
 * This tracks switching mechanics (timing, success/failure, counts) and framework state.
 * This is separate from execution strategy analysis - it handles WHICH framework methodology 
 * to apply (CAGEERF, ReACT, 5W1H, SCAMPER) while semantic analysis handles execution strategies.
 */

import { EventEmitter } from "events";
import { Logger } from "../logging/index.js";
import { FrameworkManager, FrameworkDefinition, FrameworkExecutionContext, FrameworkSelectionCriteria, createFrameworkManager } from "./framework-manager.js";
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Persisted framework state (saved to file)
 */
export interface PersistedFrameworkState {
  version: string;
  frameworkSystemEnabled: boolean;
  activeFramework: string;
  lastSwitchedAt: string;
  switchReason: string;
}

/**
 * Framework state information
 */
export interface FrameworkState {
  activeFramework: string;
  previousFramework: string | null;
  switchedAt: Date;
  switchReason: string;
  isHealthy: boolean;
  frameworkSystemEnabled: boolean; // NEW: Controls whether framework system is enabled/disabled
  switchingMetrics: {
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
  frameworkSystemEnabled: boolean; // NEW: Whether framework system is enabled
  availableFrameworks: string[];
  lastSwitchTime: Date | null;
  switchingMetrics: {
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
  'framework-system-toggled': (enabled: boolean, reason: string) => void; // NEW: Framework system enabled/disabled
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
  private switchingMetrics = {
    totalSwitches: 0,
    successfulSwitches: 0,
    failedSwitches: 0,
    averageResponseTime: 0,
    errorCount: 0
  };
  private isInitialized: boolean = false;
  private stateFilePath: string;

  constructor(logger: Logger, serverRoot?: string) {
    super();
    this.logger = logger;

    // Set state file path - place in config directory for better organization
    const rootPath = serverRoot || process.cwd();
    this.stateFilePath = path.join(rootPath, 'config', 'framework-state.json');

    // Initialize with default framework state (will be overridden by loadPersistedState)
    this.currentState = {
      activeFramework: 'CAGEERF', // Default to CAGEERF
      previousFramework: null,
      switchedAt: new Date(),
      switchReason: 'Initial framework selection',
      isHealthy: true,
      frameworkSystemEnabled: false, // NEW: Framework system disabled by default (changed from true)
      switchingMetrics: {
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

    // Load persisted state before setting up framework manager
    await this.loadPersistedState();

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
   * Load persisted state from file
   */
  private async loadPersistedState(): Promise<void> {
    try {
      const stateContent = await fs.readFile(this.stateFilePath, 'utf-8');
      const persistedState: PersistedFrameworkState = JSON.parse(stateContent);

      // Validate and apply persisted state
      if (this.isValidPersistedState(persistedState)) {
        this.currentState.frameworkSystemEnabled = persistedState.frameworkSystemEnabled;
        this.currentState.activeFramework = persistedState.activeFramework;
        this.currentState.switchedAt = new Date(persistedState.lastSwitchedAt);
        this.currentState.switchReason = persistedState.switchReason;

        this.logger.info(`✅ Loaded persisted framework state: ${persistedState.frameworkSystemEnabled ? 'enabled' : 'disabled'}, active: ${persistedState.activeFramework}`);
      } else {
        this.logger.warn('⚠️ Invalid persisted state format, using defaults');
        await this.saveStateToFile(); // Save valid defaults
      }
    } catch (error) {
      if ((error as any)?.code === 'ENOENT') {
        this.logger.info('📁 No persisted framework state found, using defaults');
        await this.saveStateToFile(); // Create initial state file
      } else {
        this.logger.warn(`⚠️ Failed to load persisted state: ${error instanceof Error ? error.message : String(error)}, using defaults`);
        await this.saveStateToFile(); // Save valid defaults
      }
    }
  }

  /**
   * Save current state to file
   */
  private async saveStateToFile(): Promise<void> {
    try {
      const persistedState: PersistedFrameworkState = {
        version: '1.0.0',
        frameworkSystemEnabled: this.currentState.frameworkSystemEnabled,
        activeFramework: this.currentState.activeFramework,
        lastSwitchedAt: this.currentState.switchedAt.toISOString(),
        switchReason: this.currentState.switchReason
      };

      // Ensure config directory exists
      const configDir = path.dirname(this.stateFilePath);
      await fs.mkdir(configDir, { recursive: true });

      await fs.writeFile(this.stateFilePath, JSON.stringify(persistedState, null, 2));
      this.logger.debug(`💾 Framework state saved to ${this.stateFilePath}`);
    } catch (error) {
      this.logger.error(`❌ Failed to save framework state: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Validate persisted state structure
   */
  private isValidPersistedState(state: any): state is PersistedFrameworkState {
    return (
      state &&
      typeof state.version === 'string' &&
      typeof state.frameworkSystemEnabled === 'boolean' &&
      typeof state.activeFramework === 'string' &&
      typeof state.lastSwitchedAt === 'string' &&
      typeof state.switchReason === 'string' &&
      ['CAGEERF', 'ReACT', '5W1H', 'SCAMPER'].includes(state.activeFramework)
    );
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
    this.switchingMetrics.totalSwitches++;
    
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
        frameworkSystemEnabled: this.currentState.frameworkSystemEnabled,
        switchingMetrics: {
          switchCount: this.currentState.switchingMetrics.switchCount + 1,
          averageResponseTime: this.currentState.switchingMetrics.averageResponseTime,
          errorCount: this.currentState.switchingMetrics.errorCount
        }
      };

      // Record switch history
      this.switchHistory.push({
        from: previousFramework,
        to: request.targetFramework,
        timestamp: new Date(),
        reason: switchReason
      });

      // Update switching performance metrics
      const switchTime = performance.now() - startTime;
      this.updateSwitchingMetrics(switchTime, true);

      // Save state to file
      this.saveStateToFile().catch(error => {
        this.logger.error(`Failed to persist framework switch state: ${error instanceof Error ? error.message : String(error)}`);
      });

      this.logger.info(`✅ Framework switch successful: '${previousFramework}' -> '${request.targetFramework}' (${switchTime.toFixed(1)}ms)`);
      this.logger.info(`New active framework: ${targetFramework.name} - ${targetFramework.description}`);
      
      // Emit events
      this.emit('framework-switched', previousFramework, request.targetFramework, switchReason);
      this.emit('health-changed', this.getSystemHealth());
      
      return true;

    } catch (error) {
      const switchTime = performance.now() - startTime;
      this.updateSwitchingMetrics(switchTime, false);
      this.switchingMetrics.errorCount++;
      this.currentState.switchingMetrics.errorCount++;
      this.currentState.isHealthy = false;

      this.logger.error(`Failed to switch framework to '${request.targetFramework}':`, error);
      this.emit('framework-error', request.targetFramework, error instanceof Error ? error : new Error(String(error)));
      
      return false;
    }
  }

  /**
   * Generate execution context using active framework
   */
  generateExecutionContext(prompt: any, criteria?: FrameworkSelectionCriteria): FrameworkExecutionContext | null {
    this.ensureInitialized();

    // NEW: Return null if framework system is disabled
    if (!this.currentState.frameworkSystemEnabled) {
      return null;
    }

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
    if (this.currentState.switchingMetrics.errorCount > 0) {
      issues.push(`${this.currentState.switchingMetrics.errorCount} framework switching errors detected`);
      status = this.currentState.switchingMetrics.errorCount > 5 ? "error" : "degraded";
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
      frameworkSystemEnabled: this.currentState.frameworkSystemEnabled, // NEW: Include enabled state
      availableFrameworks: this.frameworkManager!.listFrameworks(true).map(f => f.id),
      lastSwitchTime: this.switchHistory.length > 0 ? this.switchHistory[this.switchHistory.length - 1].timestamp : null,
      switchingMetrics: { ...this.switchingMetrics },
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
   * Reset switching performance metrics
   */
  resetMetrics(): void {
    this.switchingMetrics = {
      totalSwitches: 0,
      successfulSwitches: 0,
      failedSwitches: 0,
      averageResponseTime: 0,
      errorCount: 0
    };

    this.currentState.switchingMetrics = {
      switchCount: 0,
      averageResponseTime: 0,
      errorCount: 0
    };

    this.logger.info("Framework state manager switching metrics reset");
  }

  /**
   * Enable the framework system
   */
  enableFrameworkSystem(reason?: string): void {
    this.ensureInitialized();

    if (this.currentState.frameworkSystemEnabled) {
      this.logger.info("Framework system is already enabled");
      return;
    }

    const enableReason = reason || "Framework system enabled";

    this.currentState.frameworkSystemEnabled = true;
    this.currentState.switchReason = enableReason;
    this.currentState.switchedAt = new Date();

    this.logger.info(`✅ Framework system enabled: ${enableReason}`);

    // Save state to file
    this.saveStateToFile().catch(error => {
      this.logger.error(`Failed to persist framework enable state: ${error instanceof Error ? error.message : String(error)}`);
    });

    // Emit events
    this.emit('framework-system-toggled', true, enableReason);
    this.emit('health-changed', this.getSystemHealth());
  }

  /**
   * Disable the framework system
   */
  disableFrameworkSystem(reason?: string): void {
    this.ensureInitialized();

    if (!this.currentState.frameworkSystemEnabled) {
      this.logger.info("Framework system is already disabled");
      return;
    }

    const disableReason = reason || "Framework system disabled";

    this.currentState.frameworkSystemEnabled = false;
    this.currentState.switchReason = disableReason;
    this.currentState.switchedAt = new Date();

    this.logger.info(`🚫 Framework system disabled: ${disableReason}`);

    // Save state to file
    this.saveStateToFile().catch(error => {
      this.logger.error(`Failed to persist framework disable state: ${error instanceof Error ? error.message : String(error)}`);
    });

    // Emit events
    this.emit('framework-system-toggled', false, disableReason);
    this.emit('health-changed', this.getSystemHealth());
  }

  /**
   * Check if framework system is enabled
   */
  isFrameworkSystemEnabled(): boolean {
    this.ensureInitialized();
    return this.currentState.frameworkSystemEnabled;
  }

  /**
   * Set framework system enabled state (for config loading)
   */
  setFrameworkSystemEnabled(enabled: boolean, reason?: string): void {
    if (enabled) {
      this.enableFrameworkSystem(reason || "Loaded from configuration");
    } else {
      this.disableFrameworkSystem(reason || "Loaded from configuration");
    }
  }

  // Private helper methods

  private ensureInitialized(): void {
    if (!this.isInitialized || !this.frameworkManager) {
      throw new Error("FrameworkStateManager not initialized. Call initialize() first.");
    }
  }

  private updateSwitchingMetrics(responseTime: number, success: boolean): void {
    if (success) {
      this.switchingMetrics.successfulSwitches++;
    } else {
      this.switchingMetrics.failedSwitches++;
    }
    
    // Update average response time for switching operations
    const totalOperations = this.switchingMetrics.successfulSwitches + this.switchingMetrics.failedSwitches;
    this.switchingMetrics.averageResponseTime = 
      (this.switchingMetrics.averageResponseTime * (totalOperations - 1) + responseTime) / totalOperations;
    
    this.currentState.switchingMetrics.averageResponseTime = this.switchingMetrics.averageResponseTime;
  }
}

/**
 * Create and initialize framework state manager
 */
export async function createFrameworkStateManager(logger: Logger, serverRoot?: string): Promise<FrameworkStateManager> {
  const manager = new FrameworkStateManager(logger, serverRoot);
  await manager.initialize();
  return manager;
}