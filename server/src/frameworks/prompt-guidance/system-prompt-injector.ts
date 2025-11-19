// @lifecycle canonical - Injects methodology-specific guidance into system prompts.
/**
 * System Prompt Injector - Phase 3 Implementation
 *
 * Handles intelligent injection of methodology guidance into system prompts.
 * Extracted from framework-manager execution logic for better separation of concerns.
 */

import { Logger } from "../../logging/index.js";
import { ConvertedPrompt } from "../../types/index.js";
import {
  IMethodologyGuide,
  FrameworkDefinition,
  SystemPromptInjectionResult,
  PromptGuidanceConfig
} from "../types/index.js";
import type { ContentAnalysisResult } from "../../semantic/types.js";

/**
 * System prompt injection configuration
 */
export interface SystemPromptInjectorConfig {
  enableTemplateVariables: boolean;
  enableContextualEnhancement: boolean;
  enableValidationGuidance: boolean;
  injectionMethod: 'template' | 'append' | 'prepend' | 'smart' | 'semantic-aware';
  maxPromptLength: number;
  // Phase 4: Semantic awareness settings
  enableSemanticAwareness: boolean;
  semanticComplexityAdaptation: boolean;
  semanticInjectionStrategy: 'conservative' | 'moderate' | 'aggressive';
}

/**
 * System Prompt Injector
 *
 * Intelligently injects methodology guidance into system prompts based on
 * active framework and prompt characteristics.
 */
export class SystemPromptInjector {
  private logger: Logger;
  private config: SystemPromptInjectorConfig;

  constructor(logger: Logger, config?: Partial<SystemPromptInjectorConfig>) {
    this.logger = logger;
    this.config = {
      enableTemplateVariables: true,
      enableContextualEnhancement: true,
      enableValidationGuidance: true,
      injectionMethod: 'smart',
      maxPromptLength: 4000,
      // Phase 4: Semantic awareness defaults
      enableSemanticAwareness: true,
      semanticComplexityAdaptation: true,
      semanticInjectionStrategy: 'moderate',
      ...config
    };
  }

  /**
   * Inject methodology guidance into system prompt
   * Extracted from framework-manager.generateSystemPrompt()
   * Phase 4: Enhanced with semantic analysis awareness
   */
  injectMethodologyGuidance(
    prompt: ConvertedPrompt,
    framework: FrameworkDefinition,
    methodologyGuide: IMethodologyGuide,
    semanticAnalysis?: ContentAnalysisResult
  ): SystemPromptInjectionResult {
    const startTime = Date.now();
    this.logger.debug(`Injecting ${framework.methodology} guidance into system prompt for ${prompt.name}`);

    try {
      // Generate base guidance from methodology guide
      const baseGuidance = this.generateBaseGuidance(methodologyGuide, prompt, semanticAnalysis);

      // Create enhanced system prompt using framework template
      const enhancedPrompt = this.createEnhancedPrompt(
        framework.systemPromptTemplate,
        prompt,
        framework,
        baseGuidance,
        semanticAnalysis
      );

      // Apply template variable substitution
      const finalPrompt = this.applyTemplateVariables(enhancedPrompt, prompt, framework);

      // Validate prompt length and quality
      const validationResult = this.validateInjectedPrompt(finalPrompt, prompt, framework);

      const result: SystemPromptInjectionResult = {
        originalPrompt: prompt.userMessageTemplate || '',
        enhancedPrompt: finalPrompt,
        injectedGuidance: baseGuidance,
        sourceFramework: framework,
        metadata: {
          injectionTime: new Date(),
          injectionMethod: this.getEffectiveInjectionMethod(semanticAnalysis),
          variablesUsed: this.extractUsedVariables(finalPrompt),
          confidence: validationResult.confidence,
          processingTimeMs: Date.now() - startTime,
          validationPassed: validationResult.passed,
          // Phase 4: Semantic analysis metadata
          semanticAware: semanticAnalysis !== undefined,
          semanticComplexity: semanticAnalysis?.complexity,
          semanticConfidence: semanticAnalysis?.confidence
        }
      };

      this.logger.debug(`System prompt injection completed for ${framework.methodology} in ${result.metadata.processingTimeMs}ms`);
      return result;

    } catch (error) {
      this.logger.error(`Failed to inject methodology guidance for ${framework.methodology}:`, error);

      // Return fallback result with original prompt
      return {
        originalPrompt: prompt.userMessageTemplate || '',
        enhancedPrompt: prompt.userMessageTemplate || '',
        injectedGuidance: '',
        sourceFramework: framework,
        metadata: {
          injectionTime: new Date(),
          injectionMethod: 'template',
          variablesUsed: [],
          confidence: 0,
          processingTimeMs: Date.now() - startTime,
          validationPassed: false,
          error: error instanceof Error ? error.message : 'Unknown error'
        }
      };
    }
  }

