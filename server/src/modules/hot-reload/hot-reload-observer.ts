// @lifecycle canonical - Coordinates hot reload workflows using the file observer.
/**
 * Hot Reload Manager Module
 * Orchestrates file system monitoring and reload workflows with event-driven architecture
 */

import * as path from 'node:path';

import {
  FileChangeEvent,
  FileObserver,
  FileObserverConfig,
  LATE_DIRECTORY_ARMED,
  createFileObserver,
} from './file-observer.js';

import type {
  ConfigManager,
  Logger,
  HotReloadEventType,
  FileChangeOperation,
  HotReloadEvent,
} from '#shared/types/index.js';

export type { HotReloadEventType, FileChangeOperation, HotReloadEvent };

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

export interface AuxiliaryReloadConfig {
  id: string;
  directories: string[];
  handler: (event: HotReloadEvent) => Promise<void>;
  match?: (event: FileChangeEvent) => boolean;
  /**
   * Bring what this registration holds in line with the disk, after `root` — one of its
   * directories, or a directory containing or inside one — was created while the server ran.
   *
   * Required, not optional: per-file events cannot carry this. Between a directory appearing and
   * its watcher finishing the first scan, an entry can be written and removed with no event
   * either way, while the server already holds it — a `resource_manager` create registers its
   * entry directly. Only the owner knows what it holds, so every registration states how it
   * reconciles, and one that holds nothing says so in its own implementation.
   */
  reconcile: (root: string) => Promise<void>;
}

