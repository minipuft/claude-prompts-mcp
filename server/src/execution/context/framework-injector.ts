/**
 * Framework Injector - Phase 3
 * Handles framework system prompt injection into execution context
 * Integrates with FrameworkManager to provide methodology-based system prompts
 */

import { Logger } from "../../logging/index.js";
import { ConvertedPrompt } from "../../types/index.js";
import { 
  FrameworkManager, 
  FrameworkExecutionContext,
  FrameworkSelectionCriteria 
} from "../../frameworks/framework-manager.js";
import { ConfigurableSemanticAnalysis } from "../../analysis/configurable-semantic-analyzer.js";
import { 
  IMethodologyGuide,
  MethodologyEnhancement 
} from "../../frameworks/interfaces/methodology-guide-interfaces.js";

/**
 * Framework injection result
 */
export interface FrameworkInjectionResult {
  // Original prompt (unchanged)
  originalPrompt: ConvertedPrompt;
  
  // Framework context
  frameworkContext: FrameworkExecutionContext;
  
  // Enhanced prompt with framework system prompt
  enhancedPrompt: ConvertedPrompt & {
    frameworkSystemPrompt?: string;
    frameworkGuidelines?: string[];
    frameworkMetadata?: {
      selectedFramework: string;
      selectionReason: string;
      confidence: number;
    };
    methodologyEnhancement?: MethodologyEnhancement;
  };
  
  // Injection metadata
  injectionMetadata: {
    injectedAt: Date;
    frameworkId: string;
    injectionMethod: 'system_prompt' | 'user_prefix' | 'guidelines';
    originalSystemMessage?: string;
  };
}

/**
 * Framework injection configuration
 */
export interface FrameworkInjectionConfig {
  enableInjection: boolean;
  injectionMethod: 'system_prompt' | 'user_prefix' | 'guidelines';
  preserveOriginalSystemMessage: boolean;
  includeFrameworkMetadata: boolean;
  userPreferenceOverride?: string;
  enableMethodologyGuides: boolean;
}

/**
 * Framework Injector Implementation
 * Injects framework system prompts into prompt execution context
 */
export class FrameworkInjector {
  private frameworkManager: FrameworkManager;
  private logger: Logger;
  private config: FrameworkInjectionConfig;

  constructor(
    frameworkManager: FrameworkManager,
    logger: Logger,
    config: Partial<FrameworkInjectionConfig> = {}
  ) {
    this.frameworkManager = frameworkManager;
    this.logger = logger;
    
    this.config = {
      enableInjection: config.enableInjection ?? true,
      injectionMethod: config.injectionMethod ?? 'system_prompt',
      preserveOriginalSystemMessage: config.preserveOriginalSystemMessage ?? true,
      includeFrameworkMetadata: config.includeFrameworkMetadata ?? true,
      userPreferenceOverride: config.userPreferenceOverride,
      enableMethodologyGuides: config.enableMethodologyGuides ?? true
    };
  }

  /**
   * Main framework injection method
   * Enhances prompt with appropriate framework system prompt based on semantic analysis
   */
  async injectFrameworkContext(
    prompt: ConvertedPrompt,
    semanticAnalysis: ConfigurableSemanticAnalysis,
    userFrameworkPreference?: string
  ): Promise<FrameworkInjectionResult> {
    const startTime = Date.now();
    
    try {
      // Skip injection if disabled
      if (!this.config.enableInjection) {
        return this.createPassthroughResult(prompt);
      }
      
      // NEW: Skip framework injection for basic "prompt" execution type
      if (semanticAnalysis.executionType === "prompt") {
        this.logger.debug(`Skipping framework injection for prompt execution: ${prompt.id}`);
        return this.createPassthroughResult(prompt);
      }
      
      // Prepare framework selection criteria based on semantic analysis
      const executionType = semanticAnalysis.executionType;
      const selectionCriteria: FrameworkSelectionCriteria = {
        executionType: executionType as "template" | "chain",
        complexity: semanticAnalysis.complexity,
        userPreference: (userFrameworkPreference || this.config.userPreferenceOverride) as any
      };
      
      // Generate framework execution context
      const frameworkContext = this.frameworkManager.generateExecutionContext(
        prompt,
        selectionCriteria
      );
      
      // Create enhanced prompt with framework injection
      const enhancedPrompt = this.performFrameworkInjection(
        prompt,
        frameworkContext,
        semanticAnalysis
      );
      
      // Create injection result
      const result: FrameworkInjectionResult = {
        originalPrompt: prompt,
        frameworkContext,
        enhancedPrompt,
        injectionMetadata: {
          injectedAt: new Date(),
          frameworkId: frameworkContext.selectedFramework.id,
          injectionMethod: this.config.injectionMethod,
          originalSystemMessage: prompt.systemMessage
        }
      };
      
      const processingTime = Date.now() - startTime;
      this.logger.debug(
        `Framework injection completed: ${frameworkContext.selectedFramework.name} (${processingTime}ms)`
      );
      
      return result;
      
    } catch (error) {
      this.logger.error("Framework injection failed:", error);
      return this.createPassthroughResult(prompt);
    }
  }

  /**
   * Quick framework system prompt injection for execution
   */
  async injectSystemPrompt(
    prompt: ConvertedPrompt,
    semanticAnalysis: ConfigurableSemanticAnalysis
  ): Promise<string> {
    const result = await this.injectFrameworkContext(prompt, semanticAnalysis);
    return result.enhancedPrompt.frameworkSystemPrompt || "";
  }

