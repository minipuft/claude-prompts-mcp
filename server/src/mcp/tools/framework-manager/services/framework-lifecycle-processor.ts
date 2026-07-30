// @lifecycle canonical - Framework lifecycle operations: create, update, delete, reload, switch.

import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { FrameworkDraftValidator } from './methodology-validator.js';
import type { ToolResponse } from '../../../../shared/types/index.js';
import type { FrameworkResourceContext } from '../core/context.js';
import type { FrameworkManagerInput, FrameworkCreationData } from '../core/types.js';

/**
 * Optional methodology fields that can be copied directly from input to methodology data.
 * Used by both create and update handlers.
 */
const OPTIONAL_METHODOLOGY_FIELDS = [
  // Basic optional fields
  'description',
  'phases',
  'gates',
  'tool_descriptions',
  // Advanced methodology fields
  'methodology_gates',
  'template_suggestions',
  'methodology_elements',
  'argument_suggestions',
  'judge_prompt',
  // Advanced phases fields
  'processing_steps',
  'execution_steps',
  'execution_type_enhancements',
  'template_enhancements',
  'execution_flow',
  'quality_indicators',
] as const;

export class FrameworkLifecycleProcessor {
  constructor(
    private readonly ctx: FrameworkResourceContext,
    private readonly validationService: FrameworkDraftValidator
  ) {}

  async handleCreate(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { id, name, methodology, system_prompt_guidance } = args;

    if (id === undefined || id === '') {
      return this.error('Methodology ID is required for create action');
    }
    if (name === undefined || name === '') {
      return this.error('Methodology name is required for create action');
    }

    // Auto-derive type from id if methodology not provided
    const derivedType =
      methodology !== undefined && methodology !== ''
        ? methodology
        : id.toUpperCase().replace(/-/g, '_');

    // Comprehensive existence check across all state sources
    const exists = this.checkMethodologyExists(id);
    if (exists.inAnySource) {
      return this.error(
        `Methodology '${id}' already exists in: ${exists.sources.join(', ')}. Use update action to modify.`
      );
    }

    // Create methodology data with available fields
    const frameworkData: FrameworkCreationData = {
      id,
      name,
      type: derivedType,
      methodology: derivedType,
      system_prompt_guidance: system_prompt_guidance ?? '',
      enabled: true,
    };

    // Assign all optional fields (basic + advanced)
    this.assignOptionalFields(frameworkData, args);

    // Smart validation - block if required fields missing
    const validation = this.validationService.validate(frameworkData);
    if (!validation.valid) {
      return this.validationService.createErrorResponse(id, validation);
    }

    // Atomic create with rollback on failure
    const result = await this.createMethodologyAtomic(id, frameworkData);
    if (!result.success) {
      return this.error(`Failed to create methodology: ${result.error}`);
    }

    // Trigger refresh for any dependent systems
    await this.ctx.onRefresh?.();

    return this.success(this.validationService.formatSuccess(id, validation, result.paths ?? []));
  }

