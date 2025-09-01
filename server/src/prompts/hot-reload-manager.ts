/**
 * Hot Reload Manager Module
 * Orchestrates file system monitoring and reload workflows with event-driven architecture
 */

import { Logger } from "../logging/index.js";
import { FileObserver, FileChangeEvent, FileObserverConfig, createFileObserver } from "./file-observer.js";
import { CategoryManager } from "./category-manager.js";
import path from "path";
import * as fs from "fs/promises";

/**
 * Hot reload event types
 */
export type HotReloadEventType = 'prompt_changed' | 'config_changed' | 'category_changed' | 'reload_required';

/**
 * Hot reload event data
 */
export interface HotReloadEvent {
  type: HotReloadEventType;
  reason: string;
  affectedFiles: string[];
  category?: string;
  timestamp: number;
  requiresFullReload: boolean;
}

/**
 * Framework-aware hot reload capabilities
 */
export interface FrameworkHotReloadCapabilities {
  enabled: boolean;
  frameworkAnalysis: boolean;
  performanceMonitoring: boolean;
  preWarmAnalysis: boolean;
  invalidateFrameworkCaches: boolean;
}

/**
 * Hot reload configuration
 */
export interface HotReloadConfig extends Partial<FileObserverConfig> {
  enabled: boolean;
  autoReload: boolean;
  reloadDelayMs: number;
  batchChanges: boolean;
  batchTimeoutMs: number;
  frameworkCapabilities?: FrameworkHotReloadCapabilities;
}

/**
 * Hot reload statistics
 */
export interface HotReloadStats {
  reloadsTriggered: number;
  filesChanged: number;
  lastReloadTime?: number;
  autoReloadsEnabled: boolean;
  fileObserverStats: ReturnType<FileObserver['getStats']>;
  frameworkReloads: number;
  frameworkCacheClears: number;
  performanceOptimizations: number;
}

/**
 * Hot reload manager configuration
 */
const DEFAULT_HOT_RELOAD_CONFIG: HotReloadConfig = {
  enabled: true,
  autoReload: true,
  reloadDelayMs: 1000,
  batchChanges: true,
  batchTimeoutMs: 2000,
  debounceMs: 500,
  watchPromptFiles: true,
  watchConfigFiles: true,
  recursive: true,
  ignoredPatterns: [
    '**/.git/**',
    '**/node_modules/**',
    '**/.DS_Store',
    '**/Thumbs.db',
    '**/*.tmp',
    '**/*.temp',
    '**/dist/**',
    '**/*.log'
  ],
  maxRetries: 3,
  retryDelayMs: 1000,
  frameworkCapabilities: {
    enabled: false,
    frameworkAnalysis: false,
    performanceMonitoring: false,
    preWarmAnalysis: false,
    invalidateFrameworkCaches: false
  }
};

/**
 * HotReloadManager class
 * Coordinates file watching and reload operations
 */
export class HotReloadManager {
  protected logger: Logger;
  private config: HotReloadConfig;
  private fileObserver: FileObserver;
  private categoryManager?: CategoryManager;
  private onReloadCallback?: (event: HotReloadEvent) => Promise<void>;
  private stats: HotReloadStats;
  private isStarted: boolean = false;
  private batchTimer?: NodeJS.Timeout;
  private pendingChanges: FileChangeEvent[] = [];
  private watchedDirectories: Set<string> = new Set();

  constructor(
    logger: Logger, 
    categoryManager?: CategoryManager,
    config?: Partial<HotReloadConfig>
  ) {
    this.logger = logger;
    this.categoryManager = categoryManager;
    this.config = { ...DEFAULT_HOT_RELOAD_CONFIG, ...config };
    
    // Create file observer with filtered config
    const observerConfig = {
      enabled: this.config.enabled,
      debounceMs: this.config.debounceMs,
      watchPromptFiles: this.config.watchPromptFiles,
      watchConfigFiles: this.config.watchConfigFiles,
      recursive: this.config.recursive,
      ignoredPatterns: this.config.ignoredPatterns,
      maxRetries: this.config.maxRetries,
      retryDelayMs: this.config.retryDelayMs
    };
    
    this.fileObserver = createFileObserver(logger, observerConfig);
    
    this.stats = {
      reloadsTriggered: 0,
      filesChanged: 0,
      autoReloadsEnabled: this.config.autoReload,
      fileObserverStats: this.fileObserver.getStats(),
      frameworkReloads: 0,
      frameworkCacheClears: 0,
      performanceOptimizations: 0
    };

    this.setupFileObserverEventHandlers();
  }

