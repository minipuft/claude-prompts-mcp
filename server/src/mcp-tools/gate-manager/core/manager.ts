// @lifecycle canonical - Main gate manager implementation for MCP.
/**
 * Consolidated Gate Manager
 *
 * Provides MCP tool interface for gate lifecycle management.
 * Follows the same pattern as ConsolidatedPromptManager.
 */

import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { serializeYaml } from '../../../utils/yaml/yaml-parser.js';
import { VersionHistoryService } from '../../../versioning/index.js';
import { TextDiffService } from '../../prompt-manager/analysis/text-diff-service.js';

import type { GateManagerInput, GateManagerDependencies, GateCreationData } from './types.js';
import type { ConfigManager } from '../../../config/index.js';
import type { GateManager } from '../../../gates/gate-manager.js';
import type { Logger } from '../../../logging/index.js';
import type { ToolResponse } from '../../../types/index.js';

/**
 * Consolidated Gate Manager
 */
export class ConsolidatedGateManager {
  private logger: Logger;
  private gateManager: GateManager;
  private configManager: ConfigManager;
  private onRefresh?: () => Promise<void>;
  private textDiffService: TextDiffService;
  private versionHistoryService: VersionHistoryService;

  constructor(deps: GateManagerDependencies) {
    this.logger = deps.logger;
    this.gateManager = deps.gateManager;
    this.configManager = deps.configManager;
    this.textDiffService = new TextDiffService();
    this.versionHistoryService = new VersionHistoryService({
      logger: deps.logger,
      configManager: deps.configManager,
    });
    if (deps.onRefresh) {
      this.onRefresh = deps.onRefresh;
    }

    this.logger.debug('ConsolidatedGateManager initialized');
  }

