// @lifecycle canonical - Core service for managing resource version history
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
const HISTORY_FILENAME = '.history.json';
/**
 * Service for managing version history of resources (prompts, gates, methodologies).
 *
 * Stores version snapshots in sidecar `.history.json` files alongside each resource.
 * Supports automatic versioning on updates, rollback, and version comparison.
 *
 * Config is read from ConfigManager on each operation to support hot-reload.
 */
export class VersionHistoryService {
    constructor(deps) {
        this.logger = deps.logger;
        this.configProvider = deps.configManager;
    }
    /**
     * Get current versioning config from ConfigManager
     */
    getConfig() {
        return this.configProvider.getVersioningConfig();
    }
    /**
     * Check if versioning is enabled
     */
    isEnabled() {
        return this.getConfig().enabled;
    }
    /**
     * Check if auto-versioning is enabled
     */
    isAutoVersionEnabled() {
        const config = this.getConfig();
        return config.enabled && config.auto_version;
    }
    /**
     * Save a version snapshot before an update.
     *
     * @param resourceDir - Directory containing the resource
     * @param resourceType - Type of resource (prompt, gate, methodology)
     * @param resourceId - ID of the resource
     * @param snapshot - Current state to save as a version
     * @param options - Optional description and diff summary
     */
    async saveVersion(resourceDir, resourceType, resourceId, snapshot, options) {
        const config = this.getConfig();
        if (!config.enabled) {
            return { success: true, version: 0 };
        }
        try {
            const historyPath = path.join(resourceDir, HISTORY_FILENAME);
            const history = await this.loadHistoryFile(historyPath, resourceType, resourceId);
            const newVersion = history.current_version + 1;
            const entry = {
                version: newVersion,
                date: new Date().toISOString(),
                snapshot,
                diff_summary: options?.diff_summary ?? '',
                description: options?.description ?? `Version ${newVersion}`,
            };
            // Add new version at the beginning (newest first)
            history.versions.unshift(entry);
            history.current_version = newVersion;
            // Prune old versions if exceeding max
            if (history.versions.length > config.max_versions) {
                history.versions = history.versions.slice(0, config.max_versions);
                this.logger.debug(`Pruned history for ${resourceId} to ${config.max_versions} versions`);
            }
            await this.saveHistoryFile(historyPath, history);
            this.logger.debug(`Saved version ${newVersion} for ${resourceType}/${resourceId}`);
            return { success: true, version: newVersion };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Failed to save version for ${resourceId}: ${message}`);
            return { success: false, error: message };
        }
    }
    /**
     * Load version history for a resource.
     *
     * @param resourceDir - Directory containing the resource
     */
    async loadHistory(resourceDir) {
        const historyPath = path.join(resourceDir, HISTORY_FILENAME);
        if (!existsSync(historyPath)) {
            return null;
        }
        try {
            const content = await fs.readFile(historyPath, 'utf8');
            return JSON.parse(content);
        }
        catch (error) {
            this.logger.error(`Failed to load history from ${historyPath}: ${error}`);
            return null;
        }
    }
    /**
     * Get a specific version snapshot.
     *
     * @param resourceDir - Directory containing the resource
     * @param version - Version number to retrieve
     */
    async getVersion(resourceDir, version) {
        const history = await this.loadHistory(resourceDir);
        if (history === null) {
            return null;
        }
        const entry = history.versions.find((v) => v.version === version);
        return entry ?? null;
    }
    /**
     * Get the latest version number for a resource.
     *
     * @param resourceDir - Directory containing the resource
     */
    async getLatestVersion(resourceDir) {
        const history = await this.loadHistory(resourceDir);
        return history?.current_version ?? 0;
    }
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
    async rollback(resourceDir, resourceType, resourceId, targetVersion, currentSnapshot) {
        if (!this.isEnabled()) {
            return { success: false, error: 'Versioning is disabled' };
        }
        try {
            // Get the target version
            const targetEntry = await this.getVersion(resourceDir, targetVersion);
            if (targetEntry === null) {
                return { success: false, error: `Version ${targetVersion} not found` };
            }
            // Save current state as new version before rollback
            const saveResult = await this.saveVersion(resourceDir, resourceType, resourceId, currentSnapshot, {
                description: `Pre-rollback snapshot (before reverting to v${targetVersion})`,
                diff_summary: '',
            });
            if (!saveResult.success) {
                return { success: false, error: `Failed to save current state: ${saveResult.error}` };
            }
            this.logger.info(`Rollback ${resourceType}/${resourceId}: saved v${saveResult.version}, restoring v${targetVersion}`);
            return {
                success: true,
                saved_version: saveResult.version,
                restored_version: targetVersion,
                snapshot: targetEntry.snapshot,
            };
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger.error(`Rollback failed for ${resourceId}: ${message}`);
            return { success: false, error: message };
        }
    }
    /**
     * Compare two versions and return their snapshots for diffing.
     *
     * @param resourceDir - Directory containing the resource
     * @param fromVersion - First version to compare
     * @param toVersion - Second version to compare
     */
    async compareVersions(resourceDir, fromVersion, toVersion) {
        const fromEntry = await this.getVersion(resourceDir, fromVersion);
        const toEntry = await this.getVersion(resourceDir, toVersion);
        if (fromEntry === null) {
            return { success: false, error: `Version ${fromVersion} not found` };
        }
        if (toEntry === null) {
            return { success: false, error: `Version ${toVersion} not found` };
        }
        return { success: true, from: fromEntry, to: toEntry };
    }
    /**
     * Delete version history for a resource.
     * Called when a resource is deleted.
     *
     * @param resourceDir - Directory containing the resource
     */
    async deleteHistory(resourceDir) {
        const historyPath = path.join(resourceDir, HISTORY_FILENAME);
        if (!existsSync(historyPath)) {
            return true;
        }
        try {
            await fs.unlink(historyPath);
            this.logger.debug(`Deleted history at ${historyPath}`);
            return true;
        }
        catch (error) {
            this.logger.error(`Failed to delete history at ${historyPath}: ${error}`);
            return false;
        }
    }
    /**
     * Format history for display in MCP response.
     *
     * @param history - History file to format
     * @param limit - Maximum entries to show (default: 10)
     */
    formatHistoryForDisplay(history, limit = 10) {
        const parts = [];
        parts.push(`📜 **Version History**: ${history.resource_id} (${history.versions.length} versions)`);
        parts.push('');
        parts.push('| Version | Date | Changes | Description |');
        parts.push('|---------|------|---------|-------------|');
        const entries = history.versions.slice(0, limit);
        for (const entry of entries) {
            const date = new Date(entry.date).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            });
            const current = entry.version === history.current_version ? ' (current)' : '';
            const changes = entry.diff_summary !== '' ? entry.diff_summary : '-';
            parts.push(`| ${entry.version}${current} | ${date} | ${changes} | ${entry.description} |`);
        }
        if (history.versions.length > limit) {
            parts.push('');
            parts.push(`*... and ${history.versions.length - limit} more versions*`);
        }
        return parts.join('\n');
    }
    // ==========================================================================
    // Private Helpers
    // ==========================================================================
    async loadHistoryFile(historyPath, resourceType, resourceId) {
        if (existsSync(historyPath)) {
            const content = await fs.readFile(historyPath, 'utf8');
            return JSON.parse(content);
        }
        // Create new history file
        return {
            resource_type: resourceType,
            resource_id: resourceId,
            current_version: 0,
            versions: [],
        };
    }
    async saveHistoryFile(historyPath, history) {
        const content = JSON.stringify(history, null, 2);
        await fs.writeFile(historyPath, content, 'utf8');
    }
}
//# sourceMappingURL=version-history-service.js.map