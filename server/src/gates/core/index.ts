// @lifecycle canonical - Barrel exports for gate core helpers.
/**
 * Core Gate System - Main Exports
 * Provides guidance and validation capabilities for prompt execution
 */

import { GateSystemManager } from '../gate-state-manager.js';
import { GateLoader, createGateLoader } from './gate-loader.js';
import { GateValidator, createGateValidator } from './gate-validator.js';
import {
  TemporaryGateRegistry,
  createTemporaryGateRegistry,
  type TemporaryGateDefinition,
} from './temporary-gate-registry.js';

import type { ValidationResult } from '../../execution/types.js';

export { GateLoader, createGateLoader } from './gate-loader.js';
export { GateValidator, createGateValidator } from './gate-validator.js';
export {
  TemporaryGateRegistry,
  createTemporaryGateRegistry,
  type TemporaryGateDefinition as TemporaryGateRegistryDefinition,
} from './temporary-gate-registry.js';

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
  private gateSystemManager?: GateSystemManager;
  private temporaryGateRegistry?: TemporaryGateRegistry;

  constructor(
    public gateLoader: GateLoader,
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

    const context = {
      content,
      metadata: validationContext.metadata,
      executionContext: {
        promptId: validationContext.promptId,
        stepId: validationContext.stepId,
        attemptNumber: validationContext.attemptNumber,
        previousAttempts: validationContext.previousAttempts,
      },
    };

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
    enableTemporaryGates?: boolean;
    maxMemoryGates?: number;
    defaultExpirationMs?: number;
    llmConfig?: any; // LLMIntegrationConfig from types
  }
): LightweightGateSystem {
  // Create temporary gate registry if enabled
  let temporaryGateRegistry: TemporaryGateRegistry | undefined;
  if (options?.enableTemporaryGates !== false) {
    temporaryGateRegistry = createTemporaryGateRegistry(logger, {
      maxMemoryGates: options?.maxMemoryGates,
      defaultExpirationMs: options?.defaultExpirationMs,
    });
  }

  const gateLoader = createGateLoader(logger, gatesDirectory, temporaryGateRegistry);
  const gateValidator = createGateValidator(logger, gateLoader, options?.llmConfig);

  const gateSystem = new LightweightGateSystem(gateLoader, gateValidator, temporaryGateRegistry);

  if (gateSystemManager) {
    gateSystem.setGateSystemManager(gateSystemManager);
  }

  return gateSystem;
}