  async handleUpdate(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { id } = args;

    if (id === undefined || id === '') {
      return this.error('Methodology ID is required for update action');
    }

    const existingFramework = this.ctx.frameworkManager.getFramework(id);
    if (existingFramework === undefined) {
      return this.error(`Methodology '${id}' not found. Use create action to add new methodology.`);
    }

    // Load existing YAML files from disk
    const existingData = await this.ctx.fileService.loadExistingMethodology(id);
    if (existingData === null) {
      return this.error(`Failed to load methodology files for '${id}'. Files may be corrupted.`);
    }

    // Capture before state for diff generation
    const beforeState: Record<string, unknown> = {
      id: existingData.methodology['id'],
      name: existingData.methodology['name'],
      type: existingData.methodology['type'],
      description: existingData.methodology['description'],
      enabled: existingData.methodology['enabled'],
    };

    // Build update data with ONLY the fields provided in the request
    const frameworkData: Partial<FrameworkCreationData> & { id: string; methodology: string } = {
      id,
      methodology: args.methodology ?? '',
    };

    if (args.name !== undefined) frameworkData.name = args.name;
    if (args.methodology !== undefined) {
      frameworkData.type = args.methodology;
      frameworkData.methodology = args.methodology;
    }
    if (args.system_prompt_guidance !== undefined) {
      frameworkData.system_prompt_guidance = args.system_prompt_guidance;
    }
    if (args.enabled !== undefined) frameworkData.enabled = args.enabled;

    // Assign all optional fields from input (only defined fields)
    this.assignOptionalFields(frameworkData as FrameworkCreationData, args);

    // Build after state for diff generation
    const afterState: Record<string, unknown> = {
      id,
      name: frameworkData.name ?? existingData.methodology['name'],
      type: frameworkData.type ?? existingData.methodology['type'],
      description: frameworkData.description ?? existingData.methodology['description'],
      enabled: frameworkData.enabled ?? existingData.methodology['enabled'],
    };

    // Save version before update (auto-versioning)
    let versionSaved: number | undefined;
    const skipVersion = args.skip_version === true;
    if (this.ctx.versionHistoryService.isAutoVersionEnabled() && !skipVersion) {
      const diffForVersion = this.ctx.textDiffService.generateObjectDiff(
        beforeState,
        afterState,
        `${id}/methodology.yaml`
      );
      const diffSummary = `+${diffForVersion.stats.additions}/-${diffForVersion.stats.deletions}`;

      const versionResult = await this.ctx.versionHistoryService.saveVersion(
        'methodology',
        id,
        beforeState,
        {
          description: args.version_description ?? 'Update via resource_manager',
          diff_summary: diffSummary,
        }
      );

      if (versionResult.success) {
        versionSaved = versionResult.version;
        this.ctx.logger.debug(`Saved version ${versionSaved} for methodology ${id}`);
      } else {
        this.ctx.logger.warn(
          `Failed to save version for methodology ${id}: ${versionResult.error}`
        );
      }
    }

    // Write methodology files with merge from existing data
    const result = await this.ctx.fileService.writeMethodologyFiles(frameworkData, existingData);

    if (!result.success) {
      return this.error(`Failed to update methodology: ${result.error}`);
    }

    // Trigger refresh to reload methodologies
    await this.ctx.onRefresh?.();

    // Generate diff view
    const diffResult = this.ctx.textDiffService.generateObjectDiff(
      beforeState,
      afterState,
      `${id}/methodology.yaml`
    );

    let response =
      `✅ Methodology '${id}' updated successfully\n\n` +
      `📁 Files updated:\n${result.paths?.map((p) => `  - ${p}`).join('\n')}\n\n`;

    if (versionSaved !== undefined) {
      response += `📜 **Version ${versionSaved}** saved (use \`action:"history"\` to view)\n\n`;
    }

    if (diffResult.hasChanges) {
      response += `${diffResult.formatted}\n\n`;
    }

    response += `🔄 Framework registry reloaded`;

    return this.success(response);
  }

