// @lifecycle canonical - Barrel exports for gate core helpers.
/**
 * Core Gate System - Main Exports
 * Provides guidance and validation capabilities for prompt execution
 *
 * New registry-based architecture exports:
 * - GateDefinitionLoader: YAML + MD loading with caching
 * - Gate schema validation utilities
 */

import { GateSystemManager } from '../gate-state-manager.js';
import { GateLoader, createGateLoader } from './gate-loader.js';
import { GateValidator, createGateValidator } from './gate-validator.js';
import {
  TemporaryGateRegistry,
  createTemporaryGateRegistry,
  type TemporaryGateDefinition,
} from './temporary-gate-registry.js';

import type { GateDefinitionProvider } from './gate-loader.js';
import type { ValidationResult } from '../../execution/types.js';
import type { ValidationContext } from '../types.js';

export { GateLoader, createGateLoader, type GateDefinitionProvider } from './gate-loader.js';
export { GateValidator, createGateValidator } from './gate-validator.js';
export {
  TemporaryGateRegistry,
  createTemporaryGateRegistry,
  type TemporaryGateDefinition as TemporaryGateRegistryDefinition,
} from './temporary-gate-registry.js';
// RuntimeGateLoader removed - redundant with GateDefinitionLoader
// Use GateDefinitionLoader for YAML+MD loading with hot-reload support

// ============================================================================
// New Registry-Based Architecture (Phase 2)
// ============================================================================

// Gate Definition Loader - YAML + MD loading with caching
export {
  GateDefinitionLoader,
  createGateDefinitionLoader,
  getDefaultGateDefinitionLoader,
  resetDefaultGateDefinitionLoader,
  type GateDefinitionLoaderConfig,
  type GateLoaderStats as GateDefinitionLoaderStats,
  type GateSchemaValidationResult,
} from './gate-definition-loader.js';

// Gate Schema - Zod validation for gate.yaml files
export {
  GateDefinitionSchema,
  GatePassCriteriaSchema,
  GateActivationSchema,
  GateRetryConfigSchema,
  validateGateSchema,
  isValidGateDefinition,
  type GateDefinitionYaml as GateDefinitionYamlSchema,
  type GatePassCriteriaYaml,
  type GateActivationYaml,
  type GateRetryConfigYaml,
} from './gate-schema.js';

export type { ValidationResult } from '../../execution/types.js';
export type {
  GateActivationResult,
  GatePassCriteria,
  LightweightGateDefinition,
  ValidationCheck,
  ValidationContext,
} from '../types.js';
export type { GateValidationStatistics } from './gate-validator.js';

/**
 * Core gate system manager with temporary gate support
 */
export class LightweightGateSystem {
  private gateSystemManager: GateSystemManager | undefined;
  private temporaryGateRegistry: TemporaryGateRegistry | undefined;

  constructor(
    public gateLoader: GateDefinitionProvider,
    public gateValidator: GateValidator,
    temporaryGateRegistry?: TemporaryGateRegistry
  ) {
    this.temporaryGateRegistry = temporaryGateRegistry;
  }

  /**
   * Set gate system manager for runtime state checking
   */
  setGateSystemManager(gateSystemManager: GateSystemManager): void {
    this.gateSystemManager = gateSystemManager;
  }

  /**
   * Set temporary gate registry
   */
  setTemporaryGateRegistry(temporaryGateRegistry: TemporaryGateRegistry): void {
    this.temporaryGateRegistry = temporaryGateRegistry;
  }

  /**
   * Create a temporary gate
   */
  createTemporaryGate(
    definition: Omit<TemporaryGateDefinition, 'id' | 'created_at'>,
    scopeId?: string
  ): string | null {
    if (!this.temporaryGateRegistry) {
      return null;
    }
    return this.temporaryGateRegistry.createTemporaryGate(definition, scopeId);
  }

  /**
   * Get temporary gates for scope
   */
  getTemporaryGatesForScope(scope: string, scopeId: string): TemporaryGateDefinition[] {
    if (!this.temporaryGateRegistry) {
      return [];
    }
    return this.temporaryGateRegistry.getTemporaryGatesForScope(scope, scopeId);
  }

  /**
   * Clean up temporary gates for scope
   */
  cleanupTemporaryGates(scope: string, scopeId?: string): number {
    if (!this.temporaryGateRegistry) {
      return 0;
    }
    return this.temporaryGateRegistry.cleanupScope(scope, scopeId);
  }

  /**
   * Check if gate system is enabled
   */
  private isGateSystemEnabled(): boolean {
    // If no gate system manager is set, default to enabled for backwards compatibility
    if (!this.gateSystemManager) {
      return true;
    }
    return this.gateSystemManager.isGateSystemEnabled();
  }

  /**
   * Get guidance text for active gates
   */
  async getGuidanceText(
    gateIds: string[],
    context: {
      promptCategory?: string;
      framework?: string;
      explicitRequest?: boolean;
    }
  ): Promise<string[]> {
    // Check if gate system is enabled
    if (!this.isGateSystemEnabled()) {
      return []; // Return empty guidance if gates are disabled
    }

    const activation = await this.gateLoader.getActiveGates(gateIds, context);
    return activation.guidanceText;
  }

