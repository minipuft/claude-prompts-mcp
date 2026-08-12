// @lifecycle canonical - YAML-specific prompt loading, discovery, and conversion.
/**
 * YAML Prompt Loader
 *
 * Pure functions for YAML-based prompt discovery, loading, and conversion.
 * Extracted from PromptLoader to keep domain responsibilities focused.
 *
 * Architecture:
 *   PromptLoader ──delegates──▶ yaml-prompt-loader (YAML ops)
 *                  ──handles──▶ Markdown ops (inline)
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import * as path from 'node:path';

import { validatePromptYaml, type PromptYaml } from './prompt-schema.js';

import type { PromptInjectionConfig, PromptInjectionRule } from '#shared/types/injection.js';
import type { PromptData } from './types.js';

import { type Logger, PromptArgument } from '#shared/types/index.js';
import { INJECTION_TYPES } from '#shared/types/injection.js';
import { loadYamlFileSync } from '#shared/utils/yaml/index.js';

// ============================================
// Shared Types (used by both YAML and Markdown loading)
// ============================================

/**
 * Loaded prompt file content (cached type)
 */
export interface LoadedPromptFile {
  systemMessage?: string;
  userMessageTemplate: string;
  isChain?: boolean;
  gateConfiguration?: {
    include?: string[];
    exclude?: string[];
    framework_gates?: boolean;
    inline_gate_definitions?: Array<{
      id?: string;
      name: string;
      type: 'validation' | 'guidance';
      scope: 'execution' | 'session' | 'chain' | 'step';
      description: string;
      guidance: string;
      pass_criteria: any[];
      expires_at?: number;
      source?: 'manual' | 'automatic' | 'analysis';
      context?: Record<string, any>;
    }>;
  };
  injection?: PromptInjectionConfig;
  chainSteps?: Array<{
    promptId: string;
    stepName: string;
    /** Stable node identity (P3 Tier 1) — mirrors `ChainStepSchema.id`. */
    id?: string;
    inputMapping?: Record<string, string>;
    outputMapping?: Record<string, string>;
    retries?: number;
    subagentModel?: 'heavy' | 'standard' | 'fast';
    agentType?: string;
    /** Per-step framework override — mirrors `ChainStepSchema.framework`. */
    framework?: string;
    /** Accepted, not yet consumed — mirrors `ChainStepSchema.inlineGateIds`. */
    inlineGateIds?: string[];
  }>;
}

export type InlineGateDefinition = NonNullable<
  NonNullable<LoadedPromptFile['gateConfiguration']>['inline_gate_definitions']
>[number];
export type InlineGateDefinitions = InlineGateDefinition[];

// ============================================
// Context for stateful YAML operations
// ============================================

/**
 * Shared context for YAML loading operations that need cache/stats access.
 * Passed by reference from PromptLoader so mutations are shared.
 */
export interface YamlLoadContext {
  readonly logger: Logger;
  readonly cache: Map<string, LoadedPromptFile>;
  readonly stats: { cacheHits: number; cacheMisses: number; loadErrors: number };
  readonly enableCache: boolean;
  readonly debug: boolean;
}

// ============================================
// Pure Functions (no state dependencies)
// ============================================

/** Where a dropped inline gate definition came from, for the warning message. */
export interface InlineGateSource {
  readonly logger?: Logger | undefined;
  /** Prompt the definitions were declared in. Named in the warning so it can be found. */
  readonly promptId?: string | undefined;
}

const INLINE_GATE_SCOPES = ['execution', 'session', 'chain', 'step'] as const;
const INLINE_GATE_TYPES = ['validation', 'guidance'] as const;

/**
 * Fields that disqualify a definition, named so a warning can report them.
 *
 * Returns every problem rather than the first: an author fixing one field at a time from a
 * warning that stops at the first failure needs as many load cycles as they have mistakes.
 *
 * Extracted from the loop as a pure function for two reasons — the loop needs the field names to
 * report, and it measured cyclomatic 23 against a limit of 10 with the checks inlined.
 */