  /**
   * Generate base methodology guidance from guide
   * Extracted from framework-manager.generateSystemPromptTemplate()
   * Phase 4: Enhanced with semantic analysis
   */
  private generateBaseGuidance(
    guide: IMethodologyGuide,
    prompt: ConvertedPrompt,
    semanticAnalysis?: ContentAnalysisResult
  ): string {
    // Get methodology-specific system prompt guidance
    const baseGuidance = guide.getSystemPromptGuidance({
      promptName: prompt.name,
      promptCategory: prompt.category,
      promptType: prompt.executionMode || 'prompt'
    });

    // Phase 4: Enhance with semantic-aware contextual guidance
    if (this.config.enableContextualEnhancement) {
      const contextualGuidance = this.generateContextualGuidance(guide, prompt, semanticAnalysis);
      return `${baseGuidance}\n\n${contextualGuidance}`;
    }

    // Add semantic complexity-specific guidance if available
    if (this.config.enableSemanticAwareness && semanticAnalysis) {
      const semanticGuidance = this.generateSemanticGuidance(guide, semanticAnalysis);
      if (semanticGuidance) {
        return `${baseGuidance}\n\n${semanticGuidance}`;
      }
    }

    return baseGuidance;
  }

  /**
   * Create enhanced system prompt with methodology integration
   * Phase 4: Enhanced with semantic analysis awareness
   */
  private createEnhancedPrompt(
    template: string,
    prompt: ConvertedPrompt,
    framework: FrameworkDefinition,
    guidance: string,
    semanticAnalysis?: ContentAnalysisResult
  ): string {
    // Use smart injection method by default
    switch (this.config.injectionMethod) {
      case 'template':
        return this.injectViaTemplate(template, guidance);
      case 'append':
        return `${template}\n\n${guidance}`;
      case 'prepend':
        return `${guidance}\n\n${template}`;
      case 'semantic-aware':
        return this.semanticAwareInject(template, guidance, prompt, framework, semanticAnalysis);
      case 'smart':
      default:
        return this.smartInject(template, guidance, prompt, framework, semanticAnalysis);
    }
  }

  /**
   * Smart injection that adapts to prompt characteristics
   * Phase 4: Enhanced with semantic analysis awareness
   */
  private smartInject(
    template: string,
    guidance: string,
    prompt: ConvertedPrompt,
    framework: FrameworkDefinition,
    semanticAnalysis?: ContentAnalysisResult
  ): string {
    // Use semantic analysis if available and semantic awareness is enabled
    if (this.config.enableSemanticAwareness && semanticAnalysis) {
      return this.semanticAwareInject(template, guidance, prompt, framework, semanticAnalysis);
    }

    // Fallback to original smart injection logic
    // For complex prompts or chain types, use template integration
    if (prompt.executionMode === 'chain' || (prompt.arguments && prompt.arguments.length > 3)) {
      return this.injectViaTemplate(template, guidance);
    }

    // For simple prompts, append guidance
    return `${template}\n\n## ${framework.methodology} Methodology Guidance\n\n${guidance}`;
  }

  /**
   * Inject guidance via template replacement
   */
  private injectViaTemplate(template: string, guidance: string): string {
    // Look for guidance placeholder in template
    if (template.includes('{METHODOLOGY_GUIDANCE}')) {
      return template.replace('{METHODOLOGY_GUIDANCE}', guidance);
    }

    // If no placeholder, append to template
    return `${template}\n\n${guidance}`;
  }

  /**
   * Apply template variable substitution
   * Extracted from framework-manager.generateSystemPrompt()
   */
  private applyTemplateVariables(
    prompt: string,
    convertedPrompt: ConvertedPrompt,
    framework: FrameworkDefinition
  ): string {
    if (!this.config.enableTemplateVariables) {
      return prompt;
    }

    let processedPrompt = prompt;

    // Replace standard template variables
    processedPrompt = processedPrompt.replace(/\{PROMPT_NAME\}/g, convertedPrompt.name || 'Prompt');
    processedPrompt = processedPrompt.replace(/\{PROMPT_CATEGORY\}/g, convertedPrompt.category || 'general');
    processedPrompt = processedPrompt.replace(/\{FRAMEWORK_NAME\}/g, framework.name);
    processedPrompt = processedPrompt.replace(/\{METHODOLOGY\}/g, framework.methodology);

    // Replace prompt-specific variables
    if (convertedPrompt.executionMode) {
      processedPrompt = processedPrompt.replace(/\{PROMPT_TYPE\}/g, convertedPrompt.executionMode);
    }

    return processedPrompt;
  }

