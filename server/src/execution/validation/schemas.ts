// @lifecycle canonical - Defines validation schemas for execution requests.
/**
 * Zod Validation Schemas for Execution System
 *
 * Comprehensive validation schemas for all execution-related types,
 * providing runtime type safety and clear error messages.
 */
import { z } from 'zod';

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
 * Zod schema for temporary gate object validation
 *
 * Note: The 'severity' field is currently metadata-only and does not affect execution behavior.
 * Severity-based enforcement is planned for future semantic layer integration.
 *
 * Gate types: 'validation' runs checks, 'guidance' only provides instructional text.
 */
const temporaryGateObjectSchema = z
  .object(
    {
      id: z.string().min(1, 'Gate ID cannot be empty').optional(),
      template: z.string().trim().min(1, 'Template reference cannot be empty').optional(),
      name: z.string().trim().min(1, 'Gate name cannot be empty').optional(),
      type: z.enum(['validation', 'guidance']).optional(),
      scope: gateScopeSchema.optional(),
      criteria: z.array(z.string().min(1, 'Gate criteria cannot be empty')).optional(),
      pass_criteria: z.array(z.string().min(1, 'Pass criteria cannot be empty')).optional(),
      guidance: z.string().optional(),
      description: z.string().optional(),
      severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
      context: z.record(z.any()).optional(),
      source: z.enum(['manual', 'automatic', 'analysis']).optional(),
    },
    {
      errorMap: (issue, ctx) => {
        if (issue.code === z.ZodIssueCode.invalid_type) {
          return { message: 'Temporary gate definition must be an object or string reference' };
        }
        return { message: ctx.defaultError };
      },
    }
  )
  .superRefine((value, ctx) => {
    const hasIdentifier = Boolean(value.id);
    const hasContent = Boolean(
      (value.criteria && value.criteria.length > 0) ||
      (value.pass_criteria && value.pass_criteria.length > 0) ||
      (value.guidance && value.guidance.trim().length > 0) ||
      (value.description && value.description.trim().length > 0)
    );

    if (!hasIdentifier && !hasContent) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Provide an id/template or include criteria/guidance for each temporary gate',
      });
    }
  });

/**
 * Zod schema for unified GateSpecification validation (canonical in v3.0.0+).
 *
 * Accepts:
 * - String gate ID references (e.g., "toxicity")
 * - Simple custom checks ({name, description})
 * - Full temporary gate definitions (with criteria, severity, etc.)
 */
export const gateSpecificationSchema = z.union(
  [
    z.string().trim().min(1, 'Gate reference cannot be empty'),
    customCheckSchema,
    temporaryGateObjectSchema,
  ],
  {
    errorMap: (issue, ctx) => {
      if (issue.code === z.ZodIssueCode.invalid_union) {
        return {
          message:
            'Gate specification must be a string ID, custom check object, or full gate definition',
        };
      }
      return { message: ctx.defaultError };
    },
  }
);

/**
 * Zod schema for gate_action parameter validation
 * Used when retry limit is exceeded to let user choose: retry, skip, or abort
 */
export const gateActionSchema = z.enum(['retry', 'skip', 'abort'], {
  errorMap: (issue, ctx) => {
    if (issue.code === z.ZodIssueCode.invalid_enum_value) {
      return { message: 'Gate action must be one of: retry, skip, abort' };
    }
    return { message: ctx.defaultError };
  },
});

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
      gate_action: gateActionSchema.optional(),
      user_response: z.string().trim().optional(),
      force_restart: z.boolean().optional(),
      gates: z.array(gateSpecificationSchema).optional(),
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
