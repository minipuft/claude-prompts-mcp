import type { VersioningConfig, VersionEntry, HistoryFile, SaveVersionResult, RollbackResult, SaveVersionOptions } from './types.js';
import type { Logger } from '../logging/index.js';
/**
 * Interface for config provider - allows ConfigManager or test doubles
 */
export interface VersioningConfigProvider {
    getVersioningConfig(): VersioningConfig;
}
/**
 * Service for managing version history of resources (prompts, gates, methodologies).
 *
 * Stores version snapshots in sidecar `.history.json` files alongside each resource.
 * Supports automatic versioning on updates, rollback, and version comparison.
 *
 * Config is read from ConfigManager on each operation to support hot-reload.
 */
export declare class VersionHistoryService {
    private logger;
    private configProvider;
    constructor(deps: {
        logger: Logger;
        configManager: VersioningConfigProvider;
    });
    /**
     * Get current versioning config from ConfigManager
     */
    private getConfig;
    /**
     * Check if versioning is enabled
     */
    isEnabled(): boolean;
    /**
     * Check if auto-versioning is enabled
     */
    isAutoVersionEnabled(): boolean;
    /**
     * Save a version snapshot before an update.
     *
     * @param resourceDir - Directory containing the resource
     * @param resourceType - Type of resource (prompt, gate, methodology)
     * @param resourceId - ID of the resource
     * @param snapshot - Current state to save as a version
     * @param options - Optional description and diff summary
     */
    saveVersion(resourceDir: string, resourceType: 'prompt' | 'gate' | 'methodology', resourceId: string, snapshot: Record<string, unknown>, options?: SaveVersionOptions): Promise<SaveVersionResult>;
    /**
     * Load version history for a resource.
     *
     * @param resourceDir - Directory containing the resource
     */
    loadHistory(resourceDir: string): Promise<HistoryFile | null>;
    /**
     * Get a specific version snapshot.
     *
     * @param resourceDir - Directory containing the resource
     * @param version - Version number to retrieve
     */
    getVersion(resourceDir: string, version: number): Promise<VersionEntry | null>;
    /**
     * Get the latest version number for a resource.
     *
     * @param resourceDir - Directory containing the resource
     */
    getLatestVersion(resourceDir: string): Promise<number>;
    /**
     * Rollback to a previous version.
     *
     * This saves the current state as a new version, then returns the snapshot
     * of the requested version for the caller to restore.
     *
     * @param resourceDir - Directory containing the resource
     * @param resourceType - Type of resource
     * @param resourceId - ID of the resource
     * @param targetVersion - Version to rollback to
     * @param currentSnapshot - Current state (to save before rollback)
     */
    rollback(resourceDir: string, resourceType: 'prompt' | 'gate' | 'methodology', resourceId: string, targetVersion: number, currentSnapshot: Record<string, unknown>): Promise<RollbackResult & {
        snapshot?: Record<string, unknown>;
    }>;
    /**
     * Compare two versions and return their snapshots for diffing.
     *
     * @param resourceDir - Directory containing the resource
     * @param fromVersion - First version to compare
     * @param toVersion - Second version to compare
     */
    compareVersions(resourceDir: string, fromVersion: number, toVersion: number): Promise<{
        success: boolean;
        from?: VersionEntry;
        to?: VersionEntry;
        error?: string;
    }>;
    /**
     * Delete version history for a resource.
     * Called when a resource is deleted.
     *
     * @param resourceDir - Directory containing the resource
     */
    deleteHistory(resourceDir: string): Promise<boolean>;
    /**
     * Format history for display in MCP response.
     *
     * @param history - History file to format
     * @param limit - Maximum entries to show (default: 10)
     */
    formatHistoryForDisplay(history: HistoryFile, limit?: number): string;
    private loadHistoryFile;
    private saveHistoryFile;
}
