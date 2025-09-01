/**
 * Unified Gate Evaluator
 * Single orchestrator that handles all gate evaluation strategies with enhanced capabilities
 */

import { Logger } from "../../logging/index.js";
import {
  GateDefinition,
  GateRequirement,
  GateEvaluationResult,
  GateStatus,
} from "../../types/index.js";

// Import strategy-based evaluators
import { ContentAnalysisEvaluatorFactory } from "./strategies/content-analysis-evaluators.js";
import { StructureValidationEvaluatorFactory } from "./strategies/structure-validation-evaluators.js";
import { PatternMatchingEvaluatorFactory } from "./strategies/pattern-matching-evaluators.js";
import { CustomLogicEvaluatorFactory } from "./strategies/custom-logic-evaluators.js";

// Import hint generation system
import { HintGeneratorFactory, UniversalHintGenerator } from "./hint-generators.js";

import type {
  ExtendedGateType,
  ExtendedGateRequirement,
  GateEvaluationContext,
  EnhancedGateEvaluationResult,
  GateEvaluator as IGateEvaluator,
  HintGenerator,
} from "../registry/gate-registry.js";
import type { GateRequirementType } from "../../types/index.js";

/**
 * Main Gate Evaluator that orchestrates all evaluation strategies
 * Provides a single entry point for all gate evaluation needs
 */
export class GateEvaluationService {
  private logger: Logger;
  private universalHintGenerator: UniversalHintGenerator;

  // Strategy-based evaluator factories
  private evaluatorFactories = new Map<string, any>([
    ['content_analysis', ContentAnalysisEvaluatorFactory],
    ['structure_validation', StructureValidationEvaluatorFactory],
    ['pattern_matching', PatternMatchingEvaluatorFactory],
    ['custom_logic', CustomLogicEvaluatorFactory],
  ]);

  // Gate type to strategy mapping
  private gateTypeToStrategy: Map<GateRequirementType, string> = new Map([
    // Content Analysis Strategy
    ['content_length', 'content_analysis'],
    ['readability_score', 'content_analysis'],
    ['grammar_quality', 'content_analysis'],
    ['tone_analysis', 'content_analysis'],
    
    // Structure Validation Strategy
    ['format_validation', 'structure_validation'],
    ['section_validation', 'structure_validation'],
    ['hierarchy_validation', 'structure_validation'],
    ['code_quality', 'structure_validation'],
    
    // Pattern Matching Strategy
    ['keyword_presence', 'pattern_matching'],
    ['pattern_matching', 'pattern_matching'],
    ['link_validation', 'pattern_matching'],
    
    // Custom Logic Strategy
    ['custom', 'custom_logic'],
    ['required_fields', 'custom_logic'],
    ['completeness', 'custom_logic'],
    ['security_validation', 'custom_logic'],
  ]);

  constructor(logger: Logger) {
    this.logger = logger;
    this.universalHintGenerator = new UniversalHintGenerator(logger);
  }

  /**
   * Evaluate all gates for given content - Main entry point
   */
  async evaluateGates(
    content: string,
    gates: GateDefinition[],
    context?: Record<string, any>
  ): Promise<GateStatus[]> {
    const gateStatuses: GateStatus[] = [];

    for (const gate of gates) {
      this.logger.debug(`Evaluating gate: ${gate.name} (${gate.id})`);
      
      const gateStatus = await this.evaluateGate(content, gate, context);
      gateStatuses.push(gateStatus);

      this.logger.debug(
        `Gate ${gate.id} result: ${gateStatus.passed ? 'PASSED' : 'FAILED'}`
      );
    }

    return gateStatuses;
  }

  /**
   * Evaluate a single gate using appropriate strategy
   */
  async evaluateGate(
    content: string,
    gate: GateDefinition,
    context?: Record<string, any>
  ): Promise<GateStatus> {
    const evaluationResults: GateEvaluationResult[] = [];
    let overallPassed = true;

    for (const requirement of gate.requirements) {
      const result = await this.evaluateRequirement(content, requirement, context);
      evaluationResults.push(result);

      // If this is a required requirement and it failed, the gate fails
      if (requirement.required !== false && !result.passed) {
        overallPassed = false;
      }
    }

    // Calculate weighted score if needed
    if (!overallPassed && gate.requirements.some(req => req.weight)) {
      overallPassed = this.calculateWeightedScore(evaluationResults, gate.requirements) >= 0.7;
    }

    return {
      gateId: gate.id,
      passed: overallPassed,
      requirements: gate.requirements,
      evaluationResults,
      timestamp: Date.now(),
    };
  }

