/**
 * Prompt Guidance Service - Phase 3 Implementation
 *
 * Unified service that orchestrates all prompt guidance components.
 * Provides a single integration point for MCP tools to access methodology guidance.
 */

import { Logger } from "../../logging/index.js";
import { ConvertedPrompt } from "../../types/index.js";
import type { ContentAnalysisResult } from "../../semantic/types.js";
import {
  SystemPromptInjector,
  createSystemPromptInjector
} from "./system-prompt-injector.js";
import {
  MethodologyTracker,
  createMethodologyTracker,
  type MethodologyTrackerConfig
} from "./methodology-tracker.js";
import {
  TemplateEnhancer,
  createTemplateEnhancer
} from "./template-enhancer.js";
import {
  SystemPromptInjectionResult,
  TemplateEnhancementResult,
  MethodologyState,
  MethodologySwitchRequest
} from "../types/index.js";
import {
  FrameworkDefinition,
  IMethodologyGuide
} from "../types/index.js";
import { FrameworkManager } from "../framework-manager.js";

/**
 * Prompt guidance service configuration
 */
type MethodologyTrackingServiceConfig = Partial<MethodologyTrackerConfig> & {
  enabled: boolean;
};

export interface PromptGuidanceServiceConfig {
  systemPromptInjection: {
    enabled: boolean;
    injectionMethod: 'template' | 'append' | 'prepend' | 'smart';
    enableTemplateVariables: boolean;
    enableContextualEnhancement: boolean;
  };
  templateEnhancement: {
    enabled: boolean;
    enhancementLevel: 'minimal' | 'moderate' | 'comprehensive';
    enableArgumentSuggestions: boolean;
    enableStructureOptimization: boolean;
  };
  methodologyTracking: MethodologyTrackingServiceConfig;
}

/**
 * Comprehensive prompt guidance result
 */
export interface PromptGuidanceResult {
  originalPrompt: ConvertedPrompt;
  enhancedPrompt?: ConvertedPrompt;
  systemPromptInjection?: SystemPromptInjectionResult;
  templateEnhancement?: TemplateEnhancementResult;
  activeMethodology: string;
  guidanceApplied: boolean;
  processingTimeMs: number;
  metadata: {
    frameworkUsed: string;
    enhancementsApplied: string[];
    confidenceScore: number;
    // Phase 4: Semantic analysis metadata
    semanticAware?: boolean;
    semanticComplexity?: 'low' | 'medium' | 'high';
    semanticConfidence?: number;
  };
}

/**
 * Prompt Guidance Service
 *
 * Orchestrates all prompt guidance components to provide intelligent
 * methodology-driven prompt enhancement for MCP tools.
 */
export class PromptGuidanceService {
  private logger: Logger;
  private config: PromptGuidanceServiceConfig;
  private systemPromptInjector: SystemPromptInjector;
  private methodologyTracker!: MethodologyTracker;
  private templateEnhancer: TemplateEnhancer;
  private frameworkManager?: FrameworkManager;
  private initialized: boolean = false;

  constructor(logger: Logger, config?: Partial<PromptGuidanceServiceConfig>) {
    this.logger = logger;
    this.config = {
      systemPromptInjection: {
        enabled: true,
        injectionMethod: 'smart',
        enableTemplateVariables: true,
        enableContextualEnhancement: true
      },
      templateEnhancement: {
        enabled: true,
        enhancementLevel: 'moderate',
        enableArgumentSuggestions: true,
        enableStructureOptimization: true
      },
      methodologyTracking: {
        enabled: true,
        persistStateToDisk: true,
        enableHealthMonitoring: true,
        healthCheckIntervalMs: 30000,
        maxSwitchHistory: 100,
        enableMetrics: true
      },
      ...config
    };

    // Initialize components
    this.systemPromptInjector = createSystemPromptInjector(logger, this.config.systemPromptInjection);
    this.templateEnhancer = createTemplateEnhancer(logger, this.config.templateEnhancement);
  }

  /**
   * Initialize the prompt guidance service
   */
  async initialize(frameworkManager?: FrameworkManager): Promise<void> {
    if (this.initialized) {
      this.logger.debug("PromptGuidanceService already initialized");
      return;
    }

    this.logger.info("Initializing PromptGuidanceService...");

    try {
      // Initialize methodology tracker
      const { enabled: trackingEnabled, ...trackerConfig } =
        this.config.methodologyTracking;
      this.methodologyTracker = await createMethodologyTracker(
        this.logger,
        trackerConfig
      );

      if (!trackingEnabled) {
        this.logger.info(
          "Prompt guidance methodology tracking initialized but marked disabled in config"
        );
      }

      // Set framework manager if provided
      if (frameworkManager) {
        this.frameworkManager = frameworkManager;
      }

      this.initialized = true;
      this.logger.info("PromptGuidanceService initialized successfully");

    } catch (error) {
      this.logger.error("Failed to initialize PromptGuidanceService:", error);
      throw error;
    }
  }

