// @lifecycle migrating - Coordinating semantic analysis with framework switching is still stabilizing.
/**
 * Framework-Semantic Integration -  Implementation
 * Intelligent framework switching and consensus mechanisms
 *
 * Key Integration Points:
 * - Semantic Analysis provides WHAT the prompt needs (complexity, structure, requirements)
 * - Framework Manager provides HOW to approach it (methodology, system prompts)
 * - Integration layer coordinates between systems WITHOUT interference
 */

import { Logger } from '../../logging/index.js';
import { ContentAnalyzer } from '../../semantic/configurable-semantic-analyzer.js';
import { ConvertedPrompt } from '../../types/index.js';
import { FrameworkManager } from '../framework-manager.js';
import { FrameworkStateManager } from '../framework-state-manager.js';
import { PromptGuidanceService } from '../prompt-guidance/service.js';
import {
  FrameworkDefinition,
  FrameworkExecutionContext,
  FrameworkSelectionCriteria,
  FrameworkAlignmentResult,
  FrameworkSwitchingConfig,
  FrameworkSwitchRecommendation,
  FrameworkUsageInsights,
  FrameworkUsageMetrics,
  IntegratedAnalysisResult,
} from '../types/index.js';

import type { ContentAnalysisResult } from '../../semantic/types.js';

/**
 * Integration types are sourced from the semantic integration type module
 */

/**
 * Framework-Semantic Integration Engine
 * Coordinates framework selection based on semantic analysis and user preference
 */
export class FrameworkSemanticIntegration {
  private frameworkManager: FrameworkManager;
  private frameworkStateManager: FrameworkStateManager;
  private semanticAnalyzer: ContentAnalyzer;
  private logger: Logger;
  private config: FrameworkSwitchingConfig;
  // Prompt guidance coordination
  private promptGuidanceService?: PromptGuidanceService;

  // Framework switching state management
  private lastFrameworkSwitch = new Map<string, number>();
  private frameworkUsageHistory = new Map<string, FrameworkUsageMetrics>();

  constructor(
    frameworkManager: FrameworkManager,
    frameworkStateManager: FrameworkStateManager,
    semanticAnalyzer: ContentAnalyzer,
    logger: Logger,
    config: Partial<FrameworkSwitchingConfig> = {}
  ) {
    this.frameworkManager = frameworkManager;
    this.frameworkStateManager = frameworkStateManager;
    this.semanticAnalyzer = semanticAnalyzer;
    this.logger = logger;

    this.config = {
      enableAutomaticSwitching: config.enableAutomaticSwitching ?? true,
      switchingThreshold: config.switchingThreshold ?? 0.8,
      preventThrashing: config.preventThrashing ?? true,
      switchingCooldownMs: config.switchingCooldownMs ?? 30000, // 30 second cooldown
      blacklistedFrameworks: config.blacklistedFrameworks ?? [],
      preferredFrameworks: config.preferredFrameworks ?? [],
    };
  }

