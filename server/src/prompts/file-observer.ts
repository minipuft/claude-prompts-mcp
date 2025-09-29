/**
 * File Observer Module
 * Handles file system watching for automatic change detection and hot reload triggers
 */

import * as fs from "fs";
import { FSWatcher } from "fs";
import path from "path";
import { Logger } from "../logging/index.js";
import { EventEmitter } from "events";
import { ConfigManager } from "../config/index.js";

/**
 * File change event types
 */
export type FileChangeType = 'added' | 'modified' | 'removed' | 'renamed';

/**
 * Framework analysis data for file changes
 */
export interface FrameworkAnalysisData {
  requiresFrameworkUpdate: boolean;
  affectedFrameworks: string[];
  analysisInvalidated: boolean;
  performanceImpact: 'low' | 'medium' | 'high';
}

/**
 * File change event data
 */
export interface FileChangeEvent {
  type: FileChangeType;
  filePath: string;
  filename: string;
  timestamp: number;
  isPromptFile: boolean;
  isConfigFile: boolean;
  category?: string;
  frameworkAnalysis?: FrameworkAnalysisData;
}

/**
 * Framework integration capabilities
 */
export interface FrameworkIntegration {
  enabled: boolean;
  analyzeChanges: boolean;
  cacheInvalidation: boolean;
  performanceTracking: boolean;
}

/**
 * File observer configuration
 */
export interface FileObserverConfig {
  enabled: boolean;
  debounceMs: number;
  watchPromptFiles: boolean;
  watchConfigFiles: boolean;
  recursive: boolean;
  ignoredPatterns: string[];
  maxRetries: number;
  retryDelayMs: number;
  frameworkIntegration?: FrameworkIntegration;
}

/**
 * File observer statistics
 */
export interface FileObserverStats {
  watchersActive: number;
  eventsDetected: number;
  eventsDebounced: number;
  eventsTriggered: number;
  lastEventTime?: number;
  uptime: number;
  retryCount: number;
  frameworkEvents: number;
  frameworkCacheInvalidations: number;
}

/**
 * Default configuration for FileObserver
 */
const DEFAULT_CONFIG: FileObserverConfig = {
  enabled: true,
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
  frameworkIntegration: {
    enabled: false,
    analyzeChanges: false,
    cacheInvalidation: false,
    performanceTracking: false
  }
};

/**
 * FileObserver class
 * Provides robust file system watching with event-driven architecture
 */
export class FileObserver extends EventEmitter {
  protected logger: Logger;
  private config: FileObserverConfig;
  private watchers: Map<string, FSWatcher> = new Map();
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private stats: FileObserverStats;
  private isStarted: boolean = false;
  private startTime: number = 0;
  private retryCount: number = 0;
  private configManager?: ConfigManager;

  constructor(logger: Logger, config?: Partial<FileObserverConfig>, configManager?: ConfigManager) {
    super();
    this.logger = logger;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.configManager = configManager;
    this.stats = {
      watchersActive: 0,
      eventsDetected: 0,
      eventsDebounced: 0,
      eventsTriggered: 0,
      uptime: 0,
      retryCount: 0,
      frameworkEvents: 0,
      frameworkCacheInvalidations: 0
    };

    // Set max listeners to prevent warning for multiple prompt directories
    this.setMaxListeners(50);
  }

