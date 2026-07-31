// @lifecycle canonical - Orchestrates prompt guidance components for framework-aware prompts.
/**
 * Prompt Guidance Service - Simplified Implementation
 *
 * Unified service that orchestrates prompt guidance components.
 * Simplified: System prompt injection is now inlined (was SystemPromptInjector).
 * Active framework state read from FrameworkManager (backed by SQLite via FrameworkStateStore).
 */

import { Logger } from '../../../infra/logging/index.js';
import { FrameworkManager } from '../framework-manager.js';
import { TemplateEnhancer, createTemplateEnhancer } from './template-enhancer.js';
import {
  FrameworkDefinition,
  FrameworkGuide,
  ProcessingGuidance,
  StepGuidance,
  SystemPromptInjectionResult,
} from '../types/index.js';

import type { ContentAnalysisResult } from '../../../shared/types/index.js';
import type { ConvertedPrompt } from '../../execution/types.js';

export interface PromptGuidanceServiceConfig {
  systemPromptInjection: {
    enabled: boolean;
  };
  templateEnhancement: {
    enabled: boolean;
    enhancementLevel: 'minimal' | 'moderate' | 'comprehensive';
    enableStructureOptimization: boolean;
  };
}

/**
 * Comprehensive prompt guidance result
 */
export interface PromptGuidanceResult {
  originalPrompt: ConvertedPrompt;
  enhancedPrompt?: ConvertedPrompt;
  systemPromptInjection?: SystemPromptInjectionResult;
  templateProcessingGuidance?: ProcessingGuidance;
  executionStepGuidance?: StepGuidance;
  activeFrameworkType: string;
  guidanceApplied: boolean;
  processingTimeMs: number;
  metadata: {
    frameworkUsed: string;
    enhancementsApplied: string[];
    confidenceScore: number;
    semanticAware?: boolean;
    semanticComplexity?: 'low' | 'medium' | 'high';
    semanticConfidence?: number;
  };
}

// Alias for backward compatibility
export type ServicePromptGuidanceResult = PromptGuidanceResult;

/**
 * Prompt Guidance Service
 *
 * Orchestrates prompt guidance: template enhancement and system prompt injection.
 * Active framework state is read from FrameworkManager (SQLite-backed).
 */
export class PromptGuidanceService {
  private logger: Logger;
  private config: PromptGuidanceServiceConfig;
  private templateEnhancer: TemplateEnhancer;
  private frameworkManager?: FrameworkManager;
  private initialized: boolean = false;

  constructor(logger: Logger, config?: Partial<PromptGuidanceServiceConfig>) {
    this.logger = logger;
    this.config = {
      systemPromptInjection: {
        enabled: true,
      },
      templateEnhancement: {
        enabled: true,
        enhancementLevel: 'moderate',
        enableStructureOptimization: true,
      },
      ...config,
    };

    this.templateEnhancer = createTemplateEnhancer(logger, this.config.templateEnhancement);
  }

  /**
   * Initialize the prompt guidance service
   */
  async initialize(frameworkManager?: FrameworkManager): Promise<void> {
    if (this.initialized) {
      this.logger.debug('PromptGuidanceService already initialized');
      return;
    }

    this.logger.info('Initializing PromptGuidanceService...');

    if (frameworkManager) {
      this.frameworkManager = frameworkManager;
    }

    this.initialized = true;
    this.logger.info('PromptGuidanceService initialized successfully');
  }

