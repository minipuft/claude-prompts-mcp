/**
 * Gate Registry System - Phase 2 Implementation
 * Comprehensive gate management with dynamic registration, intelligent hints, and workflow integration
 */

import { Logger } from "../logging/index.js";
import {
  GateDefinition,
  GateRequirement,
  GateRequirementType,
  GateEvaluationResult,
  GateStatus,
  GateType,
  WorkflowExecutionContext,
  ValidationResult,
} from "../types/index.js";

// ===== Enhanced Gate Types =====

// Re-export the unified type
export type ExtendedGateType = GateRequirementType;

export interface ExtendedGateRequirement extends GateRequirement {
  type: ExtendedGateType;
  // Enhanced criteria with more specific validation
  criteria: GateRequirementCriteria;
  // Dependency requirements for gate chaining
  dependencies?: string[];
  // Runtime-specific overrides
  runtimeOverrides?: Record<string, Partial<GateRequirementCriteria>>;
}

export interface GateRequirementCriteria {
  // Common criteria
  weight?: number;
  threshold?: number;
  required?: boolean;
  
  // Content length criteria
  min?: number;
  max?: number;
  
  // Keyword presence criteria
  keywords?: string[];
  caseSensitive?: boolean;
  minMatches?: number;
  
  // Format validation criteria
  format?: string;
  allowedFormats?: string[];
  structureRules?: string[];
  
  // Section validation criteria
  sections?: string[];
  allowExtra?: boolean;
  
  // Readability criteria
  readabilityTarget?: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  fleschKincaidMin?: number;
  fleschKincaidMax?: number;
  
  // Grammar quality criteria
  grammarStrength?: 'basic' | 'standard' | 'strict';
  allowedErrors?: number;
  
  // Tone analysis criteria
  expectedTone?: 'professional' | 'casual' | 'technical' | 'friendly' | 'formal';
  toneConfidence?: number;
  
  // Hierarchy validation criteria
  maxDepth?: number;
  requireH1?: boolean;
  consecutiveHeaders?: boolean;
  
  // Link validation criteria
  validateExternal?: boolean;
  validateInternal?: boolean;
  brokenLinkTolerance?: number;
  
  // Code quality criteria
  syntaxValidation?: boolean;
  styleGuide?: string;
  complexityLimit?: number;
  
  // Required fields criteria
  requiredFields?: string[];
  fieldValidation?: Record<string, any>;
  
  // Completeness criteria
  completenessMinScore?: number;
  requiredSections?: string[];
  
  // Security criteria
  securityLevel?: 'basic' | 'standard' | 'strict';
  allowedPatterns?: string[];
  blockedPatterns?: string[];
  
  // Custom criteria for extensibility
  customCriteria?: Record<string, any>;
}

export interface ExtendedGateDefinition extends Omit<GateDefinition, 'requirements'> {
  requirements: ExtendedGateRequirement[];
  // Gate chaining support
  chainedGates?: string[];
  // Runtime targeting
  runtimeTargets?: string[];
  // Configuration management
  configVersion?: string;
  // A/B testing support
  experimentGroup?: string;
}

export interface GateEvaluationContext {
  content: string;
  metadata?: Record<string, any>;
  workflowContext?: WorkflowExecutionContext;
  runtime?: string;
  stepId?: string;
  previousResults?: Record<string, any>;
}

export interface EnhancedGateEvaluationResult extends GateEvaluationResult {
  // Intelligent hints
  hints?: string[];
  nextActions?: string[];
  // Progressive guidance
  improvementSuggestions?: ImprovementSuggestion[];
  // Context-aware scoring
  contextualScore?: number;
  // Performance metrics
  evaluationTime?: number;
}

export interface ImprovementSuggestion {
  type: 'content' | 'structure' | 'format' | 'style';
  priority: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  example?: string;
  autoFixable?: boolean;
}

export interface RegisteredGate {
  definition: ExtendedGateDefinition;
  evaluator: GateEvaluator;
  hintGenerator: HintGenerator;
  registeredAt: Date;
  lastUsed?: Date;
  usageCount: number;
  performanceStats: {
    avgEvaluationTime: number;
    successRate: number;
    failureRate: number;
  };
}

export interface GateEvaluator {
  evaluate(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext
  ): Promise<EnhancedGateEvaluationResult>;
}

export interface HintGenerator {
  generateHints(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext,
    evaluationResult: EnhancedGateEvaluationResult
  ): Promise<string[]>;
  
  generateImprovementSuggestions(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext,
    evaluationResult: EnhancedGateEvaluationResult
  ): Promise<ImprovementSuggestion[]>;
}

// ===== Gate Registry Implementation =====

export class GateRegistry {
  private gates: Map<string, RegisteredGate> = new Map();
  private evaluators: Map<ExtendedGateType, GateEvaluator> = new Map();
  private hintGenerators: Map<ExtendedGateType, HintGenerator> = new Map();
  private logger: Logger;
  private configVersion: string = "1.0.0";

