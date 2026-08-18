// @lifecycle canonical - Framework lifecycle operations: create, update, delete, reload, switch.

import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { frameworkSnapshotContract } from './framework-snapshot-contract.js';

import type { ToolResponse } from '#shared/types/index.js';
import type { FrameworkDraftValidator } from './framework-draft-validator.js';
import type { FrameworkResourceContext } from '../core/context.js';
import type { FrameworkManagerInput, FrameworkCreationData } from '../core/types.js';

import { projectWriteModel } from '#modules/versioning/index.js';

/**
 * Optional framework fields that can be copied directly from input to framework data.
 * Used by both create and update handlers.
 */
const OPTIONAL_FRAMEWORK_FIELDS = [
  // Basic optional fields
  'description',
  'phases',
  'gates',
  'tool_descriptions',
  // Advanced framework fields
  'framework_gates',
  'template_suggestions',
  'framework_elements',
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
    const { id, name, framework, system_prompt_guidance } = args;

    if (id === undefined || id === '') {
      return this.error('Framework ID is required for create action');
    }
    if (name === undefined || name === '') {
      return this.error('Framework name is required for create action');
    }

    // Auto-derive type from id when the caller omits `framework`
    const derivedType =
      framework !== undefined && framework !== '' ? framework : id.toUpperCase().replace(/-/g, '_');

    // Comprehensive existence check across all state sources
    const exists = this.checkFrameworkExists(id);
    if (exists.inAnySource) {
      return this.error(
        `Framework '${id}' already exists in: ${exists.sources.join(', ')}. Use update action to modify.`
      );
    }

    // Create framework data with available fields
    const frameworkData: FrameworkCreationData = {
      id,
      name,
      type: derivedType,
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
    const result = await this.createFrameworkAtomic(id, frameworkData);
    if (!result.success) {
      return this.error(`Failed to create framework: ${result.error}`);
    }

    // Trigger refresh for any dependent systems
    await this.ctx.onRefresh?.();

    return this.success(this.validationService.formatSuccess(id, validation, result.paths ?? []));
  }

  async handleUpdate(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { id } = args;

    if (id === undefined || id === '') {
      return this.error('Framework ID is required for update action');
    }

    const existingFramework = this.ctx.frameworkManager.getFramework(id);
    if (existingFramework === undefined) {
      return this.error(`Framework '${id}' not found. Use create action to add new framework.`);
    }

    // Load existing YAML files from disk
    const existingData = await this.ctx.fileService.loadExistingFramework(id);
    if (existingData === null) {
      return this.error(`Failed to load framework files for '${id}'. Files may be corrupted.`);
    }

    // Capture before state for diff generation and versioning
    const beforeState = frameworkSnapshotContract.project(id, existingData);

    // Build update data with ONLY the fields provided in the request
    const frameworkData: Partial<FrameworkCreationData> & { id: string } = { id };

    if (args.name !== undefined) frameworkData.name = args.name;
    // `framework` is the wire name for the type discriminator; FrameworkCreationData calls it `type`.
    if (args.framework !== undefined) {
      frameworkData.type = args.framework;
    }
    if (args.system_prompt_guidance !== undefined) {
      frameworkData.system_prompt_guidance = args.system_prompt_guidance;
    }
    if (args.enabled !== undefined) frameworkData.enabled = args.enabled;

    // Assign all optional fields from input (only defined fields)
    this.assignOptionalFields(frameworkData as FrameworkCreationData, args);

    // The state this edit will PRODUCE. An update carries only the fields the request named, and
    // `writeFrameworkFiles` deep-merges them over the existing YAML — so the produced state is
    // that merge, and `beforeState` is the merge base here for the same reason.
    const afterState = projectWriteModel(
      id,
      frameworkData,
      frameworkSnapshotContract.projectedFields,
      beforeState
    );

    // Auto-versioning — go-forward: version N holds the state edit N produced, matching prompts
    // and gates. `recordEditResult` bridges the prior live state when it is not already the newest
    // row, which carries pre-existing framework rows across the era boundary without a migration.
    let versionSaved: number | undefined;
    const skipVersion = args.skip_version === true;
    if (this.ctx.versionHistoryService.isAutoVersionEnabled() && !skipVersion) {
      const diffForVersion = this.ctx.textDiffService.generateObjectDiff(
        beforeState,
        afterState,
        `${id}/framework.yaml`
      );
      const diffSummary = `+${diffForVersion.stats.additions}/-${diffForVersion.stats.deletions}`;

      const versionResult = await this.ctx.versionHistoryService.recordEditResult(
        'framework',
        id,
        beforeState,
        afterState,
        {
          description: 'Update via resource_manager',
          diff_summary: diffSummary,
        }
      );

      versionSaved = versionResult.version;
      this.ctx.logger.debug(`Saved version ${versionSaved} for framework ${id}`);
    }

    // Write framework files with merge from existing data
    const result = await this.ctx.fileService.writeFrameworkFiles(frameworkData, existingData);

    if (!result.success) {
      return this.error(`Failed to update framework: ${result.error}`);
    }

    // Trigger refresh to reload frameworks
    await this.ctx.onRefresh?.();

    // Generate diff view
    const diffResult = this.ctx.textDiffService.generateObjectDiff(
      beforeState,
      afterState,
      `${id}/framework.yaml`
    );

    let response =
      `✅ Framework '${id}' updated successfully\n\n` +
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
    const { id } = args;

    if (id === undefined || id === '') {
      return this.error('Framework ID is required for delete action');
    }

    const existingFramework = this.ctx.frameworkManager.getFramework(id);
    if (existingFramework === undefined) {
      return this.error(`Framework '${id}' not found`);
    }

    // Prevent deleting built-in frameworks
    const builtInFrameworks = ['cageerf', 'react', '5w1h', 'scamper'];
    if (builtInFrameworks.includes(id.toLowerCase())) {
      return this.error(
        `Cannot delete built-in framework '${id}'. Only custom frameworks can be deleted.`
      );
    }

    // Get framework directory path
    const serverRoot = this.ctx.configManager.getServerRoot();
    const frameworkDir = path.join(serverRoot, 'resources', 'frameworks', id.toLowerCase());

    if (!existsSync(frameworkDir)) {
      return this.error(`Framework directory not found: ${frameworkDir}`);
    }

    // `dry_run` reports what would be removed and returns before anything is. Deletion is the one
    // destructive action rollback cannot undo — there is no version row for a framework that no
    // longer exists.
    if (args.dry_run === true) {
      return this.success(
        `🔍 **Dry run** — deletion of framework '${id}'\n\n` +
          `Nothing was removed.\n\n` +
          `📁 Would remove the directory: ${frameworkDir}\n` +
          `📜 Would purge this framework's rows from \`version_history\`\n` +
          `⚠️ Deletion cannot be undone — rollback cannot restore a deleted framework.\n\n` +
          `💡 Re-send with \`confirm: true\` and without \`dry_run\` to apply it.`
      );
    }

    // Remove framework directory
    try {
      await fs.rm(frameworkDir, { recursive: true });
    } catch (error) {
      return this.error(
        `Failed to delete framework directory: ${
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
      `✅ Framework '${id}' deleted successfully\n\n` +
        `📁 Directory removed: ${frameworkDir}\n\n` +
        `🔄 Framework registry updated`
    );
  }

  async handleReload(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { id, reason } = args;

    if (id === undefined || id === '') {
      return this.error('Framework ID is required for reload action');
    }

    const existingFramework = this.ctx.frameworkManager.getFramework(id);
    if (existingFramework === undefined) {
      return this.error(`Framework '${id}' not found`);
    }

    // Trigger full refresh (framework registry doesn't have per-item reload)
    await this.ctx.onRefresh?.();

    const reasonText = reason !== undefined && reason !== '' ? ` (reason: ${reason})` : '';

    return this.success(`🔄 Framework '${id}' reloaded successfully${reasonText}`);
  }

  async handleSwitch(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { id, reason } = args;

    if (id === undefined || id === '') {
      return this.error('Framework ID is required for switch action');
    }

    const targetFramework = this.ctx.frameworkManager.getFramework(id);
    if (targetFramework === undefined) {
      const availableFrameworks = this.ctx.frameworkManager
        .listFrameworks(true)
        .map((f) => f.id)
        .join(', ');
      return this.error(`Framework '${id}' not found.\n\nAvailable: ${availableFrameworks}`);
    }

    // Check if already active
    if (this.ctx.frameworkStateStore?.getActiveFramework()?.id === targetFramework.id) {
      return this.success(`ℹ️ Framework '${id}' is already active`);
    }

    if (this.ctx.frameworkStateStore === undefined) {
      return this.error('Framework state manager not initialized');
    }

    // No initializer: the try assigns it and the catch returns early.
    let switchSuccess: boolean;
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
   * Comprehensive existence check across all framework state sources.
   */
  private checkFrameworkExists(id: string): {
    inAnySource: boolean;
    sources: string[];
    filesystem: boolean;
    registry: boolean;
    frameworkMap: boolean;
  } {
    const normalizedId = id.toLowerCase();
    const sources: string[] = [];

    const fsExists = this.ctx.fileService.frameworkExists(normalizedId);
    if (fsExists) sources.push('filesystem');

    const registry = this.ctx.frameworkManager.getFrameworkRegistry();
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
   * Atomic framework creation with rollback on failure.
   */
  private async createFrameworkAtomic(
    id: string,
    frameworkData: FrameworkCreationData
  ): Promise<{ success: boolean; error?: string; paths?: string[] }> {
    const normalizedId = id.toLowerCase();
    const registry = this.ctx.frameworkManager.getFrameworkRegistry();

    // Step 1: Write files to disk
    const writeResult = await this.ctx.fileService.writeFrameworkFiles(frameworkData, null);
    if (!writeResult.success) {
      return { success: false, error: `File write failed: ${writeResult.error}` };
    }

    // Step 2: Clear loader cache to force fresh load
    const loader = registry.getRuntimeLoader();
    loader.clearCache();

    // Step 3: Register in framework registry
    const registryResult = await registry.loadAndRegisterById(normalizedId);
    if (!registryResult) {
      await this.ctx.fileService.deleteFramework(normalizedId);
      return { success: false, error: 'Registry registration failed - files rolled back' };
    }

    // Step 4: Register in framework manager
    const frameworkResult = await this.ctx.frameworkManager.registerFramework(id);
    if (!frameworkResult) {
      registry.unregisterGuide(normalizedId);
      await this.ctx.fileService.deleteFramework(normalizedId);
      return {
        success: false,
        error: 'Framework registration failed - registry and files rolled back',
      };
    }

    return { success: true, paths: writeResult.paths };
  }

  /**
   * Copy defined optional fields from input to framework data.
   */
  private assignOptionalFields(target: FrameworkCreationData, source: FrameworkManagerInput): void {
    for (const field of OPTIONAL_FRAMEWORK_FIELDS) {
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