  /**
   * Main integration method - combines semantic analysis with framework selection
   * Enhanced with prompt guidance coordination
   */
  async analyzeWithFrameworkIntegration(
    prompt: ConvertedPrompt,
    userFrameworkPreference?: string,
    includePromptGuidance?: boolean
  ): Promise<IntegratedAnalysisResult> {
    const startTime = performance.now();

    // NEW: Check if framework system is enabled before proceeding
    if (!this.frameworkStateManager.isFrameworkSystemEnabled()) {
      this.logger.debug(
        `Framework system disabled - returning semantic analysis only for prompt: ${prompt.id}`
      );
      return this.createNonFrameworkIntegratedResult(prompt, startTime);
    }

    try {
      // Step 1: Perform semantic analysis (WHAT does the prompt need?)
      this.logger.debug(`Starting semantic analysis for prompt: ${prompt.id}`);
      const semanticAnalysis = await this.semanticAnalyzer.analyzePrompt(prompt);

      // Step 2: Check analysis capabilities and adapt accordingly
      const analysisCapabilities = semanticAnalysis.capabilities;
      this.logger.debug(
        `Analysis capabilities: semantic=${analysisCapabilities.hasSemanticUnderstanding}, framework=${analysisCapabilities.canRecommendFramework}`
      );

      // Step 3: Enhance framework criteria with user preference and analysis mode
      const executionType = semanticAnalysis.executionType === 'chain' ? 'chain' : 'single';
      const enhancedCriteria = this.enhanceFrameworkCriteria(
        {
          executionType,
          complexity: semanticAnalysis.complexity,
        },
        userFrameworkPreference,
        semanticAnalysis
      );

      // Step 4: Framework selection adapted to analysis capabilities
      this.logger.debug(
        `Selecting framework based on semantic criteria (mode: ${semanticAnalysis.analysisMetadata.mode})`
      );
      const frameworkContext = this.selectOptimalFramework(
        prompt,
        enhancedCriteria,
        semanticAnalysis
      );

      // Step 5: Validate framework-semantic alignment
      const alignment = this.validateFrameworkAlignment(semanticAnalysis, frameworkContext);

      // Step 6: Generate alternative frameworks (adapted for analysis mode)
      const alternatives = this.generateAlternativeFrameworks(
        enhancedCriteria,
        frameworkContext,
        semanticAnalysis
      );

      // Step 6: Build integrated result with optional prompt guidance
      const result: IntegratedAnalysisResult = {
        semanticAnalysis,
        frameworkContext,
        integration: {
          frameworkSelectionReason: frameworkContext.metadata.selectionReason,
          semanticFrameworkAlignment: alignment.overallAlignment,
          alternativeFrameworks: alternatives,
          consensusMetrics: alignment.detailedMetrics,
        },
        recommendations: this.generateIntegratedRecommendations(
          semanticAnalysis,
          frameworkContext,
          alignment
        ),
      };

      // Apply prompt guidance if requested and available
      if (includePromptGuidance && this.promptGuidanceService?.isInitialized()) {
        try {
          const guidanceResult = await this.promptGuidanceService.applyGuidance(prompt, {
            includeSystemPromptInjection: true,
            includeTemplateEnhancement: true,
            frameworkOverride: frameworkContext.selectedFramework.type,
            semanticAnalysis: semanticAnalysis,
          });

          // Enhance the result with prompt guidance information
          result.promptGuidance = {
            guidanceApplied: guidanceResult.guidanceApplied,
            enhancedPrompt: guidanceResult.enhancedPrompt,
            systemPromptInjection: guidanceResult.systemPromptInjection,
            processingTimeMs: guidanceResult.processingTimeMs,
            confidenceScore: guidanceResult.metadata.confidenceScore,
          };

          this.logger.debug(
            `Prompt guidance applied with confidence: ${guidanceResult.metadata.confidenceScore}`
          );
        } catch (error) {
          this.logger.warn('Failed to apply prompt guidance:', error);
        }
      }

      // Update performance tracking
      this.updateFrameworkUsage(
        frameworkContext.selectedFramework.id,
        performance.now() - startTime,
        alignment.overallAlignment
      );

      this.logger.info(
        `Framework integration completed: ${frameworkContext.selectedFramework.name} ` +
          `(alignment: ${(alignment.overallAlignment * 100).toFixed(1)}%)`
      );

      return result;
    } catch (error) {
      this.logger.error('Framework-semantic integration failed:', error);
      return this.createFallbackIntegratedResult(prompt, startTime);
    }
  }

  /**
   * Get framework performance insights for optimization
   */
  getFrameworkUsageInsights(): FrameworkUsageInsights {
    const frameworks = this.frameworkManager.listFrameworks(true);
    const insights: FrameworkUsageInsights = {
      totalAnalyses: 0,
      frameworkUsage: {},
      recommendations: [],
    };

    frameworks.forEach((framework) => {
      const metrics = this.frameworkUsageHistory.get(framework.id);
      if (metrics) {
        insights.frameworkUsage[framework.id] = {
          framework: framework,
          ...metrics,
        };
        insights.totalAnalyses += metrics.usageCount;
      }
    });

    // Generate optimization recommendations
    insights.recommendations = this.generateUsageRecommendations(insights);

    return insights;
  }

