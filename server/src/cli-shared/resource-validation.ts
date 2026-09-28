// @lifecycle canonical - Compatibility adapter over canonical ResourceVerificationService for CLI+MCP callers.
import {
  ResourceVerificationService,
  type ResourceVerificationIssue,
  type ResourceVerificationResult,
  type ResourceVerificationType,
} from '#modules/resources/services/resource-verification-service.js';

export type ResourceValidationType = Exclude<ResourceVerificationType, 'tools'>;
export type ResourceValidationIssue = ResourceVerificationIssue;
export type ResourceValidationResult = ResourceVerificationResult;

const verificationService = new ResourceVerificationService();

/**
 * The CLI reports an inline gate the loader would drop as an error (R117): `cpm validate` and
 * `cpm init` fail on one, and `runValidatedMutation` refuses only one its mutation introduced.
 */
const CLI_CHECKS = { unloadableInlineGates: true } as const;

export function validateResourceDocument(
  resourceType: ResourceValidationType,
  resourceId: string,
  filePath: string,
  data: unknown
): ResourceValidationResult {
  return verificationService.validateDocument(resourceType, resourceId, filePath, data, CLI_CHECKS);
}

export function validateResourceFile(
  resourceType: ResourceValidationType,
  resourceId: string,
  filePath: string
): ResourceValidationResult {
  return verificationService.validateFile(resourceType, resourceId, filePath, CLI_CHECKS);
}

export function formatValidationIssues(issues: ResourceValidationIssue[]): string[] {
  return verificationService.formatIssues(issues);
}
