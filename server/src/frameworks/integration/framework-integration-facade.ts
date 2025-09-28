/**
 * Framework Integration Facade - Centralized Framework Access Pattern
 *
 * Purpose: Provide a single, safe interface for all framework-dependent operations
 * across the codebase. This facade ensures framework enable/disable state is
 * consistently checked and provides sensible defaults when framework is disabled.
 *
 * Benefits:
 * - Single source of truth for framework state checks
 * - Eliminates repetitive enable/disable validation code
 * - Provides safe defaults when framework system is disabled
 * - Makes it easy to add/remove framework parameters in the future
 * - Impossible to accidentally use framework when disabled
 */

import { Logger } from "../../logging/index.js";
import { FrameworkStateManager } from "../framework-state-manager.js";
import { FrameworkManager, FrameworkDefinition, FrameworkExecutionContext, FrameworkSelectionCriteria } from "../framework-manager.js";
import { ConvertedPrompt } from "../../types/index.js";

/**
 * Framework metadata for response building
 */
export interface FrameworkResponseMetadata {
  framework?: string;
  methodology?: string;
  confidence?: number;
  selectionReason?: string;
}

/**
 * Framework analysis result wrapper
 */
export interface FrameworkAnalysisResult {
  hasFrameworkRecommendation: boolean;
  recommendedFramework?: string;
  reasoning: string[];
  confidence: number;
}

/**
 * Framework Integration Facade Interface
 *
 * Provides safe, centralized access to all framework operations with
 * built-in enable/disable checks and sensible defaults.
 */
export interface FrameworkIntegrationFacade {
  // Core state checks
  isEnabled(): boolean;
  getActiveFrameworkName(): string | null;
  getActiveFramework(): FrameworkDefinition | null;

  // Context generation (returns null when disabled)
  generateExecutionContext(prompt: ConvertedPrompt, criteria?: FrameworkSelectionCriteria): FrameworkExecutionContext | null;
  getFrameworkMetadata(): FrameworkResponseMetadata;

  // Integration helpers
  shouldInjectFramework(): boolean;
  shouldApplyFrameworkGates(): boolean;
  shouldShowFrameworkInfo(): boolean;

  // Framework-aware operations (safely handle disabled state)
  executeWithFramework<T>(
    enabledCallback: (framework: FrameworkDefinition) => T,
    disabledCallback: () => T
  ): T;

  // Metadata builders (return empty/default when disabled)
  buildFrameworkResponse(): FrameworkResponseMetadata;
  buildFrameworkAnalysis(): FrameworkAnalysisResult;
  buildFrameworkRecommendations(): string[];

  // Framework management operations
  enableFramework(reason?: string): void;
  disableFramework(reason?: string): void;
  switchFramework(targetFramework: string, reason?: string): Promise<boolean>;
}

/**
 * Framework Integration Facade Implementation
 *
 * Wraps FrameworkStateManager and FrameworkManager to provide safe access
 * with built-in enable/disable checks for all operations.
 */
export class FrameworkIntegrationFacadeImpl implements FrameworkIntegrationFacade {
  private frameworkStateManager: FrameworkStateManager;
  private frameworkManager: FrameworkManager;
  private logger: Logger;

  constructor(
    frameworkStateManager: FrameworkStateManager,
    frameworkManager: FrameworkManager,
    logger: Logger
  ) {
    this.frameworkStateManager = frameworkStateManager;
    this.frameworkManager = frameworkManager;
    this.logger = logger;
  }

  // Core state checks

  isEnabled(): boolean {
    return this.frameworkStateManager?.isFrameworkSystemEnabled() ?? false;
  }

  getActiveFrameworkName(): string | null {
    if (!this.isEnabled()) {
      return null;
    }
    return this.frameworkStateManager?.getActiveFramework()?.name ?? null;
  }

  getActiveFramework(): FrameworkDefinition | null {
    if (!this.isEnabled()) {
      return null;
    }
    return this.frameworkStateManager?.getActiveFramework() ?? null;
  }

  // Context generation

  generateExecutionContext(prompt: ConvertedPrompt, criteria?: FrameworkSelectionCriteria): FrameworkExecutionContext | null {
    if (!this.isEnabled()) {
      this.logger.debug(`Framework system disabled - no execution context generated for prompt: ${prompt.id}`);
      return null;
    }

    return this.frameworkStateManager.generateExecutionContext(prompt, criteria);
  }