  /**
   * Start file watching
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      this.logger.warn("FileObserver is already started");
      return;
    }

    if (!this.config.enabled) {
      this.logger.info("FileObserver is disabled in configuration");
      return;
    }

    this.logger.info("📁 FileObserver: Starting file system watching...");
    this.startTime = Date.now();
    this.isStarted = true;

    // Listen for process termination to clean up watchers
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());

    this.logger.info(`✅ FileObserver started with debounce: ${this.config.debounceMs}ms`);
  }

  /**
   * Stop file watching and clean up resources
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    this.logger.info("🛑 FileObserver: Stopping file system watching...");

    // Clear all debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    // Close all watchers
    for (const [path, watcher] of this.watchers.entries()) {
      try {
        watcher.close();
        this.logger.debug(`Closed watcher for: ${path}`);
      } catch (error) {
        this.logger.warn(`Failed to close watcher for ${path}:`, error);
      }
    }
    this.watchers.clear();

    this.isStarted = false;
    this.stats.watchersActive = 0;

    this.logger.info("✅ FileObserver stopped and resources cleaned up");
  }

  /**
   * Add a directory to watch
   */
  async watchDirectory(directoryPath: string, category?: string): Promise<void> {
    if (!this.isStarted) {
      throw new Error("FileObserver must be started before adding watchers");
    }

    if (this.watchers.has(directoryPath)) {
      this.logger.debug(`Directory already being watched: ${directoryPath}`);
      return;
    }

    try {
      // Verify directory exists
      const stats = await fs.promises.stat(directoryPath);
      if (!stats.isDirectory()) {
        throw new Error(`Path is not a directory: ${directoryPath}`);
      }

      const watcher = fs.watch(directoryPath, { recursive: this.config.recursive }, (eventType, filename) => {
        this.handleFileEvent(eventType, directoryPath, filename, category);
      });

      watcher.on('error', (error) => {
        this.handleWatcherError(directoryPath, error);
      });

      this.watchers.set(directoryPath, watcher);
      this.stats.watchersActive = this.watchers.size;

      this.logger.info(`👁️ FileObserver: Watching directory: ${directoryPath}${category ? ` (category: ${category})` : ''}`);

    } catch (error) {
      this.logger.error(`Failed to watch directory ${directoryPath}:`, error);
      if (this.retryCount < this.config.maxRetries) {
        this.retryCount++;
        this.stats.retryCount++;
        this.logger.info(`Retrying in ${this.config.retryDelayMs}ms (attempt ${this.retryCount}/${this.config.maxRetries})`);
        setTimeout(() => this.watchDirectory(directoryPath, category), this.config.retryDelayMs);
      } else {
        throw error;
      }
    }
  }

  /**
   * Remove a directory from watching
   */
  async unwatchDirectory(directoryPath: string): Promise<void> {
    const watcher = this.watchers.get(directoryPath);
    if (!watcher) {
      this.logger.debug(`Directory not being watched: ${directoryPath}`);
      return;
    }

    try {
      watcher.close();
      this.watchers.delete(directoryPath);
      this.stats.watchersActive = this.watchers.size;

      // Clear any pending debounce timers for this directory
      const timersToRemove: string[] = [];
      for (const [key, timer] of this.debounceTimers.entries()) {
        if (key.startsWith(directoryPath)) {
          clearTimeout(timer);
          timersToRemove.push(key);
        }
      }
      timersToRemove.forEach(key => this.debounceTimers.delete(key));

      this.logger.info(`🚫 FileObserver: Stopped watching directory: ${directoryPath}`);

    } catch (error) {
      this.logger.error(`Failed to stop watching directory ${directoryPath}:`, error);
      throw error;
    }
  }

  /**
   * Handle file system events
   */
  private handleFileEvent(eventType: string, directoryPath: string, filename: string | null, category?: string): void {
    if (!filename) {
      return;
    }

    const filePath = path.join(directoryPath, filename);
    this.stats.eventsDetected++;

    // Check if file should be ignored
    if (this.shouldIgnoreFile(filePath, filename)) {
      return;
    }

    // Determine file types
    const isPromptFile = this.isPromptFile(filename);
    const isConfigFile = this.isConfigFile(filename, filePath);

    // Skip if we're not watching this type
    if (!isPromptFile && !isConfigFile) {
      return;
    }

    if (!this.config.watchPromptFiles && isPromptFile) {
      return;
    }

    if (!this.config.watchConfigFiles && isConfigFile) {
      return;
    }

    const changeType = this.mapEventType(eventType);
    const event: FileChangeEvent = {
      type: changeType,
      filePath,
      filename,
      timestamp: Date.now(),
      isPromptFile,
      isConfigFile,
      category
    };

    // Add framework analysis if enabled
    if (this.config.frameworkIntegration?.enabled) {
      event.frameworkAnalysis = this.analyzeFrameworkImpact(event);
      if (event.frameworkAnalysis.requiresFrameworkUpdate) {
        this.stats.frameworkEvents++;
      }
    }

    this.logger.debug(`File event detected: ${changeType} ${filename} in ${directoryPath}`);

    // Apply debouncing
    this.debounceEvent(event);
  }