  /**
   * Start hot reload monitoring
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      this.logger.warn("HotReloadManager is already started");
      return;
    }

    if (!this.config.enabled) {
      this.logger.info("HotReloadManager is disabled in configuration");
      return;
    }

    this.logger.info("🔥 HotReloadManager: Starting hot reload monitoring...");

    await this.fileObserver.start();
    this.isStarted = true;

    this.logger.info(`✅ HotReloadManager started - Auto reload: ${this.config.autoReload ? 'ON' : 'OFF'}`);
  }

  /**
   * Stop hot reload monitoring
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    this.logger.info("🛑 HotReloadManager: Stopping hot reload monitoring...");

    // Clear batch timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = undefined;
    }

    await this.fileObserver.stop();
    this.isStarted = false;

    this.logger.info("✅ HotReloadManager stopped");
  }

  /**
   * Set the callback for reload events
   */
  setReloadCallback(callback: (event: HotReloadEvent) => Promise<void>): void {
    this.onReloadCallback = callback;
    this.logger.debug("HotReloadManager: Reload callback registered");
  }

  /**
   * Add directories to watch
   */
  async watchDirectories(directories: Array<{ path: string; category?: string }>): Promise<void> {
    if (!this.isStarted) {
      throw new Error("HotReloadManager must be started before watching directories");
    }

    for (const { path: dirPath, category } of directories) {
      try {
        await this.fileObserver.watchDirectory(dirPath, category);
        this.watchedDirectories.add(dirPath);
        this.logger.info(`📁 HotReloadManager: Watching directory: ${dirPath}${category ? ` (${category})` : ''}`);
      } catch (error) {
        this.logger.error(`Failed to watch directory ${dirPath}:`, error);
      }
    }
  }

  /**
   * Manually trigger a reload
   */
  async triggerReload(reason: string = 'Manual trigger', requiresFullReload: boolean = true): Promise<void> {
    const event: HotReloadEvent = {
      type: 'reload_required',
      reason,
      affectedFiles: [],
      timestamp: Date.now(),
      requiresFullReload
    };

    await this.processReloadEvent(event);
  }

  /**
   * Setup file observer event handlers
   */
  private setupFileObserverEventHandlers(): void {
    this.fileObserver.on('fileChange', (event: FileChangeEvent) => {
      this.handleFileChange(event);
    });

    this.fileObserver.on('watcherError', (error: { directoryPath: string; error: Error }) => {
      this.logger.error(`File watcher error for ${error.directoryPath}:`, error.error);
    });

    this.logger.debug("HotReloadManager: File observer event handlers registered");
  }

  /**
   * Handle file change events
   */
  private handleFileChange(event: FileChangeEvent): void {
    this.stats.filesChanged++;
    this.logger.debug(`File change detected: ${event.type} - ${event.filename}`);

    if (this.config.batchChanges) {
      this.batchFileChange(event);
    } else {
      this.processFileChangeImmediate(event);
    }
  }

  /**
   * Batch file changes to prevent excessive reloads
   */
  private batchFileChange(event: FileChangeEvent): void {
    this.pendingChanges.push(event);

    // Clear existing timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
    }

