/**
 * Style Hot Reload Coordinator
 *
 * Handles the integration between file system watching and style manager,
 * enabling hot reload of style definitions when YAML files change.
 *
 * @see GateHotReloadCoordinator for the pattern this follows
 */
import type { Logger } from '../../logging/index.js';
import type { StyleDefinitionLoader, StyleDefinitionYaml } from '../core/index.js';
/**
 * File change operation types for hot reload events
 */
export type FileChangeOperation = 'added' | 'modified' | 'removed';
/**
 * Hot reload event for styles
 * Compatible with HotReloadManager's event structure
 */
export interface StyleHotReloadEvent {
    type: 'style_changed';
    reason: string;
    affectedFiles: string[];
    styleId?: string;
    /** The type of file change (added, modified, removed) */
    changeType?: FileChangeOperation;
    timestamp: number;
    requiresFullReload: boolean;
}
/**
 * Configuration for StyleHotReloadCoordinator
 */
export interface StyleHotReloadConfig {
    /** Enable debug logging */
    debug?: boolean;
    /** Reload timeout in ms */
    reloadTimeoutMs?: number;
    /** Optional callback invoked after successful style reload */
    onReload?: (styleId: string, definition: StyleDefinitionYaml) => void;
}
/**
 * Statistics for hot reload operations
 */
export interface StyleHotReloadStats {
    reloadsAttempted: number;
    reloadsSucceeded: number;
    reloadsFailed: number;
    lastReloadTime?: number;
    lastReloadedStyle?: string;
}
/**
 * Result returned when creating a style hot reload registration
 */
export interface StyleHotReloadRegistration {
    /** Directories that should be watched for style changes */
    directories: string[];
    /** Bound handler for use with HotReloadManager */
    handler: (event: StyleHotReloadEvent) => Promise<void>;
    /** Coordinator instance handling cache clear + reload */
    coordinator: StyleHotReloadCoordinator;
}
/**
 * Style Hot Reload Coordinator
 *
 * Coordinates between the file watching system and style manager to
 * enable seamless hot reload of style definitions.
 *
 * @example
 * ```typescript
 * const coordinator = new StyleHotReloadCoordinator(logger, loader);
 *
 * // Register with hot reload manager
 * hotReloadManager.registerAuxiliaryHandler({
 *   id: 'style',
 *   directories: [loader.getStylesDir()],
 *   handler: (event) => coordinator.handleStyleChange(event),
 * });
 * ```
 */
export declare class StyleHotReloadCoordinator {
    private logger;
    private loader;
    private config;
    private stats;
    constructor(logger: Logger, loader: StyleDefinitionLoader, config?: StyleHotReloadConfig);
    /**
     * Handle a style file change event
     *
     * For 'removed' events: clears the style from cache (no registry to unregister from)
     * For other events: reloads the definition from YAML and invokes callback
     *
     * @param event - Hot reload event from the file watcher
     */
    handleStyleChange(event: StyleHotReloadEvent): Promise<void>;
    /**
     * Handle style deletion - clear from cache
     * Note: Styles don't have a registry, just a loader cache
     */
    private handleStyleDeletion;
    /**
     * Handle style reload - reload from YAML and invoke callback
     */
    private handleStyleReload;
    /**
     * Get hot reload statistics
     */
    getStats(): StyleHotReloadStats;
    /**
     * Reset statistics
     */
    resetStats(): void;
    /**
     * Get the definition loader being used
     */
    getLoader(): StyleDefinitionLoader;
}
/**
 * Create a registration bundle for style hot reload.
 * Keeps HotReloadManager generic by returning only the callback + watch paths.
 */
export declare function createStyleHotReloadRegistration(logger: Logger, loader: StyleDefinitionLoader, config?: StyleHotReloadConfig): StyleHotReloadRegistration;
/**
 * Factory function to create a StyleHotReloadCoordinator
 */
export declare function createStyleHotReloadCoordinator(logger: Logger, loader: StyleDefinitionLoader, config?: StyleHotReloadConfig): StyleHotReloadCoordinator;