  /**
   * Intelligent framework switching based on performance and alignment
   */
  async evaluateFrameworkSwitch(
    prompt: ConvertedPrompt,
    currentResult: IntegratedAnalysisResult
  ): Promise<FrameworkSwitchRecommendation | null> {
    if (!this.config.enableAutomaticSwitching) {
      return null;
    }

    // Check if framework context is available (framework system enabled)
    if (!currentResult.frameworkContext) {
      return null; // Cannot switch if framework system is disabled
    }

    const currentFramework = currentResult.frameworkContext.selectedFramework;
    const alignment = currentResult.integration.semanticFrameworkAlignment;

    // Check if switching is warranted
    if (alignment >= this.config.switchingThreshold) {
      return null; // Current framework is performing well
    }

    // Check cooldown period to prevent thrashing
    if (this.config.preventThrashing) {
      const lastSwitch = this.lastFrameworkSwitch.get(prompt.id);
      if (lastSwitch && Date.now() - lastSwitch < this.config.switchingCooldownMs) {
        return null; // Still in cooldown period
      }
    }

    // Evaluate alternatives
    const alternatives = currentResult.integration.alternativeFrameworks;
    const bestAlternative = alternatives.find(
      (alt) => !this.config.blacklistedFrameworks.includes(alt.id) && alt.id !== currentFramework.id
    );

    if (!bestAlternative) {
      return null; // No viable alternatives
    }

    return {
      currentFramework: currentFramework,
      recommendedFramework: bestAlternative,
      reason: `Low alignment (${(alignment * 100).toFixed(1)}%) suggests ${
        bestAlternative.name
      } would be more suitable`,
      expectedImprovement: this.estimateImprovementPotential(
        currentFramework,
        bestAlternative,
        currentResult.semanticAnalysis
      ),
    };
  }

  // Private implementation methods

  /**
   * Enhance framework criteria with user preferences, context, and analysis capabilities
   */
  private enhanceFrameworkCriteria(
    baseCriteria: FrameworkSelectionCriteria,
    userPreference?: string,
    semanticAnalysis?: ContentAnalysisResult
  ): FrameworkSelectionCriteria {
    const enhanced = { ...baseCriteria };

    // Apply user preference if provided
    if (userPreference) {
      enhanced.userPreference = userPreference as any;
    }

    // Handle analysis mode specific logic
    if (semanticAnalysis) {
      // In minimal mode (no LLM), user choice is more important
      if (
        semanticAnalysis.analysisMetadata.mode === 'minimal' ||
        !semanticAnalysis.analysisMetadata.mode
      ) {
        if (!userPreference && semanticAnalysis.frameworkRecommendation.requiresUserChoice) {
          // Log that user choice is needed
          this.logger.info(
            'Minimal analysis mode - framework selection requires user choice or default'
          );
        }
      }

      // In semantic mode (with LLM), use intelligent recommendations
      if (
        semanticAnalysis.analysisMetadata.mode === 'semantic' &&
        semanticAnalysis.frameworkRecommendation.shouldUseFramework
      ) {
        // We can trust the semantic recommendation more
        this.logger.debug('Semantic analysis provides framework recommendation');
      }
    }

    // Apply global preferences
    if (this.config.preferredFrameworks.length > 0 && !enhanced.userPreference) {
      // Don't override user preference, but suggest from preferred list
    }

    return enhanced;
  }

  /**
   * Select framework using rule-based selection logic and user preference
   */
  private selectOptimalFramework(
    prompt: ConvertedPrompt,
    criteria: FrameworkSelectionCriteria,
    semanticAnalysis: ContentAnalysisResult
  ): FrameworkExecutionContext {
    // Use framework manager's selection logic
    const frameworkContext = this.frameworkManager.generateExecutionContext(prompt, criteria);

    // Log selection reasoning
    this.logger.debug(
      `Framework selection: ${frameworkContext.selectedFramework.name} ` +
        `(reason: ${frameworkContext.metadata.selectionReason})`
    );

    return frameworkContext;
  }

