// @lifecycle canonical - Canonical resource schema verification service for CLI and MCP write paths.
import { validateFrameworkSchema } from '../../../engine/frameworks/definitions/framework-schema.js';
import { validateGateSchema } from '../../../engine/gates/core/gate-schema.js';
import { validateScriptToolSchema } from '../../../modules/automation/core/script-schema.js';
import { validateStyleSchema } from '../../../modules/formatting/core/style-schema.js';
import { validatePromptYaml } from '../../../modules/prompts/prompt-schema.js';
import { loadYamlFileSync } from '../../../shared/utils/yaml/index.js';

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
