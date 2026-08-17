// @lifecycle canonical - Gate CRUD operations: create, update, delete, reload.
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { ToolResponse } from '#shared/types/index.js';
import type { GateResourceContext } from '../core/context.js';
import type { GateManagerInput, GateCreationData } from '../core/types.js';

import { logMcpToolChange } from '#runtime/resource-change-tracking.js';

export class GateLifecycleProcessor {
  constructor(private readonly ctx: GateResourceContext) {}

  async handleCreate(args: GateManagerInput): Promise<ToolResponse> {
    const { id, name, type, description, guidance, pass_criteria, activation, retry_config } = args;

    if (!id) return this.error('Gate ID is required for create action');
    if (!name) return this.error('Gate name is required for create action');
    if (!description) return this.error('Gate description is required for create action');
    if (!guidance) return this.error('Gate guidance is required for create action');

    if (this.ctx.gateManager.has(id)) {
      return this.error(`Gate '${id}' already exists. Use update action to modify.`);
    }

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

    const result = await this.ctx.gateFileService.writeGateFiles(gateData);
    if (!result.success) {
      return this.error(`Failed to create gate: ${result.error}`);
    }

    await this.ctx.onRefresh?.();
    this.trackChange('added', id);

    return this.success(
      `✅ Gate '${id}' created successfully\n\n` +
        `📁 Files created:\n${result.paths?.map((p) => `  - ${p}`).join('\n')}\n\n` +
        `🔄 Gate registry reloaded`
    );
  }

  async handleUpdate(args: GateManagerInput): Promise<ToolResponse> {
    const { id, name, type, description, guidance, pass_criteria, activation, retry_config } = args;

    if (!id) return this.error('Gate ID is required for update action');

    if (!this.ctx.gateManager.has(id)) {
      return this.error(`Gate '${id}' not found. Use create action to add new gate.`);
    }

    const existingGate = this.ctx.gateManager.get(id);
    if (!existingGate) {
      return this.error(`Failed to retrieve gate '${id}'`);
    }
    // Raw on-disk definition (not the normalizing getActivationRules()/getPassCriteria()
    // accessors, which default absent fields to {}/[] — that would fabricate an
    // `activation: {}` or `pass_criteria: []` key on every update that never set one).
    const existingDefinition = existingGate.getDefinition();

    const beforeState: Record<string, unknown> = {
      id: existingGate.gateId,
      name: existingGate.name,
      type: existingGate.type,
      description: existingGate.description,
      guidance: existingGate.getGuidance(),
    };

    const gateData: GateCreationData = {
      id,
      name: name || existingGate.name,
      type: type || existingGate.type || 'validation',
      description: description || existingGate.description,
      guidance: guidance || existingGate.getGuidance(),
      // Fall back to the existing on-disk value when the caller omits the field —
      // otherwise GateFileWriter.buildGateYaml rebuilds gate.yaml from scratch and
      // silently deletes it. Same class of bug prompts already fixed via
      // PRESERVED_PROMPT_YAML_KEYS (audit: resource-manager-settability-matrix-2026-08-13 #1).
      pass_criteria: pass_criteria ?? existingDefinition.pass_criteria,
      activation: activation ?? existingDefinition.activation,
      retry_config: retry_config ?? existingDefinition.retry_config,
    };

    const afterState: Record<string, unknown> = {
      id: gateData.id,
      name: gateData.name,
      type: gateData.type,
      description: gateData.description,
      guidance: gateData.guidance,
    };

    // Auto-versioning
    let versionSaved: number | undefined;
    const skipVersion = args.skip_version === true;
    if (this.ctx.versionHistoryService.isAutoVersionEnabled() && !skipVersion) {
      const diffForVersion = this.ctx.textDiffService.generateObjectDiff(
        beforeState,
        afterState,
        `${id}/gate.yaml`
      );
      const diffSummary = `+${diffForVersion.stats.additions}/-${diffForVersion.stats.deletions}`;

      const versionResult = await this.ctx.versionHistoryService.saveVersion(
        'gate',
        id,
        beforeState,
        {
          description: args.version_description ?? 'Update via resource_manager',
          diff_summary: diffSummary,
        }
      );

      versionSaved = versionResult.version;
      this.ctx.logger.debug(`Saved version ${versionSaved} for gate ${id}`);
    }

    const result = await this.ctx.gateFileService.writeGateFiles(gateData);
    if (!result.success) {
      return this.error(`Failed to update gate: ${result.error}`);
    }

    await this.ctx.gateManager.reload(id);
    this.trackChange('modified', id);

    const diffResult = this.ctx.textDiffService.generateObjectDiff(
      beforeState,
      afterState,
      `${id}/gate.yaml`
    );

    let response =
      `✅ Gate '${id}' updated successfully\n\n` +
      `📁 Files updated:\n${result.paths?.map((p) => `  - ${p}`).join('\n')}\n\n`;

    if (versionSaved !== undefined) {
      response += `📜 **Version ${versionSaved}** saved (use \`action:"history"\` to view)\n\n`;
    }

    if (diffResult.hasChanges) {
      response += `${diffResult.formatted}\n\n`;
    }

    response += `🔄 Gate reloaded`;

    return this.success(response);
  }