  /**
   * Validate alignment between semantic analysis and selected framework
   */
  private validateFrameworkAlignment(
    semanticAnalysis: ContentAnalysisResult,
    frameworkContext: FrameworkExecutionContext
  ): FrameworkAlignmentResult {
    const framework = frameworkContext.selectedFramework;

    // Calculate alignment scores
    const confidenceAlignment = this.calculateConfidenceAlignment(
      semanticAnalysis.confidence,
      frameworkContext.metadata.confidence
    );

    const complexityMatch = this.calculateComplexityMatch(semanticAnalysis.complexity, framework);

    const executionTypeCompatibility = this.calculateExecutionTypeCompatibility(
      semanticAnalysis.executionType,
      framework
    );

    const overallAlignment =
      (confidenceAlignment + complexityMatch + executionTypeCompatibility) / 3;

    return {
      overallAlignment,
      detailedMetrics: {
        confidenceAlignment,
        complexityMatch,
        executionTypeCompatibility,
      },
    };
  }

  /**
   * Generate alternative framework options for consensus
   */
  private generateAlternativeFrameworks(
    criteria: FrameworkSelectionCriteria,
    currentContext: FrameworkExecutionContext,
    semanticAnalysis?: ContentAnalysisResult
  ): FrameworkDefinition[] {
    const allFrameworks = this.frameworkManager.listFrameworks(true);
    const currentFramework = currentContext.selectedFramework;

    // Return frameworks that are NOT the current one, sorted by suitability
    return allFrameworks
      .filter((f) => f.id !== currentFramework.id)
      .filter((f) => !this.config.blacklistedFrameworks.includes(f.id))
      .slice(0, 3); // Limit to top 3 alternatives
  }

  /**
   * Generate integrated recommendations combining semantic and framework insights
   */
  private generateIntegratedRecommendations(
    semanticAnalysis: ContentAnalysisResult,
    frameworkContext: FrameworkExecutionContext,
    alignment: FrameworkAlignmentResult
  ) {
    return {
      executionApproach: this.generateExecutionApproach(semanticAnalysis, frameworkContext),
      expectedPerformance: {
        processingTime: this.estimateProcessingTime(semanticAnalysis),
        memoryUsage: this.estimateMemoryUsage(semanticAnalysis),
        cacheable: semanticAnalysis.complexity !== 'high',
      },
      qualityAssurance: [
        ...semanticAnalysis.suggestedGates,
        ...this.getFrameworkSpecificGates(frameworkContext.selectedFramework),
      ],
      optimizations: this.generateOptimizationSuggestions(
        semanticAnalysis,
        frameworkContext,
        alignment
      ),
    };
  }

  // Helper methods for alignment calculations

  private calculateConfidenceAlignment(
    semanticConfidence: number,
    frameworkConfidence: number
  ): number {
    // How well do the confidence scores align?
    const difference = Math.abs(semanticConfidence - frameworkConfidence);
    return Math.max(0, 1 - difference);
  }

  private calculateComplexityMatch(
    semanticComplexity: string,
    framework: FrameworkDefinition
  ): number {
    // Check if framework is suitable for the complexity level
    const complexityScore: Record<string, number> = {
      low: 1,
      medium: 2,
      high: 3,
    };

    const semantic = complexityScore[semanticComplexity] || 2;

    // Framework suitability based on type
    let frameworkSuitability = 2; // Default medium
    switch (framework.type) {
      case 'CAGEERF':
        frameworkSuitability = 3; // Best for high complexity
        break;
      case 'ReACT':
        frameworkSuitability = 2.5; // Good for medium-high
        break;
      case '5W1H':
        frameworkSuitability = 2; // Good for medium
        break;
      case 'SCAMPER':
        frameworkSuitability = 1.5; // Best for low-medium
        break;
    }

    const difference = Math.abs(semantic - frameworkSuitability);
    return Math.max(0, 1 - difference / 3);
  }

