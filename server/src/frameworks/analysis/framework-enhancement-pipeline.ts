/**
 * Framework Enhancement Pipeline
 * Framework-agnostic pipeline for processing and enhancing semantic analysis results
 * Provides composable enhancement strategies that work across different analytical frameworks
 */

import { ConvertedPrompt } from "../../types/index.js";
import { Logger } from "../../logging/index.js";
import {
  IFrameworkAnalyzer,
  SemanticAnalysisResult,
  EnhancedSemanticResult,
  FrameworkEnhancement,
  ExecutionType
} from "../interfaces/framework-interfaces.js";

/**
 * Enhancement strategy interface for pluggable enhancement logic
 */
export interface IEnhancementStrategy {
  readonly strategyId: string;
  readonly strategyName: string;
  readonly priority: number; // Higher priority runs first
  
  /**
   * Apply enhancement to analysis result
   */
  enhance(
    basicAnalysis: SemanticAnalysisResult,
    frameworkResults: Record<string, any>,
    context: EnhancementContext
  ): Promise<Partial<EnhancedSemanticResult>>;
  
  /**
   * Check if strategy is applicable to current analysis
   */
  isApplicable(
    basicAnalysis: SemanticAnalysisResult,
    frameworkResults: Record<string, any>,
    context: EnhancementContext
  ): boolean;
}

/**
 * Context information for enhancement strategies
 */
export interface EnhancementContext {
  prompt: ConvertedPrompt;
  availableFrameworks: string[];
  config: EnhancementPipelineConfig;
  logger?: Logger;
  metadata?: Record<string, any>;
}

/**
 * Configuration for the enhancement pipeline
 */
export interface EnhancementPipelineConfig {
  enabledStrategies: string[];
  strategyTimeoutMs: number;
  maxConcurrentStrategies: number;
  aggregationStrategy: 'merge' | 'weighted' | 'priority' | 'consensus';
  qualityThreshold: number;
  enableMetrics: boolean;
}

/**
 * Pipeline execution metrics
 */
export interface PipelineMetrics {
  totalExecutionTime: number;
  strategyTimes: Record<string, number>;
  strategiesApplied: number;
  strategiesSkipped: number;
  errors: number;
  qualityImprovement: number;
}

/**
 * Framework-agnostic enhancement pipeline
 */
export class FrameworkEnhancementPipeline {
  private strategies = new Map<string, IEnhancementStrategy>();
  private config: EnhancementPipelineConfig;
  private logger?: Logger;
  private metrics: PipelineMetrics;

  constructor(config: Partial<EnhancementPipelineConfig> = {}, logger?: Logger) {
    this.logger = logger;
    this.config = {
      enabledStrategies: config.enabledStrategies || [],
      strategyTimeoutMs: config.strategyTimeoutMs || 2000,
      maxConcurrentStrategies: config.maxConcurrentStrategies || 3,
      aggregationStrategy: config.aggregationStrategy || 'weighted',
      qualityThreshold: config.qualityThreshold || 0.7,
      enableMetrics: config.enableMetrics ?? true,
      ...config
    };

    this.metrics = this.initializeMetrics();
    this.registerDefaultStrategies();
  }

  /**
   * Register an enhancement strategy
   */
  registerStrategy(strategy: IEnhancementStrategy): void {
    this.strategies.set(strategy.strategyId, strategy);
    this.logger?.info(`Registered enhancement strategy: ${strategy.strategyName}`);
  }

  /**
   * Unregister an enhancement strategy
   */
  unregisterStrategy(strategyId: string): boolean {
    const success = this.strategies.delete(strategyId);
    if (success) {
      this.logger?.info(`Unregistered enhancement strategy: ${strategyId}`);
    }
    return success;
  }