  /**
   * Apply comprehensive prompt guidance to a prompt
   * Phase 4: Enhanced with semantic analysis integration
   */
  async applyGuidance(
    prompt: ConvertedPrompt,
    options: {
      includeSystemPromptInjection?: boolean;
      includeTemplateEnhancement?: boolean;
      frameworkOverride?: string;
      semanticAnalysis?: ContentAnalysisResult;
    } = {}
  ): Promise<PromptGuidanceResult> {
    const startTime = Date.now();

    if (!this.initialized) {
      throw new Error("PromptGuidanceService not initialized. Call initialize() first.");
    }

    this.logger.debug(`Applying prompt guidance for prompt: ${prompt.name}${options.semanticAnalysis ? ' with semantic analysis' : ''}`);

    try {
      // Get current methodology state
      const methodologyState = this.methodologyTracker.getCurrentState();
      const activeFramework = await this.getActiveFramework(options.frameworkOverride);
      const methodologyGuide = await this.getMethodologyGuide(activeFramework.methodology);

      const result: PromptGuidanceResult = {
        originalPrompt: prompt,
        activeMethodology: methodologyState.activeMethodology,
        guidanceApplied: false,
        processingTimeMs: 0,
        metadata: {
          frameworkUsed: activeFramework.methodology,
          enhancementsApplied: [],
          confidenceScore: 0,
          // Phase 4: Semantic analysis metadata
          semanticAware: options.semanticAnalysis !== undefined,
          semanticComplexity: options.semanticAnalysis?.complexity,
          semanticConfidence: options.semanticAnalysis?.confidence
        }
      };

      let enhancedPrompt = { ...prompt };
      let totalConfidence = 0;
      let enhancementCount = 0;

      // Apply system prompt injection if enabled
      if (this.config.systemPromptInjection.enabled &&
          (options.includeSystemPromptInjection !== false)) {

        try {
          const injectionResult = this.systemPromptInjector.injectMethodologyGuidance(
            prompt,
            activeFramework,
            methodologyGuide,
            options.semanticAnalysis
          );

          result.systemPromptInjection = injectionResult;

          // FIXED: Combine original system message with framework-injected guidance
          // This preserves the original prompt's system message while adding framework context
          const originalSystemMessage = prompt.systemMessage || '';
          const frameworkGuidance = injectionResult.enhancedPrompt;

          // Combine both: framework guidance first (sets context), then original system message
          enhancedPrompt.systemMessage = originalSystemMessage
            ? `${frameworkGuidance}\n\n${originalSystemMessage}`
            : frameworkGuidance;

          result.metadata.enhancementsApplied.push('system_prompt_injection');
          totalConfidence += injectionResult.metadata.confidence;
          enhancementCount++;
          result.guidanceApplied = true;

          this.logger.debug(`System prompt injection applied with confidence: ${injectionResult.metadata.confidence}`);

        } catch (error) {
          this.logger.warn("System prompt injection failed:", error);
        }
      }

      // Apply template enhancement if enabled
      if (this.config.templateEnhancement.enabled &&
          (options.includeTemplateEnhancement !== false)) {

        try {
          const enhancementResult = await this.templateEnhancer.enhanceTemplate(
            enhancedPrompt.userMessageTemplate,
            enhancedPrompt,
            methodologyGuide,
            activeFramework,
            undefined, // context
            options.semanticAnalysis
          );

          result.templateEnhancement = enhancementResult;

          // Update enhanced prompt with enhanced template
          enhancedPrompt.userMessageTemplate = enhancementResult.enhancedTemplate;

          result.metadata.enhancementsApplied.push('template_enhancement');
          totalConfidence += enhancementResult.validation.score / 100; // Convert to 0-1 scale
          enhancementCount++;
          result.guidanceApplied = true;

          this.logger.debug(`Template enhancement applied with score: ${enhancementResult.validation.score}`);

        } catch (error) {
          this.logger.warn("Template enhancement failed:", error);
        }
      }

      // Set enhanced prompt and calculate metrics
      if (result.guidanceApplied) {
        result.enhancedPrompt = enhancedPrompt;
        result.metadata.confidenceScore = enhancementCount > 0 ? totalConfidence / enhancementCount : 0;
      }

      result.processingTimeMs = Date.now() - startTime;

      this.logger.debug(`Prompt guidance completed in ${result.processingTimeMs}ms with confidence: ${result.metadata.confidenceScore}`);
      return result;

    } catch (error) {
      this.logger.error("Failed to apply prompt guidance:", error);

      // Return minimal result on error
      return {
        originalPrompt: prompt,
        activeMethodology: this.methodologyTracker?.getCurrentState()?.activeMethodology || 'CAGEERF',
        guidanceApplied: false,
        processingTimeMs: Date.now() - startTime,
        metadata: {
          frameworkUsed: 'error',
          enhancementsApplied: [],
          confidenceScore: 0
        }
      };
    }
  }

