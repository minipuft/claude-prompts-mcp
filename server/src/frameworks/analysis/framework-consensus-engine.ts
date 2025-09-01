/**
 * Framework Consensus Engine
 * Advanced consensus building and conflict resolution for multi-framework analysis
 * Provides intelligent comparison, ranking, and decision-making capabilities
 */

import { Logger } from "../../logging/index.js";
import { ConvertedPrompt } from "../../types/index.js";
import {
  IFrameworkAnalyzer,
  SemanticAnalysisResult,
  EnhancedSemanticResult,
  ExecutionType,
  FrameworkEnhancement
} from "../interfaces/framework-interfaces.js";

/**
 * Consensus building configuration
 */
export interface ConsensusConfig {
  agreementThreshold: number; // 0.0-1.0, minimum agreement level for consensus
  weightingStrategy: 'equal' | 'performance' | 'confidence' | 'priority';
  conflictResolution: 'majority' | 'weighted' | 'expert' | 'hybrid';
  minimumFrameworks: number; // Minimum frameworks required for consensus
  maxDissentThreshold: number; // Maximum allowed dissenting frameworks (0.0-1.0)
  confidenceFloor: number; // Minimum confidence to participate in consensus
  enableQualityGating: boolean; // Apply quality gates to framework results
}

/**
 * Framework comparison result
 */
export interface FrameworkComparison {
  frameworkId: string;
  score: number;
  confidence: number;
  strengths: string[];
  weaknesses: string[];
  recommendation: ExecutionType;
  gateSuggestions: string[];
  metadata: FrameworkComparisonMetadata;
}

/**
 * Comparison metadata for each framework
 */
export interface FrameworkComparisonMetadata {
  analysisTime: number;
  memoryUsage: number;
  complexity: 'low' | 'medium' | 'high';
  reliability: number; // 0.0-1.0
  coverage: number; // 0.0-1.0 (how much of the analysis was covered)
}

/**
 * Consensus result with detailed analysis
 */
export interface ConsensusResult {
  hasConsensus: boolean;
  consensusLevel: number; // 0.0-1.0
  finalRecommendation: EnhancedSemanticResult;
  participatingFrameworks: string[];
  frameworkComparisons: FrameworkComparison[];
  conflictAreas: ConflictArea[];
  resolutionStrategy: string;
  qualityMetrics: ConsensusQualityMetrics;
  debugInfo?: ConsensusDebugInfo;
}

/**
 * Areas where frameworks disagree
 */
export interface ConflictArea {
  aspect: 'executionType' | 'confidence' | 'gates' | 'enhancements' | 'compliance';
  frameworks: string[];
  values: any[];
  severity: 'low' | 'medium' | 'high';
  resolution: string;
}

/**
 * Quality metrics for consensus building
 */
export interface ConsensusQualityMetrics {
  overallQuality: number; // 0.0-1.0
  consistencyScore: number; // 0.0-1.0
  reliabilityScore: number; // 0.0-1.0
  coverageScore: number; // 0.0-1.0
  confidenceStability: number; // 0.0-1.0 (how stable confidence is across frameworks)
}

/**
 * Debug information for consensus building
 */
export interface ConsensusDebugInfo {
  rawFrameworkResults: Record<string, any>;
  weightingCalculations: Record<string, number>;
  consensusSteps: string[];
  rejectedFrameworks: string[];
  performanceBreakdown: Record<string, number>;
}

/**
 * Framework Consensus Engine
 */
export class FrameworkConsensusEngine {
  private config: ConsensusConfig;
  private logger?: Logger;
  private frameworkWeights = new Map<string, number>();
  private performanceHistory = new Map<string, number[]>();

  constructor(config: Partial<ConsensusConfig> = {}, logger?: Logger) {
    this.logger = logger;
    this.config = {
      agreementThreshold: config.agreementThreshold ?? 0.75,
      weightingStrategy: config.weightingStrategy ?? 'confidence',
      conflictResolution: config.conflictResolution ?? 'weighted',
      minimumFrameworks: config.minimumFrameworks ?? 2,
      maxDissentThreshold: config.maxDissentThreshold ?? 0.3,
      confidenceFloor: config.confidenceFloor ?? 0.4,
      enableQualityGating: config.enableQualityGating ?? true,
      ...config
    };
  }

