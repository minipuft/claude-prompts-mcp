/**
 * File Observer Module
 * Handles file system watching for automatic change detection and hot reload triggers
 */
import { EventEmitter } from 'events';
import { ConfigManager } from '../config/index.js';
import { Logger } from '../logging/index.js';
/**
 * File change event types
 */
export type FileChangeType = 'added' | 'modified' | 'removed' | 'renamed';
/**
 * File content types for classification
 */
export type FileContentType = 'prompt' | 'config' | 'methodology' | 'unknown';
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
    isMethodologyFile: boolean;
    /** Extracted methodology ID for methodology file changes */
    methodologyId?: string;
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
    watchMethodologyFiles: boolean;
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
    methodologyFileEvents: number;
}
/**
 * FileObserver class
 * Provides robust file system watching with event-driven architecture
 */
export declare class FileObserver extends EventEmitter {
    protected logger: Logger;
    private config;
    private watchers;
    private debounceTimers;
    private stats;
    private isStarted;
    private startTime;
    private retryCount;
    private configManager;
    private sigintHandler;
    private sigtermHandler;
    constructor(logger: Logger, config?: Partial<FileObserverConfig>, configManager?: ConfigManager);
    /**
     * Start file watching
     */
    start(): Promise<void>;
    /**
     * Stop file watching and clean up resources
     */
    stop(): Promise<void>;
    /**
     * Add a directory to watch
     */
    watchDirectory(directoryPath: string, category?: string): Promise<void>;
    /**
     * Remove a directory from watching
     */
    unwatchDirectory(directoryPath: string): Promise<void>;
    /**
     * Handle file system events
     */
    private handleFileEvent;
    /**
     * Apply debouncing to prevent excessive event firing
     */
    private debounceEvent;
    /**
     * Emit the file change event
     * For 'renamed' events, checks file existence to detect deletions
     */
    private emitFileChangeEvent;
    /**
     * Classify a 'rename' event as either 'removed' or 'added' based on file existence
     * Node.js fs.watch emits 'rename' for file creation, deletion, and actual renames
     */
    private classifyRenameEvent;
    /**
     * Handle watcher errors
     */
    private handleWatcherError;
    /**
     * Check if file should be ignored
     */
    private shouldIgnoreFile;
    /**
     * Check if file is a prompt file
     */
    private isPromptFile;
    /**
     * Check if file is a configuration file
     */
    private isConfigFile;
    /**
     * Check if file is a methodology YAML file
     * Methodology files live in resources/methodologies/{id}/ directories and are YAML files
     *
     * @returns Object with isMethodology flag and extracted methodologyId
     */
    private isMethodologyFile;
    /**
     * Map fs.watch event types to our event types
     */
    private mapEventType;
    /**
     * Get current statistics
     */
    getStats(): FileObserverStats;
    /**
     * Get current configuration
     */
    getConfig(): FileObserverConfig;
    /**
     * Update configuration
     */
    updateConfig(newConfig: Partial<FileObserverConfig>): void;
    /**
     * Get list of watched directories
     */
    getWatchedDirectories(): string[];
    /**
     * Check if FileObserver is running
     */
    isRunning(): boolean;
    /**
     * Analyze framework impact of file changes
     *  Basic analysis without complex framework dependencies
     */
    private analyzeFrameworkImpact;
    /**
     * Enable framework integration
     */
    enableFrameworkIntegration(options?: Partial<FrameworkIntegration>): void;
    /**
     * Disable framework integration
     */
    disableFrameworkIntegration(): void;
    /**
     * Check if framework integration is enabled
     */
    isFrameworkIntegrationEnabled(): boolean;
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
    };
}
/**
 * Factory function to create a FileObserver instance
 */
export declare function createFileObserver(logger: Logger, config?: Partial<FileObserverConfig>, configManager?: ConfigManager): FileObserver;
