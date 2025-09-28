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
  ContentAnalyzer,
  ContentAnalysisResult
} from "../../semantic/configurable-semantic-analyzer.js";
import { FrameworkStateManager } from "../framework-state-manager.js";

/**
 * Integrated analysis result combining semantic intelligence and framework methodology
 */
export interface IntegratedAnalysisResult {
  // Semantic analysis results - PROMPT INTELLIGENCE
  semanticAnalysis: ContentAnalysisResult;
  
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
 * Coordinates framework selection based on structural analysis and user preference
 */
export class FrameworkSemanticIntegration {
  private frameworkManager: FrameworkManager;
  private frameworkStateManager: FrameworkStateManager;
  private semanticAnalyzer: ContentAnalyzer;
  private logger: Logger;
  private config: FrameworkSwitchingConfig;

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

    // NEW: Check if framework system is enabled before proceeding
    if (!this.frameworkStateManager.isFrameworkSystemEnabled()) {
      this.logger.debug(`Framework system disabled - returning semantic analysis only for prompt: ${prompt.id}`);
      return this.createNonFrameworkIntegratedResult(prompt, startTime);
    }

    try {
      // Step 1: Perform semantic analysis (WHAT does the prompt need?)
      this.logger.debug(`Starting semantic analysis for prompt: ${prompt.id}`);
      const semanticAnalysis = await this.semanticAnalyzer.analyzePrompt(prompt);
      
      // Step 2: Check analysis capabilities and adapt accordingly
      const analysisCapabilities = semanticAnalysis.capabilities;
      this.logger.debug(`Analysis capabilities: semantic=${analysisCapabilities.hasSemanticUnderstanding}, framework=${analysisCapabilities.canRecommendFramework}`);
      
      // Step 3: Enhance framework criteria with user preference and analysis mode
      const executionType = semanticAnalysis.executionType;
      const enhancedCriteria = this.enhanceFrameworkCriteria(
        {
          executionType: executionType as "template" | "chain",
          complexity: semanticAnalysis.complexity
        },
        userFrameworkPreference,
        semanticAnalysis
      );
      
      // Step 4: Framework selection adapted to analysis capabilities
      this.logger.debug(`Selecting framework based on semantic criteria (mode: ${semanticAnalysis.analysisMetadata.mode})`);
      const frameworkContext = this.selectOptimalFramework(
        prompt,
        enhancedCriteria,
        semanticAnalysis
      );
      
      // Step 5: Validate framework-semantic alignment
      const alignment = this.validateFrameworkAlignment(semanticAnalysis, frameworkContext);
      
      // Step 6: Generate alternative frameworks (adapted for analysis mode)
      const alternatives = this.generateAlternativeFrameworks(enhancedCriteria, frameworkContext, semanticAnalysis);
      
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
      this.logger.error("Framework-semantic integration failed:", error);
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
      recommendations: []
    };
    