function findInlineGateFieldProblems(definition: Record<string, unknown>): string[] {
  const problems: string[] = [];

  if (typeof definition['name'] !== 'string') {
    problems.push('name (must be a string)');
  }
  if (!INLINE_GATE_TYPES.includes(definition['type'] as (typeof INLINE_GATE_TYPES)[number])) {
    problems.push(`type (must be one of: ${INLINE_GATE_TYPES.join(', ')})`);
  }
  if (!INLINE_GATE_SCOPES.includes(definition['scope'] as (typeof INLINE_GATE_SCOPES)[number])) {
    problems.push(`scope (must be one of: ${INLINE_GATE_SCOPES.join(', ')})`);
  }
  if (typeof definition['description'] !== 'string') {
    problems.push('description (must be a string)');
  }
  if (typeof definition['guidance'] !== 'string') {
    problems.push('guidance (must be a string)');
  }

  return problems;
}

/**
 * Log one dropped inline gate definition.
 *
 * Silent when no logger is supplied, which keeps `normalizeInlineGateDefinitions` usable as a pure
 * function from call sites that have no logger — the markdown parser being one. Those call sites
 * lose the warning, not correctness.
 */
function warnInlineGateDropped(
  origin: InlineGateSource,
  gateLabel: string,
  problems: readonly string[]
): void {
  origin.logger?.warn(
    `[PromptLoader] Dropped inline gate definition '${gateLabel}'` +
      `${origin.promptId === undefined ? '' : ` in prompt '${origin.promptId}'`}` +
      `: ${problems.join('; ')}. The gate will not load.`
  );
}

/**
 * Assemble a validated definition into its typed shape.
 *
 * Assumes `findInlineGateFieldProblems` already returned empty for this object, which is what
 * licenses the casts on the five required fields. Split from the loop so validation, reporting,
 * and assembly are each readable on their own — inlined, the loop measured cyclomatic 23.
 */
function buildInlineGateDefinition(definition: Record<string, unknown>): InlineGateDefinition {
  const inlineDefinition: InlineGateDefinition = {
    name: definition['name'] as string,
    type: definition['type'] as InlineGateDefinition['type'],
    scope: definition['scope'] as InlineGateDefinition['scope'],
    description: definition['description'] as string,
    guidance: definition['guidance'] as string,
    pass_criteria: Array.isArray(definition['pass_criteria']) ? definition['pass_criteria'] : [],
  };

  const id = definition['id'];
  if (typeof id === 'string') {
    inlineDefinition.id = id;
  }

  const expiresAt = definition['expires_at'];
  if (typeof expiresAt === 'number') {
    inlineDefinition.expires_at = expiresAt;
  }

  const source = definition['source'];
  if (source === 'manual' || source === 'automatic' || source === 'analysis') {
    inlineDefinition.source = source;
  }

  const context = definition['context'];
  if (context !== null && context !== undefined && typeof context === 'object') {
    inlineDefinition.context = context as Record<string, unknown>;
  }

  return inlineDefinition;
}

/** Best-effort label for a definition that failed validation — its own name may be the problem. */
function describeInlineGate(definition: Record<string, unknown>, index: number): string {
  const id = definition['id'];
  if (typeof id === 'string' && id.length > 0) {
    return id;
  }
  const name = definition['name'];
  if (typeof name === 'string' && name.length > 0) {
    return name;
  }
  return `#${index} (unnamed)`;
}

/**
 * Normalize raw inline gate definitions into typed array.
 * Shared between YAML and Markdown loading paths.
 *
 * Malformed definitions are dropped rather than failing the load, so a bad block degrades to the
 * prompt loading without that gate instead of taking the prompt out of service. Each drop now
 * logs a warning naming the prompt, the gate, and the offending fields — release N of ADR 0001's
 * warn-then-arm migration, whose purpose is that an operator can see, one release before these
 * definitions begin to execute, which of their workspace prompts would newly arm a gate.
 */
