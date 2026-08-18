// @lifecycle canonical - Canonical resource schema verification service for CLI and MCP write paths.
import { validateScriptToolSchema } from '../../../modules/automation/core/script-schema.js';
import { validateStyleSchema } from '../../../modules/formatting/core/style-schema.js';
import { validatePromptYaml } from '../../../modules/prompts/prompt-schema.js';

import {
  FrameworkGateSchema,
  TemplateSuggestionSchema,
  validateFrameworkSchema,
} from '#engine/frameworks/definitions/framework-schema.js';
import { validateGateSchema } from '#engine/gates/core/gate-schema.js';
import { loadYamlFileSync } from '#shared/utils/yaml/index.js';

export type ResourceVerificationType = 'prompts' | 'gates' | 'frameworks' | 'styles' | 'tools';

export interface ResourceVerificationIssue {
  code: string;
  path: string;
  message: string;
}

export interface ResourceVerificationResult {
  valid: boolean;
  resourceType: ResourceVerificationType;
  resourceId: string;
  filePath: string;
  errors: ResourceVerificationIssue[];
  warnings: ResourceVerificationIssue[];
}

export interface ResourceVerificationFailurePayload {
  resourceType: ResourceVerificationType;
  resourceId: string;
  filePath: string;
  errors: ResourceVerificationIssue[];
  warnings: ResourceVerificationIssue[];
  rolledBack: boolean;
}

export class ResourceVerificationError extends Error {
  constructor(
    public readonly payload: ResourceVerificationFailurePayload,
    message = 'Resource verification failed'
  ) {
    super(message);
    this.name = 'ResourceVerificationError';
  }
}

interface RawVerificationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function parseIssue(message: string, code: string): ResourceVerificationIssue {
  const separatorIndex = message.indexOf(': ');
  if (separatorIndex > 0) {
    return {
      code,
      path: message.slice(0, separatorIndex),
      message: message.slice(separatorIndex + 2),
    };
  }

  return {
    code,
    path: '$',
    message,
  };
}

function toIssues(messages: string[], code: string): ResourceVerificationIssue[] {
  return messages.map((message) => parseIssue(message, code));
}

/**
 * The element schemas a framework AUTHORING draft must satisfy, paired with the container name
 * the draft actually uses.
 *
 * The names differ across the boundary and that difference is load-bearing: a create payload
 * carries `framework_gates` / `template_suggestions`, `framework.yaml` carries `frameworkGates` /
 * `templateSuggestions`, and `FrameworkFileWriter` copies each array through verbatim
 * (`framework-file-writer.ts:443-448`). So the ELEMENT shape is identical on both sides and only
 * the container name differs — which is why a draft-time issue must name the snake_case field the
 * operator actually typed, not the camelCase one they never saw.
 */
const FRAMEWORK_DRAFT_ELEMENT_SCHEMAS = [
  { field: 'framework_gates', schema: FrameworkGateSchema },
  { field: 'template_suggestions', schema: TemplateSuggestionSchema },
] as const;

function normalizeResult(
  result: RawVerificationResult,
  context: Pick<ResourceVerificationResult, 'resourceType' | 'resourceId' | 'filePath'>
): ResourceVerificationResult {
  return {
    valid: result.valid,
    resourceType: context.resourceType,
    resourceId: context.resourceId,
    filePath: context.filePath,
    errors: toIssues(result.errors, 'schema_validation_error'),
    warnings: toIssues(result.warnings, 'schema_validation_warning'),
  };
}

export class ResourceVerificationService {
  validateDocument(
    resourceType: ResourceVerificationType,
    resourceId: string,
    filePath: string,
    data: unknown
  ): ResourceVerificationResult {
    const raw = this.validateResourceData(resourceType, data, resourceId);
    return normalizeResult(raw, { resourceType, resourceId, filePath });
  }