  /**
   * Apply comprehensive prompt guidance to a prompt
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
      throw new Error('PromptGuidanceService not initialized. Call initialize() first.');
    }

    this.logger.debug(`Applying prompt guidance for prompt: ${prompt.name}`);

    try {
      const activeFramework = await this.getActiveFramework(options.frameworkOverride);
      const frameworkGuide = await this.getFrameworkGuide(activeFramework.type);

      // Surface methodology guidance (read-only hints)
      const processingGuidance = frameworkGuide.guideTemplateProcessing(
        prompt.userMessageTemplate ?? '',
        'single'
      );
      const stepGuidance = frameworkGuide.guideExecutionSteps(
        prompt,
        options.semanticAnalysis ?? ({} as ContentAnalysisResult)
      );

      const result: PromptGuidanceResult = {
        originalPrompt: prompt,
        activeFrameworkType: activeFramework.type,
        templateProcessingGuidance: processingGuidance,
        executionStepGuidance: stepGuidance,
        guidanceApplied: false,
        processingTimeMs: 0,
        metadata: {
          frameworkUsed: activeFramework.type,
          enhancementsApplied: [],
          confidenceScore: 0,
          semanticAware: options.semanticAnalysis !== undefined,
          ...(options.semanticAnalysis?.complexity
            ? { semanticComplexity: options.semanticAnalysis.complexity }
            : {}),
          ...(options.semanticAnalysis?.confidence !== undefined
            ? { semanticConfidence: options.semanticAnalysis.confidence }
            : {}),
        },
      };

      let enhancedPrompt = { ...prompt };
      let totalConfidence = 0;
      let enhancementCount = 0;

      // Apply system prompt injection (inlined - no separate class needed)
      if (
        this.config.systemPromptInjection.enabled &&
        options.includeSystemPromptInjection !== false
      ) {
        try {
          const injectionResult = this.injectFrameworkGuidance(
            prompt,
            activeFramework,
            frameworkGuide
          );

          result.systemPromptInjection = injectionResult;

          // Combine: framework guidance first, then original system message
          const originalSystemMessage = prompt.systemMessage || '';
          const frameworkGuidance = injectionResult.enhancedPrompt;

          enhancedPrompt.systemMessage = originalSystemMessage
            ? `${frameworkGuidance}\n\n${originalSystemMessage}`
            : frameworkGuidance;

          result.metadata.enhancementsApplied.push('system_prompt_injection');
          totalConfidence += injectionResult.metadata.confidence;
          enhancementCount++;
          result.guidanceApplied = true;

          this.logger.debug(
            `System prompt injection applied with confidence: ${injectionResult.metadata.confidence}`
          );
        } catch (error) {
          this.logger.warn('System prompt injection failed:', error);
        }
      }

      // Apply template enhancement if enabled
      if (this.config.templateEnhancement.enabled && options.includeTemplateEnhancement !== false) {
        try {
          const enhancementResult = await this.templateEnhancer.enhanceTemplate(
            enhancedPrompt.userMessageTemplate,
            enhancedPrompt
          );

          enhancedPrompt.userMessageTemplate = enhancementResult.enhancedTemplate;
          result.metadata.enhancementsApplied.push('template_enhancement');
          totalConfidence += enhancementResult.validation.score / 100;
          enhancementCount++;
          result.guidanceApplied = true;

          this.logger.debug(
            `Template enhancement applied with score: ${enhancementResult.validation.score}`
          );
        } catch (error) {
          this.logger.warn('Template enhancement failed:', error);
        }
      }

      if (result.guidanceApplied) {
        result.enhancedPrompt = enhancedPrompt;
        result.metadata.confidenceScore =
          enhancementCount > 0 ? totalConfidence / enhancementCount : 0;
      }

      result.processingTimeMs = Date.now() - startTime;

      this.logger.debug(
        `Prompt guidance completed in ${result.processingTimeMs}ms with confidence: ${result.metadata.confidenceScore}`
      );
      return result;
    } catch (error) {
      this.logger.error('Failed to apply prompt guidance:', error);

      return {
        originalPrompt: prompt,
        activeFrameworkType: 'CAGEERF',
        guidanceApplied: false,
        processingTimeMs: Date.now() - startTime,
        metadata: {
          frameworkUsed: 'error',
          enhancementsApplied: [],
          confidenceScore: 0,
        },
      };
    }
  }

  /**
   * Inject methodology guidance into system prompt (inlined from SystemPromptInjector)
   *
   * Simple implementation: get guidance from methodology guide, combine with template.
   */
  private injectFrameworkGuidance(
    prompt: ConvertedPrompt,
    framework: FrameworkDefinition,
    guide: FrameworkGuide
  ): SystemPromptInjectionResult {
    const startTime = Date.now();

    // Get guidance from methodology guide
    const guidance = guide.getSystemPromptGuidance({
      promptName: prompt.name,
      promptCategory: prompt.category,
      promptType: prompt.chainSteps && prompt.chainSteps.length > 0 ? 'chain' : 'single',
    });

    // Simple injection: template placeholder or append with header
    const template = framework.systemPromptTemplate;
    let enhancedPromptText: string;

    if (template.includes('{FRAMEWORK_GUIDANCE}')) {
      enhancedPromptText = template.replace('{FRAMEWORK_GUIDANCE}', guidance);
    } else {
      enhancedPromptText = `${template}\n\n## ${framework.type} Methodology\n\n${guidance}`;
    }

    // Apply simple variable substitution
    enhancedPromptText = enhancedPromptText
      .replace(/\{PROMPT_NAME\}/g, prompt.name || 'Prompt')
      .replace(/\{PROMPT_CATEGORY\}/g, prompt.category || 'general')
      .replace(/\{FRAMEWORK_NAME\}/g, framework.name)
      .replace(/\{METHODOLOGY\}/g, framework.type)
      .replace(/\{PROMPT_TYPE\}/g, prompt.chainSteps?.length ? 'chain' : 'single');

    return {
      originalPrompt: prompt.userMessageTemplate || '',
      enhancedPrompt: enhancedPromptText,
      injectedGuidance: guidance,
      sourceFramework: framework,
      metadata: {
        injectionTime: new Date(),
        injectionMethod: 'unified',
        variablesUsed: [
          'PROMPT_NAME',
          'PROMPT_CATEGORY',
          'FRAMEWORK_NAME',
          'METHODOLOGY',
          'PROMPT_TYPE',
        ],
        confidence: 1.0,
        processingTimeMs: Date.now() - startTime,
        validationPassed: true,
      },
    };
  }