  /**
   * Evaluate a single requirement using the appropriate strategy evaluator
   */
  private async evaluateRequirement(
    content: string,
    requirement: GateRequirement,
    context?: Record<string, any>
  ): Promise<GateEvaluationResult> {
    const gateType = requirement.type as ExtendedGateType;
    const strategy = this.gateTypeToStrategy.get(gateType);

    if (!strategy) {
      this.logger.warn(`No strategy found for gate type: ${gateType}`);
      return this.createFallbackResult(gateType, 'Unknown gate type');
    }

    const evaluatorFactory = this.evaluatorFactories.get(strategy);
    if (!evaluatorFactory) {
      this.logger.warn(`No evaluator factory found for strategy: ${strategy}`);
      return this.createFallbackResult(gateType, 'No evaluator available');
    }

    const evaluator = evaluatorFactory.getEvaluator(gateType);
    if (!evaluator) {
      this.logger.warn(`No evaluator found for gate type: ${gateType} in strategy: ${strategy}`);
      return this.createFallbackResult(gateType, 'Evaluator not implemented');
    }

    try {
      // Convert requirement to enhanced format
      const extendedRequirement: ExtendedGateRequirement = {
        type: gateType,
        criteria: requirement.criteria || {},
        weight: requirement.weight,
        required: requirement.required,
      };

      const evaluationContext: GateEvaluationContext = {
        content,
        metadata: context,
      };

      // Execute evaluation
      const enhancedResult = await evaluator.evaluate(extendedRequirement, evaluationContext);
      
      // Convert enhanced result to standard format while preserving enhancement data
      return this.convertEnhancedResult(enhancedResult);
    } catch (error) {
      this.logger.error(`Gate evaluation failed: ${gateType}`, error);
      return this.createFallbackResult(gateType, `Evaluation error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate intelligent hints for failed gates
   */
  async generateIntelligentHints(
    gateStatuses: GateStatus[],
    content: string,
    context?: Record<string, any>
  ): Promise<string[]> {
    const hints: string[] = [];
    const failedGates = gateStatuses.filter(gate => !gate.passed);

    for (const gate of failedGates) {
      for (const result of gate.evaluationResults) {
        if (!result.passed) {
          const gateType = result.requirementId as ExtendedGateType;
          
          try {
            // Find the corresponding requirement
            const requirement = gate.requirements.find(req => req.type === result.requirementId);
            if (!requirement) continue;

            const extendedRequirement: ExtendedGateRequirement = {
              type: gateType,
              criteria: requirement.criteria || {},
              weight: requirement.weight,
              required: requirement.required,
            };

            const evaluationContext: GateEvaluationContext = {
              content,
              metadata: context,
            };

            const enhancedResult: EnhancedGateEvaluationResult = {
              requirementId: result.requirementId,
              passed: result.passed,
              score: result.score || 0,
              message: result.message || '',
              details: result.details || {},
            };

            // Generate hints using universal hint generator
            const generatedHints = await this.universalHintGenerator.generateHints(
              extendedRequirement,
              evaluationContext,
              enhancedResult
            );
            hints.push(...generatedHints);
          } catch (error) {
            this.logger.error(`Failed to generate hints for ${gateType}`, error);
            // Fallback to basic hint based on the error message
            hints.push(`${result.requirementId}: ${result.message || 'Validation failed'}`);
          }
        }
      }
    }

    return Array.from(new Set(hints)); // Remove duplicates
  }

  /**
   * Check if content needs retry based on gate failures
   */
  shouldRetry(gateStatuses: GateStatus[], maxRetries: number = 3): boolean {
    const failedGates = gateStatuses.filter(gate => !gate.passed);
    if (failedGates.length === 0) return false;
    
    // Check if any failed gate allows retries and hasn't exceeded retry count
    return failedGates.some(gate => {
      const retryCount = gate.retryCount || 0;
      return retryCount < maxRetries;
    });
  }

  /**
   * Get retry message for failed gates
   */
  getRetryMessage(gateStatuses: GateStatus[]): string {
    const failedGates = gateStatuses.filter(gate => !gate.passed);
    
    if (failedGates.length === 0) {
      return 'All gates passed';
    }
    
    const messages = failedGates.map(gate => {
      const failedRequirements = gate.evaluationResults
        .filter(result => !result.passed)
        .map(result => result.message)
        .join('; ');
      
      return `Gate '${gate.gateId}' failed: ${failedRequirements}`;
    });
    
    return `Gate validation failed. Issues to address:\n${messages.join('\n')}`;
  }

  /**
   * Get supported gate types from all strategies
   */
  getSupportedGateTypes(): GateRequirementType[] {
    return Array.from(this.gateTypeToStrategy.keys());
  }

  /**
   * Validate framework compliance for prompts
   */
  async validateFrameworkCompliance(
    promptContent: string,
    framework: string = 'CAGEERF',
    context?: Record<string, any>
  ): Promise<GateStatus> {
    // Create a framework compliance gate
    const complianceGate: GateDefinition = {
      id: `${framework.toLowerCase()}_compliance`,
      name: `${framework} Framework Compliance`,
      type: 'quality',
      requirements: [
        {
          type: 'readability_score',
          criteria: { readabilityTarget: 'intermediate' },
          required: true,
        },
        {
          type: 'grammar_quality',
          criteria: { grammarStrength: 'standard' },
          required: true,
        },
        {
          type: 'tone_analysis',
          criteria: { expectedTone: 'professional' },
          required: false,
          weight: 0.5,
        },
      ],
      failureAction: 'retry',
    };

    return await this.evaluateGate(promptContent, complianceGate, context);
  }

  /**
   * Get evaluator statistics for monitoring
   */
  getEvaluatorStatistics(): Record<string, any> {
    const stats: Record<string, any> = {
      supportedGateTypes: this.getSupportedGateTypes().length,
      strategies: Array.from(this.evaluatorFactories.keys()),
      gateTypeMapping: Object.fromEntries(this.gateTypeToStrategy),
    };

    // Add strategy-specific statistics
    for (const [strategyName, factory] of Array.from(this.evaluatorFactories.entries())) {
      try {
        const supportedTypes = factory.getSupportedTypes?.() || [];
        stats[`${strategyName}_types`] = supportedTypes.length;
        stats[`${strategyName}_evaluators`] = supportedTypes;
      } catch (error) {
        this.logger.debug(`Could not get statistics for strategy: ${strategyName}`);
      }
    }

    return stats;
  }

  /**
   * Calculate weighted score from evaluation results
   */
  private calculateWeightedScore(
    results: GateEvaluationResult[],
    requirements: GateRequirement[]
  ): number {
    let totalWeight = 0;
    let weightedScore = 0;
    
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const requirement = requirements[i];
      const weight = requirement.weight || 1;
      
      totalWeight += weight;
      weightedScore += (result.score || (result.passed ? 1 : 0)) * weight;
    }
    
    return totalWeight > 0 ? weightedScore / totalWeight : 0;
  }

  /**
   * Convert enhanced gate evaluation result to standard format
   */
  private convertEnhancedResult(enhancedResult: EnhancedGateEvaluationResult): GateEvaluationResult {
    return {
      requirementId: enhancedResult.requirementId,
      passed: enhancedResult.passed,
      score: enhancedResult.score,
      message: enhancedResult.message,
      details: {
        ...enhancedResult.details,
        // Preserve enhancement data for backwards compatibility
        hints: enhancedResult.hints,
        improvementSuggestions: enhancedResult.improvementSuggestions,
        contextualScore: enhancedResult.contextualScore,
        evaluationTime: enhancedResult.evaluationTime,
        nextActions: enhancedResult.nextActions,
      },
    };
  }

  /**
   * Create fallback result for unknown or failed evaluations
   */
  private createFallbackResult(gateType: string, message: string): GateEvaluationResult {
    return {
      requirementId: gateType,
      passed: false,
      score: 0,
      message: message,
      details: {
        fallback: true,
        evaluationType: gateType,
      },
    };
  }
}

/**
 * Create and configure a gate evaluator
 */
export function createGateEvaluator(logger: Logger): GateEvaluationService {
  return new GateEvaluationService(logger);
}