  /**
   * Get framework guidelines for execution context
   */
  async getFrameworkGuidelines(
    prompt: ConvertedPrompt,
    semanticAnalysis: ConfigurableSemanticAnalysis
  ): Promise<string[]> {
    const result = await this.injectFrameworkContext(prompt, semanticAnalysis);
    return result.frameworkContext.executionGuidelines;
  }

  // Private implementation methods

  /**
   * Perform the actual framework injection based on configuration
   */
  private performFrameworkInjection(
    prompt: ConvertedPrompt,
    frameworkContext: FrameworkExecutionContext,
    semanticAnalysis: ConfigurableSemanticAnalysis
  ): FrameworkInjectionResult['enhancedPrompt'] {
    const framework = frameworkContext.selectedFramework;
    const systemPrompt = frameworkContext.systemPrompt;
    
    // Start with original prompt
    const enhancedPrompt = { ...prompt } as FrameworkInjectionResult['enhancedPrompt'];
    
    // Apply injection based on method
    switch (this.config.injectionMethod) {
      case 'system_prompt':
        enhancedPrompt.frameworkSystemPrompt = systemPrompt;
        
        // Combine with original system message if preservation is enabled
        if (this.config.preserveOriginalSystemMessage && prompt.systemMessage) {
          enhancedPrompt.systemMessage = `${systemPrompt}\n\n${prompt.systemMessage}`;
        } else {
          enhancedPrompt.systemMessage = systemPrompt;
        }
        break;
        
      case 'user_prefix':
        enhancedPrompt.frameworkSystemPrompt = systemPrompt;
        // System prompt will be prepended to user message during execution
        break;
        
      case 'guidelines':
        enhancedPrompt.frameworkGuidelines = frameworkContext.executionGuidelines;
        // Guidelines will be applied during execution without modifying prompts
        break;
    }
    
    // Apply methodology guide enhancements if enabled
    if (this.config.enableMethodologyGuides) {
      const methodologyGuide = this.getMethodologyGuide(framework.id);
      if (methodologyGuide) {
        try {
          const methodologyEnhancement = methodologyGuide.enhanceWithMethodology(
            prompt, 
            { semanticAnalysis, frameworkContext }
          );
          enhancedPrompt.methodologyEnhancement = methodologyEnhancement;
          
          // Apply methodology system prompt guidance if using system_prompt injection
          if (this.config.injectionMethod === 'system_prompt' && methodologyEnhancement.systemPromptGuidance) {
            const baseSystemPrompt = enhancedPrompt.systemMessage || '';
            enhancedPrompt.systemMessage = `${baseSystemPrompt}\n\n${methodologyEnhancement.systemPromptGuidance}`;
          }
          
          this.logger.debug(`Methodology guide applied: ${methodologyGuide.methodology}`);
        } catch (error) {
          this.logger.warn(`Failed to apply methodology guide for ${framework.id}:`, error);
        }
      }
    }
    
    // Add framework metadata if enabled
    if (this.config.includeFrameworkMetadata) {
      enhancedPrompt.frameworkMetadata = {
        selectedFramework: framework.name,
        selectionReason: frameworkContext.metadata.selectionReason,
        confidence: frameworkContext.metadata.confidence
      };
    }
    
    return enhancedPrompt;
  }

  /**
   * Get methodology guide for a specific framework
   */
  private getMethodologyGuide(frameworkId: string): IMethodologyGuide | null {
    try {
      // Get methodology guide from framework manager
      const guide = this.frameworkManager.getMethodologyGuide(frameworkId);
      if (!guide) {
        this.logger.debug(`No methodology guide available for framework: ${frameworkId}`);
        return null;
      }
      return guide;
    } catch (error) {
      this.logger.warn(`Failed to get methodology guide for ${frameworkId}:`, error);
      return null;
    }
  }

  /**
   * Create passthrough result when injection is disabled or fails
   */
  private createPassthroughResult(prompt: ConvertedPrompt): FrameworkInjectionResult {
    // Create minimal framework context for consistency
    const defaultFramework = this.frameworkManager.listFrameworks(true)[0];
    const minimalContext = this.frameworkManager.generateExecutionContext(
      prompt,
      { executionType: "template", complexity: "low" }
    );
    
    return {
      originalPrompt: prompt,
      frameworkContext: minimalContext,
      enhancedPrompt: prompt,
      injectionMetadata: {
        injectedAt: new Date(),
        frameworkId: 'none',
        injectionMethod: this.config.injectionMethod,
        originalSystemMessage: prompt.systemMessage
      }
    };
  }

  /**
   * Update injection configuration
   */
  updateConfig(newConfig: Partial<FrameworkInjectionConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.info("Framework injector configuration updated");
  }

  /**
   * Get current injection configuration
   */
  getConfig(): FrameworkInjectionConfig {
    return { ...this.config };
  }
}

/**
 * Create and configure framework injector
 */
export async function createFrameworkInjector(
  frameworkManager: FrameworkManager,
  logger: Logger,
  config?: Partial<FrameworkInjectionConfig>
): Promise<FrameworkInjector> {
  return new FrameworkInjector(frameworkManager, logger, config);
}