  async handleDelete(args: GateManagerInput): Promise<ToolResponse> {
    const { id, confirm } = args;

    if (!id) return this.error('Gate ID is required for delete action');

    if (!confirm) {
      return this.error(
        `⚠️ Delete requires confirmation.\n\nTo delete gate '${id}', set confirm: true`
      );
    }

    if (!this.ctx.gateManager.has(id)) {
      return this.error(`Gate '${id}' not found`);
    }

    const gatesDir = this.ctx.configManager.getGatesDirectory();
    const gateDir = path.join(gatesDir, id);

    if (!existsSync(gateDir)) {
      return this.error(`Gate directory not found: ${gateDir}`);
    }

    try {
      await fs.rm(gateDir, { recursive: true });
    } catch (error) {
      return this.error(
        `Failed to delete gate directory: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    const unregistered = this.ctx.gateManager.unregister(id);
    if (!unregistered) {
      this.ctx.logger.warn(`Gate '${id}' was not found in registry during deletion`);
    }

    await this.ctx.onRefresh?.();
    this.trackChange('removed', id);

    return this.success(
      `✅ Gate '${id}' deleted successfully\n\n` +
        `📁 Directory removed: ${gateDir}\n\n` +
        `🔄 Gate unregistered from registry`
    );
  }

  async handleReload(args: GateManagerInput): Promise<ToolResponse> {
    const { id, reason } = args;

    if (!id) return this.error('Gate ID is required for reload action');

    if (!this.ctx.gateManager.has(id)) {
      return this.error(`Gate '${id}' not found`);
    }

    const reloadSuccess = await this.ctx.gateManager.reload(id);
    if (!reloadSuccess) {
      return this.error(`Failed to reload gate '${id}'`);
    }

    const reasonText = reason ? ` (reason: ${reason})` : '';
    return this.success(`🔄 Gate '${id}' reloaded successfully${reasonText}`);
  }

  private trackChange(operation: 'added' | 'modified' | 'removed', id: string): void {
    try {
      const gatesDir = this.ctx.configManager.getGatesDirectory();
      const filePath = `${gatesDir}/${id}/gate.yaml`;
      void logMcpToolChange(this.ctx.logger, {
        operation,
        resourceType: 'gate',
        resourceId: id,
        filePath,
      });
    } catch {
      // Gates directory may not be configured
    }
  }

  private success(text: string): ToolResponse {
    return { content: [{ type: 'text', text }], isError: false };
  }

  private error(text: string): ToolResponse {
    return { content: [{ type: 'text', text: `❌ ${text}` }], isError: true };
  }
}