  /**
   * Enable or disable the guidance system
   */
  setGuidanceEnabled(enabled: boolean): void {
    this.config.systemPromptInjection.enabled = enabled;
    this.config.templateEnhancement.enabled = enabled;

    this.logger.info(`Prompt guidance system ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Update service configuration
   */
  updateConfig(config: Partial<PromptGuidanceServiceConfig>): void {
    this.config = { ...this.config, ...config };

    this.templateEnhancer.updateConfig(config.templateEnhancement || {});

    this.logger.debug('PromptGuidanceService configuration updated');
  }

  /**
   * Shutdown the service
   */
  async shutdown(): Promise<void> {
    if (!this.initialized) {
      return;
    }

    this.logger.info('Shutting down PromptGuidanceService...');

    this.initialized = false;
    this.logger.info('PromptGuidanceService shutdown complete');
  }

  /**
   * Set framework manager for guidance operations
   */
  setFrameworkManager(frameworkManager: FrameworkManager): void {
    this.frameworkManager = frameworkManager;
    this.logger.debug('FrameworkManager set for PromptGuidanceService');
  }

  /**
   * Check if service is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get current configuration
   */
  getConfig(): PromptGuidanceServiceConfig {
    return { ...this.config };
  }

  /**
   * Get active framework definition
   */
  private async getActiveFramework(frameworkOverride?: string): Promise<FrameworkDefinition> {
    if (!this.frameworkManager) {
      throw new Error('FrameworkManager not set');
    }

    const targetFramework = frameworkOverride || this.frameworkManager.selectFramework().type;

    const framework = this.frameworkManager.getFramework(targetFramework);
    if (!framework) {
      throw new Error(`Framework ${targetFramework} not found`);
    }

    return framework;
  }

  /**
   * Get methodology guide for framework
   */
  private async getFrameworkGuide(methodology: string): Promise<FrameworkGuide> {
    if (!this.frameworkManager) {
      throw new Error('FrameworkManager not set');
    }

    const guide = this.frameworkManager.getFrameworkGuide(methodology);
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