  /**
   * Execute enhancement pipeline
   */
  async enhance(
    basicAnalysis: SemanticAnalysisResult,
    frameworkResults: Record<string, any>,
    context: EnhancementContext
  ): Promise<EnhancedSemanticResult> {
    const startTime = performance.now();
    
    try {
      // Get applicable strategies sorted by priority
      const applicableStrategies = this.getApplicableStrategies(
        basicAnalysis, 
        frameworkResults, 
        context
      );
      
      if (applicableStrategies.length === 0) {
        this.logger?.debug("No applicable enhancement strategies found");
        return this.createBasicEnhancedResult(basicAnalysis, frameworkResults);
      }
      
      // Execute strategies
      const enhancements = await this.executeStrategies(
        applicableStrategies,
        basicAnalysis,
        frameworkResults,
        context
      );
      
      // Aggregate enhancement results
      const enhancedResult = this.aggregateEnhancements(
        basicAnalysis,
        enhancements,
        frameworkResults
      );
      
      // Update metrics
      if (this.config.enableMetrics) {
        this.updateMetrics(startTime, applicableStrategies, enhancements);
      }
      
      return enhancedResult;
      
    } catch (error) {
      this.logger?.error("Enhancement pipeline execution failed:", error);
      this.metrics.errors++;
      return this.createBasicEnhancedResult(basicAnalysis, frameworkResults);
    }
  }

  /**
   * Get pipeline execution metrics
   */
  getMetrics(): PipelineMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset pipeline metrics
   */
  resetMetrics(): void {
    this.metrics = this.initializeMetrics();
  }

  /**
   * List registered strategies
   */
  listStrategies(): StrategyInfo[] {
    return Array.from(this.strategies.values()).map(strategy => ({
      id: strategy.strategyId,
      name: strategy.strategyName,
      priority: strategy.priority,
      enabled: this.config.enabledStrategies.includes(strategy.strategyId)
    }));
  }

  /**
   * Update pipeline configuration
   */
  updateConfig(newConfig: Partial<EnhancementPipelineConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger?.info("Enhancement pipeline configuration updated");
  }

  // Private implementation methods

  private getApplicableStrategies(
    basicAnalysis: SemanticAnalysisResult,
    frameworkResults: Record<string, any>,
    context: EnhancementContext
  ): IEnhancementStrategy[] {
    const applicableStrategies: IEnhancementStrategy[] = [];
    
    for (const [id, strategy] of this.strategies) {
      // Check if strategy is enabled
      if (!this.config.enabledStrategies.includes(id)) {
        continue;
      }
      
      // Check if strategy is applicable
      try {
        if (strategy.isApplicable(basicAnalysis, frameworkResults, context)) {
          applicableStrategies.push(strategy);
        }
      } catch (error) {
        this.logger?.warn(`Strategy applicability check failed for ${id}:`, error);
      }
    }
    
    // Sort by priority (higher priority first)
    return applicableStrategies.sort((a, b) => b.priority - a.priority);
  }