  async handleDelete(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { id, confirm } = args;

    if (id === undefined || id === '') {
      return this.error('Methodology ID is required for delete action');
    }

    if (confirm !== true) {
      return this.error(
        `⚠️ Delete requires confirmation.\n\nTo delete methodology '${id}', set confirm: true`
      );
    }

    const existingFramework = this.ctx.frameworkManager.getFramework(id);
    if (existingFramework === undefined) {
      return this.error(`Methodology '${id}' not found`);
    }

    // Prevent deleting built-in methodologies
    const builtInMethodologies = ['cageerf', 'react', '5w1h', 'scamper'];
    if (builtInMethodologies.includes(id.toLowerCase())) {
      return this.error(
        `Cannot delete built-in methodology '${id}'. Only custom methodologies can be deleted.`
      );
    }

    // Get methodology directory path
    const serverRoot = this.ctx.configManager.getServerRoot();
    const frameworkDir = path.join(serverRoot, 'resources', 'methodologies', id.toLowerCase());

    if (!existsSync(frameworkDir)) {
      return this.error(`Methodology directory not found: ${frameworkDir}`);
    }

    // Remove methodology directory
    try {
      await fs.rm(frameworkDir, { recursive: true });
    } catch (error) {
      return this.error(
        `Failed to delete methodology directory: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    // Unregister framework from in-memory registry
    const unregistered = this.ctx.frameworkManager.unregister(id);
    if (!unregistered) {
      this.ctx.logger.warn(`Framework '${id}' was not found in registry during deletion`);
    }

    // Trigger refresh for any dependent systems
    await this.ctx.onRefresh?.();

    return this.success(
      `✅ Methodology '${id}' deleted successfully\n\n` +
        `📁 Directory removed: ${frameworkDir}\n\n` +
        `🔄 Framework registry updated`
    );
  }

  async handleReload(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { id, reason } = args;

    if (id === undefined || id === '') {
      return this.error('Methodology ID is required for reload action');
    }

    const existingFramework = this.ctx.frameworkManager.getFramework(id);
    if (existingFramework === undefined) {
      return this.error(`Methodology '${id}' not found`);
    }

    // Trigger full refresh (methodology registry doesn't have per-item reload)
    await this.ctx.onRefresh?.();

    const reasonText = reason !== undefined && reason !== '' ? ` (reason: ${reason})` : '';

    return this.success(`🔄 Methodology '${id}' reloaded successfully${reasonText}`);
  }

  async handleSwitch(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { id, reason } = args;

    if (id === undefined || id === '') {
      return this.error('Methodology ID is required for switch action');
    }

    const targetFramework = this.ctx.frameworkManager.getFramework(id);
    if (targetFramework === undefined) {
      const availableFrameworks = this.ctx.frameworkManager
        .listFrameworks(true)
        .map((f) => f.id)
        .join(', ');
      return this.error(`Methodology '${id}' not found.\n\nAvailable: ${availableFrameworks}`);
    }

    // Check if already active
    if (this.ctx.frameworkStateStore?.getActiveFramework()?.id === targetFramework.id) {
      return this.success(`ℹ️ Framework '${id}' is already active`);
    }

    if (this.ctx.frameworkStateStore === undefined) {
      return this.error('Framework state manager not initialized');
    }

    let switchSuccess = false;
    try {
      switchSuccess = await this.ctx.frameworkStateStore.switchFramework({
        targetFramework: targetFramework.id,
        reason: reason ?? `Switched via resource_manager`,
      });
    } catch (error) {
      return this.error(
        `Failed to switch framework: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (!switchSuccess) {
      return this.error(
        `Failed to switch to framework '${targetFramework.name}'. Check server logs for details.`
      );
    }

    // Trigger tools update if available (for description changes)
    await this.ctx.onToolsUpdate?.();

    const reasonText = reason !== undefined && reason !== '' ? `\n📝 Reason: ${reason}` : '';

    return this.success(
      `✅ Switched to framework '${targetFramework.name}'${reasonText}\n\n` +
        `🧭 Active type: ${targetFramework.type}`
    );
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Comprehensive existence check across all methodology state sources.
   */
  private checkMethodologyExists(id: string): {
    inAnySource: boolean;
    sources: string[];
    filesystem: boolean;
    registry: boolean;
    frameworkMap: boolean;
  } {
    const normalizedId = id.toLowerCase();
    const sources: string[] = [];

    const fsExists = this.ctx.fileService.methodologyExists(normalizedId);
    if (fsExists) sources.push('filesystem');

    const registry = this.ctx.frameworkManager.getMethodologyRegistry();
    const registryExists = registry.hasGuide(normalizedId);
    if (registryExists) sources.push('registry');

    const frameworkExists = this.ctx.frameworkManager.getFramework(id) !== undefined;
    if (frameworkExists) sources.push('framework-map');

    return {
      inAnySource: sources.length > 0,
      sources,
      filesystem: fsExists,
      registry: registryExists,
      frameworkMap: frameworkExists,
    };
  }

  /**
   * Atomic methodology creation with rollback on failure.
   */
  private async createMethodologyAtomic(
    id: string,
    frameworkData: FrameworkCreationData
  ): Promise<{ success: boolean; error?: string; paths?: string[] }> {
    const normalizedId = id.toLowerCase();
    const registry = this.ctx.frameworkManager.getMethodologyRegistry();

    // Step 1: Write files to disk
    const writeResult = await this.ctx.fileService.writeMethodologyFiles(frameworkData, null);
    if (!writeResult.success) {
      return { success: false, error: `File write failed: ${writeResult.error}` };
    }

    // Step 2: Clear loader cache to force fresh load
    const loader = registry.getRuntimeLoader();
    loader.clearCache();

    // Step 3: Register in methodology registry
    const registryResult = await registry.loadAndRegisterById(normalizedId);
    if (!registryResult) {
      await this.ctx.fileService.deleteMethodology(normalizedId);
      return { success: false, error: 'Registry registration failed - files rolled back' };
    }

    // Step 4: Register in framework manager
    const frameworkResult = await this.ctx.frameworkManager.registerFramework(id);
    if (!frameworkResult) {
      registry.unregisterGuide(normalizedId);
      await this.ctx.fileService.deleteMethodology(normalizedId);
      return {
        success: false,
        error: 'Framework registration failed - registry and files rolled back',
      };
    }

    return { success: true, paths: writeResult.paths };
  }

  /**
   * Copy defined optional fields from input to methodology data.
   */
  private assignOptionalFields(target: FrameworkCreationData, source: FrameworkManagerInput): void {
    for (const field of OPTIONAL_METHODOLOGY_FIELDS) {
      const value = source[field];
      if (value !== undefined) {
        (target as unknown as Record<string, unknown>)[field] = value;
      }
    }
  }

  private success(text: string): ToolResponse {
    return { content: [{ type: 'text', text }], isError: false };
  }

  private error(text: string): ToolResponse {
    return { content: [{ type: 'text', text: `Error: ${text}` }], isError: true };
  }
}