export function normalizeInlineGateDefinitions(
  definitions: unknown,
  // Named `origin` rather than `source`: the loop below reads a `source` field off each
  // definition, and shadowing it silently would be easy to misread later.
  origin: InlineGateSource = {}
): InlineGateDefinitions | undefined {
  if (!Array.isArray(definitions)) {
    return undefined;
  }

  const normalized: InlineGateDefinitions = [];

  for (const [index, rawDefinition] of definitions.entries()) {
    if (
      rawDefinition === null ||
      rawDefinition === undefined ||
      typeof rawDefinition !== 'object'
    ) {
      warnInlineGateDropped(origin, `#${index}`, ['definition (must be an object)']);
      continue;
    }

    const definition = rawDefinition as Record<string, unknown>;

    const problems = findInlineGateFieldProblems(definition);
    if (problems.length > 0) {
      warnInlineGateDropped(origin, describeInlineGate(definition, index), problems);
      continue;
    }

    normalized.push(buildInlineGateDefinition(definition));
  }

  return normalized.length > 0 ? normalized : undefined;
}

/**
 * Discover YAML-based prompts in a category directory.
 *
 * Supports two patterns:
 * 1. **Directory pattern** (complex prompts): `{category}/{prompt_id}/prompt.yaml`
 *    - Supports external file references (user-message.md, system-message.md)
 *    - Best for prompts with long templates or multiple components
 *
 * 2. **File pattern** (simple prompts): `{category}/{prompt_id}.yaml`
 *    - All content inline in a single YAML file
 *    - Best for simple prompts with short templates
 *
 * 3. **Nested pattern** (chain sub-folders): `{category}/{folder}/{prompt_id}.yaml`
 *    - Organize related prompts (e.g., chain steps) in sub-folders
 *    - IDs include folder prefix: "folder/prompt_id"
 *
 * @param categoryDir - Path to the category directory
 * @param prefix - Optional prefix for nested prompt IDs (used in recursion)
 * @returns Array of prompt paths (directories take precedence over files with same ID)
 */
export function discoverYamlPrompts(categoryDir: string, prefix: string = ''): string[] {
  if (!existsSync(categoryDir)) {
    return [];
  }

  const entries = readdirSync(categoryDir, { withFileTypes: true });
  const discoveries: Map<string, { path: string; format: 'directory' | 'file' }> = new Map();
  const nestedPaths: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;

    if (entry.isDirectory()) {
      // Directory pattern: {prompt_id}/prompt.yaml
      const promptYamlPath = path.join(categoryDir, entry.name, 'prompt.yaml');
      const nestedPrefix = prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name;

      if (existsSync(promptYamlPath)) {
        // Directory takes precedence over file with same ID
        discoveries.set(nestedPrefix, {
          path: path.join(categoryDir, entry.name),
          format: 'directory',
        });
      }

      // ALWAYS recurse into subdirectories (parent-child pattern)
      // This enables chain directories to contain both the parent prompt AND nested step prompts
      const nested = discoverYamlPrompts(path.join(categoryDir, entry.name), nestedPrefix);
      nestedPaths.push(...nested);
    } else if (
      entry.isFile() &&
      entry.name.endsWith('.yaml') &&
      entry.name !== 'prompts.yaml' &&
      entry.name !== 'category.yaml' &&
      entry.name !== 'prompt.yaml'
    ) {
      // File pattern: {prompt_id}.yaml (skip metadata and directory-indicator files)
      const baseName = entry.name.replace(/\.yaml$/, '');
      const id = prefix.length > 0 ? `${prefix}/${baseName}` : baseName;
      // Only add if no directory version exists
      if (!discoveries.has(id)) {
        discoveries.set(id, {
          path: path.join(categoryDir, entry.name),
          format: 'file',
        });
      }
    }
  }

  // Return paths (backward compatible - just paths, format handled in loadYamlPrompt)
  const directPaths = Array.from(discoveries.values()).map((d) => d.path);
  return [...directPaths, ...nestedPaths];
}

/**
 * Check if a directory contains YAML-format prompts.
 *
 * @param categoryDir - Path to the category directory
 * @returns true if any prompt.yaml files are found
 */
export function hasYamlPrompts(categoryDir: string): boolean {
  return discoverYamlPrompts(categoryDir).length > 0;
}