  private async executeStrategies(
    strategies: IEnhancementStrategy[],
    basicAnalysis: SemanticAnalysisResult,
    frameworkResults: Record<string, any>,
    context: EnhancementContext
  ): Promise<Map<string, Partial<EnhancedSemanticResult>>> {
    const enhancements = new Map<string, Partial<EnhancedSemanticResult>>();
    
    // Execute strategies with concurrency limit
    const batches = this.createStrategyBatches(strategies, this.config.maxConcurrentStrategies);
    
    for (const batch of batches) {
      const batchPromises = batch.map(async strategy => {
        const strategyStart = performance.now();
        
        try {
          // Execute with timeout
          const enhancementPromise = strategy.enhance(basicAnalysis, frameworkResults, context);
          const timeoutPromise = new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('Strategy timeout')), this.config.strategyTimeoutMs)
          );
          
          const enhancement = await Promise.race([enhancementPromise, timeoutPromise]);
          
          enhancements.set(strategy.strategyId, enhancement);
          
          if (this.config.enableMetrics) {
            this.metrics.strategyTimes[strategy.strategyId] = performance.now() - strategyStart;
            this.metrics.strategiesApplied++;
          }
          
        } catch (error) {
          this.logger?.warn(`Enhancement strategy ${strategy.strategyId} failed:`, error);
          this.metrics.errors++;
          this.metrics.strategiesSkipped++;
        }
      });
      
      await Promise.all(batchPromises);
    }
    
    return enhancements;
  }

  private createStrategyBatches(
    strategies: IEnhancementStrategy[],
    batchSize: number
  ): IEnhancementStrategy[][] {
    const batches: IEnhancementStrategy[][] = [];
    
    for (let i = 0; i < strategies.length; i += batchSize) {
      batches.push(strategies.slice(i, i + batchSize));
    }
    
    return batches;
  }

  private aggregateEnhancements(
    basicAnalysis: SemanticAnalysisResult,
    enhancements: Map<string, Partial<EnhancedSemanticResult>>,
    frameworkResults: Record<string, any>
  ): EnhancedSemanticResult {
    const enhancementValues = Array.from(enhancements.values());
    
    if (enhancementValues.length === 0) {
      return this.createBasicEnhancedResult(basicAnalysis, frameworkResults);
    }
    
    switch (this.config.aggregationStrategy) {
      case 'merge':
        return this.mergeEnhancements(basicAnalysis, enhancementValues, frameworkResults);
      
      case 'weighted':
        return this.weightedAggregation(basicAnalysis, enhancementValues, frameworkResults);
      
      case 'priority':
        return this.priorityAggregation(basicAnalysis, enhancementValues, frameworkResults);
      
      case 'consensus':
        return this.consensusAggregation(basicAnalysis, enhancementValues, frameworkResults);
      
      default:
        return this.mergeEnhancements(basicAnalysis, enhancementValues, frameworkResults);
    }
  }

  private createBasicEnhancedResult(
    basicAnalysis: SemanticAnalysisResult,
    frameworkResults: Record<string, any>
  ): EnhancedSemanticResult {
    return {
      ...basicAnalysis,
      frameworkAnalysis: frameworkResults,
      frameworkCompliance: this.calculateAverageCompliance(frameworkResults),
      methodologyScore: this.calculateAverageMethodologyScore(frameworkResults),
      frameworkEnhancements: this.extractFrameworkEnhancements(frameworkResults)
    };
  }

  private mergeEnhancements(
    basicAnalysis: SemanticAnalysisResult,
    enhancements: Partial<EnhancedSemanticResult>[],
    frameworkResults: Record<string, any>
  ): EnhancedSemanticResult {
    const merged: EnhancedSemanticResult = this.createBasicEnhancedResult(basicAnalysis, frameworkResults);
    
    // Merge confidence scores (take maximum)
    const confidences = enhancements.map(e => e.confidence).filter(c => c !== undefined) as number[];
    if (confidences.length > 0) {
      merged.confidence = Math.max(merged.confidence, ...confidences);
    }
    
    // Merge reasoning
    const allReasoning = enhancements.map(e => e.reasoning || []).flat();
    merged.reasoning = [...merged.reasoning, ...allReasoning];
    
    // Merge suggested gates
    const allGates = enhancements.map(e => e.suggestedGates || []).flat();
    merged.suggestedGates = Array.from(new Set([...merged.suggestedGates, ...allGates]));
    
    // Merge framework enhancements
    const allEnhancements = enhancements.map(e => e.frameworkEnhancements || []).flat();
    merged.frameworkEnhancements = [...(merged.frameworkEnhancements || []), ...allEnhancements];
    
    return merged;
  }

  private weightedAggregation(
    basicAnalysis: SemanticAnalysisResult,
    enhancements: Partial<EnhancedSemanticResult>[],
    frameworkResults: Record<string, any>
  ): EnhancedSemanticResult {
    // For now, use merge strategy as weighted aggregation base
    // In a full implementation, this would weight by strategy priority and confidence
    return this.mergeEnhancements(basicAnalysis, enhancements, frameworkResults);
  }

  private priorityAggregation(
    basicAnalysis: SemanticAnalysisResult,
    enhancements: Partial<EnhancedSemanticResult>[],
    frameworkResults: Record<string, any>
  ): EnhancedSemanticResult {
    // Take the first (highest priority) enhancement that meets quality threshold
    const qualityEnhancement = enhancements.find(e => 
      (e.confidence || 0) >= this.config.qualityThreshold
    );
    
    if (qualityEnhancement) {
      return {
        ...this.createBasicEnhancedResult(basicAnalysis, frameworkResults),
        ...qualityEnhancement
      };
    }
    
    return this.createBasicEnhancedResult(basicAnalysis, frameworkResults);
  }

  private consensusAggregation(
    basicAnalysis: SemanticAnalysisResult,
    enhancements: Partial<EnhancedSemanticResult>[],
    frameworkResults: Record<string, any>
  ): EnhancedSemanticResult {
    // Build consensus from multiple enhancements
    // For now, use merge strategy as consensus base
    return this.mergeEnhancements(basicAnalysis, enhancements, frameworkResults);
  }

  private calculateAverageCompliance(frameworkResults: Record<string, any>): number | undefined {
    const complianceScores = Object.values(frameworkResults)
      .map((result: any) => result.overallCompliance || result.frameworkScore)
      .filter(score => score !== undefined) as number[];
    
    return complianceScores.length > 0
      ? complianceScores.reduce((sum, score) => sum + score, 0) / complianceScores.length
      : undefined;
  }

  private calculateAverageMethodologyScore(frameworkResults: Record<string, any>): number | undefined {
    const methodologyScores = Object.values(frameworkResults)
      .map((result: any) => result.frameworkScore || result.overallCompliance)
      .filter(score => score !== undefined) as number[];
    
    return methodologyScores.length > 0
      ? methodologyScores.reduce((sum, score) => sum + score, 0) / methodologyScores.length
      : undefined;
  }

  private extractFrameworkEnhancements(frameworkResults: Record<string, any>): FrameworkEnhancement[] {
    const enhancements: FrameworkEnhancement[] = [];
    
    Object.values(frameworkResults).forEach((result: any) => {
      if (result.templateSuggestions) {
        enhancements.push(...result.templateSuggestions);
      }
    });
    
    return enhancements;
  }

  private registerDefaultStrategies(): void {
    // Register confidence boost strategy
    this.registerStrategy(new ConfidenceBoostStrategy());
    
    // Register execution type refinement strategy
    this.registerStrategy(new ExecutionTypeRefinementStrategy());
    
    // Register gate aggregation strategy
    this.registerStrategy(new GateAggregationStrategy());
    
    // Register quality enhancement strategy
    this.registerStrategy(new QualityEnhancementStrategy());
  }

  private initializeMetrics(): PipelineMetrics {
    return {
      totalExecutionTime: 0,
      strategyTimes: {},
      strategiesApplied: 0,
      strategiesSkipped: 0,
      errors: 0,
      qualityImprovement: 0
    };
  }

  private updateMetrics(
    startTime: number,
    strategies: IEnhancementStrategy[],
    enhancements: Map<string, Partial<EnhancedSemanticResult>>
  ): void {
    this.metrics.totalExecutionTime = performance.now() - startTime;
    
    // Calculate quality improvement (simplified metric)
    const appliedEnhancements = enhancements.size;
    const totalStrategies = strategies.length;
    this.metrics.qualityImprovement = totalStrategies > 0 ? appliedEnhancements / totalStrategies : 0;
  }
}