  constructor(logger: Logger) {
    this.logger = logger;
    this.initializeBuiltInGates();
  }

  /**
   * Register a new gate with the registry
   */
  async registerGate(definition: ExtendedGateDefinition): Promise<string> {
    this.logger.info(`Registering gate: ${definition.name} (${definition.id})`);
    
    // Validate gate definition
    const validationResult = this.validateGateDefinition(definition);
    if (!validationResult.valid) {
      throw new Error(`Gate validation failed: ${validationResult.errors?.join(', ')}`);
    }

    // Create registered gate entry
    const registeredGate: RegisteredGate = {
      definition,
      evaluator: this.getEvaluatorForType(definition.requirements[0].type),
      hintGenerator: this.getHintGeneratorForType(definition.requirements[0].type),
      registeredAt: new Date(),
      usageCount: 0,
      performanceStats: {
        avgEvaluationTime: 0,
        successRate: 0,
        failureRate: 0,
      },
    };

    this.gates.set(definition.id, registeredGate);
    this.logger.info(`Gate registered successfully: ${definition.id}`);
    
    return definition.id;
  }

  /**
   * Evaluate a gate with enhanced context and intelligent hints
   */
  async evaluateGate(
    gateId: string,
    context: GateEvaluationContext
  ): Promise<EnhancedGateEvaluationResult> {
    const startTime = Date.now();
    
    const registeredGate = this.gates.get(gateId);
    if (!registeredGate) {
      throw new Error(`Gate not found: ${gateId}`);
    }

    const { definition, evaluator, hintGenerator } = registeredGate;
    
    this.logger.debug(`Evaluating gate: ${definition.name} (${gateId})`);
    
    try {
      // Enhanced evaluation with context awareness
      const evaluationResults: EnhancedGateEvaluationResult[] = [];
      let overallPassed = true;
      let totalScore = 0;
      let totalWeight = 0;

      // Evaluate each requirement
      for (const requirement of definition.requirements) {
        // Apply runtime overrides if present
        const effectiveRequirement = this.applyRuntimeOverrides(requirement, context.runtime);
        
        const result = await evaluator.evaluate(effectiveRequirement, context);
        evaluationResults.push(result);

        // Calculate weighted score
        const weight = requirement.weight || 1;
        totalScore += (result.score || 0) * weight;
        totalWeight += weight;

        // Check if requirement failed
        if (requirement.required !== false && !result.passed) {
          overallPassed = false;
        }
      }

      const overallScore = totalWeight > 0 ? totalScore / totalWeight : 0;
      const evaluationTime = Date.now() - startTime;

      // Generate intelligent hints if needed
      let hints: string[] = [];
      let improvementSuggestions: ImprovementSuggestion[] = [];
      
      if (overallScore < 1.0) {
        for (const requirement of definition.requirements) {
          const requirementResult = evaluationResults.find(r => 
            r.requirementId === requirement.type
          );
          
          if (requirementResult && !requirementResult.passed) {
            const generatedHints = await hintGenerator.generateHints(
              requirement,
              context,
              requirementResult
            );
            hints.push(...generatedHints);
            
            const suggestions = await hintGenerator.generateImprovementSuggestions(
              requirement,
              context,
              requirementResult
            );
            improvementSuggestions.push(...suggestions);
          }
        }
      }

      // Update usage statistics
      this.updateGateStatistics(gateId, evaluationTime, overallPassed);

      // Create enhanced result
      const enhancedResult: EnhancedGateEvaluationResult = {
        requirementId: gateId,
        passed: overallPassed,
        score: overallScore,
        message: this.generateEvaluationMessage(definition, overallPassed, overallScore),
        details: {
          evaluationResults,
          contextualScore: this.calculateContextualScore(context, overallScore),
          evaluationTime,
        },
        hints,
        nextActions: this.generateNextActions(overallPassed, improvementSuggestions),
        improvementSuggestions,
        contextualScore: this.calculateContextualScore(context, overallScore),
        evaluationTime,
      };

      this.logger.debug(
        `Gate evaluation complete: ${gateId} - ${overallPassed ? 'PASSED' : 'FAILED'} (${overallScore.toFixed(2)})`
      );

      return enhancedResult;
    } catch (error) {
      this.logger.error(`Gate evaluation failed: ${gateId}`, error);
      this.updateGateStatistics(gateId, Date.now() - startTime, false);
      throw error;
    }
  }

  /**
   * Get all registered gates
   */
  getRegisteredGates(): Map<string, RegisteredGate> {
    return new Map(this.gates);
  }

  /**
   * Get gate by ID
   */
  getGate(gateId: string): RegisteredGate | undefined {
    return this.gates.get(gateId);
  }

  /**
   * Remove a gate from the registry
   */
  unregisterGate(gateId: string): boolean {
    const existed = this.gates.delete(gateId);
    if (existed) {
      this.logger.info(`Gate unregistered: ${gateId}`);
    }
    return existed;
  }

