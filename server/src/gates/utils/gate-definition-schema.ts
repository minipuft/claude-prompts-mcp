// @lifecycle canonical - Schema validation for lightweight gate definitions.
/**
 * Lightweight Gate Definition Schema
 *
 * Provides runtime validation for gate definitions loaded from disk.
 * Permissive to avoid rejecting legacy fields but enforces required keys.
 */

import { z } from 'zod';

import { validateWithSchema, type SchemaValidationResult } from '../../utils/schema-validator.js';

import type {
  GateDefinitionYaml,
  GatePassCriteria,
  GateRetryConfig,
  LightweightGateDefinition,
} from '../types.js';

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
      errorMap: () => ({ message: 'Gate type is required' }),
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

      if (criteria.min_length !== undefined) {
        normalized.min_length = criteria.min_length;
      }
      if (criteria.max_length !== undefined) {
        normalized.max_length = criteria.max_length;
      }
      if (criteria.required_patterns) {
        normalized.required_patterns = criteria.required_patterns;
      }
      if (criteria.forbidden_patterns) {
        normalized.forbidden_patterns = criteria.forbidden_patterns;
      }
      if (criteria.methodology) {
        normalized.methodology = criteria.methodology;
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
      if (criteria.prompt_template) {
        normalized.prompt_template = criteria.prompt_template;
      }
      if (criteria.pass_threshold !== undefined) {
        normalized.pass_threshold = criteria.pass_threshold;
      }
      if (criteria.regex_patterns) {
        normalized.regex_patterns = criteria.regex_patterns;
      }
      if (criteria.keyword_count) {
        normalized.keyword_count = criteria.keyword_count;
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
