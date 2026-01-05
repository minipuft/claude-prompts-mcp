// @lifecycle canonical - Single source of truth for prompt JSON/YAML validation
/**
 * Prompt Schema (Zod)
 *
 * Defines the canonical schema for prompt definitions in prompts.json files.
 * Used by:
 * - PromptLoader (runtime validation)
 * - PromptConverter (content validation)
 * - (Future) CI validation scripts
 * - (Future) YAML prompt format validation
 *
 * This ensures SSOT - any schema change is enforced everywhere.
 *
 * @see gate-schema.ts for the pattern this follows
 * @see methodology-schema.ts for the pattern this follows
 */

import { z } from 'zod';

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
     * @deprecated Removed in v3.0.0 - LLM handles semantic variation better than strict enums.
     * This field is parsed but ignored by the validation system.
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
// Chain Step Schema
// ============================================

/**
 * Schema for chain step definitions.
 */
export const ChainStepSchema = z.object({
  /** ID of the prompt to execute in this step */
  promptId: z.string().min(1, 'Step promptId is required'),
  /** Name/identifier of this step */
  stepName: z.string().min(1, 'Step name is required'),
  /** Map step results to semantic names */
  inputMapping: z.record(z.string()).optional(),
  /** Name this step's output for downstream steps */
  outputMapping: z.record(z.string()).optional(),
  /** Number of retry attempts on failure (default: 0) */
  retries: z.number().int().nonnegative().optional(),
});

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
            context: z.record(z.any()).optional(),
          })
          .passthrough()
      )
      .optional(),
  })
  .partial();

export type PromptGateConfigurationYaml = z.infer<typeof PromptGateConfigurationSchema>;

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
});

export type CategoryYaml = z.infer<typeof CategorySchema>;

// ============================================
// Main Prompt Data Schema
// ============================================

/**
 * Schema for prompt definitions in prompts.json files.
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
    /** Chain steps for chain-type prompts */
    chainSteps: z.array(ChainStepSchema).optional(),
    /** Whether to register this prompt with MCP */
    registerWithMcp: z.boolean().optional(),
    /** Script tool IDs declared by this prompt (references tools/{id}/ directories) */
    tools: z.array(z.string().min(1)).optional(),
  })
  .passthrough(); // Allow additional fields for extensibility

export type PromptDataYaml = z.infer<typeof PromptDataSchema>;

// ============================================
// Prompts File Schema (prompts.json)
// ============================================

/**
 * Schema for category-level prompts.json files.
 */
export const PromptsFileSchema = z.object({
  /** Array of prompt definitions */
  prompts: z.array(PromptDataSchema),
});

export type PromptsFileYaml = z.infer<typeof PromptsFileSchema>;

// ============================================
// Prompts Config Schema (promptsConfig.json)
// ============================================

/**
 * Schema for the main promptsConfig.json file.
 */
export const PromptsConfigSchema = z.object({
  /** Available categories for organizing prompts */
  categories: z.array(CategorySchema),
  /** Paths to prompts.json files to import */
  imports: z.array(z.string()),
});

export type PromptsConfigYaml = z.infer<typeof PromptsConfigSchema>;

// ============================================
// YAML Directory Format Schema (Phase 2)
// ============================================

/**
 * Schema for prompt.yaml files in directory-based format.
 *
 * This format mirrors the gates/methodologies pattern:
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
    /** Unique identifier for the prompt (must match directory name) */
    id: z.string().min(1, 'Prompt ID is required'),
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

    // Chain steps (for chain-type prompts)
    /** Chain steps for multi-step execution */
    chainSteps: z.array(ChainStepSchema).optional(),

    // MCP registration
    /** Whether to register this prompt with MCP (default: true) */
    registerWithMcp: z.boolean().optional(),

    // Script tools
    /** Script tool IDs declared by this prompt (references tools/{id}/ directories) */
    tools: z.array(z.string().min(1)).optional(),
  })
  .passthrough() // Allow additional fields for extensibility
  .refine(
    (data) => {
      // Must have either userMessageTemplate/userMessageTemplateFile OR chainSteps
      const hasTemplate = data.userMessageTemplate || data.userMessageTemplateFile;
      const hasChainSteps = data.chainSteps && data.chainSteps.length > 0;
      return hasTemplate || hasChainSteps;
    },
    {
      message:
        'Prompt must have either userMessageTemplate/userMessageTemplateFile or chainSteps defined',
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
    for (const step of definition.chainSteps) {
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
    for (const step of definition.chainSteps) {
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

/**
 * Validate a prompts.json file against the schema.
 *
 * @param data - Raw JSON data to validate
 * @returns Validation result with errors and warnings
 */
export function validatePromptsFile(data: unknown): {
  valid: boolean;
  errors: string[];
  warnings: string[];
  data?: PromptsFileYaml;
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  const result = PromptsFileSchema.safeParse(data);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      errors.push(`${path}${issue.message}`);
    }
    return { valid: false, errors, warnings };
  }

  // Validate each prompt individually for detailed warnings
  for (const prompt of result.data.prompts) {
    const promptResult = validatePromptSchema(prompt);
    warnings.push(...promptResult.warnings.map((w) => `[${prompt.id}] ${w}`));
  }

  // Check for duplicate IDs
  const ids = result.data.prompts.map((p) => p.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
  if (duplicates.length > 0) {
    errors.push(`Duplicate prompt IDs found: ${[...new Set(duplicates)].join(', ')}`);
  }

  const validationResult: {
    valid: boolean;
    errors: string[];
    warnings: string[];
    data?: PromptsFileYaml;
  } = {
    valid: errors.length === 0,
    errors,
    warnings,
  };

  if (errors.length === 0) {
    validationResult.data = result.data;
  }

  return validationResult;
}

/**
 * Validate a promptsConfig.json file against the schema.
 *
 * @param data - Raw JSON data to validate
 * @returns Validation result with errors and warnings
 */
export function validatePromptsConfig(data: unknown): {
  valid: boolean;
  errors: string[];
  warnings: string[];
  data?: PromptsConfigYaml;
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  const result = PromptsConfigSchema.safeParse(data);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : '';
      errors.push(`${path}${issue.message}`);
    }
    return { valid: false, errors, warnings };
  }

  // Check for duplicate category IDs
  const categoryIds = result.data.categories.map((c) => c.id);
  const duplicates = categoryIds.filter((id, index) => categoryIds.indexOf(id) !== index);
  if (duplicates.length > 0) {
    errors.push(`Duplicate category IDs found: ${[...new Set(duplicates)].join(', ')}`);
  }

  // Warn about empty imports
  if (result.data.imports.length === 0) {
    warnings.push('No import paths defined - no prompts will be loaded');
  }

  const configValidationResult: {
    valid: boolean;
    errors: string[];
    warnings: string[];
    data?: PromptsConfigYaml;
  } = {
    valid: errors.length === 0,
    errors,
    warnings,
  };

  if (errors.length === 0) {
    configValidationResult.data = result.data;
  }

  return configValidationResult;
}

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