/**
 * Normalize YAML argument definitions to PromptArgument format.
 * Handles required defaults and validation object filtering.
 */
function normalizeArguments(args: PromptYaml['arguments']): PromptArgument[] {
  if (!args) return [];
  return args.map((arg) => {
    const normalized: PromptArgument = {
      name: arg.name,
      required: arg.required ?? false,
    };
    if (arg.description !== undefined) normalized.description = arg.description;
    if (arg.type !== undefined) normalized.type = arg.type;
    if (arg.defaultValue !== undefined) normalized.defaultValue = arg.defaultValue;
    if (arg.validation) {
      const validation: NonNullable<PromptArgument['validation']> = {};
      if (arg.validation.pattern !== undefined) validation.pattern = arg.validation.pattern;
      if (arg.validation.minLength !== undefined) validation.minLength = arg.validation.minLength;
      if (arg.validation.maxLength !== undefined) validation.maxLength = arg.validation.maxLength;
      if (arg.validation.allowedValues !== undefined) {
        validation.allowedValues = arg.validation.allowedValues;
      }
      if (Object.keys(validation).length > 0) normalized.validation = validation;
    }
    return normalized;
  });
}

/**
 * Normalize YAML chain step definitions.
 * Shared between yamlToPromptData (PromptData path) and loadYamlPrompt (LoadedPromptFile path).
 */
function normalizeChainSteps(
  steps: PromptYaml['chainSteps']
): NonNullable<PromptData['chainSteps']> | undefined {
  if (!steps) return undefined;
  return steps.map((step) => {
    const normalized: NonNullable<PromptData['chainSteps']>[number] = {
      promptId: step.promptId,
      stepName: step.stepName,
    };
    if (step.id != null) normalized.id = step.id;
    if (step.inputMapping) normalized.inputMapping = step.inputMapping;
    if (step.outputMapping) normalized.outputMapping = step.outputMapping;
    if (typeof step.retries === 'number') normalized.retries = step.retries;
    if (step.subagentModel != null) normalized.subagentModel = step.subagentModel;
    if (step.agentType != null) normalized.agentType = step.agentType;
    if (step.framework != null) normalized.framework = step.framework;
    // NOTE: `inlineGateIds` is deliberately NOT carried. It is accepted by the schema to preserve
    // the six declarations already in the shipped corpus, but carrying it here without wiring the
    // gate pipeline would move a dead field one layer deeper rather than making it work. This
    // allowlist is the second of the two strippers described on `ChainStepSchema`; when
    // inlineGateIds is wired, it is added here and in `04-parsing-stage.ts` together.
    return normalized;
  });
}

/**
 * Normalize gate configuration from YAML format.
 * Shared between yamlToPromptData (PromptData path) and loadYamlPrompt (LoadedPromptFile path).
 */
