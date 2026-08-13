// @lifecycle canonical - Validates prompt definitions and metadata.
/**
 * Field validation and error handling utilities
 */

import nunjucks from 'nunjucks';

import { promptResourceMetadata } from '../../../../metadata/definitions/prompt-resource.js';
import { ValidationContext } from '../core/types.js';

import type { PromptResourceActionId } from '../../../../metadata/definitions/prompt-resource.js';
import type { ToolDefinitionInput } from '../../core/types.js';

import { ResourceVerificationService } from '#modules/resources/services/index.js';
import { ValidationError } from '#shared/utils/index.js';

/**
 * Maps MCP parameter names (snake_case) to internal promptData field names (camelCase).
 * Used by updatePrompt() to apply only explicitly provided fields.
 */
export const UPDATE_FIELDS: Record<string, string> = {
  name: 'name',
  category: 'category',
  description: 'description',
  system_message: 'systemMessage',
  user_message_template: 'userMessageTemplate',
  arguments: 'arguments',
  chain_steps: 'chainSteps',
  // Moved here 2026-08-06 (row 1.6) from a hand-written special case in updatePrompt() whose only
  // reason to exist was folding the [Framework] `gates` parameter in as an alias. `gates` is no
  // longer accepted on a prompt update — it was accepted here but silently ignored on create, and
  // is declared `[Framework]` in tooling/contracts/resource-manager.json. With the alias gone the
  // field needs no special handling and clears like every other one.
  gate_configuration: 'gateConfiguration',
  // OQ-P7-8 (owner ruling 2026-08-13). The five fields `PRESERVED_PROMPT_YAML_KEYS` carries
  // forward are now also settable. These entries are what makes an explicitly supplied value
  // reach `promptData` — and `resolvePreservedPromptYamlFields` gives `promptData` precedence
  // over the on-disk value, so "set" and "preserve" are one write model with a fallback, not the
  // two competing ones the settable/preserved sets were originally kept disjoint to prevent.
  //
  // Row 1.5 deliberately added none of these (DEV-T1-4): with no tool parameter to key on, an
  // entry here was inert. The parameters now exist, so the entries are live.
  injection: 'injection',
  register_with_mcp: 'registerWithMcp',
  mcp_prompt_mode: 'mcpPromptMode',
  subagent_model: 'subagentModel',
  agent_type: 'agentType',
};

/**
 * The three preserved fields the canonical snapshot projects, and the two it cannot.
 *
 * A field belongs here only when the projection SOURCE holds its authored value. `ConvertedPrompt`
 * copies `subagentModel` and `agentType` verbatim from the prompt's own YAML (converter.ts:165-169,
 * both behind a `!= null` guard) and carries `injection` only when the file declared one
 * (converter.ts:176-177) — so for these three, present-on-the-source means authored.
 *
 * `registerWithMcp` and `mcpPromptMode` are deliberately absent. `PromptConverter` RESOLVES both
 * through prompt → category → global → hard-coded default (converter.ts:28-64) and assigns them
 * unconditionally, so they are ALWAYS present on a live prompt. Projecting them "if present" would
 * therefore materialise an inherited default into `promptData` on EVERY update, and `promptData`
 * outranks the writer's on-disk preservation — freezing the prompt against any later change to the
 * default it was inheriting, on every edit, without anyone asking. That is DEV-T1-3's hazard made
 * unconditional. They reach the YAML only when a caller sets them explicitly.
 */
export const SNAPSHOT_PRESERVED_FIELDS = ['injection', 'subagentModel', 'agentType'] as const;

/**
 * Project a live prompt onto the canonical snapshot shape `updatePrompt` records.
 *
 * `recordEditResult` decides whether to write a bridge row by structurally comparing the latest
 * recorded snapshot against the live pre-edit state. A live `ConvertedPrompt` carries
 * loader-resolved runtime keys the recorded shape never has (`registerWithMcp`, `mcpPromptMode`,
 * `promptDir`, `scriptTools`, …), and the comparison is JSON-based, so passing the raw converted
 * prompt makes every post-reload edit look out-of-band and bridge — doubling rows in steady
 * state. Both sides of every before/after comparison (bridge check, diffs, dry-run) must
 * therefore come from THIS one projection; `updatePrompt`'s produced `promptData` is this object
 * plus `tools` (which only ever arrives via `args.tools` — the live prompt carries loaded
 * `scriptTools`, not the raw id list, so the prior value is not reconstructable here and the key
 * is deliberately absent).
 *
 * The `SNAPSHOT_PRESERVED_FIELDS` tail (OQ-P7-8) is preserve-if-present, never defaulted: absent
 * on the source stays absent from the projection. Without it a recorded snapshot omits a field the
 * file still carries, and a rollback to that version restores a prompt the version never described
 * — it would land on whatever the on-disk preservation happened to be holding. With it, every
 * snapshot recorded from this point describes the whole authored state of those three fields.
 */
