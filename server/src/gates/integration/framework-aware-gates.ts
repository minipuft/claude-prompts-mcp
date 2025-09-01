/**
 * Framework-Aware Gate System - Phase 2 Implementation
 * Intelligent gate validation that adapts based on framework methodology and semantic analysis
 * 
 * Key Principles:
 * - Gates validate execution quality independent of framework choice
 * - Semantic analysis informs WHICH gates to apply
 * - Framework context provides methodology-specific validation criteria
 * - Gates remain framework-agnostic while being framework-aware
 */

import { Logger } from "../../logging/index.js";
import { ConvertedPrompt } from "../../types/index.js";
import { 
  GateRegistry,
  GateEvaluationContext,
  EnhancedGateEvaluationResult
} from "../registry/gate-registry.js";
import { 
  FrameworkDefinition,
  FrameworkExecutionContext 
} from "../../frameworks/framework-manager.js";
import { SemanticAnalysis } from "../../analysis/semantic-analyzer.js";

/**
 * Framework-aware gate evaluation context
 */
export interface FrameworkAwareGateContext extends GateEvaluationContext {
  // Semantic intelligence
  semanticAnalysis: SemanticAnalysis;
  
  // Framework methodology context
  frameworkContext: FrameworkExecutionContext;
  
  // Integration metadata
  integration: {
    frameworkAlignment: number;
    semanticConfidence: number;
    expectedComplexity: string;
  };
}

/**
 * Gate validation result with framework awareness
 */
export interface FrameworkAwareGateResult extends EnhancedGateEvaluationResult {
  // Framework-specific insights
  frameworkSpecificRecommendations?: string[];
  methodologyCompliance?: number;
  adaptiveThresholds?: {
    applied: boolean;
    originalThreshold: number;
    adjustedThreshold: number;
    reason: string;
  };
}

/**
 * Gate configuration for framework adaptation
 */
export interface FrameworkGateConfig {
  enableFrameworkAdaptation: boolean;
  adaptiveThresholds: boolean;
  frameworkSpecificGates: boolean;
  semanticGateSelection: boolean;
  consensusValidation: boolean;
}

/**
 * Framework-Aware Gate Evaluator
 * Enhances standard gate evaluation with framework and semantic intelligence
 */
export class FrameworkAwareGateEvaluator {
  private gateRegistry: GateRegistry;
  private logger: Logger;
  private config: FrameworkGateConfig;
  
  // Framework-specific gate mappings
  private frameworkGateMap = new Map<string, string[]>();
  
  // Adaptive threshold cache
  private adaptiveThresholdCache = new Map<string, number>();

  constructor(
    gateRegistry: GateRegistry,
    logger: Logger,
    config: Partial<FrameworkGateConfig> = {}
  ) {
    this.gateRegistry = gateRegistry;
    this.logger = logger;
    
    this.config = {
      enableFrameworkAdaptation: config.enableFrameworkAdaptation ?? true,
      adaptiveThresholds: config.adaptiveThresholds ?? true,
      frameworkSpecificGates: config.frameworkSpecificGates ?? true,
      semanticGateSelection: config.semanticGateSelection ?? true,
      consensusValidation: config.consensusValidation ?? false
    };
    
    this.initializeFrameworkGateMappings();
  }

  /**
   * Main framework-aware gate evaluation method
   */
  async evaluateWithFrameworkAwareness(
    context: FrameworkAwareGateContext
  ): Promise<FrameworkAwareGateResult[]> {
    const startTime = performance.now();
    
    try {
      // Step 1: Select appropriate gates based on semantic analysis
      const selectedGates = this.selectGatesBasedOnSemantics(context);
      
      // Step 2: Add framework-specific gates if enabled
      const enhancedGates = this.config.frameworkSpecificGates
        ? this.addFrameworkSpecificGates(selectedGates, context.frameworkContext)
        : selectedGates;
      
      // Step 3: Evaluate each gate with framework awareness
      const evaluationResults: FrameworkAwareGateResult[] = [];
      
      for (const gateId of enhancedGates) {
        const result = await this.evaluateGateWithFrameworkContext(
          gateId,
          context
        );
        evaluationResults.push(result);
      }
      
      // Step 4: Apply consensus validation if enabled
      const finalResults = this.config.consensusValidation
        ? this.applyConsensusValidation(evaluationResults, context)
        : evaluationResults;
      
      const totalTime = performance.now() - startTime;
      this.logger.debug(
        `Framework-aware gate evaluation completed: ${finalResults.length} gates, ` +
        `${totalTime.toFixed(2)}ms`
      );
      
      return finalResults;
      
    } catch (error) {
      this.logger.error("Framework-aware gate evaluation failed:", error);
      return this.createFallbackGateResults(context);
    }
  }