// Default enhancement strategies

class ConfidenceBoostStrategy implements IEnhancementStrategy {
  readonly strategyId = 'confidence-boost';
  readonly strategyName = 'Confidence Boost Strategy';
  readonly priority = 100;

  async enhance(
    basicAnalysis: SemanticAnalysisResult,
    frameworkResults: Record<string, any>
  ): Promise<Partial<EnhancedSemanticResult>> {
    // Boost confidence based on framework agreement
    const frameworkCount = Object.keys(frameworkResults).length;
    const confidenceBoost = Math.min(0.2, frameworkCount * 0.05);
    
    return {
      confidence: Math.min(1.0, basicAnalysis.confidence + confidenceBoost),
      reasoning: [...basicAnalysis.reasoning, `Confidence boosted by ${Math.round(confidenceBoost * 100)}% due to framework agreement`]
    };
  }

  isApplicable(
    basicAnalysis: SemanticAnalysisResult,
    frameworkResults: Record<string, any>
  ): boolean {
    return Object.keys(frameworkResults).length > 0;
  }
}

class ExecutionTypeRefinementStrategy implements IEnhancementStrategy {
  readonly strategyId = 'execution-type-refinement';
  readonly strategyName = 'Execution Type Refinement Strategy';
  readonly priority = 90;