  private calculateExecutionTypeCompatibility(
    executionType: string,
    framework: FrameworkDefinition
  ): number {
    // Check if execution type is compatible with framework
    if (framework.applicableTypes.length === 0) return 1.0; // Framework supports all types

    return framework.applicableTypes.includes(executionType) ? 1.0 : 0.6;
  }

  // Additional helper methods

  private generateExecutionApproach(
    semanticAnalysis: ContentAnalysisResult,
    frameworkContext: FrameworkExecutionContext
  ): string {
    const baseApproach = `Execute as ${semanticAnalysis.executionType} using ${frameworkContext.selectedFramework.name} methodology`;

    // Add mode-specific context
    if (semanticAnalysis.analysisMetadata.mode === 'semantic') {
      return `${baseApproach} (intelligent semantic analysis)`;
    } else {
      return `${baseApproach} (minimal analysis)`;
    }
  }

  private getFrameworkSpecificGates(framework: FrameworkDefinition): string[] {
    const gates: string[] = [];

    // Use actual gate IDs from definitions directory
    switch (framework.type) {
      case 'CAGEERF':
        gates.push('framework-compliance', 'technical-accuracy', 'content-structure');
        break;
      case 'ReACT':
        gates.push('framework-compliance', 'educational-clarity');
        break;
      case '5W1H':
        gates.push('framework-compliance', 'research-quality');
        break;
      case 'SCAMPER':
        gates.push('framework-compliance', 'content-structure');
        break;
    }

    return gates;
  }

  private generateOptimizationSuggestions(
    semanticAnalysis: ContentAnalysisResult,
    frameworkContext: FrameworkExecutionContext,
    alignment: FrameworkAlignmentResult
  ): string[] {
    const suggestions: string[] = [];

    if (alignment.overallAlignment < 0.7) {
      suggestions.push('Consider framework switching for better alignment');
    }

    if (semanticAnalysis.complexity === 'low') {
      suggestions.push('Enable parallel processing for performance improvement');
    }

    if (semanticAnalysis.confidence > 0.8) {
      suggestions.push('Enable caching to improve repeat performance');
    }

    // Mode-specific suggestions
    if (semanticAnalysis.analysisMetadata.mode !== 'semantic') {
      if (semanticAnalysis.limitations.length > 0) {
        suggestions.push('Configure LLM integration for intelligent semantic analysis');
      }
    }

    // Warning-based suggestions
    if (semanticAnalysis.warnings.length > 0) {
      suggestions.push('Review analysis warnings for potential configuration improvements');
    }

    return suggestions;
  }

  /**
   * Estimate processing time based on semantic analysis
   */
  private estimateProcessingTime(semanticAnalysis: ContentAnalysisResult): number {
    let baseTime = 100; // Base processing time in ms

    // Adjust based on complexity
    switch (semanticAnalysis.complexity) {
      case 'high':
        baseTime *= 3;
        break;
      case 'medium':
        baseTime *= 2;
        break;
      default:
        break;
    }

    // Adjust based on execution type
    switch (semanticAnalysis.executionType) {
      case 'chain':
        // Advanced chains with workflow-like features get higher multiplier
        if (
          semanticAnalysis.executionCharacteristics.advancedChainFeatures?.requiresAdvancedExecution
        ) {
          baseTime *= 2.5;
        } else {
          baseTime *= 2;
        }
        break;
      default:
        break;
    }

    return baseTime;
  }

  /**
   * Estimate memory usage based on semantic analysis
   */
  private estimateMemoryUsage(semanticAnalysis: ContentAnalysisResult): string {
    if (semanticAnalysis.complexity === 'high') {
      return 'high';
    } else if (semanticAnalysis.complexity === 'medium') {
      return 'medium';
    } else {
      return 'low';
    }
  }

