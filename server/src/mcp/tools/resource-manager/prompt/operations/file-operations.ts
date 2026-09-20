// @lifecycle canonical - Handles prompt file read/write operations with transactional guarantees.
/**
 * File system and category management operations for YAML-based prompts.
 * Uses ResourceMutationTransaction for snapshot-based rollback on validation failure.
 */

import { existsSync, readdirSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { overlayDecidedYamlKeys } from '../../../shared/yaml-key-overlay.js';
import { OperationResult, PromptResourceDependencies } from '../core/types.js';
import { validateCategoryName } from '../utils/validation.js';

import type {
  ResourceMutationTarget,
  ResourceWriteCommitOptions,
} from '#modules/resources/services/index.js';
import type { ConfigManager, Logger } from '#shared/types/index.js';
import type { ToolDefinitionInput } from '../../core/types.js';
import type { FileContentChange } from '../analysis/object-diff-generator.js';

import {
  discoverCategoryDirectories,
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
  // P4.65. Same shape as the six above and for the same reason: `ConvertedPrompt` carries no
  // `edges` (the loader linearizes them into `chainSteps` order and drops them), so the on-disk
  // YAML is the only place a chain's authored edges can be read back from. Settable since P4.65
  // — until then `collectChainEdgeErrors` could refuse a `chain_steps` rewrite that orphaned an
  // edge with no tool-side way to correct it.
  'edges',
  // P4.82. `budget` and `artifacts` ARE carried on `ConvertedPrompt`, unlike `edges` — but
  // `canonicalPromptSnapshot` does not project them, so the `promptData` an update builds still
  // arrives without them and the on-disk YAML is still the only fallback. Same precedence rule
  // as every other key here.
  'budget',
  'artifacts',
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
 * The `prompt.yaml` keys a write of each `promptData` key decides, where they differ from the key
 * itself. A message is two keys in the file: the `*File` pointer the writer emits, and the inline
 * form a flat or hand-authored prompt may declare instead. Deciding one without the other would
 * leave the file naming two sources for one message.
 */
const PROMPT_YAML_KEYS_BY_DATA_KEY: Readonly<Record<string, readonly string[]>> = {
  systemMessage: ['systemMessageFile', 'systemMessage'],
  userMessageTemplate: ['userMessageTemplateFile', 'userMessageTemplate'],
};

/**
 * Which `prompt.yaml` keys this write is allowed to change (P4.57).
 *
 * Every other key stays exactly as the file declares it, including keys the writer has no model
 * for at all. `ownsEveryModeledKey` is a write with no prior directory: the writer produces the
 * message files itself, so it must decide their pointers too, even under a narrowed scope.
 */
export function decidedPromptYamlKeys(
  suppliedKeys: ReadonlySet<string>,
  writeIntent: PromptWriteIntent,
  ownsEveryModeledKey: boolean
): Set<string> {
  const dataKeys = ownsEveryModeledKey
    ? [...ALL_PROMPT_DATA_KEYS]
    : [...suppliedKeys, ...writeIntent.unsetKeys];
  if (writeIntent.removedToolIds.length > 0) {
    dataKeys.push('tools');
  }
  const decided = new Set<string>(['id']);
  for (const dataKey of dataKeys) {
    for (const yamlKey of PROMPT_YAML_KEYS_BY_DATA_KEY[dataKey] ?? [dataKey]) {
      decided.add(yamlKey);
    }
  }
  return decided;
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

/** A file a prompt write produces, addressed relative to the prompt's own directory. */
interface PlannedPromptFile {
  relativePath: string;
  content: string;
}

/**
 * Everything one prompt write does, resolved before anything is written.
 *
 * `updatePromptImplementation` applies it and `projectPromptWrite` reports it. A preview built any
 * other way — the prompt's fields rendered as one YAML document, say — names a file the write never
 * touches and misses the ones it does, which is how a directory prompt's preview once showed a
 * rewrapped `{id}.yaml` for an update that changed one line of `user-message.md`.
 */
interface PromptWritePlan {
  promptsDir: string;
  effectiveCategory: string;
  promptDir: string;
  /** The prompt's directory under another category, relocated to `promptDir` first. */
  moveSource: string | null;
  /**
   * The prompt's prior single-file location (`{category}/{id}.yaml`, any category), deleted as
   * part of converting it to directory layout in this same write (B.21) — which also relocates it
   * when this file's category differs from `effectiveCategory`, the same way `moveSource` relocates
   * a directory. Mutually exclusive with `moveSource` and `copyOnWriteSource`: the prior state is
   * either a directory, a flat file, or neither, never two of the three.
   */
  fileSource: string | null;
  /** The prompt's directory under the root it was loaded from, copied to `promptDir` first. */
  copyOnWriteSource: string | null;
  /** Where the prompt's files are before this write; null when it has none. */
  priorDir: string | null;
  /** The resources root `priorDir` sits under. */
  priorRoot: string;
  /** `prompt.yaml` and the message files this call's scope rewrites. */
  promptFiles: PlannedPromptFile[];
  removesSystemMessage: boolean;
  /** Stub files for nested chain steps that have no directory yet. */
  scaffoldFiles: PlannedPromptFile[];
  /** Script tool files, grouped so the writer can report each tool it created. */
  toolFiles: Array<{ id: string; files: PlannedPromptFile[] }>;
  /** Tools whose `tools/{id}/` directory this write deletes. */
  removedToolIds: readonly string[];
}

/** A relative filesystem path in the `/`-separated form a diff header uses. */
function toPosixPath(filePath: string): string {
  return filePath.split(path.sep).join('/');
}

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
    writeIntent: PromptWriteIntent = NO_WRITE_INTENT,
    options: ResourceWriteCommitOptions = {}
  ): Promise<OperationResult> {
    // Everything this write does is resolved here, before the transaction opens, and the mutation
    // below applies the plan and decides nothing of its own. `projectPromptWrite` reads a
    // preview's diff off the same plan, which is what keeps the two from naming different files.
    const plan = await this.planPromptWrite(promptData, suppliedKeys, sourceRoot, writeIntent);
    const { promptsDir, effectiveCategory, promptDir, moveSource, fileSource, copyOnWriteSource } =
      plan;
    const yamlPath = path.join(promptDir, 'prompt.yaml');
    // Nested chain steps carry a path-qualified id ("implementation_plan/verification"): the
    // directory needs the full path, but the YAML `id` field and its validation take the
    // basename. That is the loader's contract (yaml-prompt-loader derives the qualified id from
    // the path and validates the file against the last segment) — writing the qualified form
    // fails the id regex, and the prompt is dropped at load with only a log line.
    const yamlId = toYamlPromptId(promptData.id);
    const promptId = (promptData as { id: string }).id;

    const targets: ResourceMutationTarget[] = [{ path: promptDir, kind: 'directory' }];
    if (moveSource !== null) {
      // Both dirs snapshotted BEFORE the mutation runs: a failure partway through the move (the
      // relocation succeeds but the post-write `validateFile` rejects the result, say) must
      // restore the ORIGINAL directory intact and leave no partial directory at the new
      // location — the two-target restore `ResourceMutationTransaction` already provides for any
      // target set, snapshot-then-mutate-then-validate-or-restore-all.
      targets.push({ path: moveSource, kind: 'directory' });
    }
    if (fileSource !== null) {
      // Same reasoning as the move target above: a failure after the file is deleted but before
      // the new directory validates must put the file back, not leave the prompt undefined.
      targets.push({ path: fileSource, kind: 'file' });
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

        if (fileSource !== null) {
          messages.push(
            ...(await this.convertPromptFileToDirectory(fileSource, promptId, effectiveCategory))
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

        // `fileSource` is a prior state too — `priorDir` alone would call this a `Created` prompt
        // for what is, from the caller's side, an update of the flat file it just converted.
        const promptExists = plan.priorDir !== null || fileSource !== null;
        affectedFiles.push(...(await this.createOrUpdateYamlPrompt(plan, promptId, promptExists)));
        messages.push(`${promptExists ? 'Updated' : 'Created'} prompt: ${promptData.id}`);

        // Scaffold chain step directories for nested sub-prompts
        if (plan.scaffoldFiles.length > 0) {
          const scaffolded = await this.writePlannedFiles(promptDir, plan.scaffoldFiles);
          this.logger.info(`Scaffolded sub-prompt directories for '${promptId}'`);
          messages.push(`Scaffolded sub-prompt directories (${scaffolded.length} files)`);
          affectedFiles.push(...scaffolded);
        }

        for (const tool of plan.toolFiles) {
          const toolDir = path.join(promptDir, 'tools', tool.id);
          await fs.mkdir(toolDir, { recursive: true });
          affectedFiles.push(toolDir, ...(await this.writePlannedFiles(promptDir, tool.files)));
          messages.push(`✅ Created tool '${tool.id}' in ${toolDir}`);
          this.logger.info(`Created script tool '${tool.id}' for prompt '${promptId}'`);
        }

        // P2.3. Inside the transaction, so a failed write rolls the deletions back with
        // everything else — a tool directory removed against a prompt.yaml that never landed
        // would leave the binding pointing at files that are gone.
        for (const toolId of plan.removedToolIds) {
          const toolDir = resolveContainedPath(promptDir, 'tools', toolId);
          await fs.rm(toolDir, { recursive: true, force: true });
          messages.push(`Removed tool '${toolId}' and deleted ${toolDir}`);
          affectedFiles.push(toolDir);
        }

        return { messages, affectedFiles };
      },
      validate: () => this.verificationService.validateFile('prompts', yamlId, yamlPath),
      ...(options.commit !== undefined ? { commit: options.commit } : {}),
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
   * What a write of `promptData` would change on disk, file by file, without writing anything.
   *
   * Takes the arguments `updatePromptImplementation` takes and resolves the plan that method
   * applies, so a caller holding one call's arguments gets exactly that call's files and contents.
   * Paths are relative to the resources root on each side: a prompt copied up from the bundled
   * tree, or moved between categories, is read from one place and lands in another.
   */
  async projectPromptWrite(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
    promptData: any,
    suppliedKeys?: ReadonlySet<string>,
    sourceRoot?: string,
    writeIntent: PromptWriteIntent = NO_WRITE_INTENT
  ): Promise<FileContentChange[]> {
    const plan = await this.planPromptWrite(promptData, suppliedKeys, sourceRoot, writeIntent);

    // Keyed by path in the order the writer applies them, so a file one plan touches twice shows
    // once, with the content that is left on disk — a later write or a deletion wins there too.
    const planned = new Map<string, string | null>();
    const writtenFiles = [
      ...plan.promptFiles,
      ...plan.scaffoldFiles,
      ...plan.toolFiles.flatMap((tool) => tool.files),
    ];
    for (const file of writtenFiles) planned.set(file.relativePath, file.content);
    if (plan.removesSystemMessage) planned.set('system-message.md', null);
    for (const toolId of plan.removedToolIds) {
      for (const relativePath of await this.listPriorFiles(plan.priorDir, 'tools', toolId)) {
        planned.set(relativePath, null);
      }
    }

    const targetPrefix = path.relative(plan.promptsDir, plan.promptDir);
    const priorPrefix =
      plan.priorDir !== null ? path.relative(plan.priorRoot, plan.priorDir) : targetPrefix;
    const changes: FileContentChange[] = [];
    for (const [relativePath, after] of planned) {
      changes.push({
        path: toPosixPath(path.join(targetPrefix, relativePath)),
        previousPath: toPosixPath(path.join(priorPrefix, relativePath)),
        before: await this.readPriorFile(plan.priorDir, relativePath),
        after,
      });
    }

    // `fileSource` sits outside `promptDir` (a sibling `{id}.yaml`, not a file under it), so it
    // cannot share `targetPrefix`/`priorPrefix` with the loop above — named at its own path on
    // both sides, deleted (B.21).
    if (plan.fileSource !== null) {
      const fileSourcePath = toPosixPath(path.relative(plan.promptsDir, plan.fileSource));
      changes.push({
        path: fileSourcePath,
        previousPath: fileSourcePath,
        before: existsSync(plan.fileSource) ? await fs.readFile(plan.fileSource, 'utf8') : null,
        after: null,
      });
    }

    return changes;
  }

  /**
   * Resolve everything one prompt write will do, reading the disk but writing nothing.
   *
   * The single place a write's decisions are made: where it lands, whether it moves or copies a
   * prior tree first, which files it rewrites and with what, what it scaffolds and deletes.
   * `updatePromptImplementation` applies the result and `projectPromptWrite` reports it, so there
   * is no second derivation of any of those answers to drift from the first.
   */
  private async planPromptWrite(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    promptData: any,
    suppliedKeys: ReadonlySet<string> | undefined,
    sourceRoot: string | undefined,
    writeIntent: PromptWriteIntent
  ): Promise<PromptWritePlan> {
    const promptsDir = this.configManager.getResolvedPromptsDirectory();
    const effectiveCategory = slugifyCategoryDirectory(promptData.category);
    // `category` reaches this line straight from the tool payload. Validated here because
    // `validateCategoryName` had no call site at all — a category of `../../x` walked out of the
    // resources root and wrote there, measured 2026-08-30 and reported as `✅ Prompt Created`.
    // Both checks run before any directory is created, so a refusal writes nothing.
    validateCategoryName(effectiveCategory);
    const promptDir = resolveContainedPath(promptsDir, effectiveCategory, promptData.id);

    // Part 2 — category MOVE (owner ruling 2026-08-16, tier-b-settability-proposal §Open
    // Decision 3, overriding the proposal's original "refuse" recommendation): a caller-supplied
    // `category` that slugs to a directory other than the one the prompt currently lives under
    // relocates the whole directory tree. Detected only when the TARGET directory does not
    // already exist, so the ordinary "no move" case (the overwhelming majority of calls) costs
    // nothing beyond the `existsSync` this method already needed. Nested chain-step ids ('/' in
    // the id) are excluded: they scaffold under their PARENT's own directory
    // (`planChainStepScaffolds`), not under a category, so "category move" has no referent.
    const promptId = (promptData as { id: string }).id;
    const isNestedId = promptId.includes('/');
    const moveSource =
      !isNestedId && !existsSync(promptDir)
        ? this.findExistingPromptDirectory(promptsDir, promptId, promptDir)
        : null;

    // B.21 — single-file → directory conversion, in the SAME write, including across a category
    // change. `findExistingPromptDirectory` above deliberately excludes `format: 'file'` matches,
    // so an update of a `{category}/{id}.yaml` prompt reached this point with `moveSource === null`
    // and then wrote a fresh `{id}/` directory beside the untouched file — the prompt defined
    // twice, one copy going stale from the moment of the first update. Scans every category, the
    // same way `moveSource`'s directory-format search does, because the flat file being converted
    // may not live under the write's own TARGET category — a category-changing update of a
    // single-file prompt is exactly that: measured live, `general/one_file_note.yaml` updated with
    // `category: "docs"` left BOTH `general/one_file_note.yaml` and `docs/one_file_note/` on disk,
    // served twice, before this scan was widened from the target category alone.
    const fileSource =
      !isNestedId && moveSource === null && !existsSync(promptDir)
        ? this.findExistingPromptFile(promptsDir, promptId)
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
    // the plan then sees an existing prompt and honours `suppliedKeys`, and step directories that
    // already exist are not scaffolded. The fix is therefore a copy, not new preservation logic —
    // the preservation logic was already correct and was being handed an empty directory.
    //
    // Whole-subtree rather than a list of known file kinds: a list can only preserve what someone
    // remembered to enumerate, and the two losses above were exactly the kinds nobody had.
    const copyOnWriteSource =
      moveSource === null &&
      fileSource === null &&
      !existsSync(promptDir) &&
      sourceRoot !== undefined
        ? this.resolveCopyOnWriteSource(sourceRoot, promptsDir, promptId, promptDir)
        : null;

    // A move or a copy puts the prior tree at `promptDir` before any content is written, so every
    // "does this already exist" question is asked of the tree where it sits NOW — which is the
    // same tree, byte for byte, that the content write will then find at `promptDir`.
    const priorDir = existsSync(promptDir) ? promptDir : (moveSource ?? copyOnWriteSource);
    const priorRoot =
      copyOnWriteSource !== null && sourceRoot !== undefined ? sourceRoot : promptsDir;
    // `fileSource` has no `prompt.yaml` inside it — it IS the yaml, at its own path — so field
    // preservation (`buildPromptYamlData`'s `existingYaml`) reads it directly rather than through
    // `priorDir`, which stays null here on purpose: `isFreshDirectory` below still needs to be
    // true, because there is no prior DIRECTORY whose untouched files this write can leave alone.
    const priorYamlPath = priorDir !== null ? path.join(priorDir, 'prompt.yaml') : fileSource;

    const { files: promptFiles, removesSystemMessage } = await this.planPromptFiles(
      promptData,
      priorDir,
      priorYamlPath,
      suppliedKeysForWrite,
      writeIntent
    );

    return {
      promptsDir,
      effectiveCategory,
      promptDir,
      moveSource,
      fileSource,
      copyOnWriteSource,
      priorDir,
      priorRoot,
      promptFiles,
      removesSystemMessage,
      scaffoldFiles: Array.isArray(promptData.chainSteps)
        ? this.planChainStepScaffolds(promptDir, priorDir, promptId, promptData.chainSteps)
        : [],
      toolFiles: Array.isArray(promptData.tools) ? this.planToolFiles(promptData.tools) : [],
      removedToolIds: writeIntent.removedToolIds,
    };
  }

  /** A prior file's current content, or null when this write has no prior tree or no such file. */
  private async readPriorFile(
    priorDir: string | null,
    relativePath: string
  ): Promise<string | null> {
    if (priorDir === null) return null;
    const priorPath = path.join(priorDir, relativePath);
    return existsSync(priorPath) ? await fs.readFile(priorPath, 'utf8') : null;
  }

  /**
   * Every file under a directory of the prior tree, relative to that tree. Contained the way the
   * writer's own removal is, so an id that escapes is refused here before it is read.
   */
  private async listPriorFiles(priorDir: string | null, ...segments: string[]): Promise<string[]> {
    if (priorDir === null) return [];
    const dir = resolveContainedPath(priorDir, ...segments);
    if (!existsSync(dir)) return [];
    const entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.relative(priorDir, path.join(entry.parentPath, entry.name)));
  }

  /**
   * Locate the on-disk directory of `promptId` across every category — used only when the
   * caller's TARGET directory (derived from `promptData.category`) does not yet exist, so a
   * category-changing update can find where the prompt currently lives (Part 2 — category move).
   * Returns `null` when no OTHER directory declares this id, which is the ordinary "brand new
   * prompt" case, not a move. Excludes flat single-file prompts (`{category}/{id}.yaml`,
   * `format: 'file'`) — this writer only ever produces directory-format prompts, so a flat-file
   * match is not a directory to relocate. The sibling single-file case, including a category
   * change, is `findExistingPromptFile`, below (B.21).
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
    for (const categoryDir of this.categoryDirectoryPaths(promptsDir)) {
      const found = findYamlPromptInCategory(categoryDir, promptId);
      if (found !== null && found.format === 'directory' && found.path !== excludeDir) {
        return found.path;
      }
    }
    return null;
  }

  /**
   * Relocate the whole prompt directory tree — `tools/`, scaffolded chain-step sub-dirs,
   * everything — from `sourceDir` to `targetDir`, BEFORE any content write. The plan has already
   * read the prior state at `sourceDir` for Fix A's preservation (tools ids, authored
   * category-if-caller-omitted), and moving first means every file the plan does not rewrite
   * arrives at the NEW location intact, without this method needing to know anything about
   * preservation itself.
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
   * Locate `promptId` at its single-file location (`{category}/{id}.yaml`) across every category
   * — used only when no directory-format match exists (`moveSource === null`) and the write's own
   * TARGET directory does not yet exist, so an update of a single-file prompt can convert it to
   * directory layout in the same write (B.21) instead of leaving it in place and creating `{id}/`
   * beside it. Scans every category the same way `findExistingPromptDirectory` does, rather than
   * only the write's target category: a category-changing update of a single-file prompt is the
   * ordinary case this needs to find, not an exception to it — the flat file being converted lives
   * under whatever category it was authored in, which the caller is in the middle of changing.
   */
  private findExistingPromptFile(promptsDir: string, promptId: string): string | null {
    for (const categoryDir of this.categoryDirectoryPaths(promptsDir)) {
      const found = findYamlPromptInCategory(categoryDir, promptId);
      if (found !== null && found.format === 'file') {
        return found.path;
      }
    }
    return null;
  }

  /**
   * Delete the prompt's prior single-file location as part of converting it to directory layout
   * (B.21) — the same write relocates it too when `targetCategory` names a different category than
   * the flat file lived under, since `findExistingPromptFile` now finds it regardless of category.
   * The directory's own files are written separately by `createOrUpdateYamlPrompt`, from
   * `plan.promptFiles` — which already carries the flat file's content forward via
   * `priorYamlPath`-based field preservation, so this method's only job is removing the file the
   * conversion (and possible relocation) supersedes. Placed in `mutate()` the same way
   * `relocatePromptDirectory` is: before the content write, and covered by the same transaction
   * target for rollback.
   */
  private async convertPromptFileToDirectory(
    fileSource: string,
    promptId: string,
    targetCategory: string
  ): Promise<string[]> {
    const sourceCategory = path.basename(path.dirname(fileSource));
    await fs.rm(fileSource, { force: true });
    const relocation =
      sourceCategory === targetCategory
        ? ''
        : ` and moved from '${sourceCategory}' to '${targetCategory}'`;
    return [
      `Converted prompt '${promptId}' from single-file layout (${path.basename(fileSource)}) to directory layout${relocation}`,
    ];
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
    const categoryDirs = this.categoryDirectoryPaths(promptsDir);

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
              // "over the bundled one", not a bare "takes precedence" — this branch reaches only
              // a prompt whose sole copy is in the bundled tree, and the writable root is no
              // longer the top of the order (`shared/utils/resource-root-lookup.ts`
              // §resourceRootPrecedence). Unqualified, an operator with a workspace overlay was
              // told their copy wins a contest it can lose.
              `To change how '${id}' behaves for you, update it: the update copies it into your ` +
              `root first and your copy takes precedence over the bundled one. There is no way ` +
              `to make '${id}' stop ` +
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
   * The category directories under the prompts root, as absolute paths.
   *
   * The loader's own scan, not a copy of it. This method held a private copy of the name filter,
   * so a write or delete could find a prompt the loader had never served, and would disagree the
   * day either copy changed.
   */
  private categoryDirectoryPaths(promptsDir: string): string[] {
    return discoverCategoryDirectories(promptsDir).map((name) => path.join(promptsDir, name));
  }

  /**
   * Write the prompt's own files — `prompt.yaml` and its message files — as the plan resolved
   * them, and delete `system-message.md` when the plan clears it.
   */
  private async createOrUpdateYamlPrompt(
    plan: PromptWritePlan,
    promptId: string,
    promptExists: boolean
  ): Promise<string[]> {
    await fs.mkdir(plan.promptDir, { recursive: true });
    const paths = [
      plan.promptDir,
      ...(await this.writePlannedFiles(plan.promptDir, plan.promptFiles)),
    ];

    if (plan.removesSystemMessage) {
      // `force` because an `unset` on a prompt that never had a system message is a valid, and
      // successful, no-op — the caller asked for a state, not for a deletion event.
      const systemMessagePath = path.join(plan.promptDir, 'system-message.md');
      await fs.rm(systemMessagePath, { force: true });
      paths.push(systemMessagePath);
    }

    this.logger.info(`${promptExists ? 'Updated' : 'Created'} YAML prompt: ${promptId}`);
    return paths;
  }

  /**
   * Decide which of the prompt's own files this write rewrites, and build what lands in each.
   *
   * - `prompt.yaml` - Metadata (id, name, category, description, arguments, gates)
   * - `user-message.md` - User message template (required)
   * - `system-message.md` - System message (optional)
   */
  /* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/strict-boolean-expressions, @typescript-eslint/no-unsafe-member-access */
  private async planPromptFiles(
    promptData: any,
    priorDir: string | null,
    priorYamlPath: string | null,
    suppliedKeys: ReadonlySet<string>,
    writeIntent: PromptWriteIntent
  ): Promise<{ files: PlannedPromptFile[]; removesSystemMessage: boolean }> {
    const { unsetKeys } = writeIntent;

    // Fix B write-scope narrowing (tier-b-settability-proposal §2): a directory with no prior
    // `prompt.yaml` needs its baseline files regardless of what the caller's `suppliedKeys`
    // narrowed to — an update landing on a brand-new directory must not skip the write that makes
    // it a valid prompt. `suppliedKeys` narrows an EXISTING prompt's edit surface; it does not
    // narrow what a fresh directory needs to become one.
    const isFreshDirectory = priorDir === null;

    // Read ahead of the `writesYaml` decision below (moved out of the `if (writesYaml)` block
    // that used to gate it) — P4.66 needs it to answer a question `suppliedKeys` alone cannot:
    // does the file on disk declare a message INLINE (no `*File` pointer)? Same condition as
    // before (`priorYamlPath !== null`), so a fresh directory or a plan with no prior yaml still
    // reads nothing new; every other case now reads what it would have read anyway once
    // `writesYaml` (below) was decided true, just a few lines earlier.
    const existingYaml =
      priorYamlPath !== null ? await this.readExistingPromptYaml(priorYamlPath) : undefined;

    // A supplied `userMessageTemplate`/`systemMessage` whose CURRENT file declares it inline
    // forces `prompt.yaml` open even though neither is a `PROMPT_YAML_RESIDENT_KEYS` member: the
    // inline key keeps winning over a rewritten `.md` file until the yaml is rewritten to point at
    // it (P4.66 — `resource_manager update` patching `user_message_template` on a
    // hand-authored inline-template prompt wrote `user-message.md` and left the inline key
    // rendering). A prompt already in file-pointer form — every prompt this writer itself
    // produces, since `buildPromptYamlData` always emits the pointer once it touches the yaml —
    // needs no such forcing, which is what keeps the ordinary case byte-identical (write-scope
    // table below).
    const declaresInline = (dataKey: 'userMessageTemplate' | 'systemMessage'): boolean => {
      const fileKey = PROMPT_YAML_KEYS_BY_DATA_KEY[dataKey]?.[0] as string;
      return (
        existingYaml !== undefined &&
        existingYaml[fileKey] === undefined &&
        existingYaml[dataKey] !== undefined
      );
    };
    const convertsInlineMessage =
      (suppliedKeys.has('userMessageTemplate') && declaresInline('userMessageTemplate')) ||
      (suppliedKeys.has('systemMessage') && declaresInline('systemMessage'));

    // P2.1: any `unset` forces the `prompt.yaml` rewrite, including `systemMessage` — which is
    // NOT a `PROMPT_YAML_RESIDENT_KEYS` member (its text lives in its own file) but still owns a
    // key IN the yaml, `systemMessageFile`. Without this clause, clearing it narrowed the write
    // scope to a file the writer then never opened, so the orphaned `systemMessageFile:` survived
    // pointing at a `.md` this same call had just deleted. Caught by the enumeration test.
    const writesYaml =
      isFreshDirectory ||
      unsetKeys.size > 0 ||
      PROMPT_YAML_RESIDENT_KEYS.some((key) => suppliedKeys.has(key)) ||
      convertsInlineMessage;
    const writesUserMessage = isFreshDirectory || suppliedKeys.has('userMessageTemplate');
    // P2.1. `systemMessage` is the one unsettable field with a FILE behind it, so clearing it is
    // two operations, not one: `buildPromptYamlData` drops `systemMessageFile` (its guard is
    // already truthiness-based, and the key is gone from `promptData` by now), and the `.md` has
    // to be removed as well. Dropping only the key would leave an orphan `system-message.md` that
    // no loader reads and every `git status` shows — a removal that half happened.
    const removesSystemMessage = unsetKeys.has('systemMessage');
    const writesSystemMessage =
      Boolean(promptData.systemMessage) &&
      !removesSystemMessage &&
      (isFreshDirectory || suppliedKeys.has('systemMessage'));

    const files: PlannedPromptFile[] = [];
    if (writesYaml) {
      const promptYamlData = overlayDecidedYamlKeys(
        existingYaml,
        this.buildPromptYamlData(
          promptData as Record<string, unknown>,
          existingYaml,
          suppliedKeys,
          writeIntent
        ),
        decidedPromptYamlKeys(suppliedKeys, writeIntent, isFreshDirectory)
      );
      files.push({
        relativePath: 'prompt.yaml',
        content: serializeYaml(promptYamlData, { sortKeys: false }),
      });
    }

    if (writesUserMessage) {
      files.push({
        relativePath: 'user-message.md',
        content: promptData.userMessageTemplate ?? '',
      });
    }

    if (writesSystemMessage) {
      files.push({ relativePath: 'system-message.md', content: promptData.systemMessage });
    }

    return { files, removesSystemMessage };
  }

  /**
   * Build the `prompt.yaml` document for a write that IS touching the file. Pure — no I/O.
   * Isolates the category/tools/preserved-field precedence rules from the file-scope orchestration
   * in `planPromptFiles`, which keeps that method's branching to "which files does this
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
    // `planToolFiles`). Otherwise preserve the on-disk id list.
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
  /* eslint-enable @typescript-eslint/no-explicit-any, @typescript-eslint/strict-boolean-expressions, @typescript-eslint/no-unsafe-member-access */

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
   * Build the files each script tool gets. Pure — the writer applies them.
   *
   * - `tools/{toolId}/tool.yaml` - Tool configuration
   * - `tools/{toolId}/schema.json` - Input schema (if provided)
   * - `tools/{toolId}/script.{ext}` - Script file
   */
  private planToolFiles(
    tools: readonly ToolDefinitionInput[]
  ): Array<{ id: string; files: PlannedPromptFile[] }> {
    return tools.map((tool) => {
      const toolDir = `tools/${tool.id}`;
      const scriptFilename = this.getScriptFilename(tool.runtime);
      const toolYaml: Record<string, unknown> = {
        id: tool.id,
        name: tool.name,
        description: tool.description ?? '',
        script: scriptFilename,
        runtime: tool.runtime ?? 'auto',
        timeout: tool.timeout ?? 30000,
        enabled: true,
        execution: {
          trigger: tool.trigger ?? 'schema_match',
          confirm: tool.confirm ?? false,
          strict: tool.strict ?? false,
        },
      };

      const files: PlannedPromptFile[] = [
        {
          relativePath: `${toolDir}/tool.yaml`,
          content: serializeYaml(toolYaml, { sortKeys: false }),
        },
      ];
      if (tool.schema !== undefined) {
        files.push({
          relativePath: `${toolDir}/schema.json`,
          content: JSON.stringify(tool.schema, null, 2),
        });
      }
      files.push({ relativePath: `${toolDir}/${scriptFilename}`, content: tool.script });
      return { id: tool.id, files };
    });
  }

  /**
   * Build stub files for nested chain steps that have no directory yet.
   *
   * Only steps whose promptId follows the nested pattern (parentId/stepName) are scaffolded.
   * External references (plain promptId without '/') are skipped, and so is a step whose
   * directory already exists in the prior tree or that an earlier step in the same list named.
   *
   * Produces, relative to the parent's directory: {stepDirName}/prompt.yaml + user-message.md
   *
   * A `stepDirName` of `.` or `..` names the parent's own folder or its category, so it is refused
   * by name instead of skipped: a skip reads as success, and on a fresh create the stub would land
   * one level above the parent. Every scaffold path also goes through `resolveContainedPath`.
   */
  private planChainStepScaffolds(
    promptDir: string,
    priorDir: string | null,
    parentId: string,
    steps: unknown[]
  ): PlannedPromptFile[] {
    const files: PlannedPromptFile[] = [];
    const planned = new Set<string>();
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

      if (stepDirName === '.' || stepDirName === '..') {
        throw new Error(
          `Chain step "${promptId}" cannot scaffold outside its parent's own directory — ` +
            `"${stepDirName}" names the parent's own folder or its category, not a sub-prompt. ` +
            `Nothing was written.`
        );
      }
      // The same containment check every other resource write goes through.
      resolveContainedPath(promptDir, stepDirName);

      const alreadyExists =
        planned.has(stepDirName) ||
        (priorDir !== null && existsSync(path.join(priorDir, stepDirName)));
      if (alreadyExists) {
        continue;
      }
      planned.add(stepDirName);

      const stepName = typeof step['stepName'] === 'string' ? step['stepName'] : stepDirName;
      const yamlData = {
        id: stepDirName,
        name: stepName,
        description: `Step: ${stepName}`,
        userMessageTemplateFile: 'user-message.md',
      };
      files.push(
        {
          relativePath: `${stepDirName}/prompt.yaml`,
          content: serializeYaml(yamlData, { sortKeys: false }),
        },
        {
          relativePath: `${stepDirName}/user-message.md`,
          content: `# ${stepName}\n\nExecute this step.\n`,
        }
      );
    }

    return files;
  }

  /** Write planned files beneath `baseDir`, creating their directories; returns the paths written. */
  private async writePlannedFiles(
    baseDir: string,
    files: readonly PlannedPromptFile[]
  ): Promise<string[]> {
    const paths: string[] = [];
    for (const file of files) {
      const target = path.join(baseDir, file.relativePath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await safeWriteFile(target, file.content, 'utf8');
      paths.push(target);
    }
    return paths;
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