    frameworks.forEach(framework => {
      const metrics = this.frameworkUsageHistory.get(framework.id);
      if (metrics) {
        insights.frameworkUsage[framework.id] = {
          framework: framework,
          ...metrics
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
      // In structural mode, user choice is more important
      if (semanticAnalysis.analysisMetadata.mode === 'structural') {
        if (!userPreference && semanticAnalysis.frameworkRecommendation.requiresUserChoice) {
          // Log that user choice is needed
          this.logger.info("Structural analysis mode - framework selection requires user choice or default");
        }
      }
      
      // In semantic mode, use intelligent recommendations
      if (semanticAnalysis.analysisMetadata.mode === 'semantic' && 
          semanticAnalysis.frameworkRecommendation.shouldUseFramework) {
        // We can trust the semantic recommendation more
        this.logger.debug("Semantic analysis provides framework recommendation");
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
    currentContext: FrameworkExecutionContext,
    semanticAnalysis?: ContentAnalysisResult
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
    semanticAnalysis: ContentAnalysisResult,
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
    semanticAnalysis: ContentAnalysisResult,
    frameworkContext: FrameworkExecutionContext
  ): string {
    const baseApproach = `Execute as ${semanticAnalysis.executionType} using ${frameworkContext.selectedFramework.name} methodology`;
    
    // Add mode-specific context
    if (semanticAnalysis.analysisMetadata.mode === 'structural') {
      return `${baseApproach} (structural analysis mode)`;
    } else if (semanticAnalysis.analysisMetadata.mode === 'semantic') {
      return `${baseApproach} (intelligent semantic analysis)`;
    } else {
      return `${baseApproach} (fallback analysis mode)`;
    }
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
    semanticAnalysis: ContentAnalysisResult,
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
    
    // Mode-specific suggestions
    if (semanticAnalysis.analysisMetadata.mode === 'structural') {
      suggestions.push("Consider enabling semantic analysis for intelligent framework recommendations");
      if (semanticAnalysis.limitations.length > 0) {
        suggestions.push("Enable LLM integration or Claude hooks for better analysis capabilities");
      }
    }
    
    // Warning-based suggestions
    if (semanticAnalysis.warnings.length > 0) {
      suggestions.push("Review analysis warnings for potential configuration improvements");
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
  private estimateMemoryUsage(semanticAnalysis: ContentAnalysisResult): string {
    if (semanticAnalysis.complexity === "high") {
      return "high";
    } else if (semanticAnalysis.complexity === "medium") {
      return "medium";
    } else {
      return "low";
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
        lastUsed: new Date()
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
      recommendations.push(`Most used framework: ${mostUsedFramework.framework.name} (${mostUsedFramework.usageCount} uses)`);
    }
    
    if (leastUsedFramework.usageCount === 0) {
      recommendations.push(`Unused framework: ${leastUsedFramework.framework.name} - consider if it's needed`);
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
    if (semanticAnalysis.complexity === 'high' && alternativeFramework.methodology === 'CAGEERF') {
      improvement += 0.2;
    }
    
    if (semanticAnalysis.executionType === 'chain' && alternativeFramework.methodology === 'ReACT') {
      improvement += 0.15;
    }
    
    return Math.min(improvement, 0.4); // Cap at 40% improvement
  }

  private async createNonFrameworkIntegratedResult(prompt: ConvertedPrompt, startTime: number): Promise<IntegratedAnalysisResult> {
    // When framework system is disabled, provide semantic analysis without framework integration
    const semanticAnalysis = await this.semanticAnalyzer.analyzePrompt(prompt);

    return {
      semanticAnalysis,
      frameworkContext: null as any, // No framework context when disabled
      integration: {
        frameworkSelectionReason: "Framework system disabled",
        semanticFrameworkAlignment: 0,
        alternativeFrameworks: [],
        consensusMetrics: {
          confidenceAlignment: 0,
          complexityMatch: 0,
          executionTypeCompatibility: 0
        }
      },
      recommendations: {
        executionApproach: `Execute as ${semanticAnalysis.executionType} without framework methodology`,
        expectedPerformance: {
          processingTime: this.estimateProcessingTime(semanticAnalysis),
          memoryUsage: this.estimateMemoryUsage(semanticAnalysis),
          cacheable: semanticAnalysis.complexity !== "high"
        },
        qualityAssurance: semanticAnalysis.suggestedGates,
        optimizations: ["Framework system disabled - using standard execution"]
      }
    };
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
        
        capabilities: {
          canDetectStructure: false,
          canAnalyzeComplexity: false,
          canRecommendFramework: false,
          hasSemanticUnderstanding: false
        },
        
        limitations: ["Fallback analysis with minimal capabilities"],
        warnings: ["Analysis failed - using basic fallback"],
        
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
          mode: "structural",
          analysisTime: performance.now() - startTime,
          analyzer: "content",
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

interface FrameworkUsageMetrics {
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

export interface FrameworkUsageInsights {
  totalAnalyses: number;
  frameworkUsage: Record<string, FrameworkUsageMetrics & { framework: FrameworkDefinition }>;
  recommendations: string[];
}

export interface FrameworkSwitchRecommendation {
  currentFramework: FrameworkDefinition;
  recommendedFramework: FrameworkDefinition;
  reason: string;
  expectedImprovement: number;
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
  return new FrameworkSemanticIntegration(frameworkManager, frameworkStateManager, semanticAnalyzer, logger, config);
}