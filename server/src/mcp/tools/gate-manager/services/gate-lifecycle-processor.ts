// @lifecycle canonical - Gate CRUD operations: create, update, delete, reload.
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { gateSnapshotContract } from './gate-snapshot-contract.js';

import type { ToolResponse } from '#shared/types/index.js';
import type { GateResourceContext } from '../core/context.js';
import type { GateManagerInput, GateCreationData } from '../core/types.js';

import { projectWriteModel } from '#modules/versioning/index.js';
import { logMcpToolChange } from '#runtime/resource-change-tracking.js';
import { resolveContainedPath } from '#shared/utils/contained-path.js';

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

    // Register the gate this method just wrote, the same way `handleUpdate` does after its write.
    //
    // `onRefresh` below does NOT do this. It resolves to the application's full server refresh,
    // which reloads PROMPT data and never touches the gate registry — so before this line, a gate
    // created here was written correctly and durably to disk and remained unknown to `inspect`,
    // `update`, `history`, `reload` and `delete` until the next server restart, while this method
    // returned success and claimed the registry had reloaded. An operator had no signal at all:
    // the two things they would naturally suspect, a wrong id and a failed write, were both wrong
    // and the file on disk proved the write had worked.
    const registered = await this.ctx.gateManager.reload(id);

    await this.ctx.onRefresh?.();
    this.trackChange('added', id);

    const filesWritten = `📁 Files created:\n${result.paths?.map((p) => `  - ${p}`).join('\n')}`;

    // Not an error: the files ARE written, so reporting failure would be its own lie. But the
    // caller has to learn that the gate is not usable yet, and from what to do next rather than
    // from the next action failing.
    if (!registered) {
      return this.success(
        `⚠️ Gate '${id}' was written to disk but is NOT active in this server process\n\n` +
          `${filesWritten}\n\n` +
          `The files on disk are what you asked for. The in-memory gate registry ` +
          `did not pick them up, so this gate will not resolve until it does.\n` +
          `Recover with \`action: "reload"\`, or restart the server.`
      );
    }

    return this.success(
      `✅ Gate '${id}' created successfully\n\n` +
        `${filesWritten}\n\n` +
        `🔄 Registered in the gate registry — ready to use now`
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

    const beforeState = gateSnapshotContract.project(id, existingGate);

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

    // The state this edit will PRODUCE. `gateData` already resolves every projected field —
    // supplied value, else the existing one — so it needs no merge base.
    const afterState = projectWriteModel(
      id,
      gateData as unknown as Record<string, unknown>,
      gateSnapshotContract.projectedFields
    );

    // Auto-versioning — go-forward: version N holds the state edit N produced, so the newest
    // version always equals what `inspect` shows. `recordEditResult` bridges the prior live state
    // first when it is not already the newest row, which is what carries pre-P7 gate rows across
    // the era boundary with no data migration.
    let versionSaved: number | undefined;
    const skipVersion = args.skip_version === true;
    if (this.ctx.versionHistoryService.isAutoVersionEnabled() && !skipVersion) {
      const diffForVersion = this.ctx.textDiffService.generateObjectDiff(
        beforeState,
        afterState,
        `${id}/gate.yaml`
      );
      const diffSummary = `+${diffForVersion.stats.additions}/-${diffForVersion.stats.deletions}`;

      const versionResult = await this.ctx.versionHistoryService.recordEditResult(
        'gate',
        id,
        beforeState,
        afterState,
        {
          description: 'Update via resource_manager',
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

    // Result read, not discarded. `reload` returns false when no definition loads, and an
    // unconditional `🔄 Gate reloaded` on that branch is the same false claim `handleCreate`
    // branches on twelve lines up.
    const reloaded = await this.ctx.gateManager.reload(id);
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

    response += reloaded
      ? `🔄 Gate reloaded`
      : `⚠️ Files written, but the gate could not be reloaded into this process — it still holds ` +
        `its previous content. See the server log.`;

    return this.success(response);
  }

  async handleDelete(args: GateManagerInput): Promise<ToolResponse> {
    const { id } = args;

    if (!id) return this.error('Gate ID is required for delete action');

    // Deliberately NOT gated on registry membership. Delete removes a directory, so the directory
    // is the authority — and the check below is exactly that. A registry check here refused to
    // delete a gate that exists on disk but was never registered, which is precisely what a create
    // used to produce: the tool could not clean up what it had just made, and the directory had to
    // be removed by hand. The unregister call further down already tolerates a gate the registry
    // does not know, and logs when that happens.
    const gatesDir = this.ctx.configManager.getGatesDirectory();
    // Contained before `existsSync`, and well before the `fs.rm(..., { recursive: true })` below.
    // This join takes the same unvalidated caller id the writer does, and its consequence is
    // strictly worse: a traversing id would have aimed a recursive delete outside the root.
    let gateDir: string;
    try {
      gateDir = resolveContainedPath(gatesDir, id);
    } catch (error) {
      return this.error(error instanceof Error ? error.message : String(error));
    }

    if (!existsSync(gateDir)) {
      // P1.3 — the same false refusal prompts carried. A gate resident only in the bundled tree
      // is loaded, selectable and enforced, and this path checks the writable root alone, so the
      // message named a directory that was never supposed to exist and implied the gate did not.
      const bundledRoot = this.ctx.configManager.getBundledResourceDirectory('gates');
      if (bundledRoot !== undefined && path.resolve(bundledRoot) !== path.resolve(gatesDir)) {
        const bundledGateDir = path.join(bundledRoot, id);
        if (existsSync(bundledGateDir)) {
          return this.error(
            `'${id}' ships with the server and is served from the bundled resources tree ` +
              `(${bundledGateDir}), which is read-only — deleting it is not possible. ` +
              `Your resources root is ${gatesDir}. Update it instead: your copy is written to ` +
              `your own root and takes precedence over the bundled one.`
          );
        }
      }
      return this.error(`Gate not found: '${id}'. Nothing was removed.`);
    }

    // `dry_run` reports what would be removed and returns before anything is. Deletion is the one
    // destructive action rollback cannot undo — there is no version row for a gate that no longer
    // exists — so a preview is worth more here than anywhere else.
    if (args.dry_run === true) {
      return this.success(
        `🔍 **Dry run** — deletion of gate '${id}'\n\n` +
          `Nothing was removed.\n\n` +
          `📁 Would remove the directory: ${gateDir}\n` +
          `📜 Its \`version_history\` rows are NOT removed — they survive and become unreachable, ` +
          `since rollback resolves the gate first\n` +
          `⚠️ Deletion cannot be undone — rollback cannot restore a deleted gate.\n\n` +
          `💡 Re-send the same call without \`dry_run\` to apply it.`
      );
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

    // Reports which of the two removals actually happened rather than asserting both. A gate that
    // was on disk but never registered is now deletable (see the guard note above), and saying it
    // was "unregistered from registry" in that case would repeat the create-side false claim this
    // change exists to remove.
    return this.success(
      `✅ Gate '${id}' deleted successfully\n\n` +
        `📁 Directory removed: ${gateDir}\n\n` +
        (unregistered
          ? `🔄 Gate unregistered from registry`
          : `ℹ️ It was not in the gate registry, so only the files were removed`)
    );
  }

  async handleReload(args: GateManagerInput): Promise<ToolResponse> {
    const { id, reason } = args;

    if (!id) return this.error('Gate ID is required for reload action');

    // Deliberately NOT gated on registry membership either. `reload` is the recovery verb: the
    // registry's own `reloadGuide` reads the definition from disk and registers it whether or not
    // the id was already known. Guarding it with `has(id)` refused the one operation able to
    // repair an unregistered gate — a check for the very state it exists to fix — which is why a
    // freshly created gate could not be recovered without a restart.
    //
    // Nothing is lost by dropping it: `reloadGuide` returns false when no definition loads from
    // disk, and that becomes the error below.
    const reloadSuccess = await this.ctx.gateManager.reload(id);
    if (!reloadSuccess) {
      return this.error(
        `Failed to reload gate '${id}' — no gate definition could be loaded from disk. ` +
          `Check that ${path.join(this.ctx.configManager.getGatesDirectory(), id, 'gate.yaml')} exists.`
      );
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