  async enhance(
    basicAnalysis: SemanticAnalysisResult,
    frameworkResults: Record<string, any>
  ): Promise<Partial<EnhancedSemanticResult>> {
    // Refine execution type based on framework recommendations
    const frameworkTypes = this.extractExecutionTypes(frameworkResults);
    const refinedType = this.selectBestExecutionType(basicAnalysis.executionType, frameworkTypes);
    
    if (refinedType !== basicAnalysis.executionType) {
      return {
        executionType: refinedType,
        reasoning: [...basicAnalysis.reasoning, `Execution type refined from ${basicAnalysis.executionType} to ${refinedType} based on framework analysis`]
      };
    }
    
    return {};
  }

  isApplicable(
    basicAnalysis: SemanticAnalysisResult,
    frameworkResults: Record<string, any>
  ): boolean {
    return Object.keys(frameworkResults).length > 0;
  }

  private extractExecutionTypes(frameworkResults: Record<string, any>): ExecutionType[] {
    // Phase 2: Use 3-tier model (prompt, template, chain) - no workflow recommendations
    return ['template', 'chain'];
  }

  private selectBestExecutionType(current: ExecutionType, recommendations: ExecutionType[]): ExecutionType {
    // Phase 2: 3-tier model logic - promote template to chain if majority recommends it
    const chainCount = recommendations.filter(t => t === 'chain').length;
    const templateCount = recommendations.filter(t => t === 'template').length;
    
    if (chainCount > templateCount && current === 'template') {
      return 'chain';
    }
    
    return current;
  }
}

class GateAggregationStrategy implements IEnhancementStrategy {
  readonly strategyId = 'gate-aggregation';
  readonly strategyName = 'Gate Aggregation Strategy';
  readonly priority = 80;

  async enhance(
    basicAnalysis: SemanticAnalysisResult,
    frameworkResults: Record<string, any>
  ): Promise<Partial<EnhancedSemanticResult>> {
    // Aggregate gate suggestions from all frameworks
    const allGates = this.extractGateSuggestions(frameworkResults);
    const prioritizedGates = this.prioritizeGates(allGates);
    
    return {
      suggestedGates: Array.from(new Set([...basicAnalysis.suggestedGates, ...prioritizedGates])),
      reasoning: [...basicAnalysis.reasoning, `Aggregated ${prioritizedGates.length} additional gate suggestions from frameworks`]
    };
  }

  isApplicable(
    basicAnalysis: SemanticAnalysisResult,
    frameworkResults: Record<string, any>
  ): boolean {
    return Object.keys(frameworkResults).length > 0;
  }

  private extractGateSuggestions(frameworkResults: Record<string, any>): string[] {
    const gates: string[] = [];
    // In a real implementation, this would extract gate suggestions from frameworks
    return gates;
  }

  private prioritizeGates(gates: string[]): string[] {
    // Simple prioritization - remove duplicates and sort
    return Array.from(new Set(gates)).sort();
  }
}

class QualityEnhancementStrategy implements IEnhancementStrategy {
  readonly strategyId = 'quality-enhancement';
  readonly strategyName = 'Quality Enhancement Strategy';
  readonly priority = 70;

  async enhance(
    basicAnalysis: SemanticAnalysisResult,
    frameworkResults: Record<string, any>
  ): Promise<Partial<EnhancedSemanticResult>> {
    // Enhance based on framework compliance scores
    const complianceScores = this.extractComplianceScores(frameworkResults);
    const averageCompliance = complianceScores.length > 0
      ? complianceScores.reduce((sum, score) => sum + score, 0) / complianceScores.length
      : 0;
    
    if (averageCompliance > 0.8) {
      return {
        confidence: Math.min(1.0, basicAnalysis.confidence + 0.1),
        reasoning: [...basicAnalysis.reasoning, `High framework compliance (${Math.round(averageCompliance * 100)}%) indicates quality analysis`]
      };
    }
    
    return {};
  }

  isApplicable(
    basicAnalysis: SemanticAnalysisResult,
    frameworkResults: Record<string, any>
  ): boolean {
    return Object.keys(frameworkResults).length > 0;
  }

  private extractComplianceScores(frameworkResults: Record<string, any>): number[] {
    return Object.values(frameworkResults)
      .map((result: any) => result.overallCompliance || result.frameworkScore)
      .filter(score => score !== undefined) as number[];
  }
}

// Supporting interfaces

export interface StrategyInfo {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
}