function normalizeGateConfiguration(
  config: PromptYaml['gateConfiguration'],
  origin: InlineGateSource = {}
): PromptData['gateConfiguration'] | undefined {
  if (!config) return undefined;
  const normalized: NonNullable<PromptData['gateConfiguration']> = {};
  if (Array.isArray(config.include)) normalized.include = config.include;
  if (Array.isArray(config.exclude)) normalized.exclude = config.exclude;
  if (typeof config.framework_gates === 'boolean')
    normalized.framework_gates = config.framework_gates;
  const inlineGateDefs = normalizeInlineGateDefinitions(config.inline_gate_definitions, origin);
  if (inlineGateDefs) normalized.inline_gate_definitions = inlineGateDefs;
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/**
 * Normalize a prompt-level injection block from validated YAML.
 *
 * Shared between yamlToPromptData (PromptData path) and loadYamlPrompt (LoadedPromptFile path),
 * for the same reason `normalizeGateConfiguration` is: two call sites normalizing independently
 * is how the two paths drift.
 *
 * An empty or all-empty block normalizes to `undefined` rather than `{}`, so "declared nothing"
 * and "declared an empty block" resolve identically — the hierarchy treats a present-but-empty
 * tier as a match, which would otherwise shadow the chain tier with no rules to apply.
 */
function normalizeInjectionConfig(
  config: PromptYaml['injection']
): PromptInjectionConfig | undefined {
  if (config === undefined) return undefined;

  const normalized: PromptInjectionConfig = {};
  for (const injectionType of INJECTION_TYPES) {
    const rule = normalizeInjectionRule(config[injectionType]);
    if (rule !== undefined) normalized[injectionType] = rule;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/** Normalize one injection type's rule; returns undefined when no field was declared. */
function normalizeInjectionRule(
  rule: NonNullable<PromptYaml['injection']>['system-prompt']
): PromptInjectionRule | undefined {
  if (rule === undefined) return undefined;

  const normalized: PromptInjectionRule = {};
  if (typeof rule.enabled === 'boolean') normalized.enabled = rule.enabled;
  if (rule.frequency !== undefined) normalized.frequency = rule.frequency;
  if (rule.target !== undefined) normalized.target = rule.target;

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

/**
 * Attach a normalized injection block to loaded content, if the YAML declared one.
 *
 * The guard lives here rather than inline at the call site because `loadYamlPrompt` already
 * measures a cyclomatic complexity of 31 against a limit of 10; adding a branch to it would
 * make a function that is over budget slightly worse for no gain.
 */
function applyInjectionConfig(target: LoadedPromptFile, config: PromptYaml['injection']): void {
  const normalized = normalizeInjectionConfig(config);
  if (normalized !== undefined) {
    target.injection = normalized;
  }
}

/**
 * Convert YAML prompt definition to PromptData structure.
 *
 * @param yaml - Parsed and validated YAML data
 * @param filePath - Optional file path override (for single-file format)
 */
export function yamlToPromptData(yaml: PromptYaml, filePath?: string): PromptData {
  // Destructure YAML-only fields (not in PromptData) and fields needing transformation.
  // Everything else spreads through automatically — new simple fields flow without loader changes.
  const {
    systemMessageFile: _smf,
    userMessageTemplateFile: _umtf,
    systemMessage: _sm,
    userMessageTemplate: _umt,
    arguments: rawArgs,
    category,
    chainSteps: rawChainSteps,
    gateConfiguration: rawGateConfig,
    // Destructured so the raw YAML shape does not reach PromptData through the passthrough
    // spread below — it must arrive normalized or not at all.
    injection: rawInjection,
    ...passthroughFields
  } = yaml;

  return {
    ...passthroughFields,
    category: category ?? 'general',
    file: filePath ?? `${yaml.id}/prompt.yaml`,
    arguments: normalizeArguments(rawArgs),
    chainSteps: normalizeChainSteps(rawChainSteps),
    gateConfiguration: normalizeGateConfiguration(rawGateConfig),
    injection: normalizeInjectionConfig(rawInjection),
  };
}

// ============================================
// Stateful Functions (need YamlLoadContext)
// ============================================

/**
 * Load a prompt from YAML format (directory or single file).
 *
 * Supports three patterns:
 *
 * **Directory pattern** (for complex prompts with external files):
 * ```
 * {prompt_id}/
 * ├── prompt.yaml           # Main definition with file references
 * ├── user-message.md       # Template content (referenced via userMessageTemplateFile)
 * └── system-message.md     # Optional system prompt (referenced via systemMessageFile)
 * ```
 *
 * **File pattern** (for simple prompts with inline content):
 * ```
 * {prompt_id}.yaml          # Complete prompt with inline userMessageTemplate
 * ```
 *
 * **Nested pattern** (for chain sub-folders):
 * ```
 * {folder}/
 * ├── step1.yaml            # ID: "folder/step1"
 * └── step2.yaml            # ID: "folder/step2"
 * ```
 *
 * @param promptPath - Path to the prompt directory OR single YAML file
 * @param categoryRoot - Optional category root for calculating relative IDs (enables nested prompts)
 * @param ctx - Shared loading context (logger, cache, stats)
 * @returns Loaded prompt data with inlined content
 */
export function loadYamlPrompt(
  promptPath: string,
  categoryRoot: string | undefined,
  ctx: YamlLoadContext
): {
  promptData: PromptData;
  loadedContent: LoadedPromptFile;
} | null {
  // Determine format: directory or single file
  const isFile = promptPath.endsWith('.yaml');
  const yamlPath = isFile ? promptPath : path.join(promptPath, 'prompt.yaml');
  const baseDir = isFile ? path.dirname(promptPath) : promptPath;

  // Derive prompt ID from relative path if categoryRoot provided, otherwise use basename
  let promptId: string;
  if (categoryRoot !== undefined) {
    // For nested prompts: derive ID from relative path to category root
    const relativePath = path.relative(categoryRoot, promptPath);
    promptId = isFile ? relativePath.replace(/\.yaml$/, '') : relativePath;
    // Normalize path separators for consistent IDs across platforms
    promptId = promptId.split(path.sep).join('/');
  } else {
    // Backwards compatible: use basename only
    promptId = isFile ? path.basename(promptPath, '.yaml') : path.basename(promptPath);
  }

  // Check cache first
  // Compute relative file path for PromptData.file
  // - Directory format: {id}/prompt.yaml
  // - File format: {id}.yaml
  // For nested prompts, include the full relative path
  const relativeFilePath = isFile ? `${promptId}.yaml` : `${promptId}/prompt.yaml`;

  const cacheKey = yamlPath.toLowerCase();
  if (ctx.enableCache && ctx.cache.has(cacheKey)) {
    ctx.stats.cacheHits++;
    const cached = ctx.cache.get(cacheKey)!;
    // Reconstruct promptData from cached content - need to reload yaml for metadata
    const yamlData = loadYamlFileSync(yamlPath) as PromptYaml;
    const promptData = yamlToPromptData(yamlData, relativeFilePath);
    // Override ID with path-based ID for nested prompts (parent-child pattern)
    promptData.id = promptId;
    return {
      promptData,
      loadedContent: cached,
    };
  }
  ctx.stats.cacheMisses++;

  if (!existsSync(yamlPath)) {
    ctx.logger.warn(`[PromptLoader] YAML file not found: ${yamlPath}`);
    return null;
  }

  // Load and validate YAML
  let yamlData: PromptYaml;
  try {
    const rawData = loadYamlFileSync(yamlPath);
    // For validation, use the basename (last segment) of the promptId
    // This allows nested prompts to have IDs like "step_one" while being
    // discovered as "my_chain/step_one" based on their directory path
    const validationId = promptId.includes('/')
      ? (promptId.split('/').pop() ?? promptId)
      : promptId;
    const validation = validatePromptYaml(rawData, validationId);

    if (!validation.valid) {
      ctx.logger.error(
        `[PromptLoader] Invalid YAML in ${yamlPath}: ${validation.errors.join(', ')}`
      );
      ctx.stats.loadErrors++;
      return null;
    }

    if (validation.warnings.length > 0 && ctx.debug) {
      ctx.logger.warn(`[PromptLoader] Warnings for ${promptId}: ${validation.warnings.join(', ')}`);
    }

    yamlData = validation.data!;
  } catch (e) {
    ctx.logger.error(`[PromptLoader] Failed to load YAML from ${yamlPath}:`, e);
    ctx.stats.loadErrors++;
    return null;
  }

  // Inline file references (only applicable for directory format)
  let systemMessage: string | undefined;
  let userMessageTemplate: string;

  // System message (optional)
  if (yamlData.systemMessageFile) {
    const systemMessagePath = path.join(baseDir, yamlData.systemMessageFile);
    if (existsSync(systemMessagePath)) {
      systemMessage = readFileSync(systemMessagePath, 'utf-8');
    } else {
      ctx.logger.warn(`[PromptLoader] systemMessageFile not found: ${systemMessagePath}`);
    }
  } else if (yamlData.systemMessage) {
    systemMessage = yamlData.systemMessage;
  }

  // User message template (required unless chain)
  if (yamlData.userMessageTemplateFile) {
    const userMessagePath = path.join(baseDir, yamlData.userMessageTemplateFile);
    if (existsSync(userMessagePath)) {
      userMessageTemplate = readFileSync(userMessagePath, 'utf-8');
    } else {
      ctx.logger.error(`[PromptLoader] userMessageTemplateFile not found: ${userMessagePath}`);
      ctx.stats.loadErrors++;
      return null;
    }
  } else if (yamlData.userMessageTemplate) {
    userMessageTemplate = yamlData.userMessageTemplate;
  } else if (yamlData.chainSteps && yamlData.chainSteps.length > 0) {
    // Chain prompts may not have a user message template
    userMessageTemplate = '';
  } else if (systemMessage !== undefined && systemMessage !== '') {
    // System-only prompts (guidance, overlays) don't require user message
    userMessageTemplate = '';
    ctx.logger.debug(`[PromptLoader] System-only prompt (no user message template): ${yamlPath}`);
  } else {
    ctx.logger.error(
      `[PromptLoader] Prompt requires userMessageTemplate, userMessageTemplateFile, chainSteps, or systemMessage: ${yamlPath}`
    );
    ctx.stats.loadErrors++;
    return null;
  }

  const loadedContent: LoadedPromptFile = {
    userMessageTemplate,
  };

  if (systemMessage !== undefined) {
    loadedContent.systemMessage = systemMessage;
  }

  // The logger is attached HERE and nowhere else on this path. `yamlToPromptData` below
  // normalizes the same block a second time, so passing an origin to both would double every
  // warning — and an operator using these warnings to count affected prompts (the whole point of
  // ADR 0001's warn-then-arm release) would count each one twice. This site is also past the
  // cache-hit early return, so a definition warns once per load from disk rather than once per
  // prompt reuse.
  const normalizedGateConfig = normalizeGateConfiguration(yamlData.gateConfiguration, {
    logger: ctx.logger,
    promptId,
  });
  if (normalizedGateConfig) {
    // LoadedPromptFile.gateConfiguration has narrower inline_gate_definitions.type
    // ('validation' | 'guidance' vs string). Safe because normalizeInlineGateDefinitions
    // only emits these two values.
    loadedContent.gateConfiguration = normalizedGateConfig as LoadedPromptFile['gateConfiguration'];
  }

  applyInjectionConfig(loadedContent, yamlData.injection);

  const normalizedChainSteps = normalizeChainSteps(yamlData.chainSteps);
  if (normalizedChainSteps) {
    loadedContent.chainSteps = normalizedChainSteps;
    loadedContent.isChain = normalizedChainSteps.length > 0;
  }

  // Cache the result
  if (ctx.enableCache) {
    ctx.cache.set(cacheKey, loadedContent);
    if (ctx.debug) {
      ctx.logger.debug(
        `[PromptLoader] Cached YAML prompt: ${promptId} (cache size: ${ctx.cache.size})`
      );
    }
  }

  const promptData = yamlToPromptData(yamlData, relativeFilePath);
  // Override ID with path-based ID for nested prompts (parent-child pattern)
  promptData.id = promptId;

  return {
    promptData,
    loadedContent,
  };
}

/**
 * Load all YAML prompts from a category directory.
 *
 * Supports nested directories for organizing related prompts (e.g., chain steps).
 * Nested prompts get IDs based on their relative path from categoryDir.
 *
 * @param categoryDir - Path to the category directory
 * @param ctx - Shared loading context (logger, cache, stats)
 * @returns Array of loaded prompt data
 */
export function loadAllYamlPrompts(categoryDir: string, ctx: YamlLoadContext): PromptData[] {
  const promptDirs = discoverYamlPrompts(categoryDir);
  const prompts: PromptData[] = [];

  for (const promptDir of promptDirs) {
    // Pass categoryDir as root to enable relative ID calculation for nested prompts
    const result = loadYamlPrompt(promptDir, categoryDir, ctx);
    if (result) {
      prompts.push(result.promptData);
    }
  }

  if (ctx.debug && prompts.length > 0) {
    ctx.logger.info(`[PromptLoader] Loaded ${prompts.length} YAML prompts from ${categoryDir}`);
  }

  return prompts;
}
