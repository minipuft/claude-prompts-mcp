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

// ============================================
// Visibility Policy Schema (P5)
// ============================================

/**
 * A named item of chain-run context a step's `visibility` declaration can withhold from or
 * expose to that step's render. Mirrors `VisibilityItem` in `shared/types/chain-execution.ts`
 * (SSOT for the union) — kept as a literal Zod enum here rather than importing the type, since
 * Zod needs runtime values, not just the type, and this is the one place the vocabulary is
 * validated. Ruled item-kind-only for v1 (OQ-P5-1): node-id-addressed exposure was deferred to
 * P6 pending `ParsedCommandSnapshot.steps` carrying a nodeId, which it does as of P6 Tier 2 —
 * the vocabulary stays item-kind-only until a ruling widens it, but no longer for want of an id.
 */
export const VisibilityItemSchema = z.enum([
  'previous_step_output',
  'chain_history',
  'unknowns_ledger',
]);

/**
 * Per-step visibility policy, consumed by `decideVisibility` at render time. An item may
 * appear in `withhold` or `expose`; mutual exclusivity is not validated — expose is only
 * meaningful against a PRIOR step's withhold, so the same item in both is a no-op, not an error.
 */
export const StepVisibilitySchema = z
  .object({
    withhold: z.array(VisibilityItemSchema).optional(),
    expose: z.array(VisibilityItemSchema).optional(),
  })
  .strict();

export type StepVisibilityYaml = z.infer<typeof StepVisibilitySchema>;

// ============================================
// Chain Step Schema
// ============================================

/**
 * Schema for chain step definitions.
 *
 * STRICT, deliberately — the third strictness posture in this file, and previously the unmarked
 * one. `PromptInjectionRuleSchema` and `PromptInjectionConfigSchema` are `.strict()` because every
 * field they accept is read by the hierarchy resolver; `inline_gate_definitions` is
 * `.passthrough()` because a gate definition legitimately carries custom fields. A chain step is
 * the first kind: every field below is consumed downstream, so a key that is not here cannot take
 * effect no matter what the author intended.
 *
 * Zod's default (strip) made that failure invisible — `framwork: ReACT` parsed to a normal-looking
 * step and told the author nothing, which is how six `inlineGateIds` declarations sat dead in three
 * shipped chains. `.passthrough()` would be worse than either: `normalizeChainSteps` in
 * yaml-prompt-loader enumerates fields explicitly and drops the rest regardless, so passthrough
 * would advertise an extensibility the very next layer denies.
 *
 * BREAKING, and priced as such. An unknown key now fails the whole prompt's load
 * (`yaml-prompt-loader.ts` returns null on `valid: false`), so YAML that loaded before can stop
 * loading. That is a resource-format change and rides a major version.
 *
 * What that made mandatory: every key with a REAL consumer had to be declared first, including the
 * ones no code in this module reads. `delegation` is the worked example — the schema knew nothing
 * about it, but the skills-sync exporter reads it straight off the YAML. Rejecting it would have
 * broken the server's load path while the exporter kept honouring the field. Before adding
 * `.strict()` to any schema, enumerate readers of the FILE, not readers of the schema.
 */