  /**
   * Build consensus from multiple framework analysis results
   */
  async buildConsensus(
    basicAnalysis: SemanticAnalysisResult,
    frameworkResults: Record<string, any>,
    prompt: ConvertedPrompt
  ): Promise<ConsensusResult> {
    const startTime = performance.now();
    
    try {
      // Step 1: Compare and rank frameworks
      const comparisons = await this.compareFrameworks(frameworkResults, basicAnalysis, prompt);
      
      // Step 2: Filter frameworks based on quality gates
      const qualifiedFrameworks = this.config.enableQualityGating
        ? this.applyQualityGates(comparisons)
        : comparisons;
      
      // Step 3: Check if we have enough frameworks for consensus
      if (qualifiedFrameworks.length < this.config.minimumFrameworks) {
        return this.createNoConsensusResult(basicAnalysis, qualifiedFrameworks, "Insufficient qualified frameworks");
      }
      
      // Step 4: Calculate framework weights
      const weights = this.calculateFrameworkWeights(qualifiedFrameworks);
      
      // Step 5: Identify conflict areas
      const conflicts = this.identifyConflicts(qualifiedFrameworks);
      
      // Step 6: Apply conflict resolution
      const resolvedResult = await this.resolveConflicts(
        basicAnalysis,
        qualifiedFrameworks,
        conflicts,
        weights
      );
      
      // Step 7: Calculate consensus metrics
      const consensusLevel = this.calculateConsensusLevel(qualifiedFrameworks, conflicts);
      const qualityMetrics = this.calculateQualityMetrics(qualifiedFrameworks, consensusLevel);
      
      // Step 8: Determine if consensus is achieved
      const hasConsensus = consensusLevel >= this.config.agreementThreshold;
      
      const result: ConsensusResult = {
        hasConsensus,
        consensusLevel,
        finalRecommendation: resolvedResult,
        participatingFrameworks: qualifiedFrameworks.map(f => f.frameworkId),
        frameworkComparisons: qualifiedFrameworks,
        conflictAreas: conflicts,
        resolutionStrategy: this.config.conflictResolution,
        qualityMetrics,
        debugInfo: this.createDebugInfo(frameworkResults, weights, qualifiedFrameworks)
      };
      
      // Update performance history
      this.updatePerformanceHistory(qualifiedFrameworks, performance.now() - startTime);
      
      return result;
      
    } catch (error) {
      this.logger?.error("Consensus building failed:", error);
      return this.createErrorConsensusResult(basicAnalysis, error);
    }
  }

  /**
   * Compare frameworks and generate comparison results
   */
  private async compareFrameworks(
    frameworkResults: Record<string, any>,
    basicAnalysis: SemanticAnalysisResult,
    prompt: ConvertedPrompt
  ): Promise<FrameworkComparison[]> {
    const comparisons: FrameworkComparison[] = [];
    
    for (const [frameworkId, result] of Object.entries(frameworkResults)) {
      try {
        const comparison = await this.analyzeFrameworkResult(frameworkId, result, basicAnalysis);
        comparisons.push(comparison);
      } catch (error) {
        this.logger?.warn(`Failed to analyze framework result for ${frameworkId}:`, error);
      }
    }
    
    return comparisons.sort((a, b) => b.score - a.score);
  }

  /**
   * Analyze individual framework result
   */
  private async analyzeFrameworkResult(
    frameworkId: string,
    result: any,
    basicAnalysis: SemanticAnalysisResult
  ): Promise<FrameworkComparison> {
    const score = this.calculateFrameworkScore(result);
    const confidence = this.extractConfidence(result);
    const strengths = this.identifyStrengths(result);
    const weaknesses = this.identifyWeaknesses(result);
    const recommendation = this.extractExecutionType(result) || basicAnalysis.executionType;
    const gateSuggestions = this.extractGateSuggestions(result);
    
    const metadata: FrameworkComparisonMetadata = {
      analysisTime: result._metadata?.duration || 0,
      memoryUsage: result._metadata?.memoryUsage || 0,
      complexity: this.assessComplexity(result),
      reliability: this.calculateReliability(frameworkId),
      coverage: this.calculateCoverage(result)
    };
    
    return {
      frameworkId,
      score,
      confidence,
      strengths,
      weaknesses,
      recommendation,
      gateSuggestions,
      metadata
    };
  }

