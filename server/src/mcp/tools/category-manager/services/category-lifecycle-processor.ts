// @lifecycle canonical - Category CRUD operations: create, update, delete, reload.
import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { readCategoryYamlDocument, CATEGORY_YAML_FILENAME } from './category-file-writer.js';
import { categorySnapshotContract } from './category-snapshot-contract.js';
import { isPreviewRequest } from '../../shared/preview-action.js';

import type { ToolResponse } from '#shared/types/index.js';
import type { CategoryResourceContext } from '../core/context.js';
import type { CategoryCreationData, CategoryManagerInput } from '../core/types.js';

import { discoverYamlPromptsInCategory } from '#modules/prompts/category-maintenance.js';
import { purgeHistoryOnDelete } from '#modules/versioning/delete-purge.js';
import {
  updateRowDescription,
  describeVersionRecord,
  projectWriteModel,
} from '#modules/versioning/index.js';
import { resolveContainedPath } from '#shared/utils/path-containment.js';

export class CategoryLifecycleProcessor {
  constructor(private readonly ctx: CategoryResourceContext) {}

  async handleCreate(args: CategoryManagerInput): Promise<ToolResponse> {
    const { id, name, description, registerWithMcp, mcpPromptMode } = args;

    if (id === undefined || id.length === 0) {
      return this.error('Category ID is required for create action');
    }
    if (name === undefined || name.length === 0) {
      return this.error('Category name is required for create action');
    }
    if (description === undefined || description.length === 0) {
      return this.error('Category description is required for create action');
    }

    const located = this.locate(id);
    if (!located.ok) return this.error(located.error);

    // The RESOURCE is `category.yaml`, not the directory, and `create` refuses only when the
    // resource exists. A directory holding prompts but declaring nothing is the normal
    // pre-P4.7 state of every category in this repo — `create` there is exactly the right verb,
    // because it authors the declaration for the first time. Refusing on directory existence
    // instead would leave those categories permanently unauthorable through the tool, which is
    // the defect this row exists to remove.
    if (existsSync(located.yamlPath)) {
      return this.error(
        `Category '${id}' already declares a ${CATEGORY_YAML_FILENAME} at ${located.yamlPath}. ` +
          `Use update action to modify it.`
      );
    }

    const promptsHeld = discoverYamlPromptsInCategory(located.categoryDir).length;
    const directoryExisted = existsSync(located.categoryDir);

    const categoryData: CategoryCreationData = {
      id,
      name,
      description,
      registerWithMcp,
      mcpPromptMode,
    };

    const result = await this.ctx.categoryFileService.writeCategoryFiles(categoryData);
    if (!result.success) {
      return this.error(`Failed to create category: ${result.error}`);
    }

    // For CATEGORIES, as for prompts and unlike gates and frameworks, `onRefresh` IS the
    // registration: it resolves to the application's full server refresh, which re-walks every
    // prompt root and republishes the `Category[]` every consumer reads. There is no per-id
    // category registry to reload. Declared in `validate:registry-coherence`'s RULES so the
    // difference from gates is stated rather than inferred from the absence of a reload call.
    await this.ctx.onRefresh?.();

    const filesWritten = `📁 Files created:\n${result.paths?.map((p) => `  - ${p}`).join('\n')}`;

    return this.success(
      `✅ Category '${id}' created successfully\n\n` +
        `${filesWritten}\n\n` +
        (directoryExisted
          ? `ℹ️ The directory already existed and holds ${promptsHeld} prompt(s); this call added ` +
            `its declaration. Until now those prompts ran under a name and description the loader ` +
            `derived from the directory name.\n\n`
          : '') +
        `🔄 Prompt data reloaded — the category is live now`
    );
  }

