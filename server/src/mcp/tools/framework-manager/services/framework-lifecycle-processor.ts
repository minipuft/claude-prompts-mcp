// @lifecycle canonical - Framework lifecycle operations: create, update, delete, reload, switch.

import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { reregisterFramework } from './framework-reregistration.js';
import { frameworkSnapshotContract } from './framework-snapshot-contract.js';
import { isPreviewRequest } from '../../shared/preview-action.js';
import { formatRepairServingLine } from '../../shared/quarantine-report.js';

import type { ResourceWriteCommitOptions } from '#modules/resources/services/index.js';
import type { ToolResponse } from '#shared/types/index.js';
import type { QuarantinedResource } from '#shared/utils/resource-quarantine.js';
import type { FrameworkDraftValidator } from './framework-draft-validator.js';
import type { FrameworkResourceContext } from '../core/context.js';
import type { FrameworkManagerInput, FrameworkCreationData } from '../core/types.js';

import { purgeHistoryOnDelete } from '#modules/versioning/delete-purge.js';
import { projectWriteModel } from '#modules/versioning/index.js';
import { resolveContainedPath } from '#shared/utils/path-containment.js';
import { preferredRepairTarget } from '#shared/utils/resource-quarantine.js';

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

    // "Comprehensive" is true of the three sources it names and false of the disk. All three miss
    // a framework whose only file is a REFUSED one in a root this server cannot write: the
    // registry and the framework map never got an entry, and `frameworkExists` resolves the
    // writable root alone (`FrameworkFileWriter.getFrameworkDir`), where there is nothing. So
    // `create` wrote an overlay and reported plain success, never mentioning the broken file — the
    // same silent-overwrite shape P4.19 closed on gates, which was left open here on the stated
    // premise that the directory check already covered it. It covers the writable root only.
    //
    // Consulted ONLY on this branch, where nothing exists, mirroring the discipline `handleUpdate`
    // states: a REGISTERED framework is never redirected by a quarantined namesake in another root.
    const quarantined = this.resolveRepairTarget(id);
    if (quarantined !== undefined) {
      return this.error(
        `Framework '${id}' already exists on disk, but the file at ${quarantined.path} failed to ` +
          `load (${quarantined.error}), so no registry, framework-map or writable-root entry ` +
          `names it.\n\n` +
          `\`create\` would write a new copy that takes over the id, leaving that file exactly as ` +
          `broken and unmentioned. Use \`action: "update"\` with the whole framework body ` +
          `instead — that path repairs the refused file and reports whether it loads afterwards.`
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

    // The created state is recorded as version 1 — the same `saveVersion` MAX(existing)+1
    // numbering every edit uses, which a fresh id resolves to 1 on its own. No bridge: a create
    // has no prior live state to carry across, unlike an edit of an unrecorded framework. Runs as
    // the writer's `commit` step (P4.2 / SF-3 contract, matching `handleUpdate` below) so a
    // persistence failure aborts the create with nothing written.
    const skipVersion = args.skip_version === true;
    const commitOptions: ResourceWriteCommitOptions =
      this.ctx.versionHistoryService.isAutoVersionEnabled() && !skipVersion
        ? {
            commit: async (): Promise<void> => {
              await this.ctx.versionHistoryService.saveVersion(
                'framework',
                id,
                projectWriteModel(
                  id,
                  frameworkData as unknown as Record<string, unknown>,
                  frameworkSnapshotContract.projectedFields
                ),
                { description: 'Created via resource_manager', diff_summary: '' }
              );
            },
          }
        : {};

    // Atomic create with rollback on failure
    const result = await this.createFrameworkAtomic(id, frameworkData, commitOptions);
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
      // The registry has no entry — which is also true of a framework file the loader REFUSED, and
      // that file is the one `resource_manager` is the only sanctioned way to fix. Sending an
      // operator to `create` there is a dead end: `checkFrameworkExists` sees the directory and
      // refuses, so neither verb could reach the file. Consulted ONLY on this branch, so a
      // registered framework is never redirected by a quarantined namesake.
      const repairTarget = this.resolveRepairTarget(id);
      if (repairTarget !== undefined) {
        return await this.repairQuarantinedFramework(args, repairTarget);
      }
      return this.error(`Framework '${id}' not found. Use create action to add new framework.`);
    }

    // Load existing YAML files from disk
    const existingData = await this.ctx.fileService.loadExistingFramework(id);
    if (existingData === null) {
      return this.error(`Failed to load framework files for '${id}'. Files may be corrupted.`);
    }

    // Capture before state for versioning
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

    // One projection of the write serves the version's diff summary and the update's own diff. It
    // is resolved from the plan the writer applies, with the arguments the writer is handed below,
    // so both name the files the write lands in and the lines that change in them.
    const diffResult = this.ctx.textDiffService.generateFileChangeDiff(
      await this.ctx.fileService.projectFrameworkWrite(frameworkData, existingData)
    );

    // Auto-versioning — go-forward: version N holds the state edit N produced, matching prompts
    // and gates. `recordEditResult` bridges the prior live state when it is not already the newest
    // row, which carries pre-existing framework rows across the era boundary without a migration.
    //
    // Handed to the writer as its transaction's `commit` step rather than run ahead of it (P4.2 /
    // SF-3). The record then lands after the files are written and verified, and a record failure
    // restores those files — so neither a version row describing a write that never happened nor a
    // file no version row describes is reachable. Sequencing the two steps could only choose which
    // of those two the caller got; both orderings were shipped here and one was reverted.
    let versionSaved: number | undefined;
    const skipVersion = args.skip_version === true;
    const commitOptions =
      this.ctx.versionHistoryService.isAutoVersionEnabled() && !skipVersion
        ? {
            // Inlined rather than extracted to a helper on purpose: `validate:mutation-atomicity`
            // reads the record's position lexically, so a call one indirection away reads to the
            // gate exactly like the pre-fix shape — and a gate that cannot see the property is
            // not guarding it.
            commit: async (): Promise<void> => {
              const versionResult = await this.ctx.versionHistoryService.recordEditResult(
                'framework',
                id,
                beforeState,
                afterState,
                {
                  description: 'Update via resource_manager',
                  diff_summary: `+${diffResult.stats.additions}/-${diffResult.stats.deletions}`,
                }
              );
              versionSaved = versionResult.version;
              this.ctx.logger.debug(`Saved version ${versionSaved} for framework ${id}`);
            },
          }
        : {};

    // Write framework files with merge from existing data
    const result = await this.ctx.fileService.writeFrameworkFiles(
      frameworkData,
      existingData,
      commitOptions
    );

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

    let response =
      `${registered ? `✅ Framework '${id}' updated successfully` : `⚠️ Framework '${id}' was written to disk but the edit is NOT live in this process`}\n\n` +
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
      : `⚠️ Written to disk but NOT re-registered in this server process. The files on disk are ` +
        `what you asked for; until this resolves, the framework serves its previous content. ` +
        `\`action: "reload"\` retries the same registration and will fail the same way unless the ` +
        `cause was transient — check the server log for the reason, then restart.`;

    return this.success(response);
  }

  /**
   * Rewrite a framework file the loader refused, from the caller's body alone.
   *
   * NOT a merge — `existingData` is passed as `null` on purpose. `handleUpdate` deep-merges the
   * request over the YAML already on disk, and here that YAML is the thing that failed validation:
   * merging onto it would preserve the defect the caller is trying to remove. The broken file's
   * content is not returned to the caller either — a framework's `systemPromptGuidance` and
   * `judgePrompt` are instruction delivered to the client LLM (CLAUDE.md §Instruction surface),
   * and this is the file whose content has not been checked.
   *
   * A version row IS recorded, and it records the produced state only. `recordEditResult` is
   * deliberately not used: it writes a BRIDGE version of the prior live state whenever that state
   * is not already the newest row, and a quarantined framework's prior state is the content that
   * failed validation — bridging it would either publish the broken bytes as a restorable version
   * or throw inside the mutation. `saveVersion` with the produced snapshot alone is the honest
   * record: `version_history` is durable and nothing regenerates it, so the edit most worth having
   * a row for was the one that had none.
   */
  private async repairQuarantinedFramework(
    args: FrameworkManagerInput,
    target: QuarantinedResource
  ): Promise<ToolResponse> {
    const id = String(args.id);

    if (args.name === undefined || args.name === '') {
      return this.error(
        `Framework '${target.id}' is quarantined — the file at ${target.path} failed to load ` +
          `(${target.error}).\n\n` +
          `A repair supplies the WHOLE framework: there is no loaded state to merge onto, and the ` +
          `content that failed validation is deliberately not returned here. Missing: name.`
      );
    }

    // Same derivation `handleCreate` uses, and for the same reason: a repair has no prior `type`
    // to fall back on, and the schema requires one.
    const frameworkData: FrameworkCreationData = {
      id,
      name: args.name,
      type:
        args.framework !== undefined && args.framework !== ''
          ? args.framework
          : id.toUpperCase().replace(/-/g, '_'),
      system_prompt_guidance: args.system_prompt_guidance ?? '',
      enabled: args.enabled ?? true,
    };
    this.assignOptionalFields(frameworkData, args);

    // The state this repair will PRODUCE — the only state there is. No merge base is passed,
    // unlike `handleUpdate`'s call: there is no loadable prior YAML to merge over, which is what
    // quarantined means.
    const afterState = projectWriteModel(
      id,
      frameworkData as unknown as Record<string, unknown>,
      frameworkSnapshotContract.projectedFields
    );

    let versionSaved: number | undefined;
    const skipVersion = args.skip_version === true;
    const commitOptions =
      this.ctx.versionHistoryService.isAutoVersionEnabled() && !skipVersion
        ? {
            // Inlined at the call site for the same reason as `handleUpdate`'s:
            // `validate:mutation-atomicity` reads the record's position lexically, so a record one
            // indirection away reads to the gate exactly like the pre-fix shape.
            commit: async (): Promise<void> => {
              const versionResult = await this.ctx.versionHistoryService.saveVersion(
                'framework',
                id,
                afterState,
                {
                  description: 'Repair of quarantined framework via resource_manager',
                  // Empty, and it means something: there is no prior loadable state to diff
                  // against, so a `+n/-n` here would be measured against a fiction.
                  diff_summary: '',
                }
              );
              versionSaved = versionResult.version;
              this.ctx.logger.debug(`Saved repair version ${versionSaved} for framework ${id}`);
            },
          }
        : {};

    const result = await this.ctx.fileService.writeFrameworkFiles(
      frameworkData,
      null,
      commitOptions
    );
    if (!result.success) {
      return this.error(`Failed to repair framework: ${result.error}`);
    }

    // Clears the loader cache for this id and re-reads the file, so the quarantine describes THIS
    // write by the time the outcome line reads it back — rather than the state the write was asked
    // to produce, which is the assertion the row turns on.
    await this.reregister(id);

    const writtenPath = path.join(this.ctx.fileService.getFrameworkDir(id), 'framework.yaml');
    // The root that write resolved through — `getFrameworkDir` is `getFrameworksDirectory()` plus
    // the id, and this is the same directory `resolveRepairTarget` prefers. Named so
    // `formatRepairOutcome` can compare the served stamp against it.
    const writtenRoot = this.ctx.configManager.getFrameworksDirectory();

    // Says what was recorded and why it carries no diff. The previous wording — "No version was
    // recorded" — became a lie the moment the record above was added, and a version line is the
    // one place an operator checks before trusting `rollback`.
    const versionLine =
      versionSaved !== undefined
        ? `📜 **Version ${versionSaved}** recorded — the repaired state, with no diff: a ` +
          `quarantined framework has no prior loadable state to compare against (use ` +
          `\`action:"history"\` to view).\n`
        : `📜 No version was recorded — auto-versioning is off for this server, or ` +
          `\`skip_version\` was set on this call.\n`;

    return this.success(
      `Repair written for quarantined framework '${target.id}'\n\n` +
        `📁 Files written:\n${result.paths?.map((p) => `  - ${p}`).join('\n')}\n\n` +
        versionLine +
        this.formatRepairOutcome(target, writtenPath, writtenRoot)
    );
  }

  /**
   * The quarantine record an unqualified `update` on this id means, if any.
   *
   * WRITABLE root first: `preferredRepairTarget` prefers the primary because that is the root a
   * `resource_manager` write lands in, so an operator repairing `foo` means the copy they can
   * actually edit rather than the bundled one they cannot. NOT precedence — since P4.27 the primary
   * is outranked by every overlay (`shared/utils/resource-root-lookup.ts` §resourceRootPrecedence),
   * and this docstring cited that precedence back when the two happened to agree.
   */
  private resolveRepairTarget(id: string): QuarantinedResource | undefined {
    const records = this.ctx.frameworkManager.getQuarantine().byId(id.toLowerCase());
    if (records.length === 0) return undefined;
    return preferredRepairTarget(records, this.ctx.configManager.getFrameworksDirectory());
  }

  /**
   * Say, in the repair's own response, what happened to the refused file AND which root serves now.
   *
   * TWO INDEPENDENT FACTS, and they were fused into one claim. What happened to the refused file
   * has three outcomes, not two: the write always lands in the WRITABLE root, and the refused file
   * is not always there — a broken bundled framework is repaired by writing the primary, which
   * leaves the bundled file exactly as broken as it was. Reporting that as "still quarantined"
   * reads as a failed repair; reporting it as repaired claims a file was fixed that was never
   * written.
   *
   * WHICH ROOT SERVES is the second fact, and it does not follow from the first. This branch used
   * to assert that the written file "takes precedence, so `<id>` now serves your copy", which
   * P4.27 made false whenever the refused file sits in an overlay: overlays outrank the primary,
   * so the repair lands in a root that does not answer. `formatRepairServingLine` reads the
   * loader's own `sourceRoot` stamp back instead of re-deriving the order here.
   */
  private formatRepairOutcome(
    target: QuarantinedResource,
    writtenPath: string,
    writtenRoot: string
  ): string {
    const stillRefused = this.ctx.frameworkManager
      .getQuarantine()
      .byId(target.id)
      .some((record) => record.path === target.path);
    // The root the re-registration above actually served this id from — the loader's stamp carried
    // through `FrameworkManager`'s projection, not a second derivation of precedence. Ids are
    // lower-cased on both sides: a served framework's id is upper-cased, a record's is the
    // directory name.
    const servedFrom = this.ctx.frameworkManager
      .listFrameworks(false)
      .find((framework) => framework.id.toLowerCase() === target.id)?.sourceRoot;
    const serving = formatRepairServingLine(target.id, writtenRoot, servedFrom);

    if (!stillRefused) {
      return (
        `\n🩹 **Repaired**: \`${target.path}\` now loads and its quarantine record is cleared.\n` +
        serving
      );
    }

    if (path.resolve(target.path) !== path.resolve(writtenPath)) {
      return (
        `\n🚧 **The refused file was in another root and was not touched.** This repair wrote ` +
        `\`${writtenPath}\`; \`${target.path}\` stays quarantined.\n` +
        serving
      );
    }

    return (
      `\n🚧 **Still quarantined**: \`${target.path}\` did not load after the write — the ` +
      `framework remains absent from the registry. See the server log for the loader's reason.\n`
    );
  }

  /**
   * The refusal for a delete of an id that has no directory at the writable root.
   *
   * Extracted from `handleDelete` because it owns a decision — WHICH of two refusals the operator
   * gets, and the wording that sends them to the right remedy — rather than naming a step, and it
   * is the one region of that handler that nests three deep. The handler keeps the guard.
   */
  private missingFrameworkRefusal(id: string, frameworksDir: string): ToolResponse {
    // P1.3 — a framework served from the bundled tree is loaded and selectable; refusing it as
    // "directory not found" described a path that was never meant to exist.
    //
    // This branch does NOT carry the shipped frameworks, and a comment here said it did until
    // 2026-09-07. It could not: the whole branch is unreachable while `frameworkDir` exists,
    // which it does at the configured root for every shipped id, and its inner test additionally
    // requires the bundled root to DIFFER from the resources root — equal in a default install.
    // A claim of coverage from a branch that cannot execute is the shape that hid this defect,
    // so what remains here is only the case it can serve: an operator whose resources root is
    // separate from the bundle naming something that exists only in the bundle.
    const bundledRoot = this.ctx.configManager.getBundledResourceDirectory('frameworks');
    if (bundledRoot !== undefined && path.resolve(bundledRoot) !== path.resolve(frameworksDir)) {
      const bundledDir = resolveContainedPath(bundledRoot, id.toLowerCase());
      if (existsSync(bundledDir)) {
        return this.error(
          `'${id}' ships with the server and is served from the bundled resources tree ` +
            `(${bundledDir}), which is read-only — deleting it is not possible. ` +
            `Your resources root is ${frameworksDir}. Update it instead: the update copies it ` +
            // "over the bundled one", not bare "takes precedence" — this branch compares the
            // writable root to the bundled tree only, and the writable root is no longer the top
            // of the order. An operator with a workspace overlay reading the unqualified clause
            // would be told their copy wins a contest it can lose. The gate twin already says it
            // this way; the prompt twin (`prompt/operations/file-operations.ts`) does not.
            `into your own root first and your copy takes precedence over the bundled one.`
        );
      }
    }
    return this.error(`Framework '${id}' not found. Nothing was removed.`);
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
    // had just written, and the directory had to be removed by hand. The `removeFramework` call
    // further down already tolerates a framework the registry does not know, and logs when that
    // happens. Same removal, same reasoning, as the gate side in `b7102dd9`.

    // Resolve through the SAME root a framework write resolves through.
    //
    // This built `join(getServerRoot(), 'resources', 'frameworks', id)` — hardcoding the package
    // tree and consulting neither the config nor the environment, which is the defect D8 Arc 1
    // fixed for framework creates (`9e229e1e`) and missed here. With a personal library
    // configured, deleting a framework you had just created there looked in the package tree and
    // reported it missing.
    const frameworksDir = this.ctx.configManager.getFrameworksDirectory();
    const frameworkDir = resolveContainedPath(frameworksDir, id.toLowerCase());

    // Placed AFTER path resolution, not before, so a refusal can say where the thing it is
    // protecting actually lives, and before the preview, so a preview reports the same refusal.
    const refusal = this.protectedDeletionRefusal(id, frameworkDir);
    if (refusal !== undefined) {
      return refusal;
    }

    if (!existsSync(frameworkDir)) {
      return this.missingFrameworkRefusal(id, frameworksDir);
    }

    // A preview reports what would be removed and returns before anything is. Deletion is the one
    // destructive action rollback cannot undo — there is no version row for a framework that no
    // longer exists.
    if (isPreviewRequest(args)) {
      return this.success(
        `🔍 **Preview** — deletion of framework '${id}'\n\n` +
          `Nothing was removed.\n\n` +
          `📁 Would remove the directory: ${frameworkDir}\n` +
          `📜 Would also purge its \`version_history\` rows — a preview purges nothing\n` +
          `⚠️ Deletion cannot be undone — rollback cannot restore a deleted framework.\n\n` +
          `💡 Re-send as \`action:"delete"\` with \`confirm: true\` to apply it.`
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

    // AFTER the removal, and only if it succeeded. The other order destroys the rollback history
    // of a resource that is still on disk when the `fs.rm` fails, which is unrecoverable; this
    // order's failure mode is rows left behind, which is the state before this was wired.
    const purge = await purgeHistoryOnDelete(
      this.ctx.versionHistoryService,
      'framework',
      id,
      `directory removed: ${frameworkDir}`
    );
    if (purge.failure !== undefined) return this.error(purge.failure);

    // Unregister framework from in-memory registry, moving a selection that named it to the
    // configured default. Throws when that move fails to persist.
    const unregistered = await this.ctx.frameworkManager.removeFramework(id);
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
        `📜 Version history purged: ${purge.removed} row(s)\n\n` +
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
      // The loader has just re-read the file, so the quarantine describes THIS attempt. When it
      // holds a record the cause is known exactly, and naming it beats the deliberately vague
      // fallback below.
      const refused = this.ctx.frameworkManager.getQuarantine().byId(id.toLowerCase());
      if (refused.length > 0) {
        return this.error(
          `Failed to reload framework '${id}' — the file was read and refused:\n` +
            refused.map((record) => `  - ${record.path}: ${record.error}`).join('\n')
        );
      }
      // Deliberately does not name a single cause. `reregisterFramework` returns false for an
      // uninitialized manager, an unavailable registry, a guide that loads but cannot be
      // retrieved, a definition that fails to generate, or a thrown error — only one of which is
      // "the file is missing". The previous text sent operators to check a file that exists.
      //
      // Resolved through the same roots the loader itself reads (`resolveExistingFrameworkDir`
      // checks the writable root first, then the bundled root — matching
      // `RuntimeFrameworkLoader`'s primary-then-additional-dirs order). Falls back to the write
      // target (`getFrameworkDir`) when the id resolves nowhere, since that is where an operator
      // would place the file.
      const frameworkDir =
        this.ctx.fileService.resolveExistingFrameworkDir(id) ??
        this.ctx.fileService.getFrameworkDir(id);
      return this.error(
        `Failed to reload framework '${id}' — it could not be registered from disk. Check the ` +
          `server log for the reason, then verify that ` +
          `${path.join(frameworkDir, 'framework.yaml')} exists and parses.`
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
    return await reregisterFramework(this.ctx, id);
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
   * The refusal for deleting a framework that must not be removed, or `undefined` when the delete
   * may proceed. Checked before anything is removed.
   *
   * A framework that ships with the package. This asked a hardcoded four-id literal until
   * 2026-09-07 while eight ship, so `focus`, `liquescent`, `radiant` and `verify` fell through to
   * `fs.rm` and were deleted FROM THE BUNDLED TREE in a default install. The bundled-tree check in
   * `handleDelete` could not cover them, because it sits inside `if (!existsSync(frameworkDir))`
   * and those directories exist at the configured root. The owner of framework validity answers
   * this — project CLAUDE.md's Domain Ownership Matrix says never hardcode a framework list. P1.3
   * ruled that a refusal states the reason that is true and names the location, and an e2e case
   * asserts it.
   *
   * The configured default framework. It is where the active framework goes when its own framework
   * is removed, so without it that selection has nothing to resolve to. Ids are compared
   * case-insensitively, as the framework state store compares them.
   */
  private protectedDeletionRefusal(id: string, frameworkDir: string): ToolResponse | undefined {
    if (this.ctx.frameworkManager.isShippedFramework(id)) {
      return this.error(
        `Cannot delete framework '${id}': it ships with the server and is served from ` +
          `${frameworkDir}, which is read-only for deletion. Only frameworks you created can be ` +
          `deleted. Update it instead — the update copies it into your own resources root first ` +
          // Qualified for the same reason as its sibling in `handleDelete`'s bundled branch, which
          // was fixed while this one was missed: the comparison is against the SHIPPED copy, and
          // the writable root is no longer the top of the order.
          `and your copy takes precedence over the bundled one.`
      );
    }

    const configuredDefault = this.ctx.configManager.getFrameworksConfig().defaultFramework;
    if (id.toLowerCase() === configuredDefault.toLowerCase()) {
      return this.error(
        `Cannot delete framework '${id}': it is the configured default framework ` +
          `(frameworks.defaultFramework), which the active framework falls back to when its ` +
          `framework is removed. Point frameworks.defaultFramework at another framework first. ` +
          `Nothing was removed.`
      );
    }

    return undefined;
  }

  /**
   * Atomic framework creation with rollback on failure.
   */
  private async createFrameworkAtomic(
    id: string,
    frameworkData: FrameworkCreationData,
    commitOptions: ResourceWriteCommitOptions = {}
  ): Promise<{ success: boolean; error?: string; paths?: string[] }> {
    const normalizedId = id.toLowerCase();
    const registry = this.ctx.frameworkManager.getFrameworkRegistry();

    // Step 1: Write files to disk
    const writeResult = await this.ctx.fileService.writeFrameworkFiles(
      frameworkData,
      null,
      commitOptions
    );
    if (!writeResult.success) {
      return { success: false, error: `File write failed: ${writeResult.error}` };
    }

    // Step 2: Clear loader cache to force fresh load
    const loader = registry.getRuntimeLoader();
    loader.clearCache();

    // Step 3: Register in framework registry
    const registryResult = await registry.loadAndRegisterById(normalizedId);
    if (!registryResult) {
      // The boolean is read, not discarded. `deleteFramework` returns false on an rm failure or
      // a missing directory and logs rather than throwing, so the old unconditional
      // "files rolled back" told the operator the disk was clean while a half-written framework
      // directory could still be sitting there — the orphan state task 3.2 exists to make
      // recoverable.
      const removed = await this.ctx.fileService.deleteFramework(normalizedId);
      return {
        success: false,
        error: removed
          ? 'Registry registration failed - files rolled back'
          : `Registry registration failed, AND the files could not be removed — ${this.ctx.fileService.getFrameworkDir(normalizedId)} may still exist. Delete it before retrying.`,
      };
    }

    // Step 4: Register in framework manager
    const frameworkResult = await this.ctx.frameworkManager.registerFramework(id);
    if (!frameworkResult) {
      const unregistered = registry.unregisterGuide(normalizedId);
      const removed = await this.ctx.fileService.deleteFramework(normalizedId);
      return {
        success: false,
        error:
          unregistered && removed
            ? 'Framework registration failed - registry and files rolled back'
            : `Framework registration failed, and rollback was incomplete: ${unregistered ? 'guide unregistered' : 'guide NOT unregistered'}, ${removed ? 'files removed' : `files NOT removed (${this.ctx.fileService.getFrameworkDir(normalizedId)} may still exist)`}.`,
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
