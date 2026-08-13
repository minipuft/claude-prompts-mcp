// @lifecycle canonical - Handles prompt file read/write operations with transactional guarantees.
/**
 * File system and category management operations for YAML-based prompts.
 * Uses ResourceMutationTransaction for snapshot-based rollback on validation failure.
 */

import { existsSync, readdirSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { CategoryShipStatus, OperationResult, PromptResourceDependencies } from '../core/types.js';

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
  existingYaml: Record<string, unknown> | undefined
): Record<string, unknown> {
  const preserved: Record<string, unknown> = {};

  for (const key of PRESERVED_PROMPT_YAML_KEYS) {
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

/** One parsed `.gitignore` line: its pattern segments, negation flag, and anchoring. */
interface GitignoreRule {
  negate: boolean;
  /** Pattern split on `/`, trailing slash and `/**` suffix stripped (`'*'` segments are wildcards). */
  segments: string[];
  /**
   * `true` when the pattern contains a `/` other than a trailing one — anchored to the root of
   * this `.gitignore` and matched as a path prefix. `false` (e.g. bare `*`, `!.gitignore`) means
   * the pattern has no `/` at all and git matches it against any single path segment, at any
   * depth — see `git help gitignore` "PATTERN FORMAT".
   */
  anchored: boolean;
}

function parseGitignoreRules(gitignoreText: string): GitignoreRule[] {
  return gitignoreText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      const negate = line.startsWith('!');
      let pattern = negate ? line.slice(1) : line;
      if (pattern.endsWith('/')) {
        pattern = pattern.slice(0, -1);
      }
      const anchored = pattern.includes('/');
      if (pattern.endsWith('/**')) {
        pattern = pattern.slice(0, -3);
      }
      return { negate, segments: pattern.split('/'), anchored };
    });
}

function gitignoreRuleMatches(rule: GitignoreRule, pathSegments: string[]): boolean {
  const segmentMatches = (pattern: string, actual: string): boolean =>
    pattern === '*' || pattern === actual;

  if (!rule.anchored) {
    // Unanchored (no non-trailing `/`): git matches a single-segment pattern against any
    // component of the path, at any depth — not just a prefix.
    return pathSegments.some((segment) => segmentMatches(rule.segments[0] ?? '', segment));
  }
  // Anchored: matched as a prefix from the root of this `.gitignore`. A directory match implies
  // everything beneath it matches too (git prunes descent into an ignored directory), so a
  // shorter pattern matching the leading segments is sufficient regardless of a `/**` suffix.
  if (rule.segments.length > pathSegments.length) {
    return false;
  }
  return rule.segments.every((segment, i) => segmentMatches(segment, pathSegments[i] ?? ''));
}

/**
 * Does `categorySlug` ship with the repo, per `.gitignore` text alone?
 *
 * Pure by design (no fs): `resources/prompts/.gitignore` ignores everything (`*`) and un-ignores
 * specific categories with `!<category>/` + `!<category>/**` pairs (the pair is required — git
 * cannot re-include a file whose parent directory is still excluded, so the source file always
 * carries both). This walks a synthetic path for a brand-new prompt under the category
 * (`<category>/__new_prompt__/prompt.yaml`) through every rule in file order — last match wins,
 * matching git's own precedence — so it answers the same question `git check-ignore` would for a
 * prompt that does not yet exist on disk.
 *
 * Table-driven tests bind this against `git check-ignore` ground truth for all real categories,
 * so a change here that drifts from git's semantics fails loudly rather than silently.
 */
