// @lifecycle canonical - Gate CRUD operations: create, update, delete, reload.
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { ensureTrailingNewline } from './gate-file-writer.js';
import { gateSnapshotContract } from './gate-snapshot-contract.js';
import { isPreviewRequest } from '../../shared/preview-action.js';

import type { ToolResponse } from '#shared/types/index.js';
import type { QuarantinedResource } from '#shared/utils/resource-quarantine.js';
import type { GateResourceContext } from '../core/context.js';
import type { GateManagerInput, GateCreationData } from '../core/types.js';

import { projectWriteModel } from '#modules/versioning/index.js';
import { logMcpToolChange } from '#runtime/resource-change-tracking.js';
import { resolveContainedPath } from '#shared/utils/path-containment.js';
import { preferredRepairTarget } from '#shared/utils/resource-quarantine.js';

export class GateLifecycleProcessor {
  constructor(private readonly ctx: GateResourceContext) {}

  async handleCreate(args: GateManagerInput): Promise<ToolResponse> {
    const {
      id,
      name,
      type,
      description,
      guidance,
      pass_criteria,
      activation,
      retry_config,
      severity,
      enforcementMode,
      gate_type,
      subject,
    } = args;

    if (!id) return this.error('Gate ID is required for create action');
    if (!name) return this.error('Gate name is required for create action');
    if (!description) return this.error('Gate description is required for create action');
    if (!guidance) return this.error('Gate guidance is required for create action');

    if (this.ctx.gateManager.has(id)) {
      return this.error(`Gate '${id}' already exists. Use update action to modify.`);
    }

    // `has(id)` is FALSE for a gate file the loader REFUSED, so without this branch `create` is
    // the one verb that still overwrites a quarantined file and reports plain success — never
    // mentioning that anything was there. That was tolerable while a quarantined gate was
    // unreachable by every verb; once `handleUpdate` learned to repair one, an operator who
    // reached for `create` instead got no signal at all, which is worse than uniform ignorance.
    //
    // Consulted ONLY here, on the branch where the registry has no entry, mirroring the
    // discipline `handleUpdate` states: a REGISTERED gate is never redirected by a quarantined
    // namesake in another root. The refusal names the refused file and the verb that repairs it,
    // because "already exists" alone would send the operator looking for a gate `inspect` cannot
    // show them.
    const quarantined = this.resolveRepairTarget(id);
    if (quarantined !== undefined) {
      return this.error(
        `Gate '${id}' already exists on disk, but the file at ${quarantined.path} failed to ` +
          `load (${quarantined.error}), so the registry has no entry for it.\n\n` +
          `\`create\` would overwrite that file without acknowledging it was there. Use ` +
          `\`action: "update"\` with the whole gate body instead — that path repairs the refused ` +
          `file and reports whether it loads afterwards.`
      );
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
      severity,
      enforcementMode,
      gate_type,
      subject,
    };

    // The created state is recorded as version 1 — the same `saveVersion` MAX(existing)+1
    // numbering every edit uses, which a fresh id resolves to 1 on its own. No bridge: a create
    // has no prior live state to carry across, unlike an edit of an unrecorded gate. Runs as the
    // writer's `commit` step (P4.2 / SF-3 contract, matching `handleUpdate` below) so a
    // persistence failure aborts the create with nothing written.
    //
    // `guidance` is normalized through the SAME `ensureTrailingNewline` the writer applies to
    // `guidance.md` — measured: recording the raw, un-normalized value here recorded a snapshot
    // that a disk read-back never matches, so the first update bridged every single create.
    const skipVersion = args.skip_version === true;
    const commitOptions =
      this.ctx.versionHistoryService.isAutoVersionEnabled() && !skipVersion
        ? {
            commit: async (): Promise<void> => {
              await this.ctx.versionHistoryService.saveVersion(
                'gate',
                id,
                projectWriteModel(
                  id,
                  { ...gateData, guidance: ensureTrailingNewline(gateData.guidance) },
                  gateSnapshotContract.projectedFields
                ),
                { description: 'Created via resource_manager', diff_summary: '' }
              );
            },
          }
        : {};

    // `create` owns the WHOLE state being written — there is no prior file to narrow a scope
    // against — so `suppliedKeys` is left at the writer's own default (every gate-data key)
    // rather than computing one, the same convention `updatePromptImplementation`'s create
    // caller uses in `prompt-lifecycle-processor.ts`.
    const result = await this.ctx.gateFileService.writeGateFiles(
      gateData,
      undefined,
      commitOptions
    );
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
    const {
      id,
      name,
      type,
      description,
      guidance,
      pass_criteria,
      activation,
      retry_config,
      severity,
      enforcementMode,
      gate_type,
      subject,
    } = args;

    if (!id) return this.error('Gate ID is required for update action');

    if (!this.ctx.gateManager.has(id)) {
      // The registry has no entry — which is also true of a gate file the loader REFUSED, and that
      // file is the one `resource_manager` is the only sanctioned way to fix. Sending an operator
      // to `create` there is a dead end: `handleCreate` refuses nothing (the registry does not
      // have it) and then writes over the broken file with no acknowledgement that it was broken,
      // so the one response that could have said what is wrong says nothing. Consulted ONLY on
      // this branch, so a registered gate is never redirected by a quarantined namesake.
      const repairTarget = this.resolveRepairTarget(id);
      if (repairTarget !== undefined) {
        return await this.repairQuarantinedGate(args, repairTarget);
      }
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
      // Deliberately NOT defaulted to the existing definition, unlike the three above. These
      // two are preserved keys, not projected ones: `resolvePreservedGateYamlFields` already
      // falls back to the on-disk value when the caller omits them. Reading them from
      // `existingDefinition` here would work by coincidence and would defeat the preservation
      // path the moment the two disagree — the loader applies a `severity` default, so the
      // definition reports `medium` for a file that declares nothing. `gate_type` (P4.10) is
      // the third such key and rides the same path.
      severity,
      enforcementMode,
      gate_type,
      subject,
    };

    // The union of fields THIS call actually supplied, as opposed to `gateData` above — which
    // already carries every field merged with its existing value, so it cannot itself say which
    // were caller-supplied and which were only carried forward. `GateFileWriter` uses this to
    // narrow which files a write touches: a key absent here leaves the corresponding file
    // untouched (byte-identical) rather than re-serialized from `gateData`'s already-merged
    // values. Mirrors `suppliedKeys` in `prompt-lifecycle-processor.ts` (Fix B write-scope
    // narrowing).
    const suppliedKeys = new Set(
      Object.entries({
        name,
        type,
        description,
        guidance,
        pass_criteria,
        activation,
        retry_config,
        severity,
        enforcementMode,
        subject,
      })
        .filter(([, value]) => value !== undefined)
        .map(([key]) => key)
    );

    // The state this edit will PRODUCE. `gateData` already resolves every projected field —
    // supplied value, else the existing one — so it needs no merge base.
    const afterState = projectWriteModel(
      id,
      gateData as unknown as Record<string, unknown>,
      gateSnapshotContract.projectedFields
    );

    // One projection of the write serves the version's diff summary and the update's own diff. It
    // is resolved from the plan the writer applies, with the payload and scope the writer is
    // handed below, so both name exactly the files the write lands in and the lines that change.
    const diffResult = this.ctx.textDiffService.generateFileChangeDiff(
      await this.ctx.gateFileService.projectGateWrite(gateData, suppliedKeys)
    );

    // Auto-versioning — go-forward: version N holds the state edit N produced, so the newest
    // version always equals what `inspect` shows. `recordEditResult` bridges the prior live state
    // first when it is not already the newest row, which is what carries pre-P7 gate rows across
    // the era boundary with no data migration.
    //
    // Runs as the writer transaction's `commit` step, not ahead of it (P4.2 / SF-3) — see the
    // matching comment in `framework-lifecycle-processor.ts` for why ordering the record against
    // the write could only pick which failure mode the caller got.
    let versionSaved: number | undefined;
    const skipVersion = args.skip_version === true;
    const commitOptions =
      this.ctx.versionHistoryService.isAutoVersionEnabled() && !skipVersion
        ? {
            // Inlined rather than extracted to a helper on purpose — see the note in
            // `framework-lifecycle-processor.ts`: `validate:mutation-atomicity` reads the record's
            // position lexically, and a gate that cannot see the property is not guarding it.
            commit: async (): Promise<void> => {
              const versionResult = await this.ctx.versionHistoryService.recordEditResult(
                'gate',
                id,
                beforeState,
                afterState,
                {
                  description: 'Update via resource_manager',
                  diff_summary: `+${diffResult.stats.additions}/-${diffResult.stats.deletions}`,
                }
              );
              versionSaved = versionResult.version;
              this.ctx.logger.debug(`Saved version ${versionSaved} for gate ${id}`);
            },
          }
        : {};

    const result = await this.ctx.gateFileService.writeGateFiles(
      gateData,
      suppliedKeys,
      commitOptions
    );
    if (!result.success) {
      return this.error(`Failed to update gate: ${result.error}`);
    }

    // Result read, not discarded. `reload` returns false when no definition loads, and an
    // unconditional `🔄 Gate reloaded` on that branch is the same false claim `handleCreate`
    // branches on twelve lines up.
    const reloaded = await this.ctx.gateManager.reload(id);
    this.trackChange('modified', id);

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

  /**
   * Rewrite a gate file the loader refused, from the caller's body alone.
   *
   * NOT a merge. There is no loaded definition to fall back on — that is what quarantined means —
   * so every field `handleUpdate` would carry forward from `existingGate` has to arrive in this
   * call, and the three the schema requires are demanded up front rather than written as blanks
   * that fail validation a second time. The broken file's own content is not returned to the
   * caller: it is the content that failed validation, and a gate's `guidance` and `description`
   * are instruction delivered to the client LLM (CLAUDE.md §Instruction surface).
   *
   * A version row IS recorded, and it records the produced state only. `recordEditResult` is
   * deliberately not used: it compares the prior live snapshot against the newest recorded row and
   * writes a BRIDGE version of that prior state when they differ, and a quarantined gate's prior
   * state is the content that failed validation — bridging it would either publish the broken
   * bytes as a restorable version or throw inside the mutation. `saveVersion` with the produced
   * snapshot alone is the honest record: `version_history` is durable and nothing regenerates it,
   * so the edit most worth having a row for was the one that had none.
   */
  private async repairQuarantinedGate(
    args: GateManagerInput,
    target: QuarantinedResource
  ): Promise<ToolResponse> {
    // Coalesced to `''` up front so the three fields are plain strings from here on: the refusal
    // below is the only thing that distinguishes absent from supplied, and once it has not fired
    // there is nothing left for a non-null assertion to assert.
    const name = args.name ?? '';
    const description = args.description ?? '';
    const guidance = args.guidance ?? '';
    const missing = Object.entries({ name, description, guidance })
      .filter(([, value]) => value === '')
      .map(([field]) => field);

    if (missing.length > 0) {
      return this.error(
        `🚧 Gate '${target.id}' is quarantined — the file at ${target.path} failed to load ` +
          `(${target.error}).\n\n` +
          `A repair supplies the WHOLE gate: there is no loaded state to merge onto, and the ` +
          `content that failed validation is deliberately not returned here. Missing: ` +
          `${missing.join(', ')}.`
      );
    }

    const gateData: GateCreationData = {
      id: String(args.id),
      name,
      type: args.type ?? 'validation',
      description,
      guidance,
      pass_criteria: args.pass_criteria,
      activation: args.activation,
      retry_config: args.retry_config,
      severity: args.severity,
      enforcementMode: args.enforcementMode,
      gate_type: args.gate_type,
    };

    // The state this repair will PRODUCE — the only state there is. `gateData` already resolves
    // every projected field from the caller's body, and there is no merge base by construction.
    const afterState = projectWriteModel(
      String(args.id),
      gateData as unknown as Record<string, unknown>,
      gateSnapshotContract.projectedFields
    );

    let versionSaved: number | undefined;
    const skipVersion = args.skip_version === true;
    const commitOptions =
      this.ctx.versionHistoryService.isAutoVersionEnabled() && !skipVersion
        ? {
            // Inlined at the call site for the same reason as `handleUpdate`'s:
            // `validate:mutation-atomicity` reads the record's position lexically, and a record
            // one indirection away is indistinguishable from the pre-fix shape.
            commit: async (): Promise<void> => {
              const versionResult = await this.ctx.versionHistoryService.saveVersion(
                'gate',
                String(args.id),
                afterState,
                {
                  description: 'Repair of quarantined gate via resource_manager',
                  // Empty, and it means something: there is no prior loadable state to diff
                  // against, so a `+n/-n` here would be measured against a fiction.
                  diff_summary: '',
                }
              );
              versionSaved = versionResult.version;
              this.ctx.logger.debug(`Saved repair version ${versionSaved} for gate ${args.id}`);
            },
          }
        : {};

    // `suppliedKeys` left to its default: a repair owns the WHOLE state being written, exactly as
    // create and rollback do, so there is no narrower scope to compute. Passed explicitly because
    // main added this parameter ahead of `options` after this call was written, and the commit
    // options were silently arriving as the supplied-key set.
    const result = await this.ctx.gateFileService.writeGateFiles(
      gateData,
      undefined,
      commitOptions
    );
    if (!result.success) {
      return this.error(`Failed to repair gate: ${result.error}`);
    }

    // Reloads through the loader, which clears its cache for this id and re-reads the file — so
    // the quarantine is rebuilt from disk before `formatRepairOutcome` reads it back. Without this
    // the outcome line would report the state the write was ASKED to produce rather than the one
    // the loader observed, which is the whole assertion the row turns on.
    await this.ctx.gateManager.reload(String(args.id));
    this.trackChange('modified', String(args.id));

    const writtenPath = path.join(
      this.ctx.configManager.getGatesDirectory(),
      String(args.id).toLowerCase(),
      'gate.yaml'
    );

    // Says what was recorded and why it carries no diff. The previous wording — "No version was
    // recorded" — became a lie the moment the record above was added, and a version line is the
    // one place an operator checks before trusting `rollback`.
    const versionLine =
      versionSaved !== undefined
        ? `📜 **Version ${versionSaved}** recorded — the repaired state, with no diff: a ` +
          `quarantined gate has no prior loadable state to compare against (use ` +
          `\`action:"history"\` to view).\n`
        : `📜 No version was recorded — auto-versioning is off for this server, or ` +
          `\`skip_version\` was set on this call.\n`;

    return this.success(
      `🩺 Repair written for quarantined gate '${target.id}'\n\n` +
        `📁 Files written:\n${result.paths?.map((p) => `  - ${p}`).join('\n')}\n\n` +
        versionLine +
        this.formatRepairOutcome(target, writtenPath)
    );
  }

  /**
   * The quarantine record an unqualified `update` on this id means, if any.
   *
   * Nearest root first: `preferredRepairTarget` prefers the writable primary, matching
   * `resolveResourceRoots`' precedence, so an operator repairing `foo` means their own copy rather
   * than the bundled one they cannot write to.
   */
  private resolveRepairTarget(id: string): QuarantinedResource | undefined {
    const records = this.ctx.gateManager.getQuarantine().byId(id.toLowerCase());
    if (records.length === 0) return undefined;
    return preferredRepairTarget(records, this.ctx.configManager.getGatesDirectory());
  }

  /**
   * Say, in the repair's own response, whether the file actually loads now.
   *
   * Three outcomes, not two. The write always lands in the WRITABLE root, and the refused file is
   * not always there: a broken bundled gate is repaired by writing an overlay, which takes over
   * the id while the bundled file stays exactly as broken as it was. Reporting that as
   * "still quarantined" would read as a failed repair, and reporting it as repaired would claim a
   * file was fixed that was never written.
   */
  private formatRepairOutcome(target: QuarantinedResource, writtenPath: string): string {
    const stillRefused = this.ctx.gateManager
      .getQuarantine()
      .byId(target.id)
      .some((record) => record.path === target.path);

    if (!stillRefused) {
      return (
        `\n🩹 **Repaired**: \`${target.path}\` now loads; its quarantine record is cleared and ` +
        `\`${target.id}\` is served again.\n`
      );
    }

    if (path.resolve(target.path) !== path.resolve(writtenPath)) {
      return (
        `\n🚧 **The refused file was in another root and was not touched.** This repair wrote ` +
        `\`${writtenPath}\`, which takes precedence, so \`${target.id}\` now serves your copy. ` +
        `\`${target.path}\` stays quarantined.\n`
      );
    }

    return (
      `\n🚧 **Still quarantined**: \`${target.path}\` did not load after the write — the gate ` +
      `remains absent from the registry. See the server log for the loader's reason.\n`
    );
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

    // A preview reports what would be removed and returns before anything is. Deletion is the one
    // destructive action rollback cannot undo — there is no version row for a gate that no longer
    // exists — so a preview is worth more here than anywhere else.
    if (isPreviewRequest(args)) {
      return this.success(
        `🔍 **Preview** — deletion of gate '${id}'\n\n` +
          `Nothing was removed.\n\n` +
          `📁 Would remove the directory: ${gateDir}\n` +
          `📜 Its \`version_history\` rows are NOT removed — they survive and become unreachable, ` +
          `since rollback resolves the gate first\n` +
          `⚠️ Deletion cannot be undone — rollback cannot restore a deleted gate.\n\n` +
          `💡 Re-send as \`action:"delete"\` with \`confirm: true\` to apply it.`
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
      // The loader has just re-read the file, so the quarantine describes THIS attempt. Naming the
      // reason beats the old message, which told an operator to check whether a file exists in the
      // one case where it provably does — the loader read it and refused it.
      const refused = this.ctx.gateManager.getQuarantine().byId(id.toLowerCase());
      if (refused.length > 0) {
        return this.error(
          `Failed to reload gate '${id}' — the file was read and refused:\n` +
            refused.map((record) => `  - ${record.path}: ${record.error}`).join('\n')
        );
      }
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