  /**
   * Generate contextual guidance based on prompt characteristics
   * Phase 4: Enhanced with semantic analysis
   */
  private generateContextualGuidance(
    guide: IMethodologyGuide,
    prompt: ConvertedPrompt,
    semanticAnalysis?: ContentAnalysisResult
  ): string {
    const contextParts = [];

    // Phase 4: Use semantic analysis for enhanced contextual guidance
    if (semanticAnalysis && this.config.enableSemanticAwareness) {
      // Add semantic complexity-based guidance
      switch (semanticAnalysis.complexity) {
        case 'high':
          contextParts.push(`High complexity detected - apply ${guide.methodology} with extra attention to systematic breakdown and validation.`);
          break;
        case 'medium':
          contextParts.push(`Medium complexity detected - ensure ${guide.methodology} methodology is applied comprehensively.`);
          break;
        case 'low':
          contextParts.push(`Low complexity detected - apply ${guide.methodology} efficiently while maintaining quality.`);
          break;
      }

      // Add semantic execution characteristics guidance
      if (semanticAnalysis.executionCharacteristics.hasStructuredReasoning) {
        contextParts.push(`Structured reasoning detected - leverage ${guide.methodology} systematic approach.`);
      }

      if (semanticAnalysis.executionCharacteristics.hasComplexAnalysis) {
        contextParts.push(`Complex analysis patterns detected - emphasize ${guide.methodology} analytical rigor.`);
      }

      // Add semantic confidence-based guidance
      if (semanticAnalysis.confidence < 0.7) {
        contextParts.push(`Uncertain semantic analysis - apply ${guide.methodology} with additional validation steps.`);
      }
    } else {
      // Fallback to original logic when semantic analysis unavailable
      // Add complexity-based guidance
      if (prompt.arguments && prompt.arguments.length > 2) {
        contextParts.push(`This prompt has multiple parameters - apply ${guide.methodology} systematically to each component.`);
      }

      // Add type-specific guidance
      if (prompt.executionMode === 'chain') {
        contextParts.push(`Chain execution detected - maintain ${guide.methodology} consistency across all steps.`);
      }

      // Add category-specific guidance
      if (prompt.category === 'analysis') {
        contextParts.push(`Analysis prompt detected - emphasize thorough ${guide.methodology} analytical phases.`);
      }
    }

    return contextParts.join('\n');
  }

  /**
   * Validate injected prompt quality and characteristics
   */
  private validateInjectedPrompt(
    prompt: string,
    originalPrompt: ConvertedPrompt,
    framework: FrameworkDefinition
  ): { passed: boolean; confidence: number; issues: string[] } {
    const issues: string[] = [];
    let confidence = 1.0;

    // Check prompt length
    if (prompt.length > this.config.maxPromptLength) {
      issues.push(`Prompt length (${prompt.length}) exceeds maximum (${this.config.maxPromptLength})`);
      confidence -= 0.2;
    }

    // Check methodology integration
    if (!prompt.toLowerCase().includes(framework.methodology.toLowerCase())) {
      issues.push(`Methodology ${framework.methodology} not clearly referenced in prompt`);
      confidence -= 0.3;
    }

    // Check template variable resolution
    const unresolvedVariables = prompt.match(/\{[A-Z_]+\}/g);
    if (unresolvedVariables && unresolvedVariables.length > 0) {
      issues.push(`Unresolved template variables: ${unresolvedVariables.join(', ')}`);
      confidence -= 0.1 * unresolvedVariables.length;
    }

    // Ensure minimum confidence
    confidence = Math.max(confidence, 0);

    return {
      passed: issues.length === 0,
      confidence,
      issues
    };
  }

  /**
   * Phase 4: Semantic-aware injection that adapts based on semantic analysis
   */
  private semanticAwareInject(
    template: string,
    guidance: string,
    prompt: ConvertedPrompt,
    framework: FrameworkDefinition,
    semanticAnalysis?: ContentAnalysisResult
  ): string {
    if (!semanticAnalysis) {
      return this.injectViaTemplate(template, guidance);
    }

    // Determine injection strategy based on semantic complexity and characteristics
    const injectionStrategy = this.determineSemanticInjectionStrategy(semanticAnalysis);

    switch (injectionStrategy) {
      case 'minimal':
        // Low complexity - simple append
        return `${template}\n\n${guidance}`;

      case 'structured':
        // Medium complexity - organized injection
        return `${template}\n\n## ${framework.methodology} Methodology Guidance\n\n${guidance}`;

      case 'comprehensive':
        // High complexity - full template integration
        return this.injectViaTemplate(template, `## ${framework.methodology} Methodology Framework\n\n${guidance}`);

      default:
        return this.injectViaTemplate(template, guidance);
    }
  }