  validateFile(
    resourceType: ResourceVerificationType,
    resourceId: string,
    filePath: string
  ): ResourceVerificationResult {
    let data: unknown;
    try {
      data = loadYamlFileSync(filePath);
    } catch {
      return {
        valid: false,
        resourceType,
        resourceId,
        filePath,
        errors: [{ code: 'yaml_load_failed', path: '$', message: 'Failed to parse YAML file' }],
        warnings: [],
      };
    }

    if (data === null || data === undefined) {
      return {
        valid: false,
        resourceType,
        resourceId,
        filePath,
        errors: [{ code: 'yaml_load_failed', path: '$', message: 'Failed to load YAML file' }],
        warnings: [],
      };
    }

    return this.validateDocument(resourceType, resourceId, filePath, data);
  }

  /**
   * Element-level verification of a framework draft, BEFORE anything is written.
   *
   * Why the tool layer cannot do this itself: `.dependency-cruiser.cjs`
   * (`tool-layer-no-validator-value-imports`) forbids `src/mcp/tools/**` from value-importing any
   * resource schema, and names this service as the sanctioned route. That boundary is what keeps
   * one copy of the shape — the service imports the schema, the tool imports the service.
   *
   * Why it exists at all: `FrameworkDraftValidator` hard-required `framework_gates` while proving
   * only `Array.isArray(x) && x.length > 0`, and `validateFile` — the post-write check inside
   * `ResourceMutationTransaction` — ran `FrameworkGateSchema` over every entry. A draft carrying
   * `[{ id, description }]` passed the first, was written, and was rejected by the second, which
   * rolled the files back. Both verdicts now come from the same schemas in the same module.
   *
   * Returns issues rather than a `ResourceVerificationResult`: there is no file yet, so
   * `filePath` would have to be invented, and inventing one is how a message starts lying.
   */
  validateFrameworkDraftElements(draft: Record<string, unknown>): ResourceVerificationIssue[] {
    const issues: ResourceVerificationIssue[] = [];

    for (const { field, schema } of FRAMEWORK_DRAFT_ELEMENT_SCHEMAS) {
      const items: unknown = draft[field];
      if (!Array.isArray(items)) continue;

      items.forEach((item, index) => {
        const parsed = schema.safeParse(item);
        if (parsed.success) return;
        for (const issue of parsed.error.issues) {
          const suffix = issue.path.length > 0 ? `.${issue.path.join('.')}` : '';
          issues.push({
            code: 'schema_validation_error',
            path: `${field}[${index}]${suffix}`,
            message: issue.message,
          });
        }
      });
    }

    return issues;
  }

  formatIssues(issues: ResourceVerificationIssue[]): string[] {
    return issues.map((issue) => `${issue.path}: ${issue.message}`);
  }

  toFailurePayload(
    result: ResourceVerificationResult,
    rolledBack: boolean
  ): ResourceVerificationFailurePayload {
    return {
      resourceType: result.resourceType,
      resourceId: result.resourceId,
      filePath: result.filePath,
      errors: result.errors,
      warnings: result.warnings,
      rolledBack,
    };
  }

  formatFailurePayload(payload: ResourceVerificationFailurePayload): string {
    const errorLines =
      payload.errors.length > 0
        ? payload.errors.map((issue) => `  - ${issue.path}: ${issue.message}`)
        : [];
    const warningLines =
      payload.warnings.length > 0
        ? payload.warnings.map((issue) => `  - ${issue.path}: ${issue.message}`)
        : [];

    const sections: string[] = [
      `resourceType: ${payload.resourceType}`,
      `resourceId: ${payload.resourceId}`,
      `filePath: ${payload.filePath}`,
      `rolledBack: ${String(payload.rolledBack)}`,
      `errors:\n${errorLines.length > 0 ? errorLines.join('\n') : '  - (none)'}`,
    ];

    if (warningLines.length > 0) {
      sections.push(`warnings:\n${warningLines.join('\n')}`);
    }

    return sections.join('\n');
  }

  private validateResourceData(
    resourceType: ResourceVerificationType,
    data: unknown,
    expectedId: string
  ): RawVerificationResult {
    switch (resourceType) {
      case 'prompts':
        return validatePromptYaml(data, expectedId);
      case 'gates':
        return validateGateSchema(data, expectedId);
      case 'frameworks':
        return validateFrameworkSchema(data, expectedId);
      case 'styles':
        return validateStyleSchema(data, expectedId);
      case 'tools':
        return validateScriptToolSchema(data, expectedId);
    }
  }
}
