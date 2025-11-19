// @lifecycle canonical - Defines validation schemas for execution requests.
/**
 * Zod Validation Schemas for Execution System
 *
 * Comprehensive validation schemas for all execution-related types,
 * providing runtime type safety and clear error messages.
 */
import { z } from 'zod';

/**
 * Zod schema for ExecutionMode validation
 */
export const executionModeSchema = z.enum(['auto', 'prompt', 'template', 'chain'], {
  errorMap: (issue, ctx) => {
    if (issue.code === z.ZodIssueCode.invalid_enum_value) {
      return { message: 'Execution mode must be one of: auto, prompt, template, chain' };
    }
    return { message: ctx.defaultError };
  },
});

/**
 * Zod schema for GateScope validation
 */
export const gateScopeSchema = z.enum(['execution', 'session', 'chain', 'step'], {
  errorMap: (issue, ctx) => {
    if (issue.code === z.ZodIssueCode.invalid_enum_value) {
      return { message: 'Gate scope must be one of: execution, session, chain, step' };
    }
    return { message: ctx.defaultError };
  },
});

/**
 * Zod schema for CustomCheck validation
 */
export const customCheckSchema = z.object(
  {
    name: z.string().min(1, 'Custom check name cannot be empty'),
    description: z.string().min(1, 'Custom check description cannot be empty'),
  },
  {
    errorMap: (issue, ctx) => {
      if (issue.code === z.ZodIssueCode.invalid_type) {
        return { message: 'Custom check must be an object with name and description' };
      }
      return { message: ctx.defaultError };
    },
  }
);

/**
 * Zod schema for TemporaryGateDefinition validation
 */
export const temporaryGateDefinitionSchema = z.object(
  {
    id: z.string().min(1, 'Gate ID cannot be empty'),
    criteria: z
      .array(z.string().min(1, 'Gate criteria cannot be empty'))
      .min(1, 'Gate criteria cannot be empty'),
    severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  },
  {
    errorMap: (issue, ctx) => {
      if (issue.code === z.ZodIssueCode.invalid_type) {
        return { message: 'Temporary gate definition must be an object with id and criteria' };
      }
      return { message: ctx.defaultError };
    },
  }
);

/**
 * Complete Zod schema for McpToolRequest validation
 */
export const mcpToolRequestSchema = z
  .object(
    {
      command: z.string().trim().min(1, 'Command cannot be empty').optional(),
      chain_id: z
        .string()
        .regex(
          /^chain-[a-zA-Z0-9_-]+(?:#\d+)?$/,
          'Chain ID must follow format: chain-{prompt} or chain-{prompt}#runNumber'
        )
        .optional(),
      gate_verdict: z
        .string()
        .trim()
        .regex(
          /^GATE_REVIEW:\s(PASS|FAIL)\s-\s.+$/,
          'Gate verdict must follow format: "GATE_REVIEW: PASS/FAIL - reason"'
        )
        .optional(),
      user_response: z.string().trim().optional(),
      force_restart: z.boolean().optional(),
      execution_mode: executionModeSchema.optional(),
      api_validation: z.boolean().optional(),
      gate_validation: z.boolean().optional(),
      quality_gates: z.array(z.string()).optional(),
      custom_checks: z.array(customCheckSchema).optional(),
      temporary_gates: z.array(temporaryGateDefinitionSchema).optional(),
      gate_scope: gateScopeSchema.optional(),
      timeout: z.number().int().positive().optional(),
      options: z.record(z.any()).optional(),
    },
    {
      errorMap: (issue, ctx) => {
        if (issue.code === z.ZodIssueCode.invalid_type) {
          return { message: 'MCP tool request must be a valid object' };
        }
        return { message: ctx.defaultError };
      },
    }
  )
  .refine(
    (data) => {
      const hasCommand = typeof data.command === 'string' && data.command.trim().length > 0;
      const hasResumeTarget = Boolean(data.chain_id);
      return hasCommand || hasResumeTarget;
    },
    {
      message: 'Request must include a command or chain identifier',
      path: ['command'],
    }
  );

/**
 * Type inference from schema for runtime type checking
 */
export type McpToolRequestFromSchema = z.infer<typeof mcpToolRequestSchema>;
