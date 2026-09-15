// @lifecycle canonical - Schema validation for lightweight gate definitions.
/**
 * Lightweight Gate Definition Schema
 *
 * Provides runtime validation for gate definitions loaded from disk.
 * Permissive to avoid rejecting legacy fields but enforces required keys.
 */

import { z } from 'zod/v4';

import type { GateDefinitionYaml, GatePassCriteria, LightweightGateDefinition } from '../types.js';

import { validateWithSchema, type SchemaValidationResult } from '#shared/utils/schema-validator.js';

const activationSchema = z
  .object({
    prompt_categories: z.array(z.string()).optional(),
    explicit_request: z.boolean().optional(),
    framework_context: z.array(z.string()).optional(),
  })
  .partial();

const retryConfigSchema = z
  .object({
    max_attempts: z.number().int().nonnegative().optional(),
    improvement_hints: z.boolean().optional(),
    preserve_context: z.boolean().optional(),
  })
  .partial();

const lightweightGateSchema = z
  .object({
    id: z.string().min(1, 'Gate ID is required'),
    name: z.string().min(1, 'Gate name is required'),
    type: z.enum(['validation', 'guidance'], {
      error: () => 'Gate type is required',
    }),
    description: z.string().optional(),
    severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    enforcementMode: z.enum(['blocking', 'advisory', 'informational']).optional(),
    guidance: z.string().optional(),
    pass_criteria: z.array(z.record(z.string(), z.any())).optional(),
    retry_config: retryConfigSchema.optional(),
    activation: activationSchema.optional(),
    gate_type: z.string().optional(),
  })
  .passthrough();

export function validateLightweightGateDefinition(
  value: unknown
): SchemaValidationResult<LightweightGateDefinition> {
  const result = validateWithSchema(lightweightGateSchema, value, { name: 'Gate definition' });

  if (!result.success) {
    return result.errors ? { success: false, errors: result.errors } : { success: false };
  }

  if (!result.data?.description) {
    return {
      success: false,
      errors: ['Gate definition missing description'],
    };
  }

  const parsed = result.data as unknown as GateDefinitionYaml;
  const { id, name, type, description } = parsed;
  const lightweight: LightweightGateDefinition = {
    id,
    name,
    type,
    description,
  };

  if (parsed.severity) {
    lightweight.severity = parsed.severity;
  }
  if (parsed.enforcementMode) {
    lightweight.enforcementMode = parsed.enforcementMode;
  }
  if (parsed.gate_type) {
    lightweight.gate_type = parsed.gate_type;
  }
  if (parsed['guidanceFile']) {
    lightweight.guidanceFile = parsed['guidanceFile'];
  }
  if (parsed.guidance) {
    lightweight.guidance = parsed.guidance;
  }
  if (parsed.pass_criteria) {
    lightweight.pass_criteria = parsed.pass_criteria.map((criteria) => {
      const normalized: GatePassCriteria = {
        type: criteria.type,
      };

      // min_length/max_length/required_patterns/forbidden_patterns/regex_patterns/
      // keyword_count are deliberately not copied — they were never evaluated (B9) and
      // are rejected at load, so GatePassCriteria no longer declares them.
      if (criteria.framework) {
        normalized.framework = criteria.framework;
      }
      if (criteria.min_compliance_score !== undefined) {
        normalized.min_compliance_score = criteria.min_compliance_score;
      }
      if (criteria.severity) {
        normalized.severity = criteria.severity;
      }
      if (criteria.quality_indicators) {
        const indicators: Record<string, { keywords?: string[]; patterns?: string[] }> = {};
        for (const [key, value] of Object.entries(criteria.quality_indicators)) {
          const normalizedIndicator: { keywords?: string[]; patterns?: string[] } = {};
          if (value.keywords) {
            normalizedIndicator.keywords = value.keywords;
          }
          if (value.patterns) {
            normalizedIndicator.patterns = value.patterns;
          }
          indicators[key] = normalizedIndicator;
        }
        normalized.quality_indicators = indicators;
      }

      // Shell verification fields
      if (criteria.shell_command) {
        normalized.shell_command = criteria.shell_command;
      }
      if (criteria.shell_timeout !== undefined) {
        normalized.shell_timeout = criteria.shell_timeout;
      }
      if (criteria.shell_working_dir) {
        normalized.shell_working_dir = criteria.shell_working_dir;
      }
      if (criteria.shell_env) {
        normalized.shell_env = criteria.shell_env;
      }
      if (criteria.shell_max_attempts !== undefined) {
        normalized.shell_max_attempts = criteria.shell_max_attempts;
      }
      if (criteria.shell_preset) {
        normalized.shell_preset = criteria.shell_preset;
      }

      // Script tool verification fields
      if (criteria.script_tool_id) {
        normalized.script_tool_id = criteria.script_tool_id;
      }
      if (criteria.script_tool_input) {
        normalized.script_tool_input = criteria.script_tool_input;
      }
      if (criteria.script_tool_timeout !== undefined) {
        normalized.script_tool_timeout = criteria.script_tool_timeout;
      }
      if (criteria.script_tool_working_dir) {
        normalized.script_tool_working_dir = criteria.script_tool_working_dir;
      }

      return normalized;
    });
  }
  if (parsed.retry_config) {
    lightweight.retry_config = {
      max_attempts: parsed.retry_config.max_attempts ?? 2,
      improvement_hints: parsed.retry_config.improvement_hints ?? true,
      preserve_context: parsed.retry_config.preserve_context ?? true,
    };
  }
  if (parsed.activation) {
    lightweight.activation = {};
    if (parsed.activation.prompt_categories) {
      lightweight.activation.prompt_categories = parsed.activation.prompt_categories;
    }
    if (parsed.activation.explicit_request !== undefined) {
      lightweight.activation.explicit_request = parsed.activation.explicit_request;
    }
    if (parsed.activation.framework_context) {
      lightweight.activation.framework_context = parsed.activation.framework_context;
    }
  }

  return {
    success: true,
    data: lightweight,
  };
}
