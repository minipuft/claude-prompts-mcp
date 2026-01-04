/**
 * Hot Reload Manager Module
 * Orchestrates file system monitoring and reload workflows with event-driven architecture
 */
import { CategoryManager } from './category-manager.js';
import { FileChangeEvent, FileObserver, FileObserverConfig } from './file-observer.js';
import { ConfigManager } from '../config/index.js';
import { Logger } from '../logging/index.js';
/**
 * Hot reload event types
 */
export type HotReloadEventType = 'prompt_changed' | 'config_changed' | 'category_changed' | 'methodology_changed' | 'gate_changed' | 'reload_required';
/**
 * File change operation types for hot reload events
 */
export type FileChangeOperation = 'added' | 'modified' | 'removed';
/**
 * Hot reload event data
 */
export interface HotReloadEvent {
    type: HotReloadEventType;
    reason: string;
    affectedFiles: string[];
    category?: string;
    /** Methodology ID for methodology_changed events */
    methodologyId?: string;
    /** Gate ID for gate_changed events */
    gateId?: string;
    /** The type of file change (added, modified, removed) */
    changeType?: FileChangeOperation;
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
export interface AuxiliaryReloadConfig {
    id: string;
    directories: string[];
    handler: (event: HotReloadEvent) => Promise<void>;
    match?: (event: FileChangeEvent) => boolean;
}
/**
 * HotReloadManager class
 * Coordinates file watching and reload operations
 */
export declare class HotReloadManager {
    protected logger: Logger;
    private config;
    private fileObserver;
    private categoryManager;
    private onReloadCallback;
    private onMethodologyReloadCallback;
    private onGateReloadCallback;
    private auxiliaryReloads;
    private stats;
    private isStarted;
    private batchTimer;
    private pendingChanges;
    private watchedDirectories;
    constructor(logger: Logger, categoryManager?: CategoryManager, config?: Partial<HotReloadConfig>, configManager?: ConfigManager);
    /**
     * Start hot reload monitoring
     */
    start(): Promise<void>;
    /**
     * Stop hot reload monitoring
     */
    stop(): Promise<void>;
    /**
     * Set the callback for reload events
     */
    setReloadCallback(callback: (event: HotReloadEvent) => Promise<void>): void;
    /**
     * Set the callback for methodology reload events
     * This callback is invoked when methodology YAML files change
     */
    setMethodologyReloadCallback(callback: (event: HotReloadEvent) => Promise<void>): void;
    /**
     * Set the callback for gate reload events
     * This callback is invoked when gate YAML files change
     */
    setGateReloadCallback(callback: (event: HotReloadEvent) => Promise<void>): void;
    /**
     * Register auxiliary reload handlers (e.g., methodology, gate) with their watch directories.
     * Directories must also be passed to watchDirectories by the caller.
     */
    setAuxiliaryReloads(reloads: AuxiliaryReloadConfig[]): void;
    /**
     * Add directories to watch
     */
    watchDirectories(directories: Array<{
        path: string;
        category?: string;
    }>): Promise<void>;
    /**
     * Manually trigger a reload
     */
    triggerReload(reason?: string, requiresFullReload?: boolean): Promise<void>;
    /**
     * Setup file observer event handlers
     */
    private setupFileObserverEventHandlers;
    /**
     * Handle file change events
     */
    private handleFileChange;
    /**
     * Handle methodology file change events
     * These are processed separately from regular file changes to enable
     * targeted methodology reload without affecting prompt system
     */
    private handleMethodologyFileChange;
    /**
     * Extract methodology ID from file path
     */
    private extractMethodologyId;
    /**
     * Map FileChangeType to FileChangeOperation
     * 'renamed' is no longer used after file-observer enhancement (becomes 'added' or 'removed')
     */
    private mapToChangeOperation;
    private triggerAuxiliaryReloads;
    /**
     * Batch file changes to prevent excessive reloads
     */
    private batchFileChange;
    /**
     * Process batched file changes
     */
    private processBatchedChanges;
    /**
     * Process immediate file change (no batching)
     */
    private processFileChangeImmediate;
    /**
     * Process reload event with framework integration
     */
    protected processReloadEvent(event: HotReloadEvent): Promise<void>;
    /**
     * Get current statistics
     */
    getStats(): HotReloadStats;
    /**
     * Get current configuration
     */
    getConfig(): HotReloadConfig;
    /**
     * Update configuration
     */
    updateConfig(newConfig: Partial<HotReloadConfig>): void;
    /**
     * Check if hot reload manager is running
     */
    isRunning(): boolean;
    /**
     * Get watched directories
     */
    getWatchedDirectories(): string[];
    /**
     * Framework pre-reload processing
     *  Basic framework cache invalidation and analysis
     */
    private processFrameworkPreReload;
    /**
     * Framework post-reload processing
     *  Basic performance optimization and cache warming
     */
    private processFrameworkPostReload;
    /**
     * Enable framework capabilities
     */
    enableFrameworkCapabilities(options?: Partial<FrameworkHotReloadCapabilities>): void;
    /**
     * Disable framework capabilities
     */
    disableFrameworkCapabilities(): void;
    /**
     * Check if framework capabilities are enabled
     */
    isFrameworkCapabilitiesEnabled(): boolean;
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
    };
}
/**
 * Factory function to create a HotReloadManager instance
 */
export declare function createHotReloadManager(logger: Logger, categoryManager?: CategoryManager, config?: Partial<HotReloadConfig>, configManager?: ConfigManager): HotReloadManager;
