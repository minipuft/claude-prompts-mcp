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

    // Re-register the framework this method just rewrote, so the process that made the edit can
    // see it. `onRefresh` below does NOT do this: for this tool it is supplied at
    // `src/mcp/tools/index.ts:597-600` and its entire body is a comment plus a `logger.debug`.
    // Before this line, an update wrote correct YAML to disk and then claimed
    // `🔄 Framework registry reloaded` while the in-memory definition stayed at its pre-edit
    // content until the next server restart — the same write-then-assert-a-refresh shape fixed on
    // the gate side in `b7102dd9`. `create` is unaffected and deliberately untouched:
    // `createFrameworkAtomic` steps 2-4 already clear the cache and register.
    const registered = await this.reregister(id);

    // Still runs, and is still not what makes the edit visible. Kept because dependent systems
    // outside the framework registry subscribe to it.
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

    // Reports what happened rather than asserting it. Not an error either way: the files ARE
    // written, so returning a failure would be its own lie — but the caller has to learn that the
    // edit is not live yet from this response, not from the next action returning stale content.
    response += registered
      ? `🔄 Re-registered in the framework registry — the new content is live in this process`
      : `⚠️ Written to disk but NOT re-registered in this server process. The files are correct ` +
        `and will load on the next start; until then this framework resolves to its previous ` +
        `content. Recover with \`action: "reload"\`, or restart the server.`;

    return this.success(response);
  }

  async handleDelete(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { id } = args;

    if (id === undefined || id === '') {
      return this.error('Framework ID is required for delete action');
    }

    // Deliberately NOT gated on registry membership. Delete removes a directory, so the directory
    // is the authority — and the `existsSync` check below is exactly that. A registry check here
    // refused to delete a framework that exists on disk but was never registered, which is
    // precisely the state a failed re-registration produces: the tool could not clean up what it
    // had just written, and the directory had to be removed by hand. The `unregister` call
    // further down already tolerates a framework the registry does not know, and logs when that
    // happens. Same removal, same reasoning, as the gate side in `b7102dd9`.

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
          // Corrects a claim the live path never made good on: deletion is `fs.rm` +
          // `unregister` and touches no database row. The version rows survive and become
          // unreachable, since rollback resolves the framework first — the same wording, and the
          // same reason, as the gate-side correction in `b7102dd9`.
          `📜 Its \`version_history\` rows are NOT removed — they survive and become unreachable, ` +
          `since rollback resolves the framework first\n` +
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

    // Reports which of the two removals actually happened rather than asserting both. A framework
    // that was on disk but never registered is now deletable (see the guard note above), and
    // saying the registry was updated in that case would repeat the false claim this change
    // removes elsewhere in this file.
    return this.success(
      `✅ Framework '${id}' deleted successfully\n\n` +
        `📁 Directory removed: ${frameworkDir}\n\n` +
        (unregistered
          ? `🔄 Framework unregistered from the registry`
          : `ℹ️ It was not in the framework registry, so only the files were removed`)
    );
  }

  async handleReload(args: FrameworkManagerInput): Promise<ToolResponse> {
    const { id, reason } = args;

    if (id === undefined || id === '') {
      return this.error('Framework ID is required for reload action');
    }

    // Deliberately NOT gated on registry membership either. `reload` is the recovery verb:
    // `registerFramework` loads the definition from disk and registers it whether or not the id
    // was already known. Guarding it with `getFramework(id) === undefined` refused the one
    // operation able to repair an unregistered framework — a check for the very state it exists
    // to fix. Nothing is lost by dropping it: `registerFramework` returns false when no
    // definition loads from disk, and that becomes the error below.
    //
    // Before this change `handleReload` had no implementation at all: its whole body was
    // `await this.ctx.onRefresh?.()`, a measured no-op for this tool, followed by an
    // unconditional `reloaded successfully`.
    const reloaded = await this.reregister(id);

    if (!reloaded) {
      return this.error(
        `Failed to reload framework '${id}' — no framework definition could be loaded from disk. ` +
          `Check that ${path.join(this.ctx.fileService.getFrameworkDir(id), 'framework.yaml')} exists.`
      );
    }

    // Still runs, for dependent systems outside the framework registry.
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
   * Clear the runtime loader's cache for `id`, then load-and-register it from disk.
   *
   * ORDER IS THE CONTRACT. `RuntimeFrameworkLoader` caches parsed definitions, so a re-register
   * that skips the clear re-registers the content the loader already holds — the pre-edit
   * content. `createFrameworkAtomic` step 2 exists for exactly that reason; update and reload
   * need the same step for the same reason.
   *
   * `FrameworkManager.reloadResource(id)` is `protected` and regenerates from the guide already
   * in the registry, so it cannot pick up a changed file. `registerFramework(id)` is the public
   * surface and does the whole job: `loadAndRegisterById` (guide) → `generateSingleFrameworkDefinition`
   * → set in the framework map. It returns false rather than throwing when nothing loads.
   */
  private async reregister(id: string): Promise<boolean> {
    try {
      this.ctx.frameworkManager.getFrameworkRegistry().getRuntimeLoader().clearCache(id);
    } catch (error) {
      // `getFrameworkRegistry` throws when the manager is not initialized. Reported, not
      // swallowed: the caller branches on false and says the content is not live.
      this.ctx.logger.warn(
        `Could not clear the framework loader cache for '${id}': ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
    }

    return await this.ctx.frameworkManager.registerFramework(id);
  }

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