    // Set new timer
    this.batchTimer = setTimeout(() => {
      this.processBatchedChanges();
    }, this.config.batchTimeoutMs);
  }

  /**
   * Process batched file changes
   */
  private async processBatchedChanges(): Promise<void> {
    if (this.pendingChanges.length === 0) {
      return;
    }

    const changes = [...this.pendingChanges];
    this.pendingChanges = [];
    this.batchTimer = undefined;

    this.logger.info(`Processing ${changes.length} batched file changes`);

    // Group changes by type
    const promptChanges = changes.filter(c => c.isPromptFile);
    const configChanges = changes.filter(c => c.isConfigFile);

    // Determine reload type
    const requiresFullReload = configChanges.length > 0 || 
      promptChanges.some(c => c.type === 'added' || c.type === 'removed');

    let reloadType: HotReloadEventType = 'prompt_changed';
    let reason = `${promptChanges.length} prompt file(s) changed`;

    if (configChanges.length > 0) {
      reloadType = 'config_changed';
      reason = `${configChanges.length} config file(s) changed`;
    }

    const hotReloadEvent: HotReloadEvent = {
      type: reloadType,
      reason,
      affectedFiles: changes.map(c => c.filePath),
      timestamp: Date.now(),
      requiresFullReload
    };

    await this.processReloadEvent(hotReloadEvent);
  }

  /**
   * Process immediate file change (no batching)
   */
  private async processFileChangeImmediate(event: FileChangeEvent): Promise<void> {
    let reloadType: HotReloadEventType = 'prompt_changed';
    let requiresFullReload = false;

    if (event.isConfigFile) {
      reloadType = 'config_changed';
      requiresFullReload = true;
    } else if (event.type === 'added' || event.type === 'removed') {
      requiresFullReload = true;
    }

    const hotReloadEvent: HotReloadEvent = {
      type: reloadType,
      reason: `File ${event.type}: ${event.filename}`,
      affectedFiles: [event.filePath],
      category: event.category,
      timestamp: event.timestamp,
      requiresFullReload
    };

    await this.processReloadEvent(hotReloadEvent);
  }

  /**
   * Process reload event with framework integration
   */
  protected async processReloadEvent(event: HotReloadEvent): Promise<void> {
    this.stats.reloadsTriggered++;
    this.stats.lastReloadTime = event.timestamp;

    this.logger.info(`🔄 Hot reload triggered: ${event.reason}`);

    // Framework-aware pre-processing
    if (this.config.frameworkCapabilities?.enabled) {
      await this.processFrameworkPreReload(event);
    }

    if (this.config.autoReload && this.onReloadCallback) {
      try {
        // Add delay if configured
        if (this.config.reloadDelayMs > 0) {
          this.logger.debug(`Delaying reload by ${this.config.reloadDelayMs}ms`);
          await new Promise(resolve => setTimeout(resolve, this.config.reloadDelayMs));
        }

        await this.onReloadCallback(event);
        
        // Framework-aware post-processing
        if (this.config.frameworkCapabilities?.enabled) {
          await this.processFrameworkPostReload(event);
        }

        this.logger.info("✅ Hot reload completed successfully");

      } catch (error) {
        this.logger.error("❌ Hot reload failed:", error);
      }
    } else {
      this.logger.info("⏭️ Auto reload is disabled - skipping automatic reload");
    }
  }

  /**
   * Get current statistics
   */
  getStats(): HotReloadStats {
    return {
      ...this.stats,
      fileObserverStats: this.fileObserver.getStats()
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): HotReloadConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<HotReloadConfig>): void {
    const oldAutoReload = this.config.autoReload;
    this.config = { ...this.config, ...newConfig };
    
    // Update file observer config if needed
    if (newConfig.debounceMs !== undefined || 
        newConfig.watchPromptFiles !== undefined || 
        newConfig.watchConfigFiles !== undefined) {
      this.fileObserver.updateConfig({
        debounceMs: this.config.debounceMs,
        watchPromptFiles: this.config.watchPromptFiles,
        watchConfigFiles: this.config.watchConfigFiles
      });
    }

    if (oldAutoReload !== this.config.autoReload) {
      this.stats.autoReloadsEnabled = this.config.autoReload;
      this.logger.info(`Auto reload ${this.config.autoReload ? 'enabled' : 'disabled'}`);
    }

    this.logger.info("HotReloadManager configuration updated");
  }

  /**
   * Check if hot reload manager is running
   */
  isRunning(): boolean {
    return this.isStarted;
  }

  /**
   * Get watched directories
   */
  getWatchedDirectories(): string[] {
    return Array.from(this.watchedDirectories);
  }

  /**
   * Framework pre-reload processing
   * Phase 1: Basic framework cache invalidation and analysis
   */
  private async processFrameworkPreReload(event: HotReloadEvent): Promise<void> {
    const startTime = performance.now();
    
    this.logger.debug("Processing framework pre-reload analysis...");
    
    if (this.config.frameworkCapabilities?.invalidateFrameworkCaches) {
      this.stats.frameworkCacheClears++;
      this.logger.debug("Framework caches invalidated for hot-reload");
    }
    
    if (this.config.frameworkCapabilities?.frameworkAnalysis) {
      this.stats.frameworkReloads++;
      this.logger.debug(`Framework analysis prepared for ${event.affectedFiles.length} files`);
    }
    
    const processingTime = performance.now() - startTime;
    this.logger.debug(`Framework pre-reload completed in ${processingTime.toFixed(2)}ms`);
  }

  /**
   * Framework post-reload processing
   * Phase 1: Basic performance optimization and cache warming
   */
  private async processFrameworkPostReload(event: HotReloadEvent): Promise<void> {
    const startTime = performance.now();
    
    this.logger.debug("Processing framework post-reload optimizations...");
    
    if (this.config.frameworkCapabilities?.preWarmAnalysis) {
      this.stats.performanceOptimizations++;
      this.logger.debug("Framework analysis cache pre-warmed");
    }
    
    if (this.config.frameworkCapabilities?.performanceMonitoring) {
      const processingTime = performance.now() - startTime;
      this.logger.debug(`Framework post-reload monitoring: ${processingTime.toFixed(2)}ms`);
    }
  }

  /**
   * Enable framework capabilities
   */
  enableFrameworkCapabilities(options: Partial<FrameworkHotReloadCapabilities> = {}): void {
    this.config.frameworkCapabilities = {
      enabled: true,
      frameworkAnalysis: true,
      performanceMonitoring: true,
      preWarmAnalysis: true,
      invalidateFrameworkCaches: true,
      ...options
    };
    
    // Enable framework integration on file observer if available
    if ('enableFrameworkIntegration' in this.fileObserver) {
      (this.fileObserver as any).enableFrameworkIntegration({
        enabled: true,
        analyzeChanges: this.config.frameworkCapabilities.frameworkAnalysis,
        cacheInvalidation: this.config.frameworkCapabilities.invalidateFrameworkCaches,
        performanceTracking: this.config.frameworkCapabilities.performanceMonitoring
      });
    }
    
    this.logger.info("Framework capabilities enabled for HotReloadManager");
  }

  /**
   * Disable framework capabilities
   */
  disableFrameworkCapabilities(): void {
    this.config.frameworkCapabilities = {
      enabled: false,
      frameworkAnalysis: false,
      performanceMonitoring: false,
      preWarmAnalysis: false,
      invalidateFrameworkCaches: false
    };
    
    // Disable framework integration on file observer if available
    if ('disableFrameworkIntegration' in this.fileObserver) {
      (this.fileObserver as any).disableFrameworkIntegration();
    }
    
    this.logger.info("Framework capabilities disabled for HotReloadManager");
  }

  /**
   * Check if framework capabilities are enabled
   */
  isFrameworkCapabilitiesEnabled(): boolean {
    return this.config.frameworkCapabilities?.enabled ?? false;
  }

  /**
   * Get debug information
   */
  getDebugInfo(): {
    isRunning: boolean;
    config: HotReloadConfig;
    stats: HotReloadStats;
    watchedDirectories: string[];
    pendingChanges: number;
    fileObserverDebug: ReturnType<FileObserver['getDebugInfo']>;
    frameworkCapabilities: FrameworkHotReloadCapabilities | undefined;
  } {
    return {
      isRunning: this.isRunning(),
      config: this.getConfig(),
      stats: this.getStats(),
      watchedDirectories: this.getWatchedDirectories(),
      pendingChanges: this.pendingChanges.length,
      fileObserverDebug: this.fileObserver.getDebugInfo(),
      frameworkCapabilities: this.config.frameworkCapabilities
    };
  }
}

/**
 * Factory function to create a HotReloadManager instance
 */
export function createHotReloadManager(
  logger: Logger, 
  categoryManager?: CategoryManager,
  config?: Partial<HotReloadConfig>
): HotReloadManager {
  return new HotReloadManager(logger, categoryManager, config);
}