  async handleUpdate(args: CategoryManagerInput): Promise<ToolResponse> {
    const { id, name, description, registerWithMcp, mcpPromptMode } = args;

    if (id === undefined || id.length === 0) {
      return this.error('Category ID is required for update action');
    }

    const located = this.locate(id);
    if (!located.ok) return this.error(located.error);

    const declared = await readCategoryYamlDocument(located.yamlPath, this.ctx.logger);
    if (declared === undefined) {
      return this.error(this.describeMissingDeclaration(id, located));
    }

    const beforeState = categorySnapshotContract.project(id, declared);

    const categoryData: CategoryCreationData = {
      id,
      // Projected fields fall back to the existing on-disk value, because
      // `buildCategoryYaml` rebuilds the document from scratch and would otherwise delete what
      // the caller merely did not mention. The loader's DERIVED defaults are deliberately not
      // used as the fallback: writing `Prompts in the x category` into the file would freeze a
      // default as though an author had chosen it.
      name: name ?? String(declared['name'] ?? ''),
      description: description ?? String(declared['description'] ?? ''),
      // Deliberately NOT defaulted from `declared`, unlike the two above. These are preserved
      // keys: `resolvePreservedCategoryYamlFields` already falls back to the on-disk value when
      // the caller omits them, and reading them here would work by coincidence while defeating
      // the preservation path the moment the two disagree.
      registerWithMcp,
      mcpPromptMode,
    };

    // The state this edit will PRODUCE. `categoryData` resolves every projected field already,
    // but the PRESERVED ones are resolved inside the writer, so the merge base is the document
    // on disk — without it an update that omits `mcpPromptMode` would record a snapshot claiming
    // the key was dropped while the writer carried it forward.
    const afterState = projectWriteModel(
      id,
      categoryData as unknown as Record<string, unknown>,
      categorySnapshotContract.projectedFields,
      declared
    );

    // One projection of the write serves the version's diff summary and the update's own diff. It
    // is resolved from the plan the writer applies, with the payload the writer is handed below,
    // so both name the file the write lands in and the lines that change there. Read before the
    // write, because the projection's "before" side is the file as it still is.
    const diffResult = this.ctx.textDiffService.generateFileChangeDiff(
      await this.ctx.categoryFileService.projectCategoryWrite(categoryData)
    );

    // Auto-versioning runs as the writer transaction's `commit` step, not ahead of it (P4.2 /
    // SF-3). Inlined rather than extracted to a helper on purpose — `validate:mutation-atomicity`
    // reads the record's position lexically.
    let versionOutcome: { version?: number; recorded: boolean } | undefined;
    const skipVersion = args.skip_version === true;
    const commitOptions =
      this.ctx.versionHistoryService.isAutoVersionEnabled() && !skipVersion
        ? {
            commit: async (): Promise<void> => {
              const versionResult = await this.ctx.versionHistoryService.recordEditResult(
                'category',
                id,
                beforeState,
                afterState,
                {
                  description: updateRowDescription('resource_manager'),
                  diff_summary: `+${diffResult.stats.additions}/-${diffResult.stats.deletions}`,
                }
              );
              versionOutcome = versionResult;
              this.ctx.logger.debug(
                `${versionResult.recorded ? 'Saved' : 'Matched'} version ${versionResult.version} for category ${id}`
              );
            },
          }
        : {};

    const result = await this.ctx.categoryFileService.writeCategoryFiles(
      categoryData,
      commitOptions
    );
    if (!result.success) {
      return this.error(`Failed to update category: ${result.error}`);
    }

    await this.ctx.onRefresh?.();

    let response =
      `✅ Category '${id}' updated successfully\n\n` +
      `📁 Files updated:\n${result.paths?.map((p) => `  - ${p}`).join('\n')}\n\n`;

    if (versionOutcome !== undefined) {
      response += `${describeVersionRecord(versionOutcome)}\n\n`;
    }

    if (diffResult.hasChanges) {
      response += `${diffResult.formatted}\n\n`;
    }

    response += `🔄 Prompt data reloaded`;

    return this.success(response);
  }