  /**
   * Get gate recommendations based on framework and semantic analysis
   */
  getFrameworkAwareGateRecommendations(
    semanticAnalysis: SemanticAnalysis,
    frameworkContext: FrameworkExecutionContext
  ): GateRecommendation[] {
    const recommendations: GateRecommendation[] = [];
    
    // Semantic-based recommendations
    semanticAnalysis.suggestedGates.forEach(gateId => {
      recommendations.push({
        gateId,
        reason: "Recommended by semantic analysis",
        priority: this.calculateGatePriority(gateId, semanticAnalysis.complexity),
        source: "semantic"
      });
    });
    
    // Framework-specific recommendations
    const frameworkGates = this.frameworkGateMap.get(frameworkContext.selectedFramework.methodology);
    if (frameworkGates) {
      frameworkGates.forEach(gateId => {
        if (!recommendations.some(r => r.gateId === gateId)) {
          recommendations.push({
            gateId,
            reason: `Recommended for ${frameworkContext.selectedFramework.name} methodology`,
            priority: "medium",
            source: "framework"
          });
        }
      });
    }
    
    // Sort by priority
    return recommendations.sort((a, b) => {
      const priorityOrder = { "high": 3, "medium": 2, "low": 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
  }

  /**
   * Update gate configuration based on performance feedback
   */
  updateAdaptiveThresholds(
    gateId: string,
    performance: GatePerformanceMetrics
  ): void {
    if (!this.config.adaptiveThresholds) return;
    
    const cacheKey = `${gateId}_adaptive_threshold`;
    const currentThreshold = this.adaptiveThresholdCache.get(cacheKey) || 0.8;
    
    // Adjust threshold based on performance
    let newThreshold = currentThreshold;
    
    if (performance.falsePositiveRate > 0.2) {
      newThreshold = Math.min(currentThreshold + 0.05, 0.95); // Increase threshold to reduce false positives
    } else if (performance.falseNegativeRate > 0.2) {
      newThreshold = Math.max(currentThreshold - 0.05, 0.5); // Decrease threshold to reduce false negatives
    }
    
    if (newThreshold !== currentThreshold) {
      this.adaptiveThresholdCache.set(cacheKey, newThreshold);
      this.logger.info(
        `Adaptive threshold updated for gate ${gateId}: ${currentThreshold.toFixed(2)} -> ${newThreshold.toFixed(2)}`
      );
    }
  }

  // Private implementation methods

  /**
   * Initialize framework-specific gate mappings
   */
  private initializeFrameworkGateMappings(): void {
    // CAGEERF Framework Gates
    this.frameworkGateMap.set("CAGEERF", [
      "context_validation",
      "analysis_depth_validation", 
      "goal_clarity_validation",
      "execution_completeness_validation",
      "evaluation_rigor_validation",
      "refinement_validation",
      "framework_compliance_validation"
    ]);
    
    // ReACT Framework Gates
    this.frameworkGateMap.set("ReACT", [
      "reasoning_validation",
      "action_coherence_validation",
      "observation_accuracy_validation",
      "reasoning_chain_validation"
    ]);
    
    // 5W1H Framework Gates
    this.frameworkGateMap.set("5W1H", [
      "who_identification_validation",
      "what_definition_validation", 
      "when_timing_validation",
      "where_context_validation",
      "why_rationale_validation",
      "how_methodology_validation"
    ]);
    
    // SCAMPER Framework Gates
    this.frameworkGateMap.set("SCAMPER", [
      "creativity_validation",
      "innovation_assessment_validation",
      "alternative_exploration_validation"
    ]);
    
    this.logger.info(`Framework gate mappings initialized for ${this.frameworkGateMap.size} frameworks`);
  }

  /**
   * Select gates based on semantic analysis
   */
  private selectGatesBasedOnSemantics(
    context: FrameworkAwareGateContext
  ): string[] {
    if (!this.config.semanticGateSelection) {
      return context.semanticAnalysis.suggestedGates;
    }
    
    const selectedGates = new Set<string>();
    
    // Always include basic gates
    selectedGates.add("content_validation");
    
    // Add semantic-suggested gates
    context.semanticAnalysis.suggestedGates.forEach(gate => {
      selectedGates.add(gate);
    });
    
    // Add complexity-based gates
    switch (context.semanticAnalysis.complexity) {
      case "high":
        selectedGates.add("complexity_validation");
        selectedGates.add("performance_validation");
        selectedGates.add("quality_assurance_validation");
        break;
      case "medium":
        selectedGates.add("structural_validation");
        break;
      case "low":
        selectedGates.add("basic_validation");
        break;
    }
    
    // Add execution type specific gates
    switch (context.semanticAnalysis.executionType) {
      case "chain":
        selectedGates.add("chain_validation");
        // Advanced chains get workflow-level validation
        if (context.semanticAnalysis.executionCharacteristics.advancedChainFeatures?.requiresAdvancedExecution) {
          selectedGates.add("workflow_validation");
          selectedGates.add("state_management_validation");
        }
        selectedGates.add("step_validation");
        break;
      case "template":
        selectedGates.add("template_validation");
        break;
    }
    
    return Array.from(selectedGates);
  }

  /**
   * Add framework-specific gates to the selection
   */
  private addFrameworkSpecificGates(
    baseGates: string[],
    frameworkContext: FrameworkExecutionContext
  ): string[] {
    const gateSet = new Set(baseGates);
    const frameworkGates = this.frameworkGateMap.get(frameworkContext.selectedFramework.methodology);
    
    if (frameworkGates) {
      frameworkGates.forEach(gate => gateSet.add(gate));
      this.logger.debug(
        `Added ${frameworkGates.length} framework-specific gates for ${frameworkContext.selectedFramework.name}`
      );
    }
    
    return Array.from(gateSet);
  }

  /**
   * Evaluate a single gate with framework context
   */
  private async evaluateGateWithFrameworkContext(
    gateId: string,
    context: FrameworkAwareGateContext
  ): Promise<FrameworkAwareGateResult> {
    // Get standard gate evaluation
    const standardResult = await this.gateRegistry.evaluateGate(gateId, context);
    
    // Apply framework-aware enhancements
    const frameworkEnhancements = this.applyFrameworkEnhancements(
      standardResult,
      context
    );
    
    // Apply adaptive thresholds if enabled
    const adaptiveResult = this.config.adaptiveThresholds
      ? this.applyAdaptiveThresholds(frameworkEnhancements, gateId, context)
      : frameworkEnhancements;
    
    return adaptiveResult;
  }

  /**
   * Apply framework-specific enhancements to gate results
   */
  private applyFrameworkEnhancements(
    result: EnhancedGateEvaluationResult,
    context: FrameworkAwareGateContext
  ): FrameworkAwareGateResult {
    const framework = context.frameworkContext.selectedFramework;
    
    // Calculate methodology compliance
    const methodologyCompliance = this.calculateMethodologyCompliance(
      result,
      framework,
      context.semanticAnalysis
    );
    
    // Generate framework-specific recommendations
    const frameworkRecommendations = this.generateFrameworkRecommendations(
      result,
      framework,
      context
    );
    
    return {
      ...result,
      methodologyCompliance,
      frameworkSpecificRecommendations: frameworkRecommendations
    };
  }

  /**
   * Apply adaptive thresholds based on context
   */
  private applyAdaptiveThresholds(
    result: FrameworkAwareGateResult,
    gateId: string,
    context: FrameworkAwareGateContext
  ): FrameworkAwareGateResult {
    const cacheKey = `${gateId}_adaptive_threshold`;
    const adaptiveThreshold = this.adaptiveThresholdCache.get(cacheKey);
    
    if (!adaptiveThreshold) {
      return result; // No adaptive threshold configured
    }
    
    const originalPassed = result.passed;
    const originalScore = result.score || 0;
    
    // Apply adaptive threshold
    const newPassed = originalScore >= adaptiveThreshold;
    
    if (originalPassed !== newPassed) {
      return {
        ...result,
        passed: newPassed,
        adaptiveThresholds: {
          applied: true,
          originalThreshold: 0.8, // Default threshold
          adjustedThreshold: adaptiveThreshold,
          reason: `Adjusted based on framework ${context.frameworkContext.selectedFramework.name} performance history`
        }
      };
    }
    
    return result;
  }

  /**
   * Apply consensus validation across multiple gates
   */
  private applyConsensusValidation(
    results: FrameworkAwareGateResult[],
    context: FrameworkAwareGateContext
  ): FrameworkAwareGateResult[] {
    // Simple consensus: if majority of critical gates pass, boost confidence of others
    const criticalGates = results.filter(r => 
      r.requirementId.includes('validation') || 
      r.requirementId.includes('quality')
    );
    
    const criticalPassRate = criticalGates.filter(r => r.passed).length / Math.max(criticalGates.length, 1);
    
    if (criticalPassRate > 0.7) {
      // High critical pass rate - boost confidence of marginal gates
      return results.map(result => {
        if (!result.passed && result.score && result.score > 0.6) {
          return {
            ...result,
            score: Math.min(result.score + 0.1, 1.0),
            message: `${result.message} (consensus boost applied)`
          };
        }
        return result;
      });
    }
    
    return results;
  }

  /**
   * Calculate methodology compliance score
   */
  private calculateMethodologyCompliance(
    result: EnhancedGateEvaluationResult,
    framework: FrameworkDefinition,
    semanticAnalysis: SemanticAnalysis
  ): number {
    let compliance = result.score || 0.5;
    
    // Framework-specific compliance adjustments
    switch (framework.methodology) {
      case "CAGEERF":
        // CAGEERF values thoroughness and structure
        if (semanticAnalysis.confidence > 0.8) compliance += 0.1;
        if (semanticAnalysis.executionCharacteristics.hasSystemMessage) compliance += 0.05;
        break;
      
      case "ReACT":
        // ReACT values reasoning and action coherence
        if (semanticAnalysis.executionType === "chain") compliance += 0.1;
        if (semanticAnalysis.confidence > 0.8) compliance += 0.1;
        break;
      
      case "5W1H":
        // 5W1H values comprehensive coverage
        if (semanticAnalysis.confidence > 0.7) compliance += 0.1;
        if (semanticAnalysis.executionCharacteristics.argumentCount > 3) compliance += 0.05;
        break;
      
      case "SCAMPER":
        // SCAMPER values creativity and alternatives
        if (semanticAnalysis.complexity === "medium" || semanticAnalysis.complexity === "high") {
          compliance += 0.1;
        }
        break;
    }
    
    return Math.min(compliance, 1.0);
  }

  /**
   * Generate framework-specific recommendations
   */
  private generateFrameworkRecommendations(
    result: EnhancedGateEvaluationResult,
    framework: FrameworkDefinition,
    context: FrameworkAwareGateContext
  ): string[] {
    const recommendations: string[] = [];
    
    if (!result.passed) {
      switch (framework.methodology) {
        case "CAGEERF":
          recommendations.push("Apply systematic CAGEERF analysis structure");
          recommendations.push("Ensure all framework components are addressed");
          break;
        
        case "ReACT":
          recommendations.push("Strengthen reasoning-action connection");
          recommendations.push("Add explicit observation and reflection steps");
          break;
        
        case "5W1H":
          recommendations.push("Ensure all 5W1H questions are addressed");
          recommendations.push("Add missing contextual information");
          break;
        
        case "SCAMPER":
          recommendations.push("Explore more creative alternatives");
          recommendations.push("Apply additional SCAMPER techniques");
          break;
      }
    }
    
    return recommendations;
  }

  /**
   * Calculate gate priority based on complexity and context
   */
  private calculateGatePriority(
    gateId: string, 
    complexity: string
  ): "high" | "medium" | "low" {
    // Critical gates are always high priority
    if (gateId.includes("validation") || gateId.includes("quality")) {
      return "high";
    }
    
    // Complexity-based priority
    if (complexity === "high") {
      return "high";
    } else if (complexity === "medium") {
      return "medium";
    } else {
      return "low";
    }
  }

  /**
   * Create fallback gate results in case of failure
   */
  private createFallbackGateResults(
    context: FrameworkAwareGateContext
  ): FrameworkAwareGateResult[] {
    return [{
      requirementId: "fallback_validation",
      passed: false,
      score: 0.3,
      message: "Framework-aware gate evaluation failed, using fallback validation",
      details: { error: "Evaluation system failure" },
      methodologyCompliance: 0.3,
      frameworkSpecificRecommendations: [
        "Review framework configuration",
        "Check gate registry status",
        "Verify semantic analysis results"
      ]
    }];
  }
}

// Supporting interfaces

export interface GateRecommendation {
  gateId: string;
  reason: string;
  priority: "high" | "medium" | "low";
  source: "semantic" | "framework" | "adaptive";
}

export interface GatePerformanceMetrics {
  gateId: string;
  executionCount: number;
  averageExecutionTime: number;
  passRate: number;
  falsePositiveRate: number;
  falseNegativeRate: number;
}

/**
 * Create and configure framework-aware gate evaluator
 */
export function createFrameworkAwareGateEvaluator(
  gateRegistry: GateRegistry,
  logger: Logger,
  config?: Partial<FrameworkGateConfig>
): FrameworkAwareGateEvaluator {
  return new FrameworkAwareGateEvaluator(gateRegistry, logger, config);
}