export function canonicalPromptSnapshot(
  id: string,
  source: object | undefined
): Record<string, unknown> {
  const from = source as Record<string, unknown> | undefined;
  const snapshot: Record<string, unknown> = {
    id,
    name: from?.['name'] ?? id,
    category: from?.['category'] ?? 'general',
    description: from?.['description'] ?? '',
    systemMessage: from?.['systemMessage'],
    userMessageTemplate: from?.['userMessageTemplate'] ?? '',
    arguments: from?.['arguments'] ?? [],
    chainSteps: from?.['chainSteps'] ?? [],
    gateConfiguration: from?.['gateConfiguration'],
  };

  for (const field of SNAPSHOT_PRESERVED_FIELDS) {
    const value = from?.[field];
    if (value !== undefined) {
      snapshot[field] = value;
    }
  }

  return snapshot;
}

/**
 * Action-specific parameter requirements and examples
 */
const ACTION_REQUIREMENTS: Record<string, { required: string[]; example: string }> = {
  create: {
    required: ['id', 'name', 'description', 'user_message_template'],
    example: `{action:'create', id:'my_prompt', name:'My Prompt', description:'What it does', user_message_template:'Process {{input}}'}`,
  },
  update: {
    required: ['id'],
    example: `{action:'update', id:'existing_prompt', description:'Updated description'}`,
  },
  delete: {
    required: ['id'],
    example: `{action:'delete', id:'prompt_to_remove'}`,
  },
  analyze_type: {
    required: ['id'],
    example: `{action:'analyze_type', id:'my_prompt'}`,
  },
  analyze_gates: {
    required: ['id'],
    example: `{action:'analyze_gates', id:'my_prompt'}`,
  },
};

const ACTION_METADATA_MAP = new Map<
  PromptResourceActionId,
  (typeof promptResourceMetadata.data.actions)[number]
>(
  promptResourceMetadata.data.actions.map((action) => [action.id as PromptResourceActionId, action])
);

/**
 * Validate required fields in operation arguments with contextual error messages
 */
export function validateRequiredFields(args: any, required: string[]): void {
  const missing: string[] = [];

  for (const field of required) {
    if (!args[field]) {
      missing.push(field);
    }
  }

  if (missing.length > 0) {
    const action = args.action || 'unknown';
    const actionInfo = ACTION_REQUIREMENTS[action];

    let errorMessage = `❌ Missing required fields for action '${action}': ${missing.join(', ')}\n\n`;

    if (actionInfo) {
      errorMessage += `📋 Required parameters: ${actionInfo.required.join(', ')}\n`;
      errorMessage += `📚 Example: ${actionInfo.example}\n\n`;
    }

    const descriptor = ACTION_METADATA_MAP.get(action as PromptResourceActionId);
    if (descriptor) {
      errorMessage += `⚙️ Action: ${descriptor.displayName} (${descriptor.status})\n`;
      if (descriptor.issues && descriptor.issues.length > 0) {
        errorMessage += descriptor.issues
          .map((issue) => `- ${issue.severity === 'high' ? '❗' : '⚠️'} ${issue.summary}`)
          .join('\n');
        errorMessage += '\n';
      }
      if (descriptor.requiredArgs.length > 0) {
        errorMessage += `🔑 Requires: ${descriptor.requiredArgs.join(', ')}\n`;
      }
      errorMessage += '\n';
    }

    errorMessage += `💡 TIP: Check the 'action' parameter description for complete requirements.\n`;
    errorMessage += `📖 See: docs/mcp-tool-usage-guide.md for detailed examples`;

    throw new ValidationError(errorMessage);
  }
}