  private updateFrameworkUsage(
    frameworkId: string,
    processingTime: number,
    alignmentScore: number
  ): void {
    let metrics = this.frameworkUsageHistory.get(frameworkId);

    if (!metrics) {
      metrics = {
        usageCount: 0,
        averageProcessingTime: 0,
        averageAlignmentScore: 0,
        lastUsed: new Date(),
      };
    }

    metrics.usageCount++;
    metrics.averageProcessingTime = (metrics.averageProcessingTime + processingTime) / 2;
    metrics.averageAlignmentScore = (metrics.averageAlignmentScore + alignmentScore) / 2;
    metrics.lastUsed = new Date();

    this.frameworkUsageHistory.set(frameworkId, metrics);
  }

  private generateUsageRecommendations(insights: FrameworkUsageInsights): string[] {
    const recommendations: string[] = [];

    const frameworkUsage = Object.values(insights.frameworkUsage);
    if (frameworkUsage.length === 0) return recommendations;

    // Find best and worst performing frameworks
    const mostUsedFramework = frameworkUsage.reduce((best, current) =>
      current.usageCount > best.usageCount ? current : best
    );

    const leastUsedFramework = frameworkUsage.reduce((worst, current) =>
      current.usageCount < worst.usageCount ? current : worst
    );

    if (mostUsedFramework.usageCount > 10) {
      recommendations.push(
        `Most used framework: ${mostUsedFramework.framework.name} (${mostUsedFramework.usageCount} uses)`
      );
    }

    if (leastUsedFramework.usageCount === 0) {
      recommendations.push(
        `Unused framework: ${leastUsedFramework.framework.name} - consider if it's needed`
      );
    }

    return recommendations;
  }

  private estimateImprovementPotential(
    currentFramework: FrameworkDefinition,
    alternativeFramework: FrameworkDefinition,
    semanticAnalysis: ContentAnalysisResult
  ): number {
    // Estimate potential improvement based on framework characteristics
    let improvement = 0.1; // Base improvement assumption

    // Framework-specific improvements
    if (semanticAnalysis.complexity === 'high' && alternativeFramework.type === 'CAGEERF') {
      improvement += 0.2;
    }

    if (semanticAnalysis.executionType === 'chain' && alternativeFramework.type === 'ReACT') {
      improvement += 0.15;
    }

    return Math.min(improvement, 0.4); // Cap at 40% improvement
  }

  private async createNonFrameworkIntegratedResult(
    prompt: ConvertedPrompt,
    startTime: number
  ): Promise<IntegratedAnalysisResult> {
    // When framework system is disabled, provide semantic analysis without framework integration
    const semanticAnalysis = await this.semanticAnalyzer.analyzePrompt(prompt);

    return {
      semanticAnalysis,
      frameworkContext: null as any, // No framework context when disabled
      integration: {
        frameworkSelectionReason: 'Framework system disabled',
        semanticFrameworkAlignment: 0,
        alternativeFrameworks: [],
        consensusMetrics: {
          confidenceAlignment: 0,
          complexityMatch: 0,
          executionTypeCompatibility: 0,
        },
      },
      recommendations: {
        executionApproach: `Execute as ${semanticAnalysis.executionType} without framework methodology`,
        expectedPerformance: {
          processingTime: this.estimateProcessingTime(semanticAnalysis),
          memoryUsage: this.estimateMemoryUsage(semanticAnalysis),
          cacheable: semanticAnalysis.complexity !== 'high',
        },
        qualityAssurance: semanticAnalysis.suggestedGates,
        optimizations: ['Framework system disabled - using standard execution'],
      },
    };
  }

  /**
   * Set prompt guidance service for intelligent coordination
   */
  setPromptGuidanceService(promptGuidanceService: PromptGuidanceService): void {
    this.promptGuidanceService = promptGuidanceService;
    this.logger.info('PromptGuidanceService integrated with FrameworkSemanticIntegration');
  }

  /**
   * Check if prompt guidance is available and ready
   */
  hasPromptGuidance(): boolean {
    return this.promptGuidanceService?.isInitialized() ?? false;
  }