  async handleDelete(args: CategoryManagerInput): Promise<ToolResponse> {
    const { id } = args;

    if (id === undefined || id.length === 0) {
      return this.error('Category ID is required for delete action');
    }

    const located = this.locate(id);
    if (!located.ok) return this.error(located.error);

    if (!existsSync(located.yamlPath)) {
      return this.error(this.describeMissingDeclaration(id, located));
    }

    const promptsHeld = discoverYamlPromptsInCategory(located.categoryDir).length;

    // A category delete removes the DECLARATION, never the prompts. That asymmetry with gate and
    // framework delete — which remove their whole directory — is stated in the response rather
    // than left to be discovered, because the directory is what an operator pictures when they
    // type `delete`. Removing it would delete every prompt in the category, which no caller
    // asking to delete a category's metadata has asked for.
    if (isPreviewRequest(args)) {
      return this.success(
        `🔍 **Preview** — deletion of category '${id}'\n\n` +
          `Nothing was removed.\n\n` +
          `📁 Would remove the declaration: ${located.yamlPath}\n` +
          `📦 Would NOT remove the ${promptsHeld} prompt(s) in ${located.categoryDir}; ` +
          `the category keeps serving them under a name and description derived from its ` +
          `directory name\n` +
          (promptsHeld === 0
            ? `🗂️ The directory would then be empty and is removed with the declaration\n`
            : '') +
          `📜 Would also purge its \`version_history\` rows — a preview purges nothing\n` +
          `⚠️ Deletion cannot be undone — rollback cannot restore a deleted category.\n\n` +
          `💡 Re-send as \`action:"delete"\` with \`confirm: true\` to apply it.`
      );
    }

    try {
      await fs.rm(located.yamlPath);
    } catch (error) {
      return this.error(
        `Failed to delete ${CATEGORY_YAML_FILENAME}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    // An empty category directory still loads as a real, empty category, so leaving one behind
    // would make `delete` report success while the category remained in every listing.
    let directoryRemoved = false;
    try {
      if ((await fs.readdir(located.categoryDir)).length === 0) {
        await fs.rmdir(located.categoryDir);
        directoryRemoved = true;
      }
    } catch (_error) {
      // Non-empty, already gone, or not removable. The declaration IS removed either way, and
      // the response below reports which of the two happened rather than asserting both.
    }

    // AFTER the removal, and only if it succeeded. The other order destroys the rollback history
    // of a declaration still on disk when the `fs.rm` fails, which is unrecoverable; this order's
    // failure mode is rows left behind, which is the state before this was wired. The prompts the
    // category holds are untouched here, exactly as their files are — this purges the history of
    // the `category.yaml` declaration, which is this handler's resource.
    const purge = await purgeHistoryOnDelete(
      this.ctx.versionHistoryService,
      'category',
      id,
      `declaration removed: ${located.yamlPath}`
    );
    if (purge.failure !== undefined) return this.error(purge.failure);

    await this.ctx.onRefresh?.();

    return this.success(
      `✅ Category '${id}' declaration deleted\n\n` +
        `📁 Removed: ${located.yamlPath}\n\n` +
        `📜 Version history purged: ${purge.removed} row(s)\n\n` +
        (directoryRemoved
          ? `🗂️ The directory held no prompts and was removed with it\n\n`
          : `📦 ${promptsHeld} prompt(s) in ${located.categoryDir} were NOT removed — the ` +
            `category is still served, under a name and description derived from its directory ` +
            `name\n\n`) +
        `🔄 Prompt data reloaded`
    );
  }

  async handleReload(args: CategoryManagerInput): Promise<ToolResponse> {
    const { id, reason } = args;

    // Refused rather than ignored. There is no per-category registry entry to reload — the whole
    // `Category[]` is rebuilt by one walk of the prompt roots — so an id here changes nothing, and
    // accepting it answered a targeted reload that never happened. `common:reload` declares `id`
    // for every type because the other three read it; this is the one that cannot.
    if (id !== undefined && id !== '') {
      return this.error(
        `Category reload takes no 'id': categories are rebuilt by the same walk that loads ` +
          `prompts, so a reload always covers every category. Re-send without 'id'.`
      );
    }
    if (this.ctx.onRefresh === undefined) {
      return this.error(
        'Category reload is unavailable: this handler was constructed without a refresh callback.'
      );
    }

    await this.ctx.onRefresh();

    const reasonText = reason !== undefined && reason.length > 0 ? ` (reason: ${reason})` : '';
    return this.success(
      `🔄 Prompt data reloaded${reasonText}\n\n` +
        `Categories are rebuilt by the same walk that loads prompts, so this reloads every ` +
        `category rather than one.`
    );
  }

  /**
   * Resolve a category id to its directory and declaration path, or refuse.
   *
   * The join is the containment check (`resolveContainedPath`), performed once here so every
   * handler below — including the one that removes files — works from a path that cannot be
   * outside the resources root.
   */
  private locate(
    id: string
  ):
    | { ok: true; root: string; categoryDir: string; yamlPath: string }
    | { ok: false; error: string } {
    const root = this.ctx.configManager.getResolvedPromptsDirectory();
    try {
      const categoryDir = resolveContainedPath(root, id);
      return {
        ok: true,
        root,
        categoryDir,
        yamlPath: path.join(categoryDir, CATEGORY_YAML_FILENAME),
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Why there is nothing here to update or delete — naming the state that is actually true.
   *
   * Three different states reach this message and a single "not found" would be false for two of
   * them: the category may not exist at all, may exist as a directory of prompts that declares
   * no metadata, or may be served from the bundled tree where nothing is writable. P1.3 fixed
   * exactly this class of false refusal for prompts, gates and frameworks.
   */
  private describeMissingDeclaration(
    id: string,
    located: { root: string; categoryDir: string; yamlPath: string }
  ): string {
    if (existsSync(located.categoryDir)) {
      const promptsHeld = discoverYamlPromptsInCategory(located.categoryDir).length;
      return (
        `Category '${id}' exists as a directory holding ${promptsHeld} prompt(s) but declares no ` +
        `${CATEGORY_YAML_FILENAME}, so there is no metadata to change. Its name and description ` +
        `are derived from the directory name at load. Use action:"create" to author the ` +
        `declaration — it writes ${located.yamlPath} and touches no prompt.`
      );
    }

    const bundledRoot = this.ctx.configManager.getBundledResourceDirectory('prompts');
    if (bundledRoot !== undefined && path.resolve(bundledRoot) !== path.resolve(located.root)) {
      const bundledCategoryDir = path.join(bundledRoot, id);
      if (existsSync(bundledCategoryDir)) {
        return (
          `'${id}' ships with the server and is served from the bundled resources tree ` +
          `(${bundledCategoryDir}), which is read-only. Your resources root is ${located.root}. ` +
          `Use action:"create" there: your declaration is written to your own root and takes ` +
          `precedence over the bundled one, and the bundled prompts keep loading underneath it.`
        );
      }
    }

    return `Category not found: '${id}'. Nothing was changed.`;
  }

  private success(text: string): ToolResponse {
    return { content: [{ type: 'text', text }], isError: false };
  }

  private error(text: string): ToolResponse {
    return { content: [{ type: 'text', text: `❌ ${text}` }], isError: true };
  }
}