/** True when one path is the other, or contains it. */
function pathsOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}${path.sep}`) || b.startsWith(`${a}${path.sep}`);
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
    '**/*.log',
  ],
  maxRetries: 3,
  retryDelayMs: 1000,
  frameworkCapabilities: {
    enabled: false,
    frameworkAnalysis: false,
    performanceMonitoring: false,
    preWarmAnalysis: false,
    invalidateFrameworkCaches: false,
  },
};

/**
 * HotReloadObserver class
 * Coordinates file watching and reload operations
 */
export class HotReloadObserver {
  protected logger: Logger;
  private config: HotReloadConfig;
  private fileObserver: FileObserver;
  private onReloadCallback: ((event: HotReloadEvent) => Promise<void>) | undefined;
  private auxiliaryReloads: AuxiliaryReloadConfig[] = [];
  private stats: HotReloadStats;
  private isStarted: boolean = false;
  private batchTimer: NodeJS.Timeout | undefined;
  private pendingChanges: FileChangeEvent[] = [];
  private watchedDirectories: Set<string> = new Set();

  constructor(logger: Logger, config?: Partial<HotReloadConfig>, configManager?: ConfigManager) {
    this.logger = logger;
    this.config = { ...DEFAULT_HOT_RELOAD_CONFIG, ...config };

    // Create file observer with filtered config
    const debounceMs: number =
      this.config.debounceMs ?? DEFAULT_HOT_RELOAD_CONFIG.debounceMs ?? 500;
    const watchPromptFiles: boolean =
      this.config.watchPromptFiles ?? DEFAULT_HOT_RELOAD_CONFIG.watchPromptFiles ?? true;
    const watchConfigFiles: boolean =
      this.config.watchConfigFiles ?? DEFAULT_HOT_RELOAD_CONFIG.watchConfigFiles ?? true;
    const recursive: boolean = this.config.recursive ?? DEFAULT_HOT_RELOAD_CONFIG.recursive ?? true;
    const ignoredPatterns: string[] =
      this.config.ignoredPatterns ?? DEFAULT_HOT_RELOAD_CONFIG.ignoredPatterns ?? [];
    const maxRetries: number = this.config.maxRetries ?? DEFAULT_HOT_RELOAD_CONFIG.maxRetries ?? 3;
    const retryDelayMs: number =
      this.config.retryDelayMs ?? DEFAULT_HOT_RELOAD_CONFIG.retryDelayMs ?? 1000;

    const observerConfig: Partial<FileObserverConfig> = {
      enabled: this.config.enabled,
      debounceMs,
      watchPromptFiles,
      watchConfigFiles,
      recursive,
      ignoredPatterns,
      maxRetries,
      retryDelayMs,
    };

    this.fileObserver = createFileObserver(logger, observerConfig, configManager);

    this.stats = {
      reloadsTriggered: 0,
      filesChanged: 0,
      autoReloadsEnabled: this.config.autoReload,
      fileObserverStats: this.fileObserver.getStats(),
      frameworkReloads: 0,
      frameworkCacheClears: 0,
      performanceOptimizations: 0,
    };

    this.setupFileObserverEventHandlers();
  }

  /**
   * Start hot reload monitoring
   */
  async start(): Promise<void> {
    if (this.isStarted) {
      this.logger.warn('HotReloadObserver is already started');
      return;
    }

    if (!this.config.enabled) {
      this.logger.info('HotReloadObserver is disabled in configuration');
      return;
    }

    this.logger.info('🔥 HotReloadObserver: Starting hot reload monitoring...');

    await this.fileObserver.start();
    this.isStarted = true;

    this.logger.info(
      `✅ HotReloadObserver started - Auto reload: ${this.config.autoReload ? 'ON' : 'OFF'}`
    );
  }

  /**
   * Stop hot reload monitoring
   */
  async stop(): Promise<void> {
    if (!this.isStarted) {
      return;
    }

    this.logger.info('🛑 HotReloadObserver: Stopping hot reload monitoring...');

    // Clear batch timer
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = undefined;
    }

    await this.fileObserver.stop();
    this.isStarted = false;

    this.logger.info('✅ HotReloadObserver stopped');
  }

  /**
   * Set the callback for reload events
   */
  setReloadCallback(callback: (event: HotReloadEvent) => Promise<void>): void {
    this.onReloadCallback = callback;
    this.logger.debug('HotReloadObserver: Reload callback registered');
  }

  /**
   * Register auxiliary reload handlers (framework, gate, style, script tools, change tracking)
   * with their watch directories. This is the ONE path a framework file takes: there is no
   * dedicated framework callback, because a second route would handle every framework event
   * twice — and while it sat unwired, it turned each framework edit into an extra prompt reload.
   * Directories must also be passed to watchDirectories by the caller.
   */
  setAuxiliaryReloads(reloads: AuxiliaryReloadConfig[]): void {
    this.auxiliaryReloads = reloads.map((reload) => ({
      ...reload,
      directories: reload.directories.map((dir) => path.normalize(dir)),
    }));

    // Register auxiliary directories with the file observer so their events
    // bypass prompt/config/framework classification and reach triggerAuxiliaryReloads()
    const allDirs = this.auxiliaryReloads.flatMap((r) => r.directories);
    this.fileObserver.registerAuxiliaryDirectories(allDirs);

    this.logger.debug('HotReloadObserver: Auxiliary reload handlers registered', {
      count: this.auxiliaryReloads.length,
      ids: this.auxiliaryReloads.map((r) => r.id),
    });
  }

  /**
   * Add directories to watch
   */
  async watchDirectories(directories: Array<{ path: string; category?: string }>): Promise<void> {
    if (!this.isStarted) {
      throw new Error('HotReloadObserver must be started before watching directories');
    }

    for (const { path: dirPath, category } of directories) {
      try {
        await this.fileObserver.watchDirectory(dirPath, category);
        this.watchedDirectories.add(dirPath);
        this.logger.info(
          `📁 HotReloadObserver: Watching directory: ${dirPath}${category ? ` (${category})` : ''}`
        );
      } catch (error) {
        this.logger.error(`Failed to watch directory ${dirPath}:`, error);
      }
    }
  }

  /**
   * Setup file observer event handlers
   */
  private setupFileObserverEventHandlers(): void {
    this.fileObserver.on('fileChange', (event: FileChangeEvent) => {
      this.handleFileChange(event);
    });

    this.fileObserver.on(LATE_DIRECTORY_ARMED, (directoryPath: string) => {
      void this.reconcileLateDirectory(directoryPath);
    });

    this.fileObserver.on('watcherError', (error: { directoryPath: string; error: Error }) => {
      this.logger.error(`File watcher error for ${error.directoryPath}:`, error.error);
    });

    this.logger.debug('HotReloadObserver: File observer event handlers registered');
  }

  /**
   * Handle file change events
   */
  private handleFileChange(event: FileChangeEvent): void {
    this.stats.filesChanged++;
    this.logger.debug(`File change detected: ${event.type} - ${event.filename}`);

    // Fire auxiliary reload handlers opportunistically (non-blocking)
    void this.triggerAuxiliaryReloads(event);

    // Auxiliary-only files (gates, scripts) don't need prompt reload processing
    if (event.isAuxiliaryFile && !event.isPromptFile && !event.isConfigFile) {
      return;
    }

    if (this.config.batchChanges) {
      this.batchFileChange(event);
    } else {
      this.processFileChangeImmediate(event);
    }
  }

  /**
   * Reconcile everything a directory created after startup could have changed unobserved.
   *
   * Every auxiliary registration whose directories overlap it compares what it holds against the
   * disk, and the prompt catalog reloads in full — prompt reload always rebuilds from every root,
   * so that IS its reconciliation. Each owner runs even if another throws: one failed
   * reconciliation must not leave a sibling type stale.
   */
  private async reconcileLateDirectory(directoryPath: string): Promise<void> {
    const root = path.normalize(directoryPath);
    this.logger.info(`🔁 HotReloadObserver: reconciling ${root} (created after startup)`);

    for (const reload of this.auxiliaryReloads) {
      if (!reload.directories.some((dir) => pathsOverlap(dir, root))) {
        continue;
      }
      try {
        await reload.reconcile(root);
      } catch (error) {
        this.logger.error(
          `[HotReloadObserver] Reconcile failed for ${reload.id} at ${root}`,
          error
        );
      }
    }

    await this.processReloadEvent({
      type: 'reload_required',
      reason: `reconciling ${root}, created after startup`,
      affectedFiles: [root],
      timestamp: Date.now(),
      requiresFullReload: true,
    });
  }

  /**
   * Map FileChangeType to FileChangeOperation
   * 'renamed' is no longer used after file-observer enhancement (becomes 'added' or 'removed')
   */
  private mapToChangeOperation(fileChangeType: FileChangeEvent['type']): FileChangeOperation {
    switch (fileChangeType) {
      case 'added':
        return 'added';
      case 'removed':
        return 'removed';
      case 'modified':
      case 'renamed':
      default:
        return 'modified';
    }
  }

  private async triggerAuxiliaryReloads(event: FileChangeEvent): Promise<void> {
    if (this.auxiliaryReloads.length === 0) {
      return;
    }

    const normalizedPath = path.normalize(event.filePath);

    for (const reload of this.auxiliaryReloads) {
      const matchesPath = reload.directories.some((dir) =>
        normalizedPath.startsWith(path.normalize(dir))
      );
      const matchesCustom = reload.match ? reload.match(event) : true;

      if (!matchesPath || !matchesCustom) {
        continue;
      }

      // The framework id the observer already resolved travels with the event.
      //
      // `FileObserver` extracts it from the path when it classifies a framework file, and the
      // framework reload handler refuses an event without one ("missing frameworkId, skipping").
      // Auxiliary events are the ONLY path framework files take (see `setAuxiliaryReloads`),
      // so dropping the id here meant every framework edit and every framework
      // deletion was observed by the watcher, logged as a file event, and then discarded: an
      // edited `framework.yaml` kept serving its previous guidance, and a deleted framework
      // stayed selected, until a restart.
      const hotReloadEvent: HotReloadEvent = {
        type: 'reload_required',
        reason: `${reload.id} file ${event.type}: ${event.filename}`,
        affectedFiles: [event.filePath],
        timestamp: event.timestamp,
        requiresFullReload: false,
        changeType: this.mapToChangeOperation(event.type),
        ...(event.frameworkId !== undefined ? { frameworkId: event.frameworkId } : {}),
      };

      try {
        await reload.handler(hotReloadEvent);
      } catch (error) {
        this.logger.error(`[HotReloadObserver] Auxiliary reload failed for ${reload.id}`, error);
      }
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
    const promptChanges = changes.filter((c) => c.isPromptFile);
    const configChanges = changes.filter((c) => c.isConfigFile);

    // Determine reload type
    const requiresFullReload =
      configChanges.length > 0 ||
      promptChanges.some((c) => c.type === 'added' || c.type === 'removed');

    let reloadType: HotReloadEventType = 'prompt_changed';
    let reason = `${promptChanges.length} prompt file(s) changed`;

    if (configChanges.length > 0) {
      reloadType = 'config_changed';
      reason = `${configChanges.length} config file(s) changed`;
    }

    const hotReloadEvent: HotReloadEvent = {
      type: reloadType,
      reason,
      affectedFiles: changes.map((c) => c.filePath),
      timestamp: Date.now(),
      requiresFullReload,
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
      timestamp: event.timestamp,
      requiresFullReload,
      ...(event.category ? { category: event.category } : {}),
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
          await new Promise((resolve) => setTimeout(resolve, this.config.reloadDelayMs));
        }

        await this.onReloadCallback(event);

        // Framework-aware post-processing
        if (this.config.frameworkCapabilities?.enabled) {
          await this.processFrameworkPostReload(event);
        }

        this.logger.info('✅ Hot reload completed successfully');
      } catch (error) {
        this.logger.error('❌ Hot reload failed:', error);
      }
    } else {
      this.logger.info('⏭️ Auto reload is disabled - skipping automatic reload');
    }
  }

  /**
   * Get current statistics
   */
  getStats(): HotReloadStats {
    return {
      ...this.stats,
      fileObserverStats: this.fileObserver.getStats(),
    };
  }

  /**
   * Get current configuration
   */
  getConfig(): HotReloadConfig {
    return { ...this.config };
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
   *  Basic framework cache invalidation and analysis
   */
  private async processFrameworkPreReload(event: HotReloadEvent): Promise<void> {
    const startTime = performance.now();

    this.logger.debug('Processing framework pre-reload analysis...');

    if (this.config.frameworkCapabilities?.invalidateFrameworkCaches) {
      this.stats.frameworkCacheClears++;
      this.logger.debug('Framework caches invalidated for hot-reload');
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
   *  Basic performance optimization and cache warming
   */
  private async processFrameworkPostReload(_event: HotReloadEvent): Promise<void> {
    const startTime = performance.now();

    this.logger.debug('Processing framework post-reload optimizations...');

    if (this.config.frameworkCapabilities?.preWarmAnalysis) {
      this.stats.performanceOptimizations++;
      this.logger.debug('Framework analysis cache pre-warmed');
    }

    if (this.config.frameworkCapabilities?.performanceMonitoring) {
      const processingTime = performance.now() - startTime;
      this.logger.debug(`Framework post-reload monitoring: ${processingTime.toFixed(2)}ms`);
    }
  }
}

/**
 * Factory function to create a HotReloadObserver instance
 */
export function createHotReloadObserver(
  logger: Logger,
  config?: Partial<HotReloadConfig>,
  configManager?: ConfigManager
): HotReloadObserver {
  return new HotReloadObserver(logger, config, configManager);
}