  /**
   * Switch methodology using the tracker
   */
  async switchMethodology(request: MethodologySwitchRequest): Promise<boolean> {
    if (!this.initialized) {
      throw new Error("PromptGuidanceService not initialized");
    }

    this.logger.info(`Switching methodology to: ${request.targetMethodology}`);
    return await this.methodologyTracker.switchMethodology(request);
  }

  /**
   * Get current methodology state
   */
  getCurrentMethodologyState(): MethodologyState {
    if (!this.initialized) {
      throw new Error("PromptGuidanceService not initialized");
    }

    return this.methodologyTracker.getCurrentState();
  }

  /**
   * Get methodology system health
   */
  getSystemHealth() {
    if (!this.initialized) {
      throw new Error("PromptGuidanceService not initialized");
    }

    return this.methodologyTracker.getSystemHealth();
  }

  /**
   * Enable or disable the entire guidance system
   */
  setGuidanceEnabled(enabled: boolean): void {
    this.config.systemPromptInjection.enabled = enabled;
    this.config.templateEnhancement.enabled = enabled;
    this.config.methodologyTracking.enabled = enabled;

    this.logger.info(`Prompt guidance system ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Update service configuration
   */
  updateConfig(config: Partial<PromptGuidanceServiceConfig>): void {
    this.config = { ...this.config, ...config };

    // Update component configurations
    this.systemPromptInjector.updateConfig(config.systemPromptInjection || {});
    this.templateEnhancer.updateConfig(config.templateEnhancement || {});

    if (config.methodologyTracking && this.methodologyTracker) {
      const { enabled: trackingEnabled, ...trackerConfig } =
        config.methodologyTracking;

      if (typeof trackingEnabled === 'boolean') {
        this.config.methodologyTracking.enabled = trackingEnabled;
      }

      this.methodologyTracker.updateConfig(trackerConfig);
    }

    this.logger.debug("PromptGuidanceService configuration updated");
  }

  /**
   * Shutdown the service and cleanup resources
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.logger.info("Shutting down PromptGuidanceService...");

    if (this.methodologyTracker) {
      await this.methodologyTracker.shutdown();
    }

    this.initialized = false;
    this.logger.info("PromptGuidanceService shutdown complete");
  }

  /**
   * Set framework manager for guidance operations
   */
  setFrameworkManager(frameworkManager: FrameworkManager): void {
    this.frameworkManager = frameworkManager;
    this.logger.debug("FrameworkManager set for PromptGuidanceService");
  }

  /**
   * Check if service is initialized and ready
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get current service configuration
   */
  getConfig(): PromptGuidanceServiceConfig {
    return { ...this.config };
  }

  /**
   * Get active framework definition
   */
  private async getActiveFramework(frameworkOverride?: string): Promise<FrameworkDefinition> {
    if (!this.frameworkManager) {
      throw new Error("FrameworkManager not set");
    }

    const methodologyState = this.methodologyTracker.getCurrentState();
    const targetMethodology = frameworkOverride || methodologyState.activeMethodology;

    const framework = this.frameworkManager.getFramework(targetMethodology);
    if (!framework) {
      throw new Error(`Framework ${targetMethodology} not found`);
    }

    return framework;
  }

  /**
   * Get methodology guide for framework
   */
  private async getMethodologyGuide(methodology: string): Promise<IMethodologyGuide> {
    if (!this.frameworkManager) {
      throw new Error("FrameworkManager not set");
    }

    const guide = this.frameworkManager.getMethodologyGuide(methodology);
    if (!guide) {
      throw new Error(`Methodology guide for ${methodology} not found`);
    }

    return guide;
  }
}

/**
 * Create and initialize a PromptGuidanceService instance
 */
export async function createPromptGuidanceService(
  logger: Logger,
  config?: Partial<PromptGuidanceServiceConfig>,
  frameworkManager?: FrameworkManager
): Promise<PromptGuidanceService> {
  const service = new PromptGuidanceService(logger, config);
  await service.initialize(frameworkManager);
  return service;
}