/**
 * Validate operation arguments with context
 */
export function validateOperationArgs(
  args: any,
  operation: string,
  required: string[]
): ValidationContext {
  const providedFields = Object.keys(args);

  validateRequiredFields(args, required);

  return {
    operation,
    requiredFields: required,
    providedFields,
  };
}

/**
 * Normalize a prompt ID to canonical form: lowercase, hyphens/spaces → underscores.
 * All prompt IDs are stored in this form. Users may type hyphens (e.g., "my-prompt")
 * but the canonical ID uses underscores ("my_prompt"). This means "my-prompt" and
 * "my_prompt" refer to the same prompt — duplicates are not allowed.
 */
export function normalizePromptId(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Validate prompt ID format (operates on raw input, before normalization)
 */
export function validatePromptId(id: string): void {
  if (!id || typeof id !== 'string') {
    throw new ValidationError('Prompt ID must be a non-empty string');
  }

  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)) {
    throw new ValidationError(
      'Prompt ID must start with a letter and contain only alphanumeric characters, underscores, and hyphens'
    );
  }

  if (id.length > 100) {
    throw new ValidationError('Prompt ID must be 100 characters or less');
  }
}

/**
 * Validate category name format
 */
export function validateCategoryName(category: string): void {
  if (!category || typeof category !== 'string') {
    throw new ValidationError('Category must be a non-empty string');
  }

  if (category.length > 50) {
    throw new ValidationError('Category name must be 50 characters or less');
  }
}

/**
 * Validate execution mode
 */
/**
 * Validate prompt content structure
 */
export function validatePromptContent(content: any): void {
  if (!content) {
    throw new ValidationError('Prompt content cannot be empty');
  }

  if (typeof content !== 'object') {
    throw new ValidationError('Prompt content must be an object');
  }

  if (!content.user_message_template && !content.userMessageTemplate) {
    throw new ValidationError('Prompt must have a user message template');
  }
}

/**
 * Validate prompt arguments structure
 */
export function validatePromptArguments(args: any[]): void {
  if (!Array.isArray(args)) {
    throw new ValidationError('Arguments must be an array');
  }

  for (const arg of args) {
    if (!arg.name || typeof arg.name !== 'string') {
      throw new ValidationError('Each argument must have a name');
    }

    if (!arg.type || typeof arg.type !== 'string') {
      throw new ValidationError('Each argument must have a type');
    }

    if (!arg.description || typeof arg.description !== 'string') {
      throw new ValidationError('Each argument must have a description');
    }
  }
}

/**
 * Validate tool definitions for inline tool creation
 * Returns array of error messages (empty if valid)
 */