export function resolveCategoryShipStatus(gitignoreText: string, categorySlug: string): boolean {
  const testPath = [categorySlug, '__new_prompt__', 'prompt.yaml'];
  let ignored = false;
  for (const rule of parseGitignoreRules(gitignoreText)) {
    if (gitignoreRuleMatches(rule, testPath)) {
      ignored = !rule.negate;
    }
  }
  return !ignored;
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
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
  async updatePromptImplementation(promptData: any): Promise<OperationResult> {
    const promptsDir = this.configManager.getResolvedPromptsDirectory();
    const effectiveCategory = promptData.category.toLowerCase().replace(/\s+/g, '-');
    const promptDir = path.join(promptsDir, effectiveCategory, promptData.id);
    const yamlPath = path.join(promptDir, 'prompt.yaml');
    // Nested chain steps carry a path-qualified id ("implementation_plan/verification"): the
    // directory needs the full path, but the YAML `id` field and its validation take the
    // basename. That is the loader's contract (yaml-prompt-loader derives the qualified id from
    // the path and validates the file against the last segment) — writing the qualified form
    // fails the id regex, and the prompt is dropped at load with only a log line.
    const yamlId = toYamlPromptId(promptData.id);

    const txResult = await this.mutationTransaction.run({
      targets: [{ path: promptDir, kind: 'directory' }],
      mutate: async () => {
        const messages: string[] = [];
        const affectedFiles: string[] = [];

        // Ensure category directory exists
        const categoryDir = path.join(promptsDir, effectiveCategory);
        if (!existsSync(categoryDir)) {
          await fs.mkdir(categoryDir, { recursive: true });
          messages.push(`Created category directory: '${effectiveCategory}'`);
        }

        // Create/update YAML prompt
        const { exists: promptExists, paths } = await this.createOrUpdateYamlPrompt(
          promptData,
          effectiveCategory,
          promptsDir
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
      categoryShipStatus: await this.readCategoryShipStatus(promptsDir, effectiveCategory),
    };
  }

  /**
   * Read `.gitignore` from the resolved prompts directory and resolve category ship status
   * (P7-D4). A missing `.gitignore` — the common case for a workspace overlay that is not the
   * bundled repo tree — means nothing restricts what ships, so the category always ships.
   */
  private async readCategoryShipStatus(
    promptsDir: string,
    categorySlug: string
  ): Promise<CategoryShipStatus> {
    const gitignorePath = path.join(promptsDir, '.gitignore');
    let gitignoreText: string;
    try {
      gitignoreText = await fs.readFile(gitignorePath, 'utf-8');
    } catch {
      return { category: categorySlug, ships: true, gitignorePath };
    }
    return {
      category: categorySlug,
      ships: resolveCategoryShipStatus(gitignoreText, categorySlug),
      gitignorePath,
    };
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
    promptsDir: string
  ): Promise<{ exists: boolean; paths: string[] }> {
    const promptDir = path.join(promptsDir, effectiveCategory, promptData.id);
    const paths: string[] = [];

    // Check if prompt directory already exists
    const existsBefore = existsSync(promptDir);

    // Read BEFORE the directory is (re)created — this is the only surviving record of the fields
    // the writer builds no value for. Runs inside the mutation transaction's `mutate`, before any
    // write, so it observes pre-mutation content.
    const existingYaml = await this.readExistingPromptYaml(path.join(promptDir, 'prompt.yaml'));

    // Create prompt directory
    await fs.mkdir(promptDir, { recursive: true });
    paths.push(promptDir);

    // Build prompt.yaml metadata
    const promptYamlData: Record<string, unknown> = {
      // Basename, not the qualified id — see toYamlPromptId
      id: toYamlPromptId(promptData.id),
      name: promptData.name,
      category: effectiveCategory,
      description: promptData.description,
    };

    // Add optional fields
    if (promptData.systemMessage) {
      promptYamlData['systemMessageFile'] = 'system-message.md';
    }
    promptYamlData['userMessageTemplateFile'] = 'user-message.md';

    // Add arguments if present
    if (promptData.arguments && promptData.arguments.length > 0) {
      promptYamlData['arguments'] = promptData.arguments;
    }

    // Add gate configuration if present
    if (promptData.gateConfiguration) {
      promptYamlData['gateConfiguration'] = promptData.gateConfiguration;
      this.logger.debug(`[YAML-CREATE] Adding gate configuration to ${promptData.id}`);
    }

    // Add chain steps if present (for chain prompts)
    if (promptData.chainSteps && promptData.chainSteps.length > 0) {
      promptYamlData['chainSteps'] = promptData.chainSteps;
    }

    // Add tools reference if present (just tool IDs, not full definitions)
    if (promptData.tools && promptData.tools.length > 0) {
      promptYamlData['tools'] = promptData.tools.map((t: ToolDefinitionInput) => t.id);
    }

    // Carry forward the fields this writer builds no value for. Without this, every update
    // deletes them (P7-F2).
    Object.assign(
      promptYamlData,
      resolvePreservedPromptYamlFields(promptData as Record<string, unknown>, existingYaml)
    );

    // Write prompt.yaml
    const promptYamlPath = path.join(promptDir, 'prompt.yaml');
    const yamlContent = serializeYaml(promptYamlData, { sortKeys: false });
    await safeWriteFile(promptYamlPath, yamlContent, 'utf8');
    paths.push(promptYamlPath);

    // Write user-message.md (required)
    const userMessagePath = path.join(promptDir, 'user-message.md');
    await safeWriteFile(userMessagePath, promptData.userMessageTemplate ?? '', 'utf8');
    paths.push(userMessagePath);

    // Write system-message.md (optional)
    if (promptData.systemMessage) {
      const systemMessagePath = path.join(promptDir, 'system-message.md');
      await safeWriteFile(systemMessagePath, promptData.systemMessage, 'utf8');
      paths.push(systemMessagePath);
    }

    this.logger.info(`${existsBefore ? 'Updated' : 'Created'} YAML prompt: ${promptData.id}`);

    return {
      exists: existsBefore,
      paths,
    };
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