  /**
   * Apply semantic-guided prompt enhancement
   */
  async applySemanticGuidedEnhancement(
    prompt: ConvertedPrompt,
    semanticAnalysis: ContentAnalysisResult,
    frameworkContext: FrameworkExecutionContext
  ): Promise<any> {
    if (!this.promptGuidanceService?.isInitialized()) {
      this.logger.debug('Prompt guidance service not available for semantic-guided enhancement');
      return null;
    }

    try {
      const guidanceResult = await this.promptGuidanceService.applyGuidance(prompt, {
        includeSystemPromptInjection: true,
        includeTemplateEnhancement: true,
        frameworkOverride: frameworkContext.selectedFramework.type,
        semanticAnalysis: semanticAnalysis,
      });

      return {
        enhancedPrompt: guidanceResult.enhancedPrompt,
        systemPromptInjection: guidanceResult.systemPromptInjection,
        guidanceMetadata: {
          semanticAware: guidanceResult.metadata.semanticAware,
          semanticComplexity: guidanceResult.metadata.semanticComplexity,
          confidenceScore: guidanceResult.metadata.confidenceScore,
          enhancementsApplied: guidanceResult.metadata.enhancementsApplied,
        },
      };
    } catch (error) {
      this.logger.error('Failed to apply semantic-guided enhancement:', error);
      return null;
    }
  }

  private createFallbackIntegratedResult(
    prompt: ConvertedPrompt,
    startTime: number
  ): IntegratedAnalysisResult {
    const fallbackFramework = this.frameworkManager.listFrameworks(true)[0];

    return {
      semanticAnalysis: {
        executionType: 'single',
        requiresExecution: false,
        requiresFramework: false,
        confidence: 0.3,
        reasoning: ['Fallback analysis'],

        capabilities: {
          canDetectStructure: false,
          canAnalyzeComplexity: false,
          canRecommendFramework: false,
          hasSemanticUnderstanding: false,
        },

        limitations: ['Fallback analysis with minimal capabilities'],
        warnings: ['Analysis failed - using basic fallback'],

        executionCharacteristics: {
          hasConditionals: false,
          hasLoops: false,
          hasChainSteps: false,
          argumentCount: 0,
          templateComplexity: 0,
          hasSystemMessage: false,
          hasUserTemplate: false,
          hasStructuredReasoning: false,
          hasMethodologyKeywords: false,
          hasComplexAnalysis: false,
        },
        complexity: 'low',
        suggestedGates: ['basic_validation'],
        frameworkRecommendation: {
          shouldUseFramework: false,
          reasoning: ['Fallback analysis - framework not recommended'],
          confidence: 0.9,
        },
        analysisMetadata: {
          version: '3.0.0',
          mode: 'minimal',
          analysisTime: performance.now() - startTime,
          analyzer: 'content',
          cacheHit: false,
        },
      },
      frameworkContext: this.frameworkManager.generateExecutionContext(prompt, {
        executionType: 'single',
        complexity: 'low',
      }),
      integration: {
        frameworkSelectionReason: 'Fallback selection',
        semanticFrameworkAlignment: 0.3,
        alternativeFrameworks: [],
        consensusMetrics: {
          confidenceAlignment: 0.3,
          complexityMatch: 0.3,
          executionTypeCompatibility: 0.3,
        },
      },
      recommendations: {
        executionApproach: 'Basic single execution',
        expectedPerformance: {
          processingTime: 100,
          memoryUsage: 'low',
          cacheable: true,
        },
        qualityAssurance: ['basic_validation'],
        optimizations: [],
      },
    };
  }
}

/**
 * Create and configure framework-semantic integration with configurable analyzer
 */
export async function createFrameworkSemanticIntegration(
  frameworkManager: FrameworkManager,
  frameworkStateManager: FrameworkStateManager,
  logger: Logger,
  semanticAnalyzer: ContentAnalyzer,
  config?: Partial<FrameworkSwitchingConfig>
): Promise<FrameworkSemanticIntegration> {
  return new FrameworkSemanticIntegration(
    frameworkManager,
    frameworkStateManager,
    semanticAnalyzer,
    logger,
    config
  );
}