export function validateToolDefinitions(tools: ToolDefinitionInput[]): string[] {
  const errors: string[] = [];
  const seenIds = new Set<string>();

  if (!Array.isArray(tools)) {
    errors.push('Tools must be an array');
    return errors;
  }

  for (const tool of tools) {
    // Required fields
    if (!tool.id) {
      errors.push('Tool missing required field: id');
    }
    if (!tool.name) {
      errors.push('Tool missing required field: name');
    }
    if (!tool.script) {
      errors.push(`Tool '${tool.id || 'unknown'}' missing required field: script`);
    }

    // ID format validation (lowercase alphanumeric with underscores/hyphens)
    if (tool.id && !/^[a-z][a-z0-9_-]*$/.test(tool.id)) {
      errors.push(
        `Tool ID '${tool.id}' must start with lowercase letter and contain only lowercase alphanumeric, underscores, or hyphens`
      );
    }

    // Duplicate ID check
    if (tool.id) {
      if (seenIds.has(tool.id)) {
        errors.push(`Duplicate tool ID: '${tool.id}'`);
      }
      seenIds.add(tool.id);
    }

    // Valid runtime values
    const validRuntimes = ['python', 'node', 'shell', 'auto'];
    if (tool.runtime && !validRuntimes.includes(tool.runtime)) {
      errors.push(
        `Tool '${tool.id}' has invalid runtime: '${tool.runtime}'. Valid: ${validRuntimes.join(', ')}`
      );
    }

    // Valid trigger values
    const validTriggers = ['schema_match', 'explicit', 'always', 'never'];
    if (tool.trigger && !validTriggers.includes(tool.trigger)) {
      errors.push(
        `Tool '${tool.id}' has invalid trigger: '${tool.trigger}'. Valid: ${validTriggers.join(', ')}`
      );
    }

    // Timeout must be positive
    if (tool.timeout !== undefined && (typeof tool.timeout !== 'number' || tool.timeout <= 0)) {
      errors.push(`Tool '${tool.id}' has invalid timeout: must be a positive number`);
    }

    // Schema should be an object if provided
    if (tool.schema !== undefined && (typeof tool.schema !== 'object' || tool.schema === null)) {
      errors.push(`Tool '${tool.id}' has invalid schema: must be an object`);
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Chain step operations
// ---------------------------------------------------------------------------

export interface ChainStepOperationOptions {
  operation: 'add' | 'remove' | 'reorder' | 'replace';
  index?: number;
  stepData?: Record<string, unknown>;
  order?: number[];
}

/**
 * Apply a step-level operation to a chain steps array.
 * Pure function — returns a new array without mutating the input.
 */
export function applyChainStepOperation(
  currentSteps: unknown[],
  opts: ChainStepOperationOptions
): unknown[] {
  switch (opts.operation) {
    case 'add': {
      if (opts.stepData == null) {
        throw new ValidationError('chain_step_data required for add operation');
      }
      const steps = [...currentSteps];
      if (opts.index !== undefined) {
        if (opts.index < 0 || opts.index > steps.length) {
          throw new ValidationError(
            `chain_step_index ${opts.index} out of range [0, ${steps.length}]`
          );
        }
        steps.splice(opts.index, 0, opts.stepData);
      } else {
        steps.push(opts.stepData);
      }
      return steps;
    }
    case 'remove': {
      if (opts.index === undefined) {
        throw new ValidationError('chain_step_index required for remove operation');
      }
      if (opts.index < 0 || opts.index >= currentSteps.length) {
        throw new ValidationError(
          `chain_step_index ${opts.index} out of range [0, ${currentSteps.length - 1}]`
        );
      }
      const steps = [...currentSteps];
      steps.splice(opts.index, 1);
      return steps;
    }
    case 'reorder': {
      if (!Array.isArray(opts.order)) {
        throw new ValidationError('chain_step_order required for reorder operation');
      }
      if (opts.order.length !== currentSteps.length) {
        throw new ValidationError(
          `chain_step_order length (${opts.order.length}) must match step count (${currentSteps.length})`
        );
      }
      const sorted = [...opts.order].sort((a, b) => a - b);
      const expected = Array.from({ length: currentSteps.length }, (_, i) => i);
      if (sorted.some((v, i) => v !== expected[i])) {
        throw new ValidationError(
          'chain_step_order must be a permutation of indices [0, ..., n-1]'
        );
      }
      return opts.order.map((i) => currentSteps[i]);
    }
    case 'replace':
      return currentSteps;
    default:
      throw new ValidationError(`Unknown chain_step_operation: ${String(opts.operation)}`);
  }
}

// ---------------------------------------------------------------------------
// Chain step reference validation
// ---------------------------------------------------------------------------

export interface ChainStepReferenceValidation {
  valid: boolean;
  warnings: string[];
}

/**
 * Validate that chain step promptId references point to registered prompts.
 * Non-blocking — returns warnings, does not throw.
 * Skips nested references (containing '/') since those are sub-prompts.
 */
export function validateChainStepReferences(
  steps: unknown[],
  registeredIds: string[]
): ChainStepReferenceValidation {
  const warnings: string[] = [];
  const idSet = new Set(registeredIds);

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i] as Record<string, unknown> | null;
    const promptId = step?.['promptId'];
    if (typeof promptId === 'string' && promptId.length > 0) {
      if (!promptId.includes('/') && !idSet.has(promptId)) {
        warnings.push(`Step ${i + 1} references unknown promptId '${promptId}'`);
      }
    }
  }

  return { valid: warnings.length === 0, warnings };
}

// ---------------------------------------------------------------------------
// Produced-prompt validation (P7 row 3.5)
// ---------------------------------------------------------------------------

/** The three text bodies whose template syntax is checked before a write. */
const TEMPLATE_BODY_FIELDS = ['description', 'systemMessage', 'userMessageTemplate'] as const;

/**
 * The subset of `promptData` this validation reads. Deliberately not `PromptData` or
 * `ConvertedPrompt`: the check runs on the state an update PRODUCES, which is a plain object
 * assembled by the processor and not yet either type.
 */
export interface PromptWriteCandidate {
  id?: unknown;
  name?: unknown;
  category?: unknown;
  description?: unknown;
  systemMessage?: unknown;
  userMessageTemplate?: unknown;
  arguments?: unknown;
  chainSteps?: unknown;
  gateConfiguration?: unknown;
}

export interface PromptWriteDefect {
  /** Stable class of the defect, used to tell a NEW defect from a pre-existing one. */
  key: string;
  message: string;
}

export interface PromptWriteDiagnosis {
  /** Defects this edit introduces — the write must not proceed. */
  blocking: PromptWriteDefect[];
  /** Defects the prompt already had before the edit — reported, never blocking. */
  preExisting: PromptWriteDefect[];
}

/**
 * `{{ref:id}}` and `{{script:id ...}}` are resolved by the reference resolvers BEFORE Nunjucks
 * ever sees the template (`processTemplateWithRefs`), and neither is valid Nunjucks expression
 * syntax on its own. Measured 2026-08-12: 4 on-disk resource files carry them, and every one throws
 * under a bare parse. They are neutralised here so the syntax check reads the template the engine will
 * actually compile. Patterns mirror `prompt-reference-validator.ts` and `script-reference-resolver.ts`.
 */
const REFERENCE_PLACEHOLDER_PATTERNS: RegExp[] = [
  /\{\{ref:([a-zA-Z0-9_-]+)\}\}/g,
  /\{\{script:([a-zA-Z0-9_-]+)(?:\.([a-zA-Z0-9_]+))?((?:\s+[a-zA-Z_][a-zA-Z0-9_]*=(?:'[^']*'|"[^"]*"|\d+(?:\.\d+)?|true|false))*)\s*\}\}/g,
];

let syntaxEnvironment: nunjucks.Environment | undefined;
let verificationService: ResourceVerificationService | undefined;

/** Stateless service; one instance per process, matching `cli-shared/resource-validation.ts:13`. */
function getVerificationService(): ResourceVerificationService {
  verificationService ??= new ResourceVerificationService();
  return verificationService;
}

/**
 * A loader-less environment. `getNunjucksEnv()` (jsonUtils.ts:59) configures the DEFAULT tag
 * delimiters and registers no custom extensions, and only extensions change how a template parses —
 * so this compiles identically to the runtime environment while avoiding `nunjucks.configure()`'s
 * global side effect and its filesystem path resolution inside a validator.
 */
function getSyntaxEnvironment(): nunjucks.Environment {
  syntaxEnvironment ??= new nunjucks.Environment(null, {
    autoescape: false,
    throwOnUndefined: false,
  });
  return syntaxEnvironment;
}

/**
 * Compile-only syntax check.
 *
 * Eager COMPILE rather than a render with empty arguments: rendering evaluates the template, so
 * `{% for j in ci_jobs.split(',') %}` throws on an undefined variable even though its syntax is
 * valid — measured against `workflow/github_repo_setup`. Compiling separates "this text is not a
 * template" from "this template needs its arguments", and only the first is a write-blocking
 * defect.
 */
function findTemplateSyntaxError(text: string): string | undefined {
  let neutralised = text;
  for (const pattern of REFERENCE_PLACEHOLDER_PATTERNS) {
    neutralised = neutralised.replace(pattern, 'reference_placeholder');
  }

  try {
    // `eagerCompile: true` is what turns construction into a parse. `nunjucks.compile()` is the
    // same call with that flag typed away by `@types/nunjucks`, so the class is used directly.
    new nunjucks.Template(neutralised, getSyntaxEnvironment(), undefined, true);
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message.trim() : String(error);
  }
}

function collectPromptWriteDefects(candidate: PromptWriteCandidate): PromptWriteDefect[] {
  const defects: PromptWriteDefect[] = [];

  for (const field of TEMPLATE_BODY_FIELDS) {
    const value = candidate[field];
    if (typeof value !== 'string' || value.length === 0) continue;
    const syntaxError = findTemplateSyntaxError(value);
    if (syntaxError !== undefined) {
      defects.push({ key: `syntax:${field}`, message: `${field}: ${syntaxError}` });
    }
  }

  // `tools` is deliberately excluded from the projection: the writer holds tool DEFINITION
  // objects while `PromptYamlSchema` declares an id list (P7-F8), so including it would report a
  // shape mismatch that exists on every prompt and has nothing to do with the edit under test.
  //
  // Validation goes through `ResourceVerificationService`, not `validatePromptYaml` directly:
  // `.dependency-cruiser.cjs` `tool-layer-no-validator-value-imports` (severity: error) bars
  // `src/mcp/tools/` from value-importing `modules/prompts/prompt-schema`, and this is the same
  // service `file-operations.ts:183` verifies the WRITTEN file with — so the pre-write verdict and
  // the post-write verdict cannot diverge.
  const projection: Record<string, unknown> = {
    id: candidate.id,
    name: candidate.name,
    category: candidate.category,
    description: candidate.description,
    systemMessage: candidate.systemMessage,
    userMessageTemplate: candidate.userMessageTemplate,
    arguments: candidate.arguments,
    chainSteps: candidate.chainSteps,
    gateConfiguration: candidate.gateConfiguration,
  };
  for (const key of Object.keys(projection)) {
    if (projection[key] === undefined) delete projection[key];
  }

  const promptId = typeof candidate.id === 'string' ? candidate.id : 'prompt';
  const schemaResult = getVerificationService().validateDocument(
    'prompts',
    promptId,
    `${promptId}/prompt.yaml`,
    projection
  );
  if (!schemaResult.valid) {
    for (const issue of schemaResult.errors) {
      defects.push({ key: `schema:${issue.path}`, message: `${issue.path}: ${issue.message}` });
    }
  }

  return defects;
}

/**
 * Diagnose the state an update would write, relative to the state it replaces.
 *
 * Differential by design. Three on-disk prompts carry Handlebars-style `{{#if}}` / `{{{x}}}` text
 * that no Nunjucks parse accepts; a flat check would refuse every future edit to them, including
 * an edit that improves them. A defect is blocking only when the edit INTRODUCES it — the same
 * defect class present before the edit is reported and allowed through.
 */
export function diagnosePromptWrite(
  before: PromptWriteCandidate | null | undefined,
  after: PromptWriteCandidate
): PromptWriteDiagnosis {
  const afterDefects = collectPromptWriteDefects(after);
  if (afterDefects.length === 0) {
    return { blocking: [], preExisting: [] };
  }

  const beforeKeys = new Set(
    before != null ? collectPromptWriteDefects(before).map((defect) => defect.key) : []
  );

  const blocking: PromptWriteDefect[] = [];
  const preExisting: PromptWriteDefect[] = [];
  for (const defect of afterDefects) {
    if (beforeKeys.has(defect.key)) {
      preExisting.push(defect);
    } else {
      blocking.push(defect);
    }
  }

  return { blocking, preExisting };
}

/**
 * Sanitize user input for safe processing
 */
export function sanitizeInput(input: string): string {
  if (typeof input !== 'string') {
    return '';
  }

  // Remove potentially dangerous characters
  return input
    .replace(/[<>]/g, '') // Remove angle brackets
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, '') // Remove event handlers
    .trim();
}

/**
 * Validate filter syntax
 */
export function validateFilterSyntax(filter: string): void {
  if (!filter || typeof filter !== 'string') {
    return; // Empty filter is valid
  }

  // Check for balanced quotes
  const quotes = filter.match(/"/g);
  if (quotes && quotes.length % 2 !== 0) {
    throw new ValidationError('Unbalanced quotes in filter expression');
  }

  // Validate filter patterns
  const validFilterPatterns = [
    /^type:\w+$/,
    /^category:[a-z-_]+$/,
    /^intent:[a-z-_\s]+$/i,
    /^confidence:[<>]?\d+(?:-\d+)?$/,
    /^execution:(required|optional)$/,
    /^gates:(yes|no)$/,
  ];

  const filterParts = filter.split(/\s+/);
  for (const part of filterParts) {
    if (part.includes(':')) {
      const isValid = validFilterPatterns.some((pattern) => pattern.test(part));
      if (!isValid) {
        throw new ValidationError(`Invalid filter syntax: ${part}`);
      }
    }
  }
}