  /**
   * Apply quality gates to filter frameworks
   */
  private applyQualityGates(comparisons: FrameworkComparison[]): FrameworkComparison[] {
    return comparisons.filter(comparison => {
      // Gate 1: Minimum confidence
      if (comparison.confidence < this.config.confidenceFloor) {
        this.logger?.debug(`Framework ${comparison.frameworkId} filtered: confidence too low (${comparison.confidence})`);
        return false;
      }
      
      // Gate 2: Minimum reliability
      if (comparison.metadata.reliability < 0.6) {
        this.logger?.debug(`Framework ${comparison.frameworkId} filtered: reliability too low (${comparison.metadata.reliability})`);
        return false;
      }
      
      // Gate 3: Minimum coverage
      if (comparison.metadata.coverage < 0.5) {
        this.logger?.debug(`Framework ${comparison.frameworkId} filtered: coverage too low (${comparison.metadata.coverage})`);
        return false;
      }
      
      return true;
    });
  }

  /**
   * Calculate framework weights based on strategy
   */
  private calculateFrameworkWeights(comparisons: FrameworkComparison[]): Record<string, number> {
    const weights: Record<string, number> = {};
    
    switch (this.config.weightingStrategy) {
      case 'equal':
        comparisons.forEach(c => { weights[c.frameworkId] = 1.0; });
        break;
        
      case 'performance':
        comparisons.forEach(c => {
          weights[c.frameworkId] = this.normalizePerformanceWeight(c.metadata.analysisTime);
        });
        break;
        
      case 'confidence':
        comparisons.forEach(c => { weights[c.frameworkId] = c.confidence; });
        break;
        
      case 'priority':
        comparisons.forEach((c, index) => {
          weights[c.frameworkId] = 1.0 - (index * 0.1); // Decrease by priority order
        });
        break;
    }
    
    return weights;
  }

  /**
   * Identify areas where frameworks conflict
   */
  private identifyConflicts(comparisons: FrameworkComparison[]): ConflictArea[] {
    const conflicts: ConflictArea[] = [];
    
    // Check execution type conflicts
    const executionTypes = comparisons.map(c => c.recommendation);
    if (new Set(executionTypes).size > 1) {
      conflicts.push({
        aspect: 'executionType',
        frameworks: comparisons.map(c => c.frameworkId),
        values: executionTypes,
        severity: this.calculateConflictSeverity(executionTypes),
        resolution: 'Resolved by weighted voting'
      });
    }
    
    // Check confidence conflicts
    const confidences = comparisons.map(c => c.confidence);
    const confidenceVariance = this.calculateVariance(confidences);
    if (confidenceVariance > 0.1) {
      conflicts.push({
        aspect: 'confidence',
        frameworks: comparisons.map(c => c.frameworkId),
        values: confidences,
        severity: confidenceVariance > 0.2 ? 'high' : 'medium',
        resolution: 'Resolved by averaging with weights'
      });
    }
    
    // Check gate suggestion conflicts
    const allGates = comparisons.map(c => c.gateSuggestions).flat();
    const uniqueGates = new Set(allGates);
    if (uniqueGates.size > allGates.length * 0.7) {
      conflicts.push({
        aspect: 'gates',
        frameworks: comparisons.map(c => c.frameworkId),
        values: comparisons.map(c => c.gateSuggestions),
        severity: 'low',
        resolution: 'Resolved by union of suggestions'
      });
    }
    
    return conflicts;
  }