  getFrameworkMetadata(): FrameworkResponseMetadata {
    if (!this.isEnabled()) {
      return {}; // Empty metadata when disabled
    }

    const activeFramework = this.getActiveFramework();
    if (!activeFramework) {
      return {};
    }

    return {
      framework: activeFramework.name,
      methodology: activeFramework.methodology,
      confidence: 1.0,
      selectionReason: "Active framework"
    };
  }

  // Integration helpers

  shouldInjectFramework(): boolean {
    return this.isEnabled();
  }

  shouldApplyFrameworkGates(): boolean {
    return this.isEnabled();
  }

  shouldShowFrameworkInfo(): boolean {
    return this.isEnabled();
  }

  // Framework-aware operations

  executeWithFramework<T>(
    enabledCallback: (framework: FrameworkDefinition) => T,
    disabledCallback: () => T
  ): T {
    if (!this.isEnabled()) {
      this.logger.debug("Framework system disabled - executing disabled callback");
      return disabledCallback();
    }

    const activeFramework = this.getActiveFramework();
    if (!activeFramework) {
      this.logger.warn("Framework system enabled but no active framework found - executing disabled callback");
      return disabledCallback();
    }

    return enabledCallback(activeFramework);
  }

  // Metadata builders

  buildFrameworkResponse(): FrameworkResponseMetadata {
    return this.executeWithFramework(
      (framework) => ({
        framework: framework.name,
        methodology: framework.methodology,
        confidence: 1.0,
        selectionReason: `Using ${framework.name} methodology`
      }),
      () => ({}) // Empty response when disabled
    );
  }

  buildFrameworkAnalysis(): FrameworkAnalysisResult {
    return this.executeWithFramework<FrameworkAnalysisResult>(
      (framework): FrameworkAnalysisResult => ({
        hasFrameworkRecommendation: true,
        recommendedFramework: framework.name,
        reasoning: [`${framework.name} methodology selected`, framework.description],
        confidence: 1.0
      }),
      (): FrameworkAnalysisResult => ({
        hasFrameworkRecommendation: false,
        reasoning: ["Framework system disabled"],
        confidence: 0.0
      })
    );
  }

  buildFrameworkRecommendations(): string[] {
    return this.executeWithFramework(
      (framework) => [
        `Apply ${framework.name} methodology`,
        `Follow ${framework.methodology} principles`,
        "Leverage framework-specific guidance"
      ],
      () => ["Use standard execution approach"] // Basic recommendation when disabled
    );
  }

  // Framework management operations

  enableFramework(reason?: string): void {
    this.frameworkStateManager.enableFrameworkSystem(reason);
    this.logger.info(`Framework system enabled via facade: ${reason || 'No reason provided'}`);
  }

  disableFramework(reason?: string): void {
    this.frameworkStateManager.disableFrameworkSystem(reason);
    this.logger.info(`Framework system disabled via facade: ${reason || 'No reason provided'}`);
  }

  async switchFramework(targetFramework: string, reason?: string): Promise<boolean> {
    if (!this.isEnabled()) {
      this.logger.warn(`Cannot switch framework - system is disabled. Enable first to switch to: ${targetFramework}`);
      return false;
    }

    const success = await this.frameworkStateManager.switchFramework({
      targetFramework,
      reason: reason || `Framework switch via facade to ${targetFramework}`
    });

    this.logger.info(`Framework switch via facade: ${success ? 'successful' : 'failed'} (${targetFramework})`);
    return success;
  }
}

/**
 * Factory function to create Framework Integration Facade
 */
export function createFrameworkIntegrationFacade(
  frameworkStateManager: FrameworkStateManager,
  frameworkManager: FrameworkManager,
  logger: Logger
): FrameworkIntegrationFacade {
  return new FrameworkIntegrationFacadeImpl(frameworkStateManager, frameworkManager, logger);
}

/**
 * Usage Examples:
 *
 * // Instead of direct framework access:
 * // const framework = frameworkStateManager?.isFrameworkSystemEnabled() ? frameworkStateManager?.getActiveFramework() : null;
 *
 * // Use the facade:
 * const framework = frameworkFacade.getActiveFramework();
 *
 * // Instead of complex conditional logic:
 * // if (frameworkStateManager?.isFrameworkSystemEnabled()) {
 * //   const context = frameworkStateManager.generateExecutionContext(prompt);
 * //   // ... framework processing
 * // } else {
 * //   // ... standard processing
 * // }
 *
 * // Use the facade with executeWithFramework:
 * const result = frameworkFacade.executeWithFramework(
 *   (framework) => processWithFramework(prompt, framework),
 *   () => processStandard(prompt)
 * );
 *
 * // Simple metadata building:
 * const metadata = frameworkFacade.buildFrameworkResponse();
 */