  /**
   * Get gate statistics
   */
  getGateStatistics(gateId: string): RegisteredGate['performanceStats'] | undefined {
    const gate = this.gates.get(gateId);
    return gate?.performanceStats;
  }

  /**
   * Initialize built-in gates from existing system
   */
  private initializeBuiltInGates(): void {
    // This will be implemented to load existing gates from the current system
    this.logger.info('Initializing built-in gates...');
    // Implementation will register the existing 5 gate types
  }

  /**
   * Validate gate definition
   */
  private validateGateDefinition(definition: ExtendedGateDefinition): ValidationResult {
    const errors: string[] = [];

    if (!definition.id || !definition.name) {
      errors.push('Gate must have id and name');
    }

    if (!definition.requirements || definition.requirements.length === 0) {
      errors.push('Gate must have at least one requirement');
    }

    for (const requirement of definition.requirements || []) {
      if (!this.evaluators.has(requirement.type)) {
        errors.push(`No evaluator found for requirement type: ${requirement.type}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Get evaluator for gate type
   */
  private getEvaluatorForType(type: ExtendedGateType): GateEvaluator {
    const evaluator = this.evaluators.get(type);
    if (!evaluator) {
      throw new Error(`No evaluator registered for type: ${type}`);
    }
    return evaluator;
  }

  /**
   * Get hint generator for gate type
   */
  private getHintGeneratorForType(type: ExtendedGateType): HintGenerator {
    const generator = this.hintGenerators.get(type);
    if (!generator) {
      throw new Error(`No hint generator registered for type: ${type}`);
    }
    return generator;
  }

  /**
   * Apply runtime-specific overrides to requirements
   */
  private applyRuntimeOverrides(
    requirement: ExtendedGateRequirement,
    runtime?: string
  ): ExtendedGateRequirement {
    if (!runtime || !requirement.runtimeOverrides) {
      return requirement;
    }

    const overrides = requirement.runtimeOverrides[runtime];
    if (!overrides) {
      return requirement;
    }

    return {
      ...requirement,
      criteria: {
        ...requirement.criteria,
        ...overrides,
      },
    };
  }

  /**
   * Update gate usage statistics
   */
  private updateGateStatistics(
    gateId: string,
    evaluationTime: number,
    passed: boolean
  ): void {
    const gate = this.gates.get(gateId);
    if (!gate) return;

    gate.usageCount++;
    gate.lastUsed = new Date();
    
    // Update performance stats
    const stats = gate.performanceStats;
    stats.avgEvaluationTime = (stats.avgEvaluationTime + evaluationTime) / 2;
    
    if (passed) {
      stats.successRate = (stats.successRate + 1) / gate.usageCount;
    } else {
      stats.failureRate = (stats.failureRate + 1) / gate.usageCount;
    }
  }

  /**
   * Generate evaluation message
   */
  private generateEvaluationMessage(
    definition: ExtendedGateDefinition,
    passed: boolean,
    score: number
  ): string {
    const status = passed ? 'PASSED' : 'FAILED';
    const scorePercent = Math.round(score * 100);
    return `Gate '${definition.name}' ${status} with score ${scorePercent}%`;
  }

  /**
   * Calculate contextual score based on workflow context
   */
  private calculateContextualScore(
    context: GateEvaluationContext,
    baseScore: number
  ): number {
    // Enhanced scoring based on workflow context
    let contextualScore = baseScore;
    
    if (context.workflowContext) {
      // Adjust score based on workflow progress
      const progress = context.workflowContext.stepResults 
        ? Object.keys(context.workflowContext.stepResults).length 
        : 0;
      
      // Later steps in workflow might have different scoring criteria
      if (progress > 2) {
        contextualScore += 0.1; // Bonus for late-stage validation
      }
    }
    
    return Math.min(contextualScore, 1.0);
  }

  /**
   * Generate next actions based on evaluation results
   */
  private generateNextActions(
    passed: boolean,
    suggestions: ImprovementSuggestion[]
  ): string[] {
    const actions: string[] = [];
    
    if (passed) {
      actions.push('proceed_to_next_step');
      if (suggestions.length > 0) {
        actions.push('optional_refinement_available');
      }
    } else {
      actions.push('address_validation_issues');
      if (suggestions.some(s => s.autoFixable)) {
        actions.push('auto_fix_available');
      }
      actions.push('manual_review_required');
    }
    
    return actions;
  }

  /**
   * Register a gate evaluator
   */
  registerEvaluator(type: ExtendedGateType, evaluator: GateEvaluator): void {
    this.evaluators.set(type, evaluator);
    this.logger.debug(`Registered evaluator for type: ${type}`);
  }

  /**
   * Register a hint generator
   */
  registerHintGenerator(type: ExtendedGateType, generator: HintGenerator): void {
    this.hintGenerators.set(type, generator);
    this.logger.debug(`Registered hint generator for type: ${type}`);
  }
}

/**
 * Create and configure a gate registry
 */
export function createGateRegistry(logger: Logger): GateRegistry {
  return new GateRegistry(logger);
}