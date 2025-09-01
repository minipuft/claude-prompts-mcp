/**
 * Framework-Semantic Integration - Phase 2 Implementation
 * Intelligent framework switching and consensus mechanisms
 * 
 * Key Integration Points:
 * - Semantic Analysis provides WHAT the prompt needs (complexity, structure, requirements)
 * - Framework Manager provides HOW to approach it (methodology, system prompts)
 * - Integration layer coordinates between systems WITHOUT interference
 */

import { Logger } from "../../logging/index.js";
import { ConvertedPrompt } from "../../types/index.js";
import { 
  FrameworkManager, 
  FrameworkDefinition, 
  FrameworkExecutionContext,
  FrameworkSelectionCriteria 
} from "../framework-manager.js";
import { 
  SemanticAnalyzer, 
  SemanticAnalysis 
} from "../../analysis/semantic-analyzer.js";

/**
 * Integrated analysis result combining semantic intelligence and framework methodology
 */
export interface IntegratedAnalysisResult {
  // Semantic analysis results - PROMPT INTELLIGENCE
  semanticAnalysis: SemanticAnalysis;
  
  // Framework execution context - METHODOLOGY GUIDANCE
  frameworkContext: FrameworkExecutionContext;
  
  // Integration metadata
  integration: {
    frameworkSelectionReason: string;
    semanticFrameworkAlignment: number; // How well semantic criteria match selected framework
    alternativeFrameworks: FrameworkDefinition[];
    consensusMetrics: {
      confidenceAlignment: number;
      complexityMatch: number;
      executionTypeCompatibility: number;
    };
  };
  
  // Combined execution recommendations
  recommendations: {
    executionApproach: string;
    expectedPerformance: {
      processingTime: number;
      memoryUsage: string;
      cacheable: boolean;
    };
    qualityAssurance: string[];
    optimizations: string[];
  };
}

/**
 * Framework switching configuration
 */
export interface FrameworkSwitchingConfig {
  enableAutomaticSwitching: boolean;
  switchingThreshold: number; // Confidence threshold for switching
  preventThrashing: boolean; // Prevent rapid framework switches
  switchingCooldownMs: number;
  blacklistedFrameworks: string[];
  preferredFrameworks: string[];
}

/**
 * Framework-Semantic Integration Engine
 * Coordinates intelligent framework selection based on semantic analysis
 */
export class FrameworkSemanticIntegration {
  private frameworkManager: FrameworkManager;
  private semanticAnalyzer: SemanticAnalyzer;
  private logger: Logger;
  private config: FrameworkSwitchingConfig;
  
  // Framework switching state management
  private lastFrameworkSwitch = new Map<string, number>();
  private frameworkPerformanceHistory = new Map<string, FrameworkPerformanceMetrics>();
  
  constructor(
    frameworkManager: FrameworkManager,
    semanticAnalyzer: SemanticAnalyzer,
    logger: Logger,
    config: Partial<FrameworkSwitchingConfig> = {}
  ) {
    this.frameworkManager = frameworkManager;
    this.semanticAnalyzer = semanticAnalyzer;
    this.logger = logger;
    
    this.config = {
      enableAutomaticSwitching: config.enableAutomaticSwitching ?? true,
      switchingThreshold: config.switchingThreshold ?? 0.8,
      preventThrashing: config.preventThrashing ?? true,
      switchingCooldownMs: config.switchingCooldownMs ?? 30000, // 30 second cooldown
      blacklistedFrameworks: config.blacklistedFrameworks ?? [],
      preferredFrameworks: config.preferredFrameworks ?? []
    };
  }

