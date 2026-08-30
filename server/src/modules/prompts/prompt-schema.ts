// @lifecycle canonical - Single source of truth for prompt YAML validation
/**
 * Prompt Schema (Zod)
 *
 * Defines canonical schemas for prompt definitions (YAML directory format).
 * Used by:
 * - PromptLoader (runtime validation)
 * - PromptConverter (content validation)
 * - ResourceVerificationService (MCP tool validation)
 *
 * @see gate-schema.ts for the pattern this follows
 * @see framework-schema.ts for the pattern this follows
 */

import { z } from 'zod/v4';

import { linearize } from '#modules/workflow-ir/linearizer.js';
import {
  EXPORTER_ONLY_STEP_KEYS,
  workflowBudgetSchema,
  workflowEdgeSchema,
  workflowNodeIdSchema,
  workflowNodeSchema,
} from '#modules/workflow-ir/node-schema.js';
import { mintNodeIds } from '#shared/utils/node-order.js';

// ============================================
// Argument Validation Schema
// ============================================

/**
 * Schema for argument validation rules.
 */
export const ArgumentValidationSchema = z
  .object({
    /** Regex pattern for string validation */
    pattern: z.string().optional(),
    /** Minimum length for strings */
    minLength: z.number().int().nonnegative().optional(),
    /** Maximum length for strings */
    maxLength: z.number().int().positive().optional(),
    /**
     * @deprecated Enforcement was dropped in v3.0.0 — the LLM handles semantic variation
     * (e.g. "urgent" vs "high") better than a strict enum. The field itself was not removed:
     * it is still accepted here and carried through yaml-prompt-loader.ts, but
     * argument-schema.ts deliberately never applies it.
     */
    allowedValues: z.array(z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .partial();

export type ArgumentValidationYaml = z.infer<typeof ArgumentValidationSchema>;

// ============================================
// Prompt Argument Schema
// ============================================

/**
 * Schema for prompt argument definitions.
 */
export const PromptArgumentSchema = z.object({
  /** Name of the argument (required) */
  name: z.string().min(1, 'Argument name is required'),
  /** Description of the argument */
  description: z.string().optional(),
  /** Whether this argument is required (default: false) */
  required: z.boolean().default(false),
  /** Type of the argument value */
  type: z.enum(['string', 'number', 'boolean', 'object', 'array']).optional(),
  /** Default value if not provided */
  defaultValue: z.any().optional(),
  /** Validation rules for the argument */
  validation: ArgumentValidationSchema.optional(),
});

export type PromptArgumentYaml = z.infer<typeof PromptArgumentSchema>;

/** Composer-specific presentation metadata consumed by interactive clients. */
export const PromptComposerMetadataSchema = z
  .object({
    /** Declared text argument that receives the current composer draft. */
    inputArgument: z.string().min(1, 'Composer input argument is required'),
  })
  .strict();

export type PromptComposerMetadataYaml = z.infer<typeof PromptComposerMetadataSchema>;

function validateComposerInputArgument(
  data: {
    arguments: PromptArgumentYaml[];
    composer?: PromptComposerMetadataYaml;
  },
  ctx: z.RefinementCtx
): void {
  const inputArgument = data.composer?.inputArgument;
  if (inputArgument === undefined) return;

  const argument = data.arguments.find((candidate) => candidate.name === inputArgument);
  if (argument === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['composer', 'inputArgument'],
      message: `Composer inputArgument '${inputArgument}' must name a declared argument`,
    });
    return;
  }

  if (argument.type !== undefined && argument.type !== 'string') {
    ctx.addIssue({
      code: 'custom',
      path: ['composer', 'inputArgument'],
      message: `Composer inputArgument '${inputArgument}' must reference a string argument`,
    });
  }
}

// ============================================
// Chain Step Schema
// ============================================

/**
 * Schema for chain step definitions — DERIVED from the one step vocabulary (Tier A).
 *
 * `workflowNodeSchema` (`modules/workflow-ir/node-schema.ts`) is the single Zod source for a
 * step. A YAML chain step is that node with the two identity fields swapped in optionality, and
 * nothing else:
 *
 *   - `id` optional here, required on a node — a YAML step has `stepName` for `mintNodeIds` to
 *     slug from at parse time; a submitted node has nothing, and edges address it by id.
 *   - `stepName` required here, optional on a node — the mirror of the same fact.
 *
 * Deriving rather than restating is the whole of row A.1: before it, the two objects agreed by
 * hand and no gate noticed when one gained a field. Adding a field to the node schema now reaches
 * YAML automatically; `tests/unit/workflow-ir/chain-node-parity.test.ts` fails on any other
 * divergence, in either direction.
 *
 * STILL STRICT, and still breaking in the way the original note priced: an unknown key fails the
 * whole prompt's load (`yaml-prompt-loader.ts` returns null on `valid: false`). The one YAML key
 * that used to be declared here and is now absent is `delegation` — an exporter-only marker with
 * no runtime reader, stripped before validation by {@link stripExporterOnlyStepKeys} rather than
 * declared, so the skills-sync exporter keeps reading it off raw YAML and the node vocabulary
 * does not gain a field that `-->` and the IR could never export. See
 * {@link EXPORTER_ONLY_STEP_KEYS}.
 */
export const ChainStepSchema = workflowNodeSchema
  .omit({ id: true, stepName: true })
  .extend({
    /**
     * Stable node identity for this step (kebab-case). Optional — when omitted, a node id is
     * minted at parse time from a slug of `stepName`. Explicit ids must be unique within the
     * chain (enforced in `validatePromptYaml` / `validatePromptSchema`).
     */
    id: workflowNodeIdSchema.optional(),
    /** Name/identifier of this step. Required in YAML: it is the id-minting fallback. */
    stepName: z.string().min(1, 'Step name is required'),
  })
  .strict();

export type ChainStepYaml = z.infer<typeof ChainStepSchema>;

/**
 * Remove exporter-only chain-step keys before validation.
 *
 * `ChainStepSchema` is `.strict()`, so a key it does not declare fails the whole prompt's load.
 * `delegation` has one real reader — the skills-sync exporter, off raw YAML — and no runtime
 * reader at all, so it may neither be declared (it would enter the node vocabulary, where `-->`
 * and a submitted IR could never export it) nor rejected (YAML the exporter honours would stop
 * loading). Stripping is the third option and the only one that leaves both readers correct.
 *
 * Returns a SHALLOW COPY down to the affected step objects and never mutates its input: the
 * exporter reads the file through its own `yaml.load`, but `resource-verification-service` hands
 * this function objects it also keeps, and a validator that edits its argument is a validator
 * with a side effect.
 */
export function stripExporterOnlyStepKeys(data: unknown): unknown {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return data;
  const record = data as Record<string, unknown>;
  const steps = record['chainSteps'];
  if (!Array.isArray(steps)) return data;

  let stripped = false;
  const cleaned: unknown[] = (steps as unknown[]).map((step): unknown => {
    if (typeof step !== 'object' || step === null || Array.isArray(step)) return step;
    const stepRecord = step as Record<string, unknown>;
    if (!EXPORTER_ONLY_STEP_KEYS.some((key) => key in stepRecord)) return step;
    stripped = true;
    const copy = { ...stepRecord };
    for (const key of EXPORTER_ONLY_STEP_KEYS) delete copy[key];
    return copy;
  });

  return stripped ? { ...record, chainSteps: cleaned } : data;
}

// ============================================
// Gate Configuration Schema
// ============================================

/**
 * Schema for prompt gate configuration.
 */
export const PromptGateConfigurationSchema = z
  .object({
    /** Gate IDs to include */
    include: z.array(z.string()).optional(),
    /** Gate IDs to exclude */
    exclude: z.array(z.string()).optional(),
    /** Whether to include framework gates (default: true) */
    framework_gates: z.boolean().optional(),
    /** Inline gate definitions */
    inline_gate_definitions: z
      .array(
        z
          .object({
            id: z.string().optional(),
            name: z.string().min(1),
            /** Gate type - 'validation' or 'guidance' standard, but allows custom types */
            type: z.string().min(1),
            scope: z.enum(['execution', 'session', 'chain', 'step']).optional(),
            description: z.string().optional(),
            guidance: z.string().optional(),
            pass_criteria: z.array(z.any()).optional(),
            expires_at: z.number().optional(),
            source: z.enum(['manual', 'automatic', 'analysis']).optional(),
            context: z.record(z.string(), z.any()).optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .partial();

export type PromptGateConfigurationYaml = z.infer<typeof PromptGateConfigurationSchema>;

// ============================================
// Injection Configuration Schema
// ============================================

/**
 * Schema for one injection type's rule inside a prompt-level injection block.
 *
 * Deliberately narrower than the category/chain/step rule shape: no `conditions`, because
 * every condition case describes a position within a chain rather than a property of the
 * prompt. Every field here is read by the hierarchy resolver — nothing is accepted that
 * cannot take effect.
 */
export const PromptInjectionRuleSchema = z
  .object({
    /** Whether this injection type is enabled for this prompt */
    enabled: z.boolean().optional(),
    /** How often to inject during chain execution */
    frequency: z
      .object({
        mode: z.enum(['every', 'first-only', 'never']),
        interval: z.number().int().positive().optional(),
      })
      .optional(),
    /** Which execution contexts receive the injection */
    target: z.enum(['steps', 'gates', 'both']).optional(),
  })
  .strict();

/**
 * Schema for a prompt's own injection configuration.
 *
 * Resolved between step and chain config: a prompt's declaration about itself outranks the
 * chain or category it runs inside. Setting `system-prompt.enabled: false` also withholds
 * gates that score framework adherence — scoring a framework that was never injected
 * is incoherent (ADR 0001).
 */
export const PromptInjectionConfigSchema = z
  .object({
    /** Framework system prompt injection */
    'system-prompt': PromptInjectionRuleSchema.optional(),
    /** Quality gate guidance injection */
    'gate-guidance': PromptInjectionRuleSchema.optional(),
    /** Response style guidance injection */
    'style-guidance': PromptInjectionRuleSchema.optional(),
  })
  .strict();

export type PromptInjectionConfigYaml = z.infer<typeof PromptInjectionConfigSchema>;

// ============================================
// Category Schema
// ============================================

/**
 * Schema for category definitions.
 */
export const CategorySchema = z.object({
  /** Unique identifier for the category */
  id: z.string().min(1, 'Category ID is required'),
  /** Display name for the category */
  name: z.string().min(1, 'Category name is required'),
  /** Description of the category */
  description: z.string().min(1, 'Category description is required'),
  /** MCP registration default for prompts in this category */
  registerWithMcp: z.boolean().optional(),
  /** Native MCP prompt behavior default for prompts in this category: 'expand' or 'launch' */
  mcpPromptMode: z.enum(['expand', 'launch']).optional(),
});

export type CategoryYaml = z.infer<typeof CategorySchema>;

// ============================================
// Main Prompt Data Schema
// ============================================

/**
 * Schema for prompt definitions (JSON-compatible, used by PromptDataSchema consumers).
 *
 * @example
 * ```json
 * {
 *   "id": "code_review",
 *   "name": "Code Review",
 *   "category": "development",
 *   "description": "Reviews code for quality and best practices",
 *   "file": "code_review.md",
 *   "arguments": [
 *     { "name": "code", "type": "string", "required": true }
 *   ]
 * }
 * ```
 */
export const PromptDataSchema = z
  .object({
    // Required core fields
    /** Unique identifier for the prompt */
    id: z.string().min(1, 'Prompt ID is required'),
    /** Display name for the prompt */
    name: z.string().min(1, 'Prompt name is required'),
    /** Category this prompt belongs to */
    category: z.string().min(1, 'Prompt category is required'),
    /** Description of the prompt */
    description: z.string().min(1, 'Prompt description is required'),
    /** Path to the prompt markdown file */
    file: z.string().min(1, 'Prompt file path is required'),

    // Optional fields
    /** Arguments accepted by this prompt */
    arguments: z.array(PromptArgumentSchema).default([]),
    /** Optional mapping from an interactive composer draft to one declared text argument. */
    composer: PromptComposerMetadataSchema.optional(),
    /** Gate configuration for validation */
    gateConfiguration: PromptGateConfigurationSchema.optional(),
    /** Prompt-level injection control (resolved between step and chain config) */
    injection: PromptInjectionConfigSchema.optional(),
    /** Chain steps for chain-type prompts */
    chainSteps: z.array(ChainStepSchema).optional(),
    /**
     * Dependency edges between chain steps, addressed by minted node id (Tier A).
     *
     * Same vocabulary a submitted Workflow IR uses, and the same meaning: NOT control flow, but
     * ordering constraints the loader linearizes into `chainSteps` order. Absent edges leave the
     * authored order untouched, which is what every bundled chain relies on.
     */
    edges: z.array(workflowEdgeSchema).optional(),
    /**
     * Run-level budget for this chain, same shape a submitted Workflow IR declares (Tier A).
     *
     * A declared structural cap may only NARROW the server default; the schema's `.max()` bounds
     * enforce that here exactly as they do on the IR path.
     */
    budget: workflowBudgetSchema.optional(),
    /** Whether to register this prompt with MCP */
    registerWithMcp: z.boolean().optional(),
    /** Native MCP prompt behavior: 'expand' (plain text) or 'launch' (route through prompt_engine) */
    mcpPromptMode: z.enum(['expand', 'launch']).optional(),
    /** Script tool IDs declared by this prompt (references tools/{id}/ directories) */
    tools: z.array(z.string().min(1)).optional(),
    /** Client-agnostic capability hint for delegation model selection */
    subagentModel: z.enum(['heavy', 'standard', 'fast']).optional(),
    /** Default host agent for this prompt's delegated steps (a step may override it) */
    agentType: z.string().min(1).optional(),
  })
  .passthrough()
  .superRefine(validateComposerInputArgument); // Allow additional fields for extensibility

export type PromptDataYaml = z.infer<typeof PromptDataSchema>;

// PromptsFileSchema and PromptsConfigSchema removed — JSON prompts.json format deprecated.
// Use PromptYamlSchema for YAML directory-based prompt validation.

// ============================================
// YAML Directory Format Schema (Phase 2)
// ============================================

/**
 * Schema for prompt.yaml files in directory-based format.
 *
 * This format mirrors the gates/frameworks pattern:
 * - Each prompt gets its own directory: `prompts/{category}/{id}/`
 * - Main definition in `prompt.yaml`
 * - Optional referenced files for system message and user template
 *
 * @example
 * ```yaml
 * # prompts/analysis/progressive_research/prompt.yaml
 * id: progressive_research
 * name: Progressive Research Assistant
 * category: analysis
 * description: "A step-by-step research assistant..."
 *
 * # File references (inlined by loader)
 * systemMessageFile: system-message.md
 * userMessageTemplateFile: user-message.md
 *
 * # OR inline content directly
 * # systemMessage: "You are a research assistant..."
 * # userMessageTemplate: "Research the following: {{topic}}"
 *
 * arguments:
 *   - name: notes
 *     type: string
 *     description: "The initial notes to research"
 *     required: false
 *
 * gateConfiguration:
 *   include: [research-quality]
 *   framework_gates: true
 *
 * registerWithMcp: true
 * ```
 */
export const PromptYamlSchema = z
  .object({
    // Required core fields
    /** Unique identifier for the prompt (must match directory name). Convention: lowercase with underscores. */
    id: z
      .string()
      .min(1, 'Prompt ID is required')
      .regex(
        /^[a-zA-Z][a-zA-Z0-9_-]*$/,
        'Prompt ID must start with a letter and contain only alphanumeric characters, underscores, or hyphens'
      ),
    /** Human-readable name */
    name: z.string().min(1, 'Prompt name is required'),
    /** Category this prompt belongs to (auto-derived from directory if omitted) */
    category: z.string().optional(),
    /** Description of what this prompt does */
    description: z.string().min(1, 'Prompt description is required'),

    // File references (inlined by loader - mutually exclusive with inline content)
    /** Reference to system-message.md file (inlined into systemMessage by loader) */
    systemMessageFile: z.string().optional(),
    /** Reference to user-message.md file (inlined into userMessageTemplate by loader) */
    userMessageTemplateFile: z.string().optional(),

    // Inline content (alternative to file references)
    /** System message content (either directly specified or inlined from systemMessageFile) */
    systemMessage: z.string().optional(),
    /** User message template (either directly specified or inlined from userMessageTemplateFile) */
    userMessageTemplate: z.string().optional(),

    // Arguments
    /** Arguments accepted by this prompt */
    arguments: z.array(PromptArgumentSchema).default([]),
    /** Optional mapping from an interactive composer draft to one declared text argument. */
    composer: PromptComposerMetadataSchema.optional(),

    // Gate configuration
    /** Gate configuration for validation */
    gateConfiguration: PromptGateConfigurationSchema.optional(),

    // Injection control
    /** Prompt-level injection control (resolved between step and chain config) */
    injection: PromptInjectionConfigSchema.optional(),

    // Chain steps (for chain-type prompts)
    /** Chain steps for multi-step execution */
    chainSteps: z.array(ChainStepSchema).optional(),
    /**
     * Dependency edges between chain steps, addressed by minted node id (Tier A).
     *
     * Same vocabulary a submitted Workflow IR uses, and the same meaning: NOT control flow, but
     * ordering constraints the loader linearizes into `chainSteps` order. Absent edges leave the
     * authored order untouched, which is what every bundled chain relies on.
     */
    edges: z.array(workflowEdgeSchema).optional(),
    /**
     * Run-level budget for this chain, same shape a submitted Workflow IR declares (Tier A).
     *
     * A declared structural cap may only NARROW the server default; the schema's `.max()` bounds
     * enforce that here exactly as they do on the IR path.
     */
    budget: workflowBudgetSchema.optional(),

    // MCP registration
    /** Whether to register this prompt with MCP (default: true) */
    registerWithMcp: z.boolean().optional(),
    /** Native MCP prompt behavior: 'expand' (plain text) or 'launch' (route through prompt_engine). Default: 'expand' */
    mcpPromptMode: z.enum(['expand', 'launch']).optional(),

    // Script tools
    /** Script tool IDs declared by this prompt (references tools/{id}/ directories) */
    tools: z.array(z.string().min(1)).optional(),

    // Delegation
    /** Client-agnostic capability hint for delegation model selection */
    subagentModel: z.enum(['heavy', 'standard', 'fast']).optional(),
    /** Default host agent for this prompt's delegated steps (a step may override it) */
    agentType: z.string().min(1).optional(),
  })
  .passthrough() // Allow additional fields for extensibility
  .refine(
    (data) => {
      // Must have either userMessageTemplate/userMessageTemplateFile, chainSteps, or systemMessage
      const hasTemplate =
        (data.userMessageTemplate !== undefined && data.userMessageTemplate !== '') ||
        (data.userMessageTemplateFile !== undefined && data.userMessageTemplateFile !== '');
      const hasChainSteps = data.chainSteps !== undefined && data.chainSteps.length > 0;
      const hasSystemMessage =
        (data.systemMessage !== undefined && data.systemMessage !== '') ||
        (data.systemMessageFile !== undefined && data.systemMessageFile !== '');
      return hasTemplate || hasChainSteps || hasSystemMessage;
    },
    {
      message:
        'Prompt must have userMessageTemplate/userMessageTemplateFile, chainSteps, or systemMessage defined',
    }
  )
  .superRefine(validateComposerInputArgument);

export type PromptYaml = z.infer<typeof PromptYamlSchema>;

/**
 * Result of YAML prompt schema validation.
 */
export interface PromptYamlValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Validation errors (blocking issues) */
  errors: string[];
  /** Validation warnings (non-blocking issues) */
  warnings: string[];
  /** Parsed data if validation passed */
  data?: PromptYaml;
}

/**
 * Validate a chain's declared dependency edges against its steps (Tier A).
 *
 * Edge endpoints address the ids `mintNodeIds` derives — an explicit step `id` when declared,
 * otherwise a slug of `stepName` — which is the same id space `chain_run_nodes.id` and a gate's
 * `target_step_id` use. Two failures are possible and both are errors, not warnings: an endpoint
 * naming no step (the author addressed something that does not exist) and a cycle (no total order
 * exists, so the loader could not order the run at all). Cycle detection IS `linearize`, not a
 * second traversal — one implementation of the ordering rule, shared with the Workflow IR path.
 */
function collectChainEdgeErrors(
  steps: ReadonlyArray<{ id?: string; stepName: string; promptId: string }>,
  edges: ReadonlyArray<{ from: string; to: string }> | undefined
): string[] {
  if (edges === undefined || edges.length === 0) return [];

  const errors: string[] = [];
  const ids = mintNodeIds(steps.map((step) => ({ ...step })));
  const known = new Set(ids);

  for (const edge of edges) {
    for (const endpoint of [edge.from, edge.to]) {
      if (!known.has(endpoint)) {
        errors.push(
          `Chain edge ${edge.from} -> ${edge.to} names step id '${endpoint}', which no chain step declares or mints (known ids: ${ids.join(', ')})`
        );
      }
    }
  }
  if (errors.length > 0) return errors;

  const result = linearize(
    steps.map((step, index) => ({ id: ids[index] as string, promptId: step.promptId })),
    edges
  );
  if (!result.ok) {
    for (const rejection of result.rejections) errors.push(`Chain edges: ${rejection.detail}`);
  }
  return errors;
}

/**
 * Validate a prompt.yaml definition against the schema.
 *
 * @param data - Raw YAML data to validate
 * @param expectedId - Expected ID (should match directory name)
 * @returns Validation result with errors, warnings, and parsed data
 *
 * @example
 * ```typescript
 * const yaml = loadYamlFileSync('prompts/analysis/progressive_research/prompt.yaml');
 * const result = validatePromptYaml(yaml, 'progressive_research');
 * if (result.valid) {
 *   console.log('Prompt definition:', result.data);
 * }
 * ```
 */
export function validatePromptYaml(data: unknown, expectedId?: string): PromptYamlValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Schema validation. Exporter-only keys are removed first — see stripExporterOnlyStepKeys.
  const result = PromptYamlSchema.safeParse(stripExporterOnlyStepKeys(data));
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      errors.push(`${path}${issue.message}`);
    }
    return { valid: false, errors, warnings };
  }

  const definition = result.data;

  // ID must match directory name (if expectedId provided)
  if (expectedId !== undefined && definition.id.toLowerCase() !== expectedId.toLowerCase()) {
    errors.push(`ID '${definition.id}' does not match directory '${expectedId}'`);
  }

  // Warnings for recommended fields
  if (!definition.arguments || definition.arguments.length === 0) {
    warnings.push('Prompt has no arguments defined - may limit reusability');
  }

  if (definition.description.length < 20) {
    warnings.push('Prompt description is short - consider adding more detail');
  }

  // Check for file reference vs inline content conflicts
  if (definition.systemMessageFile && definition.systemMessage) {
    warnings.push('Both systemMessageFile and systemMessage specified - file will be used');
  }
  if (definition.userMessageTemplateFile && definition.userMessageTemplate) {
    warnings.push(
      'Both userMessageTemplateFile and userMessageTemplate specified - file will be used'
    );
  }

  // Validate chain steps if present
  if (definition.chainSteps && definition.chainSteps.length > 0) {
    const stepNames = new Set(definition.chainSteps.map((s) => s.stepName));
    const seenStepIds = new Set<string>();
    for (const step of definition.chainSteps) {
      if (step.id) {
        if (seenStepIds.has(step.id)) {
          errors.push(
            `Chain step id '${step.id}' is duplicated — explicit step ids must be unique within a chain`
          );
        }
        seenStepIds.add(step.id);
      }
      if (step.inputMapping) {
        for (const ref of Object.values(step.inputMapping)) {
          if (ref.startsWith('step') && !stepNames.has(ref)) {
            warnings.push(`Chain step '${step.stepName}' references unknown step: ${ref}`);
          }
        }
      }
    }
    errors.push(...collectChainEdgeErrors(definition.chainSteps, definition.edges));
  }

  const validationResult: PromptYamlValidationResult = {
    valid: errors.length === 0,
    errors,
    warnings,
  };

  if (errors.length === 0) {
    validationResult.data = definition;
  }

  return validationResult;
}

/**
 * Check if a value is a valid YAML prompt definition.
 *
 * @param data - Value to check
 * @returns true if data is a valid YAML prompt definition
 */
export function isValidPromptYaml(data: unknown): data is PromptYaml {
  return PromptYamlSchema.safeParse(stripExporterOnlyStepKeys(data)).success;
}

// ============================================
// Validation Utilities
// ============================================

/**
 * Result of prompt schema validation.
 */
export interface PromptSchemaValidationResult {
  /** Whether validation passed */
  valid: boolean;
  /** Validation errors (blocking issues) */
  errors: string[];
  /** Validation warnings (non-blocking issues) */
  warnings: string[];
  /** Parsed data if validation passed */
  data?: PromptDataYaml;
}

/**
 * Validate a prompt definition against the schema.
 *
 * @param data - Raw JSON data to validate
 * @param expectedId - Expected ID (should match for consistency checks)
 * @returns Validation result with errors, warnings, and parsed data
 *
 * @example
 * ```typescript
 * const prompt = { id: 'test', name: 'Test', ... };
 * const result = validatePromptSchema(prompt);
 * if (result.valid) {
 *   console.log('Prompt definition:', result.data);
 * } else {
 *   console.error('Validation errors:', result.errors);
 * }
 * ```
 */
export function validatePromptSchema(
  data: unknown,
  expectedId?: string
): PromptSchemaValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Schema validation. Exporter-only keys are removed first — see stripExporterOnlyStepKeys.
  const result = PromptDataSchema.safeParse(stripExporterOnlyStepKeys(data));
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      errors.push(`${path}${issue.message}`);
    }
    return { valid: false, errors, warnings };
  }

  const definition = result.data;

  // ID consistency check (if expectedId provided)
  if (expectedId !== undefined && definition.id !== expectedId) {
    errors.push(`ID '${definition.id}' does not match expected '${expectedId}'`);
  }

  // Warnings for recommended fields
  if (!definition.arguments || definition.arguments.length === 0) {
    warnings.push('Prompt has no arguments defined - may limit reusability');
  }

  if (!definition.description || definition.description.length < 20) {
    warnings.push('Prompt description is short - consider adding more detail');
  }

  // Check for chain consistency
  if (definition.chainSteps && definition.chainSteps.length > 0) {
    // Validate chain step references
    const stepNames = new Set(definition.chainSteps.map((s) => s.stepName));
    const seenStepIds = new Set<string>();
    for (const step of definition.chainSteps) {
      if (step.id) {
        if (seenStepIds.has(step.id)) {
          errors.push(
            `Chain step id '${step.id}' is duplicated — explicit step ids must be unique within a chain`
          );
        }
        seenStepIds.add(step.id);
      }
      if (step.inputMapping) {
        for (const ref of Object.values(step.inputMapping)) {
          // Input mappings can reference previous step outputs or argument names
          // This is a soft warning as we can't validate prompt existence here
          if (ref.startsWith('step') && !stepNames.has(ref)) {
            warnings.push(`Chain step '${step.stepName}' references unknown step: ${ref}`);
          }
        }
      }
    }
    errors.push(...collectChainEdgeErrors(definition.chainSteps, definition.edges));
  }

  const schemaValidationResult: PromptSchemaValidationResult = {
    valid: errors.length === 0,
    errors,
    warnings,
  };

  if (errors.length === 0) {
    schemaValidationResult.data = definition;
  }

  return schemaValidationResult;
}

// validatePromptsFile and validatePromptsConfig removed — JSON prompts.json format deprecated.

/**
 * Check if a value is a valid prompt definition.
 * Simpler check without detailed error messages.
 *
 * @param data - Value to check
 * @returns true if data is a valid prompt definition
 */
export function isValidPromptData(data: unknown): data is PromptDataYaml {
  return PromptDataSchema.safeParse(stripExporterOnlyStepKeys(data)).success;
}

/**
 * Check if a value is a valid category definition.
 *
 * @param data - Value to check
 * @returns true if data is a valid category definition
 */
export function isValidCategory(data: unknown): data is CategoryYaml {
  return CategorySchema.safeParse(data).success;
}