  /**
   * Apply debouncing to prevent excessive event firing
   */
  private debounceEvent(event: FileChangeEvent): void {
    const debounceKey = `${event.filePath}_${event.type}`;
    
    // Clear existing timer for this file+type
    const existingTimer = this.debounceTimers.get(debounceKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
      this.stats.eventsDebounced++;
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.debounceTimers.delete(debounceKey);
      this.emitFileChangeEvent(event);
    }, this.config.debounceMs);

    this.debounceTimers.set(debounceKey, timer);
  }

  /**
   * Emit the file change event
   */
  private emitFileChangeEvent(event: FileChangeEvent): void {
    this.stats.eventsTriggered++;
    this.stats.lastEventTime = event.timestamp;

    this.logger.info(`🔄 FileObserver: File ${event.type}: ${event.filename}`);
    
    // Emit specific event types
    this.emit('fileChange', event);
    this.emit(`file:${event.type}`, event);
    
    if (event.isPromptFile) {
      this.emit('promptFileChange', event);
    }
    
    if (event.isConfigFile) {
      this.emit('configFileChange', event);
    }
  }

  /**
   * Handle watcher errors
   */
  private handleWatcherError(directoryPath: string, error: Error): void {
    this.logger.error(`FileObserver: Watcher error for ${directoryPath}:`, error);
    
    // Remove failed watcher
    this.watchers.delete(directoryPath);
    this.stats.watchersActive = this.watchers.size;

    // Emit error event
    this.emit('watcherError', { directoryPath, error });

    // Attempt to restart watcher
    if (this.retryCount < this.config.maxRetries) {
      this.retryCount++;
      this.stats.retryCount++;
      setTimeout(() => {
        this.logger.info(`Attempting to restart watcher for: ${directoryPath}`);
        this.watchDirectory(directoryPath).catch(retryError => {
          this.logger.error(`Failed to restart watcher for ${directoryPath}:`, retryError);
        });
      }, this.config.retryDelayMs);
    }
  }

  /**
   * Check if file should be ignored
   */
  private shouldIgnoreFile(filePath: string, filename: string): boolean {
    const normalizedPath = path.normalize(filePath).replace(/\\/g, '/');
    
    return this.config.ignoredPatterns.some(pattern => {
      // Simple glob pattern matching
      const regexPattern = pattern
        .replace(/\*\*/g, '.*')
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]');
      
      const regex = new RegExp(`^${regexPattern}$`);
      return regex.test(normalizedPath) || regex.test(filename);
    });
  }

  /**
   * Check if file is a prompt file
   */
  private isPromptFile(filename: string): boolean {
    const ext = path.extname(filename).toLowerCase();
    return ext === '.md' || ext === '.markdown';
  }

  /**
   * Check if file is a configuration file
   */
  private isConfigFile(filename: string, fullPath?: string): boolean {
    const basename = path.basename(filename);
    
    // Standard config files
    if (basename === 'prompts.json' || basename === 'config.json') {
      return true;
    }
    
    // Main prompts config - get filename from ConfigManager if available
    if (this.configManager && fullPath) {
      try {
        const mainConfigPath = this.configManager.getPromptsFilePath();
        const mainConfigFilename = path.basename(mainConfigPath);
        return basename === mainConfigFilename;
      } catch (error) {
        // Fallback to default behavior if ConfigManager fails
        this.logger.debug(`Could not get prompts config path from ConfigManager: ${error}`);
      }
    }
    
    // Fallback for backward compatibility
    return basename === 'promptsConfig.json';
  }

  /**
   * Map fs.watch event types to our event types
   */
  private mapEventType(eventType: string): FileChangeType {
    switch (eventType) {
      case 'rename':
        return 'renamed';
      case 'change':
        return 'modified';
      default:
        return 'modified';
    }
  }

  /**
   * Get current statistics
   */
  getStats(): FileObserverStats {
    return {
      ...this.stats,
      uptime: this.isStarted ? Date.now() - this.startTime : 0
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): FileObserverConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<FileObserverConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.info("FileObserver configuration updated");
  }

  /**
   * Get list of watched directories
   */
  getWatchedDirectories(): string[] {
    return Array.from(this.watchers.keys());
  }

  /**
   * Check if FileObserver is running
   */
  isRunning(): boolean {
    return this.isStarted;
  }

  /**
   * Analyze framework impact of file changes
   * Phase 1: Basic analysis without complex framework dependencies
   */
  private analyzeFrameworkImpact(event: FileChangeEvent): FrameworkAnalysisData {
    // Basic framework analysis for Phase 1 compatibility
    const requiresFrameworkUpdate = event.isPromptFile || event.isConfigFile;
    const affectedFrameworks = requiresFrameworkUpdate ? ['basic'] : [];
    const analysisInvalidated = event.isPromptFile && (event.type === 'modified' || event.type === 'added');
    const performanceImpact: 'low' | 'medium' | 'high' = event.isConfigFile ? 'high' : 'low';

    if (requiresFrameworkUpdate && this.config.frameworkIntegration?.cacheInvalidation) {
      this.stats.frameworkCacheInvalidations++;
      this.logger.debug(`Framework cache invalidation triggered by ${event.filename}`);
    }

    return {
      requiresFrameworkUpdate,
      affectedFrameworks,
      analysisInvalidated,
      performanceImpact
    };
  }

  /**
   * Enable framework integration
   */
  enableFrameworkIntegration(options: Partial<FrameworkIntegration> = {}): void {
    this.config.frameworkIntegration = {
      enabled: true,
      analyzeChanges: true,
      cacheInvalidation: true,
      performanceTracking: true,
      ...options
    };
    this.logger.info("Framework integration enabled for FileObserver");
  }

  /**
   * Disable framework integration
   */
  disableFrameworkIntegration(): void {
    this.config.frameworkIntegration = {
      enabled: false,
      analyzeChanges: false,
      cacheInvalidation: false,
      performanceTracking: false
    };
    this.logger.info("Framework integration disabled for FileObserver");
  }

  /**
   * Check if framework integration is enabled
   */
  isFrameworkIntegrationEnabled(): boolean {
    return this.config.frameworkIntegration?.enabled ?? false;
  }

  /**
   * Get debug information
   */
  getDebugInfo(): {
    isRunning: boolean;
    config: FileObserverConfig;
    stats: FileObserverStats;
    watchedDirectories: string[];
    activeDebounceTimers: number;
    frameworkIntegration: FrameworkIntegration | undefined;
  } {
    return {
      isRunning: this.isRunning(),
      config: this.getConfig(),
      stats: this.getStats(),
      watchedDirectories: this.getWatchedDirectories(),
      activeDebounceTimers: this.debounceTimers.size,
      frameworkIntegration: this.config.frameworkIntegration
    };
  }
}

/**
 * Factory function to create a FileObserver instance
 */
export function createFileObserver(logger: Logger, config?: Partial<FileObserverConfig>, configManager?: ConfigManager): FileObserver {
  return new FileObserver(logger, config, configManager);
}