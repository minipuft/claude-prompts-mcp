// @lifecycle canonical - Validates framework identifiers against the manager.
/**
 * Framework Validator
 * Centralized validation and normalization for framework identifiers.
 *
 * This class serves as the single entrypoint for verifying framework identifiers
 * across parsing, execution, and state-management components. All lookups are
 * delegated to the FrameworkManager to ensure a single source of truth.
 */
import { Logger } from '../logging/index.js';
import { ValidationError, type ErrorContext } from '../utils/errorHandling.js';

import type { FrameworkManager } from './framework-manager.js';
import type { FrameworkDefinition } from './types/index.js';

export interface FrameworkValidationOptions {
  /** Reject disabled frameworks when true */
  requireEnabled?: boolean;
  /** Optional identifier for logging/error context (ex: pipeline stage name) */
  stage?: string;
  /** Additional context merged into raised ValidationError instances */
  context?: Partial<ErrorContext>;
}

export interface FrameworkExistenceOptions {
  /** Only consider enabled frameworks */
  enabledOnly?: boolean;
}

export interface FrameworkValidationResult {
  normalizedId: string;
  definition: FrameworkDefinition;
}

interface FrameworkValidatorConfig {
  /** Default action label injected into ValidationError context */
  defaultStage?: string;
}

export class FrameworkValidator {
  private readonly defaultStage: string;

  constructor(
    private readonly frameworkManager: FrameworkManager,
    private readonly logger: Logger,
    config: FrameworkValidatorConfig = {}
  ) {
    this.defaultStage = config.defaultStage ?? 'framework_validation';
  }

  /**
   * Validate and normalize an identifier, returning the framework definition.
   * Throws ValidationError when identifier is missing, unknown, or disabled.
   */
  validateAndNormalize(
    frameworkId: string,
    options: FrameworkValidationOptions = {}
  ): FrameworkValidationResult {
    const normalizedId = this.tryNormalize(frameworkId);
    if (!normalizedId) {
      throw this.buildMissingFrameworkError(frameworkId, options);
    }

    const definition = this.frameworkManager.getFramework(normalizedId);
    if (!definition) {
      throw this.buildMissingFrameworkError(frameworkId, options);
    }

    if (options.requireEnabled && !definition.enabled) {
      throw this.buildDisabledFrameworkError(definition.id, options);
    }

    this.logger.debug('[FrameworkValidator] Framework validated', {
      requestedId: frameworkId,
      normalizedId: definition.id,
      requireEnabled: options.requireEnabled ?? false,
    });

    return {
      normalizedId: definition.id,
      definition,
    };
  }

  /**
   * Return true when the identifier exists in the registry.
   */
  exists(frameworkId: string, options: FrameworkExistenceOptions = {}): boolean {
    const normalizedId = this.tryNormalize(frameworkId);
    if (!normalizedId) {
      return false;
    }

    if (options.enabledOnly) {
      return this.frameworkManager.isFrameworkEnabled(normalizedId);
    }

    return Boolean(this.frameworkManager.getFramework(normalizedId));
  }

  /**
   * Try to normalize the identifier without raising errors.
   */
  tryNormalize(frameworkId: string | undefined | null): string | null {
    if (!frameworkId || typeof frameworkId !== 'string') {
      return null;
    }

    const trimmed = frameworkId.trim();
    if (!trimmed) {
      return null;
    }

    const validation = this.frameworkManager.validateIdentifier(trimmed);
    if (!validation.valid) {
      return null;
    }

    return validation.normalizedId ?? trimmed.toUpperCase();
  }

  private buildMissingFrameworkError(
    frameworkId: string,
    options: FrameworkValidationOptions
  ): ValidationError {
    const sanitized = frameworkId?.trim() ?? '';
    const availableFrameworks = this.frameworkManager.getFrameworkIds(false);
    const availableList = availableFrameworks.length
      ? availableFrameworks.join(', ')
      : 'none registered';

    const message = sanitized
      ? `Framework '@${sanitized}' not found. Available frameworks: ${availableList}. ` +
        `Use system_control({ action: "framework", operation: "list" }) for details.`
      : `Framework identifier is required. Available frameworks: ${availableList}. ` +
        `Use system_control({ action: "framework", operation: "list" }) for details.`;

    return new ValidationError(message, this.buildErrorContext(frameworkId, options));
  }

  private buildDisabledFrameworkError(
    frameworkId: string,
    options: FrameworkValidationOptions
  ): ValidationError {
    const message =
      `Framework '@${frameworkId}' is currently disabled. ` +
      `Use system_control({ action: "framework", operation: "list" }) to review enabled frameworks or re-enable it before retrying.`;

    const context = this.buildErrorContext(frameworkId, options);
    context.suggestions = [
      'Enable the framework through system_control before executing symbolic framework overrides',
      ...(context.suggestions || []),
    ];

    return new ValidationError(message, context);
  }

  private buildErrorContext(
    frameworkId: string,
    options: FrameworkValidationOptions
  ): ErrorContext {
    const availableFrameworks = this.frameworkManager.getFrameworkIds(true);
    const defaultSuggestions = [
      'Run system_control({ action: "framework", operation: "list" }) to review available frameworks',
      'Ensure the framework prefix matches the registry entry (e.g., @CAGEERF)',
    ];

    return {
      action: options.stage ?? this.defaultStage,
      userInput: { frameworkId },
      suggestions: options.context?.suggestions ?? defaultSuggestions,
      relatedComponents: ['framework-validator', 'framework-manager'],
      ...options.context,
      details: {
        availableFrameworks,
        ...(options.context?.details ?? {}),
      },
    };
  }
}