export const ChainStepSchema = z
  .object({
    /** ID of the prompt to execute in this step */
    promptId: z.string().min(1, 'Step promptId is required'),
    /** Name/identifier of this step */
    stepName: z.string().min(1, 'Step name is required'),
    /**
     * Stable node identity for this step (kebab-case). Optional — when omitted, a node id is
     * minted at parse time from a slug of `stepName`. Explicit ids must be unique within the
     * chain (enforced in `validatePromptYaml` / `validatePromptSchema`). Tier 1: additive only —
     * nothing downstream consumes this field yet.
     */
    id: z
      .string()
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        'Step id must be kebab-case (lowercase alphanumeric, hyphen-separated)'
      )
      .optional(),
    /** Map step results to semantic names */
    inputMapping: z.record(z.string(), z.string()).optional(),
    /** Name this step's output for downstream steps */
    outputMapping: z.record(z.string(), z.string()).optional(),
    /** Number of retry attempts on failure (default: 0) */
    retries: z.number().int().nonnegative().optional(),
    /** Client-agnostic capability hint for delegation model selection */
    subagentModel: z.enum(['heavy', 'standard', 'fast']).optional(),
    /** Host agent to spawn for this step, overriding the prompt-level default */
    agentType: z.string().min(1).optional(),
    /**
     * Framework this step runs under, overriding the run-wide selection.
     *
     * Validated as a non-empty string, NOT an enum: frameworks are registry-resolved and
     * `frameworkManager.getFramework(id)` is the only authority on validity (project CLAUDE.md).
     * Baking the list into a schema would put a second, staler copy beside the registry — the
     * exact defect the operator registry gate exists to prevent. An unknown id resolves to the
     * run-wide framework at `12-framework-stage.ts` rather than failing the load, because a
     * framework that was renamed should degrade, not make the whole prompt unloadable.
     */
    framework: z.string().min(1).optional(),
    /**
     * Inline gate ids for this step.
     *
     * WIRED as of P6 Tier 4 (OQ-P6-8). The gate pipeline's reader predated the producer:
     * `GateEnhancementService.enhanceChainSteps` has always read `step.inlineGateIds` and passed
     * it to `GateSetResolver` at rank `inline-operator`. What stood between the author and that
     * reader were the two later strippers this docblock's neighbour describes —
     * `normalizeChainSteps`'s allowlist and the stage-04 projection — both removed in the same
     * change, because a field carried at fewer than all three is silently dead (P6-F7).
     *
     * BEHAVIOUR CHANGE, priced: a step declaring gate ids now has them applied. Measured
     * 2026-08-13 with `rg --no-ignore`: six declarations across four chains, and every one lives
     * in the operator's LOCAL, gitignored prompt corpus — **zero tracked/bundled chains declare
     * the field**, so the shipped package's behaviour is unchanged. Of the six, one names a
     * registered gate (`code-quality`); the other five name display strings with no registered
     * gate, which enter the accumulator and render no guidance (P6-F13).
     *
     * An id naming no registered gate is NOT filtered here. Every other gate source behaves the
     * same way — a client-supplied unknown id in `gates` also enters the accumulator — and
     * special-casing this one source would make gate resolution mean different things depending
     * on where an id came from.
     */
    inlineGateIds: z.array(z.string().min(1)).optional(),
    /**
     * Per-step visibility policy: which chain-run context items to withhold from or expose to
     * this step's render. Consumed by `decideVisibility` (pipeline/decisions/visibility) at the
     * operator render and delegation-envelope chokepoints. Unknown item strings are rejected
     * here by `VisibilityItemSchema`'s enum, naming the allowed vocabulary in the error.
     */
    visibility: StepVisibilitySchema.optional(),
    /**
     * Export this step as a delegated skill step.
     *
     * DECLARED BECAUSE IT HAS A CONSUMER, not because the execution runtime reads it — it does
     * not. The only reader is the skills-sync exporter (`modules/skills-sync/service.ts`), which
     * loads prompt YAML with `yaml.load(raw)` and never passes it through this schema, so
     * `s.delegation` there is a real field on a second, unvalidated read path.
     *
     * That second path is exactly why `.strict()` had to declare it rather than reject it: a
     * search of this schema says `delegation` is unknown, while an exported skill provably
     * carries it. Rejecting would have failed the prompt's load in the server while the exporter
     * kept honouring the field — divergence between two readers of one file, which is worse than
     * either behaviour alone.
     *
     * Not to be confused with `ChainStepPrompt.delegated`, the runtime's own flag, which is set
     * by the execution pipeline and never sourced from here.
     */
    delegation: z.boolean().optional(),
  })
  .strict();

export type ChainStepYaml = z.infer<typeof ChainStepSchema>;

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
    /** Gate configuration for validation */
    gateConfiguration: PromptGateConfigurationSchema.optional(),
    /** Prompt-level injection control (resolved between step and chain config) */
    injection: PromptInjectionConfigSchema.optional(),
    /** Chain steps for chain-type prompts */
    chainSteps: z.array(ChainStepSchema).optional(),
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
  .passthrough(); // Allow additional fields for extensibility

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

    // Gate configuration
    /** Gate configuration for validation */
    gateConfiguration: PromptGateConfigurationSchema.optional(),

    // Injection control
    /** Prompt-level injection control (resolved between step and chain config) */
    injection: PromptInjectionConfigSchema.optional(),

    // Chain steps (for chain-type prompts)
    /** Chain steps for multi-step execution */
    chainSteps: z.array(ChainStepSchema).optional(),

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
  );

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

  // Schema validation
  const result = PromptYamlSchema.safeParse(data);
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
  return PromptYamlSchema.safeParse(data).success;
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

  // Schema validation
  const result = PromptDataSchema.safeParse(data);
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
  return PromptDataSchema.safeParse(data).success;
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