  /**
   * Resolve conflicts and create final recommendation
   */
  private async resolveConflicts(
    basicAnalysis: SemanticAnalysisResult,
    comparisons: FrameworkComparison[],
    conflicts: ConflictArea[],
    weights: Record<string, number>
  ): Promise<EnhancedSemanticResult> {
    let resolvedResult: EnhancedSemanticResult = {
      ...basicAnalysis,
      frameworkAnalysis: this.combineFrameworkAnalyses(comparisons),
      frameworkCompliance: this.calculateWeightedCompliance(comparisons, weights),
      methodologyScore: this.calculateWeightedMethodologyScore(comparisons, weights),
      frameworkEnhancements: this.combineFrameworkEnhancements(comparisons)
    };
    
    // Resolve execution type conflicts
    const executionTypeConflict = conflicts.find(c => c.aspect === 'executionType');
    if (executionTypeConflict) {
      resolvedResult.executionType = this.resolveExecutionTypeConflict(comparisons, weights);
    }
    
    // Resolve confidence conflicts
    const confidenceConflict = conflicts.find(c => c.aspect === 'confidence');
    if (confidenceConflict) {
      resolvedResult.confidence = this.resolveConfidenceConflict(comparisons, weights);
    }
    
    // Resolve gate suggestion conflicts
    const gateConflict = conflicts.find(c => c.aspect === 'gates');
    if (gateConflict) {
      resolvedResult.suggestedGates = this.resolveGateConflicts(comparisons);
    }
    
    // Add conflict resolution reasoning
    if (conflicts.length > 0) {
      resolvedResult.reasoning = [
        ...resolvedResult.reasoning,
        `Resolved ${conflicts.length} conflicts using ${this.config.conflictResolution} strategy`
      ];
    }
    
    return resolvedResult;
  }

  /**
   * Calculate consensus level
   */
  private calculateConsensusLevel(
    comparisons: FrameworkComparison[],
    conflicts: ConflictArea[]
  ): number {
    if (comparisons.length <= 1) {
      return 1.0; // Perfect consensus with single framework
    }
    
    // Base consensus on conflict severity and coverage
    let consensusScore = 1.0;
    
    conflicts.forEach(conflict => {
      const penalty = conflict.severity === 'high' ? 0.3 : 
                     conflict.severity === 'medium' ? 0.2 : 0.1;
      consensusScore -= penalty;
    });
    
    // Factor in confidence stability
    const confidences = comparisons.map(c => c.confidence);
    const confidenceStability = 1.0 - this.calculateVariance(confidences);
    consensusScore *= confidenceStability;
    
    return Math.max(0.0, Math.min(1.0, consensusScore));
  }

  /**
   * Calculate quality metrics for consensus
   */
  private calculateQualityMetrics(
    comparisons: FrameworkComparison[],
    consensusLevel: number
  ): ConsensusQualityMetrics {
    const scores = comparisons.map(c => c.score);
    const confidences = comparisons.map(c => c.confidence);
    const reliabilities = comparisons.map(c => c.metadata.reliability);
    const coverages = comparisons.map(c => c.metadata.coverage);
    
    return {
      overallQuality: this.average(scores),
      consistencyScore: consensusLevel,
      reliabilityScore: this.average(reliabilities),
      coverageScore: this.average(coverages),
      confidenceStability: 1.0 - this.calculateVariance(confidences)
    };
  }

  // Helper methods for calculations

  private calculateFrameworkScore(result: any): number {
    // Combine multiple factors into overall score
    const compliance = result.overallCompliance || result.frameworkScore || 0.5;
    const presence = result.compliance ? Object.values(result.compliance).length / 7 : 0.5; // CAGEERF has 7 components
    const suggestions = result.templateSuggestions ? Math.min(1.0, result.templateSuggestions.length / 5) : 0.3;
    
    return (compliance * 0.6) + (presence * 0.3) + (suggestions * 0.1);
  }

  private extractConfidence(result: any): number {
    return result.overallCompliance || result.frameworkScore || result.confidence || 0.5;
  }

  private identifyStrengths(result: any): string[] {
    const strengths: string[] = [];
    if (result.strengthAreas) {
      strengths.push(...result.strengthAreas);
    }
    return strengths;
  }