  /**
   * Phase 4: Generate semantic-specific guidance based on analysis results
   */
  private generateSemanticGuidance(
    guide: IMethodologyGuide,
    semanticAnalysis: ContentAnalysisResult
  ): string {
    const guidanceParts = [];

    // Add analysis mode-specific guidance
    if (semanticAnalysis.analysisMetadata.mode === 'semantic') {
      guidanceParts.push(`Semantic analysis mode: Apply ${guide.methodology} with intelligent pattern recognition.`);
    } else if (semanticAnalysis.analysisMetadata.mode === 'structural') {
      guidanceParts.push(`Structural analysis mode: Apply ${guide.methodology} with systematic template analysis.`);
    }

    // Add capability-based guidance
    if (semanticAnalysis.capabilities.hasSemanticUnderstanding) {
      guidanceParts.push(`Enhanced semantic understanding available - leverage for nuanced ${guide.methodology} application.`);
    }

    // Add limitation-aware guidance
    if (semanticAnalysis.limitations.length > 0) {
      guidanceParts.push(`Analysis limitations detected - apply ${guide.methodology} with extra validation.`);
    }

    return guidanceParts.length > 0 ? guidanceParts.join('\n') : '';
  }

  /**
   * Phase 4: Determine injection strategy based on semantic analysis
   */
  private determineSemanticInjectionStrategy(semanticAnalysis: ContentAnalysisResult): 'minimal' | 'structured' | 'comprehensive' {
    // Base strategy on configured approach
    if (this.config.semanticInjectionStrategy === 'conservative') {
      return 'minimal';
    } else if (this.config.semanticInjectionStrategy === 'aggressive') {
      return 'comprehensive';
    }

    // Moderate strategy - adapt based on semantic characteristics
    const complexityScore = this.calculateSemanticComplexityScore(semanticAnalysis);

    if (complexityScore >= 0.8) {
      return 'comprehensive';
    } else if (complexityScore >= 0.5) {
      return 'structured';
    } else {
      return 'minimal';
    }
  }

  /**
   * Phase 4: Calculate semantic complexity score for injection decisions
   */
  private calculateSemanticComplexityScore(semanticAnalysis: ContentAnalysisResult): number {
    let score = 0;

    // Base complexity mapping
    switch (semanticAnalysis.complexity) {
      case 'high': score += 0.6; break;
      case 'medium': score += 0.4; break;
      case 'low': score += 0.2; break;
    }

    // Execution characteristics influence
    const chars = semanticAnalysis.executionCharacteristics;
    if (chars.hasStructuredReasoning) score += 0.1;
    if (chars.hasComplexAnalysis) score += 0.1;
    if (chars.hasChainSteps) score += 0.1;
    if (chars.argumentCount > 3) score += 0.1;

    // Confidence influence (higher confidence = more decisive injection)
    score += (semanticAnalysis.confidence * 0.2);

    return Math.min(score, 1.0);
  }

  /**
   * Phase 4: Get effective injection method based on semantic analysis
   */
  private getEffectiveInjectionMethod(semanticAnalysis?: ContentAnalysisResult): string {
    if (!semanticAnalysis || !this.config.enableSemanticAwareness) {
      return this.config.injectionMethod;
    }

    if (this.config.injectionMethod === 'semantic-aware') {
      const strategy = this.determineSemanticInjectionStrategy(semanticAnalysis);
      return `semantic-aware-${strategy}`;
    }

    return this.config.injectionMethod;
  }

  /**
   * Extract variables that were used in template processing
   */
  private extractUsedVariables(prompt: string): string[] {
    const originalVariables = [
      'PROMPT_NAME', 'PROMPT_CATEGORY', 'FRAMEWORK_NAME',
      'METHODOLOGY', 'PROMPT_TYPE', 'METHODOLOGY_GUIDANCE'
    ];

    return originalVariables.filter(variable =>
      !prompt.includes(`{${variable}}`)
    );
  }

  /**
   * Update injector configuration
   */
  updateConfig(config: Partial<SystemPromptInjectorConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.debug('SystemPromptInjector configuration updated', config);
  }

  /**
   * Get current injector configuration
   */
  getConfig(): SystemPromptInjectorConfig {
    return { ...this.config };
  }
}

/**
 * Create and configure a SystemPromptInjector instance
 */
export function createSystemPromptInjector(
  logger: Logger,
  config?: Partial<SystemPromptInjectorConfig>
): SystemPromptInjector {
  return new SystemPromptInjector(logger, config);
}