  /**
   * Validate content against active gates
   */
  async validateContent(
    gateIds: string[],
    content: string,
    validationContext: {
      promptId?: string;
      stepId?: string;
      attemptNumber?: number;
      previousAttempts?: string[];
      metadata?: Record<string, any>;
    }
  ): Promise<ValidationResult[]> {
    // Check if gate system is enabled
    if (!this.isGateSystemEnabled()) {
      // Return success results for all gates if system is disabled
      return gateIds.map((gateId) => ({
        gateId,
        valid: true,
        passed: true,
        message: 'Gate system disabled - validation skipped',
        score: 1.0,
        details: {},
        retryHints: [],
        suggestions: [],
      }));
    }

    const startTime = performance.now();

    const context: ValidationContext = {
      content,
    };

    if (validationContext.metadata) {
      context.metadata = validationContext.metadata;
    }

    const executionContext: NonNullable<ValidationContext['executionContext']> = {};
    if (validationContext.promptId) {
      executionContext.promptId = validationContext.promptId;
    }
    if (validationContext.stepId) {
      executionContext.stepId = validationContext.stepId;
    }
    if (validationContext.attemptNumber !== undefined) {
      executionContext.attemptNumber = validationContext.attemptNumber;
    }
    if (validationContext.previousAttempts) {
      executionContext.previousAttempts = validationContext.previousAttempts;
    }

    if (Object.keys(executionContext).length > 0) {
      context.executionContext = executionContext;
    }

    const results = await this.gateValidator.validateGates(gateIds, context);

    // Record validation metrics if gate system manager is available
    if (this.gateSystemManager) {
      const executionTime = performance.now() - startTime;
      const success = results.every((r) => r.passed);
      this.gateSystemManager.recordValidation(success, executionTime);
    }

    return results;
  }

  /**
   * Check if content should be retried based on validation results
   */
  shouldRetry(
    validationResults: ValidationResult[],
    currentAttempt: number,
    maxAttempts: number = 3
  ): boolean {
    return this.gateValidator.shouldRetry(validationResults, currentAttempt, maxAttempts);
  }

  /**
   * Get combined retry hints from all failed validations
   */
  getRetryHints(validationResults: ValidationResult[]): string[] {
    const allHints: string[] = [];

    for (const result of validationResults) {
      if (!result.passed) {
        allHints.push(`**${result.gateId}:**`);
        if (result.retryHints) {
          allHints.push(...result.retryHints);
        }
        allHints.push(''); // Empty line for separation
      }
    }

    return allHints;
  }

  /**
   * Get system statistics
   */
  getStatistics() {
    return {
      gateLoader: this.gateLoader.getStatistics(),
      gateValidator: this.gateValidator.getStatistics(),
    };
  }

  /**
   * Get the temporary gate registry instance (enhancement)
   */
  getTemporaryGateRegistry(): TemporaryGateRegistry | undefined {
    return this.temporaryGateRegistry;
  }

  /**
   * Cleanup the lightweight gate system and sub-components
   * Prevents async handle leaks by delegating to sub-component cleanup
   */
  async cleanup(): Promise<void> {
    // Cleanup gate system manager if present
    if (
      this.gateSystemManager &&
      'cleanup' in this.gateSystemManager &&
      typeof (this.gateSystemManager as any).cleanup === 'function'
    ) {
      try {
        await (this.gateSystemManager as any).cleanup();
      } catch (error) {
        // Errors are already logged by sub-components
      }
    }

    // Cleanup temporary gate registry if present
    if (
      this.temporaryGateRegistry &&
      'cleanup' in this.temporaryGateRegistry &&
      typeof (this.temporaryGateRegistry as any).cleanup === 'function'
    ) {
      try {
        await (this.temporaryGateRegistry as any).cleanup();
      } catch (error) {
        // Errors are already logged by sub-components
      }
    }
  }
}

/**
 * Create a complete core gate system with optional temporary gate support
 */
export function createLightweightGateSystem(
  logger: any,
  gatesDirectory?: string,
  gateSystemManager?: GateSystemManager,
  options?: {
    provider?: GateDefinitionProvider;
    enableTemporaryGates?: boolean;
    maxMemoryGates?: number;
    defaultExpirationMs?: number;
    llmConfig?: any; // LLMIntegrationConfig from types
  }
): LightweightGateSystem {
  // Create temporary gate registry if enabled
  let temporaryGateRegistry: TemporaryGateRegistry | undefined;
  if (options?.enableTemporaryGates !== false) {
    const temporaryGateOptions: Parameters<typeof createTemporaryGateRegistry>[1] = {};
    if (options?.maxMemoryGates !== undefined) {
      temporaryGateOptions.maxMemoryGates = options.maxMemoryGates;
    }
    if (options?.defaultExpirationMs !== undefined) {
      temporaryGateOptions.defaultExpirationMs = options.defaultExpirationMs;
    }
    temporaryGateRegistry = createTemporaryGateRegistry(logger, temporaryGateOptions);
  }

  const gateLoader =
    options?.provider ?? createGateLoader(logger, gatesDirectory, temporaryGateRegistry);
  const gateValidator = createGateValidator(logger, gateLoader, options?.llmConfig);

  const gateSystem = new LightweightGateSystem(gateLoader, gateValidator, temporaryGateRegistry);

  if (gateSystemManager) {
    gateSystem.setGateSystemManager(gateSystemManager);
  }

  return gateSystem;
}