  private identifyWeaknesses(result: any): string[] {
    const weaknesses: string[] = [];
    if (result.recommendedImprovements) {
      weaknesses.push(...result.recommendedImprovements.slice(0, 3));
    }
    return weaknesses;
  }

  private extractExecutionType(result: any): ExecutionType | undefined {
    return result.executionType || result.recommendedExecutionType;
  }

  private extractGateSuggestions(result: any): string[] {
    return result.suggestedGates || [];
  }

  private assessComplexity(result: any): 'low' | 'medium' | 'high' {
    const componentCount = result.compliance ? Object.keys(result.compliance).length : 0;
    const suggestionCount = result.templateSuggestions ? result.templateSuggestions.length : 0;
    
    if (componentCount > 5 && suggestionCount > 3) return 'high';
    if (componentCount > 2 || suggestionCount > 1) return 'medium';
    return 'low';
  }

  private calculateReliability(frameworkId: string): number {
    const history = this.performanceHistory.get(frameworkId) || [];
    if (history.length < 3) return 0.8; // Default for new frameworks
    
    // Calculate reliability based on consistency of past performance
    const variance = this.calculateVariance(history);
    return Math.max(0.3, 1.0 - variance);
  }

  private calculateCoverage(result: any): number {
    // Estimate how much of the analysis this framework covered
    const hasCompliance = !!result.compliance || !!result.overallCompliance;
    const hasSuggestions = !!(result.templateSuggestions?.length);
    const hasRecommendations = !!(result.recommendedImprovements?.length);
    
    let coverage = 0.3; // Base coverage
    if (hasCompliance) coverage += 0.4;
    if (hasSuggestions) coverage += 0.2;
    if (hasRecommendations) coverage += 0.1;
    
    return Math.min(1.0, coverage);
  }

  private normalizePerformanceWeight(analysisTime: number): number {
    // Faster analysis gets higher weight (inverse relationship)
    const maxTime = 5000; // 5 second maximum
    return Math.max(0.1, 1.0 - (analysisTime / maxTime));
  }

  private calculateConflictSeverity(values: any[]): 'low' | 'medium' | 'high' {
    const uniqueValues = new Set(values).size;
    const totalValues = values.length;
    
    const diversityRatio = uniqueValues / totalValues;
    if (diversityRatio > 0.8) return 'high';
    if (diversityRatio > 0.5) return 'medium';
    return 'low';
  }

  private calculateVariance(numbers: number[]): number {
    if (numbers.length <= 1) return 0;
    
    const mean = numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
    const squaredDiffs = numbers.map(n => Math.pow(n - mean, 2));
    return squaredDiffs.reduce((sum, sq) => sum + sq, 0) / numbers.length;
  }

  private average(numbers: number[]): number {
    return numbers.length > 0 ? numbers.reduce((sum, n) => sum + n, 0) / numbers.length : 0;
  }

  // Conflict resolution methods

  private resolveExecutionTypeConflict(
    comparisons: FrameworkComparison[],
    weights: Record<string, number>
  ): ExecutionType {
    const weightedVotes: Record<string, number> = {};
    
    comparisons.forEach(comparison => {
      const type = comparison.recommendation;
      const weight = weights[comparison.frameworkId] || 1.0;
      weightedVotes[type] = (weightedVotes[type] || 0) + weight;
    });
    
    return Object.keys(weightedVotes).reduce((best, current) =>
      weightedVotes[current] > weightedVotes[best] ? current : best
    ) as ExecutionType;
  }

  private resolveConfidenceConflict(
    comparisons: FrameworkComparison[],
    weights: Record<string, number>
  ): number {
    let weightedSum = 0;
    let totalWeight = 0;
    
    comparisons.forEach(comparison => {
      const weight = weights[comparison.frameworkId] || 1.0;
      weightedSum += comparison.confidence * weight;
      totalWeight += weight;
    });
    
    return totalWeight > 0 ? weightedSum / totalWeight : 0.5;
  }

  private resolveGateConflicts(comparisons: FrameworkComparison[]): string[] {
    // Union of all gate suggestions
    const allGates = comparisons.map(c => c.gateSuggestions).flat();
    return Array.from(new Set(allGates));
  }

