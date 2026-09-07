// @lifecycle canonical - Handles prompt file read/write operations with transactional guarantees.
/**
 * File system and category management operations for YAML-based prompts.
 * Uses ResourceMutationTransaction for snapshot-based rollback on validation failure.
 */

import { existsSync, readdirSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { OperationResult, PromptResourceDependencies } from '../core/types.js';
import { validateCategoryName } from '../utils/validation.js';

import type { ResourceMutationTarget } from '#modules/resources/services/index.js';
import type { ConfigManager, Logger } from '#shared/types/index.js';
import type { ToolDefinitionInput } from '../../core/types.js';

import {
  findYamlPromptInCategory,
  hasYamlPromptsInCategory,
  deleteYamlPrompt,
} from '#modules/prompts/category-maintenance.js';
import {
  ResourceMutationTransaction,
  ResourceVerificationService,
} from '#modules/resources/services/index.js';
import { safeWriteFile } from '#shared/utils/file-transactions.js';
import { resolveContainedPath } from '#shared/utils/path-containment.js';
import { slugifyCategoryDirectory } from '#shared/utils/resource-ids.js';
import { parseYaml, serializeYaml } from '#shared/utils/yaml/yaml-parser.js';

export interface FileOperationsDependencies extends Pick<
  PromptResourceDependencies,
  'logger' | 'configManager'
> {
  resourceVerificationService?: ResourceVerificationService;
  resourceMutationTransaction?: ResourceMutationTransaction;
}

/**
 * Reduce a possibly path-qualified prompt id to the value the YAML `id` field takes.
 *
 * Nested chain steps are addressed as `{parent}/{step}` ("implementation_plan/verification"),
 * which is derived from the directory path at load time — `yaml-prompt-loader` then validates
 * the file against the LAST segment only. Writing the qualified form violates the id regex, so
 * the prompt fails validation and the loader drops it with nothing but a log line.
 */
export function toYamlPromptId(promptId: string): string {
  const segments = String(promptId).split('/');
  return segments[segments.length - 1] ?? String(promptId);
}

/**
 * Prompt-level keys `PromptYamlSchema` accepts that the writer builds no value for.
 *
 * The writer emitted 10 of the 17 fields the loader accepts, so an `update` through
 * `resource_manager` silently deleted every one of these from a prompt that declared them
 * (P7-F2). `subagentModel` and `agentType` govern `==>` delegation, so the loss was behavioural,
 * not cosmetic.
 */
export const PRESERVED_PROMPT_YAML_KEYS = [
  'composer',
  'injection',
  'registerWithMcp',
  'mcpPromptMode',
  'subagentModel',
  'agentType',
] as const;

/**
 * Decide what each preserved key should carry into the rewritten YAML: an explicitly supplied
 * value if the caller had one, otherwise whatever the file itself already declared, otherwise
 * nothing.
 *
 * Preserve-if-present, never write defaults — and the on-disk YAML is the only source that can
 * honour that. `ConvertedPrompt.registerWithMcp` and `.mcpPromptMode` are always populated because
 * `PromptConverter` RESOLVES them through prompt → category → global → hard-coded default, so
 * carrying them from the loaded prompt would bake a category or global default into a file that
 * never declared one, freezing that prompt against any future change to the default it was
 * inheriting. `injection` has the same hazard in a milder form: the loaded value is normalised, so
 * writing it back would churn the authored shape.
 *
 * The explicit branch is reachable from the tool surface as of OQ-P7-8 — `injection`,
 * `register_with_mcp`, `mcp_prompt_mode`, `subagent_model` and `agent_type` are `resource_manager`
 * parameters, mapped to these keys by `UPDATE_FIELDS`. That makes this function the precedence
 * rule the whole feature rests on: an explicitly supplied value wins, an omitted one leaves the
 * file's own declaration exactly as it was.
 */
export function resolvePreservedPromptYamlFields(
  promptData: Record<string, unknown>,
  existingYaml: Record<string, unknown> | undefined,
  unsetKeys: ReadonlySet<string>
): Record<string, unknown> {
  const preserved: Record<string, unknown> = {};

  for (const key of PRESERVED_PROMPT_YAML_KEYS) {
    // P2.1. `unset` cannot be expressed as "delete the key from `promptData`" HERE, and this
    // function is the reason: for these six keys, an undefined value is the explicit signal to
    // preserve the file's own declaration. Clearing the field and stopping there would fall
    // through to the branch below, read the value straight back off disk, and write it again —
    // a removal that reports success and changes nothing. `unsetKeys` is the third state the
    // supplied/omitted pair could not carry, and it has to arrive as its own channel.
    if (unsetKeys.has(key)) {
      continue;
    }
    const supplied = promptData[key];
    if (supplied !== undefined) {
      preserved[key] = supplied;
      continue;
    }
    const declared = existingYaml?.[key];
    if (declared !== undefined) {
      preserved[key] = declared;
    }
  }

  return preserved;
}

/**
 * `promptData` keys whose value lives in `prompt.yaml` — Fix B write-scope table
 * (tier-b-settability-proposal §2). A key here does NOT mean the writer unconditionally emits
 * it (`resolvePreservedPromptYamlFields` and the tools branch still apply their own precedence);
 * it means: if this call supplied or patched this key, `prompt.yaml` is one of the files this
 * write is allowed to touch. Everything else about the file is untouched, including comments,
 * key order, and any authored shape `serializeYaml` would otherwise normalize away (§1.1 churn).
 */
export const PROMPT_YAML_RESIDENT_KEYS = [
  'name',
  'category',
  'description',
  'arguments',
  'chainSteps',
  'gateConfiguration',
  'tools',
  ...PRESERVED_PROMPT_YAML_KEYS,
] as const;

/**
 * Every `promptData` key any write path can touch. `create`, `rollback`, and a detected category
 * MOVE (Part 2) pass this verbatim — each owns the WHOLE state being written, not an edit to a
 * subset of it, so none of them has a narrower scope to compute. Also the default
 * `updatePromptImplementation` falls back to when no `suppliedKeys` argument is given, which
 * keeps every pre-Fix-B caller (existing tests, any future direct caller that has not adopted the
 * scope plumbing) on the old always-write-everything behaviour.
 */
export const ALL_PROMPT_DATA_KEYS: ReadonlySet<string> = new Set([
  ...PROMPT_YAML_RESIDENT_KEYS,
  'userMessageTemplate',
  'systemMessage',
]);

/**
 * What a write REMOVES, which its field payload cannot say.
 *
 * All three members exist for one reason: this writer reads an absent value as "preserve". That
 * makes absence the preserve signal, so it is unavailable as the removal signal, and every kind of
 * removal needs a channel of its own. Grouped into one argument rather than three more positional
 * ones because they always arrive together from a single `update` call, and a call site reading
 * `undefined, new Set([...]), 'replace', []` tells a reader nothing about which is which.
 */
export interface PromptWriteIntent {
  /** `promptData` keys to CLEAR. See `resolvePreservedPromptYamlFields` for why deletion is not enough. */
  unsetKeys: ReadonlySet<string>;
  /** Whether a supplied `tools` array REPLACES the current binding (default) or ADDS to it. */
  toolBinding: 'replace' | 'add';
  /** Tool ids whose `tools/{id}/` directory this write DELETES rather than merely unbinds. */
  removedToolIds: readonly string[];
}

/**
 * "This call removes nothing" — the default for every write path except a tool `update` carrying
 * `unset` or `tool_operation`. Named rather than inlined so the signatures taking it read as
 * deliberately empty rather than accidentally unpassed.
 */
/** The bound tool ids a `prompt.yaml` declares, as a plain string list. */
function readToolIds(existingYaml: Record<string, unknown> | undefined): string[] {
  const declared = existingYaml?.['tools'];
  return Array.isArray(declared)
    ? declared.filter((id): id is string => typeof id === 'string')
    : [];
}

export const NO_WRITE_INTENT: PromptWriteIntent = {
  unsetKeys: new Set<string>(),
  toolBinding: 'replace',
  removedToolIds: [],
};

/**
 * File system operations for prompt management
 */
export class FileOperations {
  private logger: Logger;
  private configManager: ConfigManager;
  private readonly verificationService: ResourceVerificationService;
  private readonly mutationTransaction: ResourceMutationTransaction;

  constructor(dependencies: FileOperationsDependencies) {
    this.logger = dependencies.logger;
    this.configManager = dependencies.configManager;
    this.verificationService =
      dependencies.resourceVerificationService ?? new ResourceVerificationService();
    this.mutationTransaction =
      dependencies.resourceMutationTransaction ?? new ResourceMutationTransaction();
  }

  /**
   * Update prompt implementation (shared by create/update)
   * Creates YAML directory structure: {category}/{id}/prompt.yaml + message files
   *
   * `suppliedKeys` (Fix B, tier-b-settability-proposal §2) is the union of `promptData` keys this
   * call actually supplied or patched. Omitted, it defaults to "everything" — the pre-Fix-B
   * behaviour every existing direct caller (tests, and `create`/`rollback` which own whole state
   * anyway) still gets without adopting the plumbing.
   */
  async updatePromptImplementation(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
    promptData: any,
    suppliedKeys?: ReadonlySet<string>,
    sourceRoot?: string,
    writeIntent: PromptWriteIntent = NO_WRITE_INTENT
  ): Promise<OperationResult> {
    // `writeIntent` passes through whole to `createOrUpdateYamlPrompt`, which owns the yaml-side
    // clearing; only the tool-directory removals are this method's own work.
    const { removedToolIds } = writeIntent;
    const promptsDir = this.configManager.getResolvedPromptsDirectory();
    const effectiveCategory = slugifyCategoryDirectory(promptData.category);
    // `category` reaches this line straight from the tool payload. Validated here because
    // `validateCategoryName` had no call site at all — a category of `../../x` walked out of the
    // resources root and wrote there, measured 2026-08-30 and reported as `✅ Prompt Created`.
    // Both checks run before any directory is created, so a refusal writes nothing.
    validateCategoryName(effectiveCategory);
    const promptDir = resolveContainedPath(promptsDir, effectiveCategory, promptData.id);
    const yamlPath = path.join(promptDir, 'prompt.yaml');
    // Nested chain steps carry a path-qualified id ("implementation_plan/verification"): the
    // directory needs the full path, but the YAML `id` field and its validation take the
    // basename. That is the loader's contract (yaml-prompt-loader derives the qualified id from
    // the path and validates the file against the last segment) — writing the qualified form
    // fails the id regex, and the prompt is dropped at load with only a log line.
    const yamlId = toYamlPromptId(promptData.id);

    // Part 2 — category MOVE (owner ruling 2026-08-16, tier-b-settability-proposal §Open
    // Decision 3, overriding the proposal's original "refuse" recommendation): a caller-supplied
    // `category` that slugs to a directory other than the one the prompt currently lives under
    // relocates the whole directory tree. Detected only when the TARGET directory does not
    // already exist, so the ordinary "no move" case (the overwhelming majority of calls) costs
    // nothing beyond the `existsSync` this method already needed. Nested chain-step ids ('/' in
    // the id) are excluded: they scaffold under their PARENT's own directory
    // (`scaffoldChainStepDirectories`), not under a category, so "category move" has no referent.
    const promptId = (promptData as { id: string }).id;
    const isNestedId = promptId.includes('/');
    const moveSource =
      !isNestedId && !existsSync(promptDir)
        ? this.findExistingPromptDirectory(promptsDir, promptId, promptDir)
        : null;

    // A move relocates the WHOLE prior state — composes with Fix B as a forced full scope. The
    // caller (the processor) cannot have supplied the right narrower scope for a move: it has no
    // visibility into whether a category change is a move until THIS layer resolves it against
    // disk, since the on-disk directory layout is exactly what the processor's in-memory model
    // does not track.
    const suppliedKeysForWrite =
      moveSource !== null ? ALL_PROMPT_DATA_KEYS : (suppliedKeys ?? ALL_PROMPT_DATA_KEYS);

    // P1.2 — copy-on-write from the root the prompt was LOADED from.
    //
    // A prompt served from the bundled fallback has no directory under the writable root, so an
    // update landed on a fresh directory and re-materialised the prompt from the in-memory model.
    // That model holds the prompt's own fields and nothing about its subtree, so everything on
    // disk that is not a field was LOST — silently, under `✅ Prompt Updated`. Measured
    // 2026-08-30 on `planning/implementation_plan`: editing `description` alone replaced all five
    // chain steps with 42–55 byte scaffold stubs (`discovery/user-message.md`, 3852B → 50B) and
    // the served catalog then returned the stub. On `examples/create_framework` the four files
    // under `tools/framework_builder/` simply vanished.
    //
    // Copying the source subtree FIRST turns the fresh-directory case back into the ordinary one:
    // `createOrUpdateYamlPrompt` then sees an existing prompt and honours `suppliedKeys`, and
    // `scaffoldChainStepDirectories` skips step directories that already exist. The fix is
    // therefore a copy, not new preservation logic — the preservation logic was already correct
    // and was being handed an empty directory.
    //
    // Whole-subtree rather than a list of known file kinds: a list can only preserve what someone
    // remembered to enumerate, and the two losses above were exactly the kinds nobody had.
    const copyOnWriteSource =
      moveSource === null && !existsSync(promptDir) && sourceRoot !== undefined
        ? this.resolveCopyOnWriteSource(sourceRoot, promptsDir, promptId, promptDir)
        : null;

    const targets: ResourceMutationTarget[] = [{ path: promptDir, kind: 'directory' }];
    if (moveSource !== null) {
      // Both dirs snapshotted BEFORE the mutation runs: a failure partway through the move (the
      // relocation succeeds but the post-write `validateFile` rejects the result, say) must
      // restore the ORIGINAL directory intact and leave no partial directory at the new
      // location — the two-target restore `ResourceMutationTransaction` already provides for any
      // target set, snapshot-then-mutate-then-validate-or-restore-all.
      targets.push({ path: moveSource, kind: 'directory' });
    }

    const txResult = await this.mutationTransaction.run({
      targets,
      mutate: async () => {
        const messages: string[] = [];
        const affectedFiles: string[] = [];

        // Ensure category directory exists
        const categoryDir = path.join(promptsDir, effectiveCategory);
        if (!existsSync(categoryDir)) {
          await fs.mkdir(categoryDir, { recursive: true });
          messages.push(`Created category directory: '${effectiveCategory}'`);
        }

        if (moveSource !== null) {
          messages.push(
            ...(await this.relocatePromptDirectory(
              moveSource,
              promptDir,
              promptId,
              effectiveCategory
            ))
          );
        }

        if (copyOnWriteSource !== null) {
          // Before the content write, so everything below operates on the full prior state.
          await fs.cp(copyOnWriteSource, promptDir, { recursive: true });
          // Said out loud, and said as a FORK rather than as a copy: the caller now owns a
          // detached copy, and updates to the bundled original will no longer reach it. That
          // consequence is the part a caller cannot see from the file list.
          messages.push(
            `Copied '${promptId}' into this resources root before editing, from ${copyOnWriteSource}`,
            `⚠️ This is now your own copy — updates to the bundled '${promptId}' will no longer reach it`
          );
        }

        // Create/update YAML prompt
        const { exists: promptExists, paths } = await this.createOrUpdateYamlPrompt(
          promptData,
          effectiveCategory,
          promptsDir,
          suppliedKeysForWrite,
          writeIntent
        );

        messages.push(`${promptExists ? 'Updated' : 'Created'} prompt: ${promptData.id}`);
        affectedFiles.push(...paths);

        // Scaffold chain step directories for nested sub-prompts
        if (Array.isArray(promptData.chainSteps) && promptData.chainSteps.length > 0) {
          const scaffolded = await this.scaffoldChainStepDirectories(
            promptDir,
            promptData.id,
            promptData.chainSteps
          );
          if (scaffolded.length > 0) {
            messages.push(`Scaffolded sub-prompt directories (${scaffolded.length} files)`);
            affectedFiles.push(...scaffolded);
          }
        }

        // Create/update tools if provided
        if (Array.isArray(promptData.tools) && promptData.tools.length > 0) {
          const toolResult = await this.createOrUpdateTools(
            promptDir,
            promptData.tools,
            promptData.id
          );
          messages.push(...toolResult.messages);
          affectedFiles.push(...toolResult.paths);
        }

        // P2.3. Inside the transaction, so a failed write rolls the deletions back with
        // everything else — a tool directory removed against a prompt.yaml that never landed
        // would leave the binding pointing at files that are gone.
        for (const toolId of removedToolIds) {
          const toolDir = resolveContainedPath(promptDir, 'tools', toolId);
          await fs.rm(toolDir, { recursive: true, force: true });
          messages.push(`Removed tool '${toolId}' and deleted ${toolDir}`);
          affectedFiles.push(toolDir);
        }

        return { messages, affectedFiles };
      },
      validate: () => this.verificationService.validateFile('prompts', yamlId, yamlPath),
    });

    if (!txResult.success) {
      const errorMsg = txResult.rolledBack
        ? `Prompt write failed and was rolled back: ${txResult.error}`
        : `Prompt write failed: ${txResult.error}`;
      throw new Error(errorMsg);
    }

    const result = txResult.result ?? { messages: [], affectedFiles: [] };
    return {
      message: result.messages.join('\n'),
      affectedFiles: result.affectedFiles,
    };
  }

  /**
   * Locate the on-disk directory of `promptId` across every category — used only when the
   * caller's TARGET directory (derived from `promptData.category`) does not yet exist, so a
   * category-changing update can find where the prompt currently lives (Part 2 — category move).
   * Returns `null` when no OTHER directory declares this id, which is the ordinary "brand new
   * prompt" case, not a move. Excludes flat single-file prompts (`{category}/{id}.yaml`,
   * `format: 'file'`) — this writer only ever produces directory-format prompts, and relocating a
   * single file into a directory tree is a different operation this method does not attempt; a
   * category change against a flat-file prompt falls through to an ordinary create at the target.
   */
  /**
   * The directory to copy from when a prompt is being edited into a root it does not yet live in.
   *
   * Returns null — meaning "ordinary create, copy nothing" — whenever copy-on-write has no
   * referent: the prompt already lives in the writable root, there is no distinct source root, or
   * no directory for this id exists under the source root at all.
   *
   * Located by scanning the SOURCE root's categories rather than by joining the caller's category
   * onto it, so a call that changes category while copying up still finds the original.
   */
  private resolveCopyOnWriteSource(
    sourceRoot: string,
    promptsDir: string,
    promptId: string,
    targetDir: string
  ): string | null {
    if (path.resolve(sourceRoot) === path.resolve(promptsDir)) return null;
    if (!existsSync(sourceRoot)) return null;
    return this.findExistingPromptDirectory(sourceRoot, promptId, targetDir);
  }

  private findExistingPromptDirectory(
    promptsDir: string,
    promptId: string,
    excludeDir: string
  ): string | null {
    for (const categoryDir of this.discoverCategoryDirectories(promptsDir)) {
      const found = findYamlPromptInCategory(categoryDir, promptId);
      if (found !== null && found.format === 'directory' && found.path !== excludeDir) {
        return found.path;
      }
    }
    return null;
  }

  /**
   * Relocate the whole prompt directory tree — `tools/`, scaffolded chain-step sub-dirs,
   * everything — from `sourceDir` to `targetDir`, BEFORE any content write. Doing this first
   * means `createOrUpdateYamlPrompt`'s existing-yaml read (scoped to `targetDir`) sees the full
   * prior state at the NEW location, so Fix A's preservation (tools ids, authored
   * category-if-caller-omitted) has something to read without this method needing to know
   * anything about preservation itself.
   *
   * `cp` + `rm` rather than `rename`: `ResourceMutationTransaction`'s own snapshot lives under a
   * separate `mkdtemp` root that may be a different filesystem, and `rename` throws `EXDEV`
   * across filesystems — `cp`+`rm` is the same primitive the transaction itself already uses for
   * its snapshot/restore, so this method carries no new cross-filesystem assumption.
   */
  private async relocatePromptDirectory(
    sourceDir: string,
    targetDir: string,
    promptId: string,
    targetCategory: string
  ): Promise<string[]> {
    await fs.cp(sourceDir, targetDir, { recursive: true });
    await fs.rm(sourceDir, { recursive: true, force: true });
    return [`Moved prompt '${promptId}' from '${path.basename(sourceDir)}' to '${targetCategory}'`];
  }

  /**
   * Delete prompt implementation (YAML-only)
   *
   * Searches for YAML-format prompts in all category directories:
   * - Directory format: {category}/{id}/ (deleted recursively)
   * - File format: {category}/{id}.yaml (deleted as single file)
   *
   * Automatically cleans up empty category directories.
   */
  async deletePromptImplementation(id: string): Promise<OperationResult> {
    const promptsDir = this.configManager.getResolvedPromptsDirectory();
    const categoryDirs = this.discoverCategoryDirectories(promptsDir);

    // Find the prompt first to determine the transaction target
    let targetDir: string | null = null;
    for (const categoryDir of categoryDirs) {
      const yamlPrompt = findYamlPromptInCategory(categoryDir, id);
      if (yamlPrompt !== null) {
        targetDir =
          yamlPrompt.format === 'directory' ? yamlPrompt.path : path.dirname(yamlPrompt.path);
        break;
      }
    }

    if (targetDir === null) {
      // P1.3 — say why, truthfully.
      //
      // `Prompt not found` was FALSE for the case that actually reaches here most often: a prompt
      // resident only in the bundled tree is served, inspectable and executable, and this search
      // covers only the writable root. Measured 2026-08-30 — `delete quick_decision` answered
      // "not found" for a prompt the same server had just inspected successfully. The refusal was
      // correct; the reason was not, and a reason nobody can act on is the part that costs.
      const bundledRoot = this.configManager.getBundledResourceDirectory('prompts');
      if (bundledRoot !== undefined && path.resolve(bundledRoot) !== path.resolve(promptsDir)) {
        const bundledDir = this.findExistingPromptDirectory(bundledRoot, id, '');
        if (bundledDir !== null) {
          throw new Error(
            `'${id}' ships with the server and is served from the bundled resources tree ` +
              `(${bundledDir}), which is read-only — deleting it is not possible. ` +
              `Your resources root is ${promptsDir}. ` +
              `To change how '${id}' behaves for you, update it: the update copies it into your ` +
              `root first and your copy takes precedence. There is no way to make '${id}' stop ` +
              `resolving, because a higher-precedence root can shadow a prompt but cannot express ` +
              `its absence.`
          );
        }
      }
      throw new Error(`Prompt not found: ${id}`);
    }

    const txResult = await this.mutationTransaction.run({
      targets: [{ path: targetDir, kind: 'directory' }],
      mutate: async () => {
        const messages: string[] = [];
        const affectedFiles: string[] = [];
        let deletedFromCategoryDir: string | null = null;
        let deletedFromCategoryId: string | null = null;

        for (const categoryDir of categoryDirs) {
          const yamlPrompt = findYamlPromptInCategory(categoryDir, id);
          if (yamlPrompt !== null) {
            const deletedPaths = await deleteYamlPrompt(yamlPrompt);
            if (deletedPaths.length > 0) {
              const formatLabel = yamlPrompt.format === 'directory' ? 'directory' : 'file';
              messages.push(`Deleted prompt ${formatLabel}: ${yamlPrompt.id}`);
              affectedFiles.push(...deletedPaths);
              deletedFromCategoryDir = categoryDir;
              deletedFromCategoryId = path.basename(categoryDir);
              break;
            }
          }
        }

        // Clean up empty category directory
        if (deletedFromCategoryDir !== null && deletedFromCategoryId !== null) {
          const hasRemainingPrompts = hasYamlPromptsInCategory(deletedFromCategoryDir);
          if (!hasRemainingPrompts) {
            const entries = readdirSync(deletedFromCategoryDir, { withFileTypes: true });
            const nonMetadataEntries = entries.filter(
              (e) => e.name !== 'category.yaml' && !e.name.startsWith('.')
            );
            if (nonMetadataEntries.length === 0) {
              await fs.rm(deletedFromCategoryDir, { recursive: true, force: true });
              messages.push(`Cleaned up empty category directory: ${deletedFromCategoryId}`);
            }
          }
        }

        // P1.3 — a delete that leaves the id still resolving must say so.
        //
        // Deleting your own copy of a prompt that also ships with the server re-exposes the
        // bundled one, because the bundled tree is always read as the lowest-precedence root.
        // That is the intended behaviour — delete removes the copy you own — but silently it
        // looks like a failed deletion: the caller deletes, re-inspects, and the prompt is still
        // there.
        const bundledRoot = this.configManager.getBundledResourceDirectory('prompts');
        if (
          deletedFromCategoryDir !== null &&
          bundledRoot !== undefined &&
          path.resolve(bundledRoot) !== path.resolve(promptsDir) &&
          this.findExistingPromptDirectory(bundledRoot, id, '') !== null
        ) {
          messages.push(
            `ℹ️ '${id}' still resolves — your copy is gone, and the bundled version is now being ` +
              `served again. This prompt ships with the server, so deleting your copy reverts it ` +
              `rather than removing it.`
          );
        }

        return { messages, affectedFiles };
      },
      // No validation for delete — directory gone = success
    });

    if (!txResult.success) {
      throw new Error(`Prompt deletion failed: ${txResult.error}`);
    }

    const deleteResult = txResult.result ?? { messages: [], affectedFiles: [] };
    return {
      message: deleteResult.messages.join('\n'),
      affectedFiles: deleteResult.affectedFiles,
    };
  }

  /**
   * Discover category directories in the prompts folder
   */
  private discoverCategoryDirectories(promptsDir: string): string[] {
    if (!existsSync(promptsDir)) {
      return [];
    }

    try {
      const entries = readdirSync(promptsDir, { withFileTypes: true });
      return entries
        .filter(
          (entry) =>
            entry.isDirectory() &&
            !entry.name.startsWith('.') &&
            !entry.name.startsWith('_') &&
            entry.name !== 'backup'
        )
        .map((entry) => path.join(promptsDir, entry.name));
    } catch {
      return [];
    }
  }

  /**
   * Create or update YAML prompt directory structure
   *
   * Creates/updates:
   * - {category}/{id}/prompt.yaml - Metadata (id, name, category, description, arguments, gates)
   * - {category}/{id}/user-message.md - User message template (required)
   * - {category}/{id}/system-message.md - System message (optional)
   */
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/strict-boolean-expressions, @typescript-eslint/no-unsafe-member-access */
  async createOrUpdateYamlPrompt(
    promptData: any,
    effectiveCategory: string,
    promptsDir: string,
    suppliedKeys: ReadonlySet<string> = ALL_PROMPT_DATA_KEYS,
    writeIntent: PromptWriteIntent = NO_WRITE_INTENT
  ): Promise<{ exists: boolean; paths: string[] }> {
    const { unsetKeys } = writeIntent;
    // Same containment as the caller's join — this method is also reached directly (create,
    // rollback), so it cannot rely on `updatePromptImplementation` having checked first.
    const promptDir = resolveContainedPath(promptsDir, effectiveCategory, promptData.id);
    const paths: string[] = [];

    // Check if prompt directory already exists
    const existsBefore = existsSync(promptDir);

    // Fix B write-scope narrowing (tier-b-settability-proposal §2): a directory with no prior
    // `prompt.yaml` needs its baseline files regardless of what the caller's `suppliedKeys`
    // narrowed to — an update landing on a brand-new, or just-relocated (Part 2 category move),
    // directory must not skip the write that makes it a valid prompt. `suppliedKeys` narrows an
    // EXISTING prompt's edit surface; it does not narrow what a fresh directory needs to become
    // one.
    const isFreshDirectory = !existsBefore;
    // P2.1: any `unset` forces the `prompt.yaml` rewrite, including `systemMessage` — which is
    // NOT a `PROMPT_YAML_RESIDENT_KEYS` member (its text lives in its own file) but still owns a
    // key IN the yaml, `systemMessageFile`. Without this clause, clearing it narrowed the write
    // scope to a file the writer then never opened, so the orphaned `systemMessageFile:` survived
    // pointing at a `.md` this same call had just deleted. Caught by the enumeration test.
    const writesYaml =
      isFreshDirectory ||
      unsetKeys.size > 0 ||
      PROMPT_YAML_RESIDENT_KEYS.some((key) => suppliedKeys.has(key));
    const writesUserMessage = isFreshDirectory || suppliedKeys.has('userMessageTemplate');
    // P2.1. `systemMessage` is the one unsettable field with a FILE behind it, so clearing it is
    // two operations, not one: `buildPromptYamlData` drops `systemMessageFile` (its guard is
    // already truthiness-based, and the key is gone from `promptData` by now), and the `.md` has
    // to be removed here. Dropping only the key would leave an orphan `system-message.md` that no
    // loader reads and every `git status` shows — a removal that half happened.
    const removesSystemMessage = unsetKeys.has('systemMessage');
    const writesSystemMessage =
      Boolean(promptData.systemMessage) &&
      !removesSystemMessage &&
      (isFreshDirectory || suppliedKeys.has('systemMessage'));

    // Read BEFORE the directory is (re)created, and only when `prompt.yaml` is actually going to
    // be rewritten — field preservation feeds ONLY that write, and reading it otherwise is I/O a
    // scoped-out update has no use for. This is also the acceptance mechanism for byte-identity:
    // when `writesYaml` is false, `prompt.yaml` is never opened by this call at all.
    const existingYaml = writesYaml
      ? await this.readExistingPromptYaml(path.join(promptDir, 'prompt.yaml'))
      : undefined;

    // Create prompt directory
    await fs.mkdir(promptDir, { recursive: true });
    paths.push(promptDir);

    if (writesYaml) {
      const promptYamlData = this.buildPromptYamlData(
        promptData as Record<string, unknown>,
        existingYaml,
        suppliedKeys,
        writeIntent
      );
      const promptYamlPath = path.join(promptDir, 'prompt.yaml');
      const yamlContent = serializeYaml(promptYamlData, { sortKeys: false });
      await safeWriteFile(promptYamlPath, yamlContent, 'utf8');
      paths.push(promptYamlPath);
    }

    if (writesUserMessage) {
      const userMessagePath = path.join(promptDir, 'user-message.md');
      await safeWriteFile(userMessagePath, promptData.userMessageTemplate ?? '', 'utf8');
      paths.push(userMessagePath);
    }

    if (writesSystemMessage) {
      const systemMessagePath = path.join(promptDir, 'system-message.md');
      await safeWriteFile(systemMessagePath, promptData.systemMessage, 'utf8');
      paths.push(systemMessagePath);
    }

    if (removesSystemMessage) {
      // `force` because an `unset` on a prompt that never had a system message is a valid, and
      // successful, no-op — the caller asked for a state, not for a deletion event.
      const systemMessagePath = path.join(promptDir, 'system-message.md');
      await fs.rm(systemMessagePath, { force: true });
      paths.push(systemMessagePath);
    }

    this.logger.info(`${existsBefore ? 'Updated' : 'Created'} YAML prompt: ${promptData.id}`);

    return {
      exists: existsBefore,
      paths,
    };
  }

  /**
   * Build the `prompt.yaml` document for a write that IS touching the file. Pure — no I/O.
   * Isolates the category/tools/preserved-field precedence rules from the file-scope orchestration
   * in `createOrUpdateYamlPrompt`, which keeps that method's branching to "which files does this
   * call touch" rather than "what does each file contain" (cognitive-complexity boundary).
   */
  private buildPromptYamlData(
    promptData: Record<string, unknown>,
    existingYaml: Record<string, unknown> | undefined,
    suppliedKeys: ReadonlySet<string>,
    writeIntent: PromptWriteIntent
  ): Record<string, unknown> {
    const { unsetKeys } = writeIntent;
    const promptYamlData: Record<string, unknown> = {
      // Basename, not the qualified id — see toYamlPromptId
      id: toYamlPromptId(promptData['id'] as string),
      name: promptData['name'],
      description: promptData['description'],
    };

    // `category:` full precedence (Fix B upgrade of Fix A's interim rule; owner ruling
    // 2026-08-16, tier-b-settability-proposal §Fix A / §2 / Open Decision 3): caller-supplied >
    // existing-on-disk > omit. `loader.ts:186` overwrites `prompt.category` with the
    // directory-derived id at LOAD time regardless of what the file says, so the authored value
    // has zero runtime effect either way — an explicit supply is still honoured verbatim (it is
    // the operator's authored record, same treatment as `name`/`description`), and an omitted
    // one falls back to whatever the file already declared rather than being baked from the
    // directory slug. Directory targeting is unaffected — it always uses the slugified
    // `effectiveCategory`, computed by the caller.
    const existingCategory = existingYaml?.['category'];
    if (suppliedKeys.has('category')) {
      promptYamlData['category'] = promptData['category'];
    } else if (typeof existingCategory === 'string' && existingCategory.length > 0) {
      promptYamlData['category'] = existingCategory;
    }

    if (promptData['systemMessage']) {
      promptYamlData['systemMessageFile'] = 'system-message.md';
    }
    promptYamlData['userMessageTemplateFile'] = 'user-message.md';

    const args = promptData['arguments'];
    if (Array.isArray(args) && args.length > 0) {
      promptYamlData['arguments'] = args;
    }

    if (promptData['gateConfiguration']) {
      promptYamlData['gateConfiguration'] = promptData['gateConfiguration'];
      this.logger.debug(`[YAML-CREATE] Adding gate configuration to ${String(promptData['id'])}`);
    }

    const chainSteps = promptData['chainSteps'];
    if (Array.isArray(chainSteps) && chainSteps.length > 0) {
      promptYamlData['chainSteps'] = chainSteps;
    }

    // Tools reference (just tool IDs, not full definitions). Full definitions supplied → write
    // the id list derived from them (the file bodies themselves are written separately, by
    // `createOrUpdateTools`). Otherwise preserve the on-disk id list.
    // `ConvertedPrompt` has no `tools` field (P7-F8) — the in-memory snapshot this writer's
    // caller builds can never carry it forward, so every metadata-only edit (description,
    // template patch, ...) would otherwise silently drop the binding on write, orphaning the
    // `tools/{id}/` files the loader can then no longer reach. The on-disk shape (`string[]`
    // ids) already matches this key's expected shape — carried forward verbatim, not remapped.
    // P2.1: `tools` is the second preserve-on-omit branch in this method (the six preserved keys
    // below are the other), so it needs the same explicit clear channel for the same reason —
    // omission here means "keep the binding", and without this guard `unset: ['tools']` would
    // read the id list straight back off disk. The `unset` path deliberately leaves the
    // `tools/{id}/` directories alone; unbinding is not deleting, and P2.3's `tool_operation`
    // owns the removal that does delete them.
    const suppliedTools = promptData['tools'] as ToolDefinitionInput[] | undefined;
    if (Array.isArray(suppliedTools) && suppliedTools.length > 0) {
      const suppliedIds = suppliedTools.map((t) => t.id);
      // P2.3. `'add'` has to union HERE rather than in the processor, because the current binding
      // is only legible from the on-disk yaml — `ConvertedPrompt` carries no `tools` field
      // (P7-F8), so the caller building `promptData` cannot see what is already bound.
      promptYamlData['tools'] =
        writeIntent.toolBinding === 'add'
          ? [...new Set([...readToolIds(existingYaml), ...suppliedIds])]
          : suppliedIds;
    } else if (!unsetKeys.has('tools')) {
      // P2.3. A `remove` unbinds by SUBTRACTION from the on-disk list, because the caller names
      // ids to drop rather than resending the survivors — so the survivors are only knowable here.
      const existingTools = readToolIds(existingYaml).filter(
        (id) => !writeIntent.removedToolIds.includes(id)
      );
      if (existingTools.length > 0) {
        promptYamlData['tools'] = existingTools;
      }
    }

    // Carry forward the fields this writer builds no value for. Without this, every update
    // deletes them (P7-F2).
    Object.assign(
      promptYamlData,
      resolvePreservedPromptYamlFields(promptData, existingYaml, unsetKeys)
    );

    return promptYamlData;
  }
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types, @typescript-eslint/strict-boolean-expressions, @typescript-eslint/no-unsafe-member-access */

  /**
   * Read the prompt.yaml already on disk, for field preservation only.
   *
   * A missing or unparseable file is not an error here: a create has no prior file, and a file
   * too broken to parse is about to be replaced wholesale by the write this feeds. Either way
   * there is simply nothing to preserve, and the write itself is still validated afterwards by
   * `ResourceVerificationService` inside the mutation transaction.
   */
  private async readExistingPromptYaml(
    promptYamlPath: string
  ): Promise<Record<string, unknown> | undefined> {
    if (!existsSync(promptYamlPath)) {
      return undefined;
    }

    try {
      const raw = await fs.readFile(promptYamlPath, 'utf8');
      const parsed = parseYaml<Record<string, unknown> | null>(raw, { filename: promptYamlPath });
      // An empty or `null` document parses successfully to a non-object — nothing to preserve.
      if (!parsed.success || parsed.data == null || typeof parsed.data !== 'object') {
        this.logger.warn(
          `Could not read existing prompt.yaml for field preservation: ${promptYamlPath}`
        );
        return undefined;
      }
      return parsed.data;
    } catch (error) {
      this.logger.warn(
        `Could not read existing prompt.yaml for field preservation: ${promptYamlPath} (${String(error)})`
      );
      return undefined;
    }
  }

  /**
   * Create or update script tools for a prompt
   *
   * Creates:
   * - {promptDir}/tools/{toolId}/tool.yaml - Tool configuration
   * - {promptDir}/tools/{toolId}/schema.json - Input schema (if provided)
   * - {promptDir}/tools/{toolId}/script.{ext} - Script file
   */
  async createOrUpdateTools(
    promptDir: string,
    tools: ToolDefinitionInput[],
    promptId: string
  ): Promise<{ messages: string[]; paths: string[] }> {
    const messages: string[] = [];
    const paths: string[] = [];

    const toolsDir = path.join(promptDir, 'tools');

    for (const tool of tools) {
      const toolDir = path.join(toolsDir, tool.id);

      // Create tool directory
      await fs.mkdir(toolDir, { recursive: true });
      paths.push(toolDir);

      // Build tool.yaml configuration
      const toolYaml: Record<string, unknown> = {
        id: tool.id,
        name: tool.name,
        description: tool.description ?? '',
        script: this.getScriptFilename(tool.runtime),
        runtime: tool.runtime ?? 'auto',
        timeout: tool.timeout ?? 30000,
        enabled: true,
        execution: {
          trigger: tool.trigger ?? 'schema_match',
          confirm: tool.confirm ?? false,
          strict: tool.strict ?? false,
        },
      };

      // Write tool.yaml
      const toolYamlPath = path.join(toolDir, 'tool.yaml');
      const yamlContent = serializeYaml(toolYaml, { sortKeys: false });
      await safeWriteFile(toolYamlPath, yamlContent, 'utf8');
      paths.push(toolYamlPath);

      // Write schema.json if provided
      if (tool.schema !== undefined) {
        const schemaPath = path.join(toolDir, 'schema.json');
        const schemaContent = JSON.stringify(tool.schema, null, 2);
        await safeWriteFile(schemaPath, schemaContent, 'utf8');
        paths.push(schemaPath);
      }

      // Write script file
      const scriptFilename = this.getScriptFilename(tool.runtime);
      const scriptPath = path.join(toolDir, scriptFilename);
      await safeWriteFile(scriptPath, tool.script, 'utf8');
      paths.push(scriptPath);

      messages.push(`✅ Created tool '${tool.id}' in ${toolDir}`);
      this.logger.info(`Created script tool '${tool.id}' for prompt '${promptId}'`);
    }

    return { messages, paths };
  }

  /**
   * Scaffold sub-prompt directories for nested chain steps.
   *
   * Only scaffolds steps whose promptId follows the nested pattern (parentId/stepName).
   * External references (plain promptId without '/') are skipped.
   * Already-existing directories are skipped.
   *
   * Creates: {parentDir}/{stepDirName}/prompt.yaml + user-message.md
   */
  async scaffoldChainStepDirectories(
    parentDir: string,
    parentId: string,
    steps: unknown[]
  ): Promise<string[]> {
    const scaffoldedPaths: string[] = [];
    const prefix = `${parentId}/`;

    for (const rawStep of steps) {
      const step = rawStep as Record<string, unknown>;
      const promptId = step?.['promptId'];
      if (typeof promptId !== 'string' || !promptId.startsWith(prefix)) {
        continue; // External reference — skip
      }

      const stepDirName = promptId.slice(prefix.length);
      if (!stepDirName || stepDirName.includes('/')) {
        continue; // Empty or deeply nested — skip
      }

      const stepDir = path.join(parentDir, stepDirName);
      if (existsSync(stepDir)) {
        continue; // Already exists — skip
      }

      await fs.mkdir(stepDir, { recursive: true });

      const stepName = typeof step['stepName'] === 'string' ? step['stepName'] : stepDirName;
      const yamlData = {
        id: stepDirName,
        name: stepName,
        description: `Step: ${stepName}`,
        userMessageTemplateFile: 'user-message.md',
      };
      const yamlPath = path.join(stepDir, 'prompt.yaml');
      await safeWriteFile(yamlPath, serializeYaml(yamlData, { sortKeys: false }), 'utf8');
      scaffoldedPaths.push(yamlPath);

      const userMessagePath = path.join(stepDir, 'user-message.md');
      await safeWriteFile(userMessagePath, `# ${stepName}\n\nExecute this step.\n`, 'utf8');
      scaffoldedPaths.push(userMessagePath);

      this.logger.info(`Scaffolded sub-prompt directory: ${stepDirName}`);
    }

    return scaffoldedPaths;
  }

  /**
   * Get script filename based on runtime
   */
  private getScriptFilename(runtime?: string): string {
    switch (runtime) {
      case 'python':
        return 'script.py';
      case 'node':
        return 'script.js';
      case 'shell':
        return 'script.sh';
      default:
        return 'script.py'; // Default to Python
    }
  }
}