  /**
   * Main integration method - combines semantic analysis with framework selection
   */
  async analyzeWithFrameworkIntegration(
    prompt: ConvertedPrompt,
    userFrameworkPreference?: string
  ): Promise<IntegratedAnalysisResult> {
    const startTime = performance.now();
    
    try {
      // Step 1: Perform semantic analysis (WHAT does the prompt need?)
      this.logger.debug(`Starting semantic analysis for prompt: ${prompt.id}`);
      const semanticAnalysis = await this.semanticAnalyzer.analyzePrompt(prompt);
      
      // Step 2: Enhance framework criteria with user preference
      const executionType = semanticAnalysis.executionType; // No more "auto" type in the new system
      const enhancedCriteria = this.enhanceFrameworkCriteria(
        {
          executionType: executionType as "template" | "chain" | "workflow",
          complexity: semanticAnalysis.complexity
        },
        userFrameworkPreference
      );
      
      // Step 3: Intelligent framework selection (HOW should we approach this?)
      this.logger.debug(`Selecting framework based on semantic criteria`);
      const frameworkContext = this.selectOptimalFramework(
        prompt,
        enhancedCriteria,
        semanticAnalysis
      );
      
      // Step 4: Validate framework-semantic alignment
      const alignment = this.validateFrameworkAlignment(semanticAnalysis, frameworkContext);
      
      // Step 5: Generate alternative frameworks for consensus
      const alternatives = this.generateAlternativeFrameworks(enhancedCriteria, frameworkContext);
      
      // Step 6: Build integrated result
      const result: IntegratedAnalysisResult = {
        semanticAnalysis,
        frameworkContext,
        integration: {
          frameworkSelectionReason: frameworkContext.metadata.selectionReason,
          semanticFrameworkAlignment: alignment.overallAlignment,
          alternativeFrameworks: alternatives,
          consensusMetrics: alignment.detailedMetrics
        },
        recommendations: this.generateIntegratedRecommendations(
          semanticAnalysis,
          frameworkContext,
          alignment
        )
      };
      
      // Update performance tracking
      this.updateFrameworkPerformance(
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
      this.logger.error("Framework-semantic integration failed:", error);
      return this.createFallbackIntegratedResult(prompt, startTime);
    }
  }

  /**
   * Get framework performance insights for optimization
   */
  getFrameworkPerformanceInsights(): FrameworkPerformanceInsights {
    const frameworks = this.frameworkManager.listFrameworks(true);
    const insights: FrameworkPerformanceInsights = {
      totalAnalyses: 0,
      frameworkMetrics: {},
      recommendations: []
    };
    
    frameworks.forEach(framework => {
      const metrics = this.frameworkPerformanceHistory.get(framework.id);
      if (metrics) {
        insights.frameworkMetrics[framework.id] = {
          framework: framework,
          ...metrics
        };
        insights.totalAnalyses += metrics.usageCount;
      }
    });
    
    // Generate optimization recommendations
    insights.recommendations = this.generatePerformanceRecommendations(insights);
    
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
    const bestAlternative = alternatives.find(alt => 
      !this.config.blacklistedFrameworks.includes(alt.id) &&
      alt.id !== currentFramework.id
    );
    
    if (!bestAlternative) {
      return null; // No viable alternatives
    }
    
    return {
      currentFramework: currentFramework,
      recommendedFramework: bestAlternative,
      reason: `Low alignment (${(alignment * 100).toFixed(1)}%) suggests ${bestAlternative.name} would be more suitable`,
      expectedImprovement: this.estimateImprovementPotential(
        currentFramework,
        bestAlternative,
        currentResult.semanticAnalysis
      )
    };
  }

  // Private implementation methods

  /**
   * Enhance framework criteria with user preferences and context
   */
  private enhanceFrameworkCriteria(
    baseCriteria: FrameworkSelectionCriteria,
    userPreference?: string
  ): FrameworkSelectionCriteria {
    const enhanced = { ...baseCriteria };
    
    // Apply user preference if provided
    if (userPreference) {
      enhanced.userPreference = userPreference as any;
    }
    
    // Apply global preferences
    if (this.config.preferredFrameworks.length > 0 && !enhanced.userPreference) {
      // Don't override user preference, but suggest from preferred list
    }
    
    return enhanced;
  }

  /**
   * Select optimal framework using intelligent selection logic
   */
  private selectOptimalFramework(
    prompt: ConvertedPrompt,
    criteria: FrameworkSelectionCriteria,
    semanticAnalysis: SemanticAnalysis
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
    semanticAnalysis: SemanticAnalysis,
    frameworkContext: FrameworkExecutionContext
  ): FrameworkAlignmentResult {
    const framework = frameworkContext.selectedFramework;
    
    // Calculate alignment scores
    const confidenceAlignment = this.calculateConfidenceAlignment(
      semanticAnalysis.confidence,
      frameworkContext.metadata.confidence
    );
    
    const complexityMatch = this.calculateComplexityMatch(
      semanticAnalysis.complexity,
      framework
    );
    
    const executionTypeCompatibility = this.calculateExecutionTypeCompatibility(
      semanticAnalysis.executionType,
      framework
    );
    
    const overallAlignment = (confidenceAlignment + complexityMatch + executionTypeCompatibility) / 3;
    
    return {
      overallAlignment,
      detailedMetrics: {
        confidenceAlignment,
        complexityMatch,
        executionTypeCompatibility
      }
    };
  }

  /**
   * Generate alternative framework options for consensus
   */
  private generateAlternativeFrameworks(
    criteria: FrameworkSelectionCriteria,
    currentContext: FrameworkExecutionContext
  ): FrameworkDefinition[] {
    const allFrameworks = this.frameworkManager.listFrameworks(true);
    const currentFramework = currentContext.selectedFramework;
    
    // Return frameworks that are NOT the current one, sorted by suitability
    return allFrameworks
      .filter(f => f.id !== currentFramework.id)
      .filter(f => !this.config.blacklistedFrameworks.includes(f.id))
      .slice(0, 3); // Limit to top 3 alternatives
  }

  /**
   * Generate integrated recommendations combining semantic and framework insights
   */
  private generateIntegratedRecommendations(
    semanticAnalysis: SemanticAnalysis,
    frameworkContext: FrameworkExecutionContext,
    alignment: FrameworkAlignmentResult
  ) {
    return {
      executionApproach: this.generateExecutionApproach(semanticAnalysis, frameworkContext),
      expectedPerformance: {
        processingTime: this.estimateProcessingTime(semanticAnalysis),
        memoryUsage: this.estimateMemoryUsage(semanticAnalysis),
        cacheable: semanticAnalysis.complexity !== "high"
      },
      qualityAssurance: [
        ...semanticAnalysis.suggestedGates,
        ...this.getFrameworkSpecificGates(frameworkContext.selectedFramework)
      ],
      optimizations: this.generateOptimizationSuggestions(semanticAnalysis, frameworkContext, alignment)
    };
  }

  // Helper methods for alignment calculations

  private calculateConfidenceAlignment(semanticConfidence: number, frameworkConfidence: number): number {
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
      'low': 1,
      'medium': 2,
      'high': 3
    };
    
    const semantic = complexityScore[semanticComplexity] || 2;
    
    // Framework suitability based on methodology
    let frameworkSuitability = 2; // Default medium
    switch (framework.methodology) {
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
    semanticAnalysis: SemanticAnalysis,
    frameworkContext: FrameworkExecutionContext
  ): string {
    return `Execute as ${semanticAnalysis.executionType} using ${frameworkContext.selectedFramework.name} methodology`;
  }

  private getFrameworkSpecificGates(framework: FrameworkDefinition): string[] {
    const gates: string[] = [];
    
    switch (framework.methodology) {
      case 'CAGEERF':
        gates.push('cageerf_compliance', 'structured_analysis_validation');
        break;
      case 'ReACT':
        gates.push('reasoning_validation', 'action_coherence');
        break;
      case '5W1H':
        gates.push('completeness_validation', 'question_coverage');
        break;
      case 'SCAMPER':
        gates.push('creativity_validation', 'innovation_assessment');
        break;
    }
    
    return gates;
  }

  private generateOptimizationSuggestions(
    semanticAnalysis: SemanticAnalysis,
    frameworkContext: FrameworkExecutionContext,
    alignment: FrameworkAlignmentResult
  ): string[] {
    const suggestions: string[] = [];
    
    if (alignment.overallAlignment < 0.7) {
      suggestions.push("Consider framework switching for better alignment");
    }
    
    if (semanticAnalysis.complexity === "low") {
      suggestions.push("Enable parallel processing for performance improvement");
    }
    
    if (semanticAnalysis.confidence > 0.8) {
      suggestions.push("Enable caching to improve repeat performance");
    }
    
    return suggestions;
  }

  /**
   * Estimate processing time based on semantic analysis
   */
  private estimateProcessingTime(semanticAnalysis: SemanticAnalysis): number {
    let baseTime = 100; // Base processing time in ms
    
    // Adjust based on complexity
    switch (semanticAnalysis.complexity) {
      case "high":
        baseTime *= 3;
        break;
      case "medium":
        baseTime *= 2;
        break;
      default:
        break;
    }
    
    // Adjust based on execution type
    switch (semanticAnalysis.executionType) {
      case "chain":
        // Advanced chains with workflow-like features get higher multiplier
        if (semanticAnalysis.executionCharacteristics.advancedChainFeatures?.requiresAdvancedExecution) {
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
  private estimateMemoryUsage(semanticAnalysis: SemanticAnalysis): string {
    if (semanticAnalysis.complexity === "high") {
      return "high";
    } else if (semanticAnalysis.complexity === "medium") {
      return "medium";
    } else {
      return "low";
    }
  }

  private updateFrameworkPerformance(
    frameworkId: string,
    processingTime: number,
    alignmentScore: number
  ): void {
    let metrics = this.frameworkPerformanceHistory.get(frameworkId);
    
    if (!metrics) {
      metrics = {
        usageCount: 0,
        averageProcessingTime: 0,
        averageAlignmentScore: 0,
        lastUsed: new Date()
      };
    }
    
    metrics.usageCount++;
    metrics.averageProcessingTime = (metrics.averageProcessingTime + processingTime) / 2;
    metrics.averageAlignmentScore = (metrics.averageAlignmentScore + alignmentScore) / 2;
    metrics.lastUsed = new Date();
    
    this.frameworkPerformanceHistory.set(frameworkId, metrics);
  }

  private generatePerformanceRecommendations(insights: FrameworkPerformanceInsights): string[] {
    const recommendations: string[] = [];
    
    const frameworkMetrics = Object.values(insights.frameworkMetrics);
    if (frameworkMetrics.length === 0) return recommendations;
    
    // Find best and worst performing frameworks
    const bestFramework = frameworkMetrics.reduce((best, current) => 
      current.averageAlignmentScore > best.averageAlignmentScore ? current : best
    );
    
    const worstFramework = frameworkMetrics.reduce((worst, current) => 
      current.averageAlignmentScore < worst.averageAlignmentScore ? current : worst
    );
    
    if (bestFramework.averageAlignmentScore > 0.8) {
      recommendations.push(`Consider defaulting to ${bestFramework.framework.name} (${(bestFramework.averageAlignmentScore * 100).toFixed(1)}% avg alignment)`);
    }
    
    if (worstFramework.averageAlignmentScore < 0.5) {
      recommendations.push(`Review configuration for ${worstFramework.framework.name} (${(worstFramework.averageAlignmentScore * 100).toFixed(1)}% avg alignment)`);
    }
    
    return recommendations;
  }

  private estimateImprovementPotential(
    currentFramework: FrameworkDefinition,
    alternativeFramework: FrameworkDefinition,
    semanticAnalysis: SemanticAnalysis
  ): number {
    // Estimate potential improvement based on framework characteristics
    let improvement = 0.1; // Base improvement assumption
    
    // Framework-specific improvements
    if (semanticAnalysis.complexity === 'high' && alternativeFramework.methodology === 'CAGEERF') {
      improvement += 0.2;
    }
    
    if (semanticAnalysis.executionType === 'chain' && alternativeFramework.methodology === 'ReACT') {
      improvement += 0.15;
    }
    
    return Math.min(improvement, 0.4); // Cap at 40% improvement
  }

  private createFallbackIntegratedResult(prompt: ConvertedPrompt, startTime: number): IntegratedAnalysisResult {
    const fallbackFramework = this.frameworkManager.listFrameworks(true)[0];
    
    return {
      semanticAnalysis: {
        executionType: "template",
        requiresExecution: false,
        requiresFramework: false,
        confidence: 0.3,
        reasoning: ["Fallback analysis"],
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
          hasComplexAnalysis: false
        },
        complexity: "low",
        suggestedGates: ["basic_validation"],
        frameworkRecommendation: {
          shouldUseFramework: false,
          reasoning: ["Fallback analysis - framework not recommended"],
          confidence: 0.9
        },
        analysisMetadata: {
          version: "2.0.0",
          analysisTime: performance.now() - startTime,
          analyzer: "semantic",
          cacheHit: false
        }
      },
      frameworkContext: this.frameworkManager.generateExecutionContext(prompt, {
        executionType: "template",
        complexity: "low"
      }),
      integration: {
        frameworkSelectionReason: "Fallback selection",
        semanticFrameworkAlignment: 0.3,
        alternativeFrameworks: [],
        consensusMetrics: {
          confidenceAlignment: 0.3,
          complexityMatch: 0.3,
          executionTypeCompatibility: 0.3
        }
      },
      recommendations: {
        executionApproach: "Basic template execution",
        expectedPerformance: {
          processingTime: 100,
          memoryUsage: "low",
          cacheable: true
        },
        qualityAssurance: ["basic_validation"],
        optimizations: []
      }
    };
  }
}

// Supporting interfaces

interface FrameworkPerformanceMetrics {
  usageCount: number;
  averageProcessingTime: number;
  averageAlignmentScore: number;
  lastUsed: Date;
}

interface FrameworkAlignmentResult {
  overallAlignment: number;
  detailedMetrics: {
    confidenceAlignment: number;
    complexityMatch: number;
    executionTypeCompatibility: number;
  };
}

export interface FrameworkPerformanceInsights {
  totalAnalyses: number;
  frameworkMetrics: Record<string, FrameworkPerformanceMetrics & { framework: FrameworkDefinition }>;
  recommendations: string[];
}

export interface FrameworkSwitchRecommendation {
  currentFramework: FrameworkDefinition;
  recommendedFramework: FrameworkDefinition;
  reason: string;
  expectedImprovement: number;
}

/**
 * Create and configure framework-semantic integration
 */
export async function createFrameworkSemanticIntegration(
  frameworkManager: FrameworkManager,
  logger: Logger,
  config?: Partial<FrameworkSwitchingConfig>
): Promise<FrameworkSemanticIntegration> {
  const semanticAnalyzer = new SemanticAnalyzer(logger);
  return new FrameworkSemanticIntegration(frameworkManager, semanticAnalyzer, logger, config);
}