  private combineFrameworkAnalyses(comparisons: FrameworkComparison[]): Record<string, any> {
    const combined: Record<string, any> = {};
    comparisons.forEach(comparison => {
      combined[comparison.frameworkId] = {
        score: comparison.score,
        confidence: comparison.confidence,
        strengths: comparison.strengths,
        weaknesses: comparison.weaknesses,
        metadata: comparison.metadata
      };
    });
    return combined;
  }

  private calculateWeightedCompliance(
    comparisons: FrameworkComparison[],
    weights: Record<string, number>
  ): number {
    let weightedSum = 0;
    let totalWeight = 0;
    
    comparisons.forEach(comparison => {
      const weight = weights[comparison.frameworkId] || 1.0;
      weightedSum += comparison.score * weight;
      totalWeight += weight;
    });
    
    return totalWeight > 0 ? weightedSum / totalWeight : 0.5;
  }

  private calculateWeightedMethodologyScore(
    comparisons: FrameworkComparison[],
    weights: Record<string, number>
  ): number {
    return this.calculateWeightedCompliance(comparisons, weights); // Same calculation for now
  }

  private combineFrameworkEnhancements(comparisons: FrameworkComparison[]): FrameworkEnhancement[] {
    const enhancements: FrameworkEnhancement[] = [];
    // In a real implementation, this would combine enhancements from all frameworks
    return enhancements;
  }

  private createNoConsensusResult(
    basicAnalysis: SemanticAnalysisResult,
    comparisons: FrameworkComparison[],
    reason: string
  ): ConsensusResult {
    return {
      hasConsensus: false,
      consensusLevel: 0,
      finalRecommendation: {
        ...basicAnalysis,
        frameworkAnalysis: {},
        frameworkEnhancements: []
      },
      participatingFrameworks: comparisons.map(c => c.frameworkId),
      frameworkComparisons: comparisons,
      conflictAreas: [],
      resolutionStrategy: 'none',
      qualityMetrics: {
        overallQuality: 0,
        consistencyScore: 0,
        reliabilityScore: 0,
        coverageScore: 0,
        confidenceStability: 0
      }
    };
  }

  private createErrorConsensusResult(basicAnalysis: SemanticAnalysisResult, error: any): ConsensusResult {
    return this.createNoConsensusResult(basicAnalysis, [], `Error: ${error.message || 'Unknown error'}`);
  }

  private createDebugInfo(
    frameworkResults: Record<string, any>,
    weights: Record<string, number>,
    comparisons: FrameworkComparison[]
  ): ConsensusDebugInfo {
    return {
      rawFrameworkResults: frameworkResults,
      weightingCalculations: weights,
      consensusSteps: ['Framework comparison', 'Quality gating', 'Conflict identification', 'Conflict resolution'],
      rejectedFrameworks: [],
      performanceBreakdown: Object.fromEntries(
        comparisons.map(c => [c.frameworkId, c.metadata.analysisTime])
      )
    };
  }

  private updatePerformanceHistory(comparisons: FrameworkComparison[], totalTime: number): void {
    comparisons.forEach(comparison => {
      const history = this.performanceHistory.get(comparison.frameworkId) || [];
      history.push(comparison.metadata.analysisTime);
      
      // Keep only last 10 performance records
      if (history.length > 10) {
        history.shift();
      }
      
      this.performanceHistory.set(comparison.frameworkId, history);
    });
  }

  /**
   * Update consensus engine configuration
   */
  updateConfig(newConfig: Partial<ConsensusConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger?.info("Consensus engine configuration updated");
  }

  /**
   * Get current configuration
   */
  getConfig(): ConsensusConfig {
    return { ...this.config };
  }

  /**
   * Get performance history for frameworks
   */
  getPerformanceHistory(): Record<string, number[]> {
    return Object.fromEntries(this.performanceHistory);
  }

  /**
   * Clear performance history
   */
  clearPerformanceHistory(): void {
    this.performanceHistory.clear();
    this.logger?.info("Performance history cleared");
  }
}