  /**
   * Handle gate manager action
   */
  async handleAction(args: GateManagerInput, _context: Record<string, any>): Promise<ToolResponse> {
    const { action } = args;

    try {
      switch (action) {
        case 'create':
          return await this.handleCreate(args);
        case 'update':
          return await this.handleUpdate(args);
        case 'delete':
          return await this.handleDelete(args);
        case 'list':
          return await this.handleList(args);
        case 'inspect':
          return await this.handleInspect(args);
        case 'reload':
          return await this.handleReload(args);
        case 'history':
          return await this.handleHistory(args);
        case 'rollback':
          return await this.handleRollback(args);
        case 'compare':
          return await this.handleCompare(args);
        default:
          return this.createErrorResponse(`Unknown action: ${action}`);
      }
    } catch (error) {
      this.logger.error(`gate_manager error:`, error);
      return this.createErrorResponse(
        `Error in gate_manager: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // ============================================================================
  // Action Handlers
  // ============================================================================

  private async handleCreate(args: GateManagerInput): Promise<ToolResponse> {
    const { id, name, type, description, guidance, pass_criteria, activation, retry_config } = args;

    // Validate required fields
    if (!id) {
      return this.createErrorResponse('Gate ID is required for create action');
    }
    if (!name) {
      return this.createErrorResponse('Gate name is required for create action');
    }
    if (!description) {
      return this.createErrorResponse('Gate description is required for create action');
    }
    if (!guidance) {
      return this.createErrorResponse('Gate guidance is required for create action');
    }

    // Check if gate already exists
    if (this.gateManager.has(id)) {
      return this.createErrorResponse(`Gate '${id}' already exists. Use update action to modify.`);
    }

    // Create gate data
    const gateData: GateCreationData = {
      id,
      name,
      type: type || 'validation',
      description,
      guidance,
      pass_criteria,
      activation,
      retry_config,
    };

    // Write gate files
    const result = await this.writeGateFiles(gateData);

    if (!result.success) {
      return this.createErrorResponse(`Failed to create gate: ${result.error}`);
    }

    // Trigger refresh to reload gates
    await this.onRefresh?.();

    return this.createSuccessResponse(
      `✅ Gate '${id}' created successfully\n\n` +
        `📁 Files created:\n${result.paths?.map((p) => `  - ${p}`).join('\n')}\n\n` +
        `🔄 Gate registry reloaded`
    );
  }

  private async handleUpdate(args: GateManagerInput): Promise<ToolResponse> {
    const { id, name, type, description, guidance, pass_criteria, activation, retry_config } = args;

    if (!id) {
      return this.createErrorResponse('Gate ID is required for update action');
    }

    // Check if gate exists
    if (!this.gateManager.has(id)) {
      return this.createErrorResponse(`Gate '${id}' not found. Use create action to add new gate.`);
    }

    // Get existing gate to merge with updates
    const existingGate = this.gateManager.get(id);
    if (!existingGate) {
      return this.createErrorResponse(`Failed to retrieve gate '${id}'`);
    }

    // Capture before state for diff generation
    const beforeState: Record<string, unknown> = {
      id: existingGate.gateId,
      name: existingGate.name,
      type: existingGate.type,
      description: existingGate.description,
      guidance: existingGate.getGuidance(),
    };

    // Prepare update data (merge with existing)
    const gateData: GateCreationData = {
      id,
      name: name || existingGate.name,
      type: type || existingGate.type || 'validation',
      description: description || existingGate.description,
      guidance: guidance || existingGate.getGuidance(),
      pass_criteria: pass_criteria,
      activation: activation,
      retry_config: retry_config,
    };

    // Capture after state for diff generation
    const afterState: Record<string, unknown> = {
      id: gateData.id,
      name: gateData.name,
      type: gateData.type,
      description: gateData.description,
      guidance: gateData.guidance,
    };

    // Save version before update (auto-versioning)
    let versionSaved: number | undefined;
    const skipVersion = args.skip_version === true;
    if (this.versionHistoryService.isAutoVersionEnabled() && !skipVersion) {
      const gatesDir = this.getGatesDirectory();
      const gateDir = path.join(gatesDir, id);

      // Calculate diff summary
      const diffForVersion = this.textDiffService.generateObjectDiff(
        beforeState,
        afterState,
        `${id}/gate.yaml`
      );
      const diffSummary = `+${diffForVersion.stats.additions}/-${diffForVersion.stats.deletions}`;

      const versionResult = await this.versionHistoryService.saveVersion(
        gateDir,
        'gate',
        id,
        beforeState,
        {
          description: args.version_description ?? 'Update via resource_manager',
          diff_summary: diffSummary,
        }
      );

      if (versionResult.success) {
        versionSaved = versionResult.version;
        this.logger.debug(`Saved version ${versionSaved} for gate ${id}`);
      } else {
        this.logger.warn(`Failed to save version for gate ${id}: ${versionResult.error}`);
      }
    }

    // Write updated gate files
    const result = await this.writeGateFiles(gateData);

    if (!result.success) {
      return this.createErrorResponse(`Failed to update gate: ${result.error}`);
    }

    // Reload the specific gate
    await this.gateManager.reload(id);

    // Generate diff view
    const diffResult = this.textDiffService.generateObjectDiff(
      beforeState,
      afterState,
      `${id}/gate.yaml`
    );

    let response =
      `✅ Gate '${id}' updated successfully\n\n` +
      `📁 Files updated:\n${result.paths?.map((p) => `  - ${p}`).join('\n')}\n\n`;

    // Include version info if saved
    if (versionSaved !== undefined) {
      response += `📜 **Version ${versionSaved}** saved (use \`action:"history"\` to view)\n\n`;
    }

    if (diffResult.hasChanges) {
      response += `${diffResult.formatted}\n\n`;
    }

    response += `🔄 Gate reloaded`;

    return this.createSuccessResponse(response);
  }

  private async handleDelete(args: GateManagerInput): Promise<ToolResponse> {
    const { id, confirm } = args;

    if (!id) {
      return this.createErrorResponse('Gate ID is required for delete action');
    }

    if (!confirm) {
      return this.createErrorResponse(
        `⚠️ Delete requires confirmation.\n\nTo delete gate '${id}', set confirm: true`
      );
    }

    // Check if gate exists
    if (!this.gateManager.has(id)) {
      return this.createErrorResponse(`Gate '${id}' not found`);
    }

    // Get gate directory path
    const gatesDir = this.getGatesDirectory();
    const gateDir = path.join(gatesDir, id);

    if (!existsSync(gateDir)) {
      return this.createErrorResponse(`Gate directory not found: ${gateDir}`);
    }

    // Remove gate directory
    try {
      await fs.rm(gateDir, { recursive: true });
    } catch (error) {
      return this.createErrorResponse(
        `Failed to delete gate directory: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Unregister gate from in-memory registry
    const unregistered = this.gateManager.unregister(id);
    if (!unregistered) {
      this.logger.warn(`Gate '${id}' was not found in registry during deletion`);
    }

    // Trigger refresh for any dependent systems (prompts, etc.)
    await this.onRefresh?.();

    return this.createSuccessResponse(
      `✅ Gate '${id}' deleted successfully\n\n` +
        `📁 Directory removed: ${gateDir}\n\n` +
        `🔄 Gate unregistered from registry`
    );
  }

  private async handleList(args: GateManagerInput): Promise<ToolResponse> {
    const { enabled_only = true } = args;

    const gates = this.gateManager.list(enabled_only);
    const stats = this.gateManager.getStats();

    if (gates.length === 0) {
      return this.createSuccessResponse(
        `📋 No gates found${enabled_only ? ' (enabled only)' : ''}\n\n` +
          `Use resource_manager(resource_type:"gate", action:"create", ...) to add a new gate.`
      );
    }

    const gateList = gates
      .map((gate) => {
        const typeIcon = gate.type === 'validation' ? '✓' : '📖';
        return `  ${typeIcon} ${gate.gateId}: ${gate.name}`;
      })
      .join('\n');

    return this.createSuccessResponse(
      `📋 Gates (${gates.length} total)\n\n` +
        `${gateList}\n\n` +
        `📊 Registry Stats:\n` +
        `  - Total gates: ${stats.totalGates}\n` +
        `  - Enabled: ${stats.enabledGates}\n` +
        `  - Disabled: ${stats.totalGates - stats.enabledGates}`
    );
  }

  private async handleInspect(args: GateManagerInput): Promise<ToolResponse> {
    const { id } = args;

    if (!id) {
      return this.createErrorResponse('Gate ID is required for inspect action');
    }

    const gate = this.gateManager.get(id);

    if (!gate) {
      return this.createErrorResponse(`Gate '${id}' not found`);
    }

    const typeIcon = gate.type === 'validation' ? '✓' : '📖';
    const guidance = gate.getGuidance();
    const guidancePreview = guidance.length > 500 ? guidance.substring(0, 500) + '...' : guidance;

    return this.createSuccessResponse(
      `🚦 Gate: ${gate.name}\n\n` +
        `📋 Details:\n` +
        `  - ID: ${gate.gateId}\n` +
        `  - Type: ${typeIcon} ${gate.type}\n` +
        `  - Description: ${gate.description}\n\n` +
        `📝 Guidance:\n${guidancePreview}`
    );
  }

  private async handleReload(args: GateManagerInput): Promise<ToolResponse> {
    const { id, reason } = args;

    if (!id) {
      return this.createErrorResponse('Gate ID is required for reload action');
    }

    // Check if gate exists
    if (!this.gateManager.has(id)) {
      return this.createErrorResponse(`Gate '${id}' not found`);
    }

    const success = await this.gateManager.reload(id);

    if (!success) {
      return this.createErrorResponse(`Failed to reload gate '${id}'`);
    }

    const reasonText = reason ? ` (reason: ${reason})` : '';

    return this.createSuccessResponse(`🔄 Gate '${id}' reloaded successfully${reasonText}`);
  }

  private async handleHistory(args: GateManagerInput): Promise<ToolResponse> {
    const { id, limit } = args;

    if (!id) {
      return this.createErrorResponse('Gate ID is required for history action');
    }

    // Check if gate exists
    if (!this.gateManager.has(id)) {
      return this.createErrorResponse(`Gate '${id}' not found`);
    }

    const gatesDir = this.getGatesDirectory();
    const gateDir = path.join(gatesDir, id);

    const history = await this.versionHistoryService.loadHistory(gateDir);

    if (!history || history.versions.length === 0) {
      return this.createSuccessResponse(
        `📜 No version history for gate '${id}'\n\n` +
          `💡 Version history is created automatically when updates are made.`
      );
    }

    const formatted = this.versionHistoryService.formatHistoryForDisplay(history, limit ?? 10);
    return this.createSuccessResponse(formatted);
  }

  private async handleRollback(args: GateManagerInput): Promise<ToolResponse> {
    const { id, version, confirm } = args;

    if (!id) {
      return this.createErrorResponse('Gate ID is required for rollback action');
    }
    if (version === undefined) {
      return this.createErrorResponse('Version number is required for rollback action');
    }
    if (!confirm) {
      return this.createErrorResponse(
        `⚠️ Rollback requires confirmation.\n\n` +
          `To rollback gate '${id}' to version ${version}, set confirm: true`
      );
    }

    // Check if gate exists
    const existingGate = this.gateManager.get(id);
    if (!existingGate) {
      return this.createErrorResponse(`Gate '${id}' not found`);
    }

    const gatesDir = this.getGatesDirectory();
    const gateDir = path.join(gatesDir, id);

    // Capture current state
    const currentState: Record<string, unknown> = {
      id: existingGate.gateId,
      name: existingGate.name,
      type: existingGate.type,
      description: existingGate.description,
      guidance: existingGate.getGuidance(),
    };

    // Perform rollback
    const result = await this.versionHistoryService.rollback(
      gateDir,
      'gate',
      id,
      version,
      currentState
    );

    if (!result.success) {
      return this.createErrorResponse(`Rollback failed: ${result.error}`);
    }

    // Restore the snapshot
    const snapshot = result.snapshot;
    if (!snapshot) {
      return this.createErrorResponse('Rollback failed: No snapshot found in target version');
    }

    // Write restored gate files
    const gateData: GateCreationData = {
      id: String(snapshot['id'] ?? id),
      name: String(snapshot['name'] ?? existingGate.name),
      type: (snapshot['type'] as 'validation' | 'guidance') ?? existingGate.type ?? 'validation',
      description: String(snapshot['description'] ?? existingGate.description),
      guidance: String(snapshot['guidance'] ?? existingGate.getGuidance()),
    };

    const writeResult = await this.writeGateFiles(gateData);
    if (!writeResult.success) {
      return this.createErrorResponse(`Rollback write failed: ${writeResult.error}`);
    }

    // Reload the gate
    await this.gateManager.reload(id);

    return this.createSuccessResponse(
      `✅ Gate '${id}' rolled back to version ${version}\n\n` +
        `📜 Current state saved as version ${result.saved_version}\n` +
        `🔄 Gate reloaded with restored content`
    );
  }

  private async handleCompare(args: GateManagerInput): Promise<ToolResponse> {
    const { id, from_version, to_version } = args;

    if (!id) {
      return this.createErrorResponse('Gate ID is required for compare action');
    }
    if (from_version === undefined || to_version === undefined) {
      return this.createErrorResponse(
        'Both from_version and to_version are required for compare action'
      );
    }

    // Check if gate exists
    if (!this.gateManager.has(id)) {
      return this.createErrorResponse(`Gate '${id}' not found`);
    }

    const gatesDir = this.getGatesDirectory();
    const gateDir = path.join(gatesDir, id);

    const result = await this.versionHistoryService.compareVersions(
      gateDir,
      from_version,
      to_version
    );

    if (!result.success) {
      return this.createErrorResponse(`Compare failed: ${result.error}`);
    }

    // Generate diff between versions
    const diffResult = this.textDiffService.generateObjectDiff(
      result.from!.snapshot,
      result.to!.snapshot,
      `${id}/gate.yaml`
    );

    let response =
      `📊 **Version Comparison**: ${id}\n\n` +
      `| Property | Version ${from_version} | Version ${to_version} |\n` +
      `|----------|-----------|------------|\n` +
      `| Date | ${new Date(result.from!.date).toLocaleString()} | ${new Date(result.to!.date).toLocaleString()} |\n` +
      `| Description | ${result.from!.description} | ${result.to!.description} |\n\n`;

    if (diffResult.hasChanges) {
      response += `${diffResult.formatted}\n`;
    } else {
      response += `No differences found between versions.\n`;
    }

    return this.createSuccessResponse(response);
  }

  // ============================================================================
  // File Operations
  // ============================================================================

  private getGatesDirectory(): string {
    return this.configManager.getGatesDirectory();
  }

  private async writeGateFiles(
    data: GateCreationData
  ): Promise<{ success: boolean; paths?: string[]; error?: string }> {
    const gatesDir = this.getGatesDirectory();
    const gateDir = path.join(gatesDir, data.id);
    const paths: string[] = [];

    try {
      // Create gate directory
      await fs.mkdir(gateDir, { recursive: true });
      paths.push(gateDir);

      // Build gate.yaml content
      const yamlData: Record<string, unknown> = {
        id: data.id,
        name: data.name,
        type: data.type,
        description: data.description,
        guidanceFile: 'guidance.md',
      };

      if (data.pass_criteria && data.pass_criteria.length > 0) {
        yamlData['pass_criteria'] = data.pass_criteria;
      }

      if (data.activation) {
        yamlData['activation'] = data.activation;
      }

      if (data.retry_config) {
        yamlData['retry_config'] = data.retry_config;
      }

      // Write gate.yaml
      const yamlPath = path.join(gateDir, 'gate.yaml');
      const yamlContent = serializeYaml(yamlData, { sortKeys: false });
      await fs.writeFile(yamlPath, yamlContent, 'utf8');
      paths.push(yamlPath);

      // Write guidance.md
      const guidancePath = path.join(gateDir, 'guidance.md');
      await fs.writeFile(guidancePath, data.guidance, 'utf8');
      paths.push(guidancePath);

      return { success: true, paths };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // ============================================================================
  // Response Helpers
  // ============================================================================

  private createSuccessResponse(text: string): ToolResponse {
    return {
      content: [{ type: 'text', text }],
      isError: false,
    };
  }

  private createErrorResponse(text: string): ToolResponse {
    return {
      content: [{ type: 'text', text: `❌ ${text}` }],
      isError: true,
    };
  }
}

/**
 * Create consolidated gate manager
 */
export function createConsolidatedGateManager(
  deps: GateManagerDependencies
): ConsolidatedGateManager {
  return new ConsolidatedGateManager(deps);
}
