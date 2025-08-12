/**
 * Enhanced Gate Evaluator - Phase 2 Integration
 * Bridges the existing gate system with the new comprehensive gate registry
 */

import { Logger } from "../logging/index.js";
import {
  GateDefinition,
  GateStatus,
  WorkflowExecutionContext,
} from "../types/index.js";

import {
  ExtendedGateDefinition,
  GateEvaluationContext,
  GateRegistry,
} from "./gate-registry.js";
import { GateEvaluator as LegacyGateEvaluator } from "./gateValidation.js";

import { GateEvaluatorFactory } from "./gate-evaluators.js";

/**
 * Enhanced Gate Evaluator that supports both legacy and new gate types
 */
export class EnhancedGateEvaluator {
  private logger: Logger;
  private legacyEvaluator: LegacyGateEvaluator;
  private gateRegistry: GateRegistry;

  constructor(logger: Logger) {
    this.logger = logger;
    this.legacyEvaluator = new LegacyGateEvaluator(logger);
    this.gateRegistry = new GateRegistry(logger);
    this.initializeGateRegistry();
  }

  /**
   * Evaluate gates using the appropriate evaluator (legacy or enhanced)
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
        `Gate ${gate.id} result: ${gateStatus.passed ? "PASSED" : "FAILED"}`
      );
    }

    return gateStatuses;
  }

  /**
   * Evaluate a single gate with enhanced capabilities
   */
  async evaluateGate(
    content: string,
    gate: GateDefinition,
    context?: Record<string, any>
  ): Promise<GateStatus> {
    // Check if this is a legacy gate type that should use the old evaluator
    const isLegacyGate = this.isLegacyGateType(gate);

    if (isLegacyGate) {
      return await this.legacyEvaluator.evaluateGate(content, gate, context);
    }

    // Use the enhanced gate registry for new gate types
    return await this.evaluateEnhancedGate(content, gate, context);
  }

  /**
   * Evaluate gates in workflow context with enhanced features
   */
  async evaluateWorkflowGates(
    content: string,
    gates: GateDefinition[],
    workflowContext: WorkflowExecutionContext,
    stepId?: string
  ): Promise<GateStatus[]> {
    const evaluationContext: GateEvaluationContext = {
      content,
      workflowContext,
      stepId,
      runtime: workflowContext.runtime,
      metadata: {
        workflowId: workflowContext.workflow.id,
        stepId,
        timestamp: Date.now(),
      },
      previousResults: workflowContext.stepResults,
    };

    const gateStatuses: GateStatus[] = [];

    for (const gate of gates) {
      this.logger.debug(`Evaluating workflow gate: ${gate.name} (${gate.id})`);

      const gateStatus = await this.evaluateWorkflowGate(
        gate,
        evaluationContext
      );
      gateStatuses.push(gateStatus);

      this.logger.debug(
        `Workflow gate ${gate.id} result: ${
          gateStatus.passed ? "PASSED" : "FAILED"
        }`
      );
    }

    return gateStatuses;
  }

  /**
   * Register a new gate type with the registry
   */
  async registerGate(definition: ExtendedGateDefinition): Promise<string> {
    return await this.gateRegistry.registerGate(definition);
  }

  /**
   * Get gate registry for direct access
   */
  getGateRegistry(): GateRegistry {
    return this.gateRegistry;
  }

  /**
   * Generate intelligent hints for failed gates
   */
  async generateIntelligentHints(
    gateStatuses: GateStatus[],
    context: GateEvaluationContext
  ): Promise<string[]> {
    const hints: string[] = [];

    for (const status of gateStatuses) {
      if (!status.passed) {
        // Try to get enhanced hints from the gate registry
        try {
          const registeredGate = this.gateRegistry.getGate(status.gateId);
          if (registeredGate) {
            const enhancedResult = await this.gateRegistry.evaluateGate(
              status.gateId,
              context
            );

            if (enhancedResult.hints) {
              hints.push(...enhancedResult.hints);
            }
          } else {
            // Fall back to legacy hint generation
            const legacyHints = this.legacyEvaluator.getRetryMessage([status]);
            hints.push(legacyHints);
          }
        } catch (error) {
          this.logger.error(
            `Failed to generate hints for gate ${status.gateId}`,
            error
          );
          // Fall back to basic hint
          hints.push(`Gate '${status.gateId}' failed validation`);
        }
      }
    }

    return hints;
  }

  /**
   * Check if gate should retry based on enhanced retry logic
   */
  shouldRetry(gateStatuses: GateStatus[], maxRetries: number = 3): boolean {
    return this.legacyEvaluator.shouldRetry(gateStatuses, maxRetries);
  }

  /**
   * Get enhanced retry message with intelligent hints
   */
  async getEnhancedRetryMessage(
    gateStatuses: GateStatus[],
    context: GateEvaluationContext
  ): Promise<string> {
    const failedGates = gateStatuses.filter((gate) => !gate.passed);

    if (failedGates.length === 0) {
      return "All gates passed";
    }

    const hints = await this.generateIntelligentHints(failedGates, context);
    const messages = failedGates.map((gate) => {
      const failedRequirements = gate.evaluationResults
        .filter((result) => !result.passed)
        .map((result) => result.message)
        .join("; ");

      return `Gate '${gate.gateId}' failed: ${failedRequirements}`;
    });

    const baseMessage = `Gate validation failed. Issues to address:\n${messages.join(
      "\n"
    )}`;

    if (hints.length > 0) {
      return `${baseMessage}\n\nSuggestions:\n${hints
        .map((h) => `• ${h}`)
        .join("\n")}`;
    }

    return baseMessage;
  }

  /**
   * Initialize the gate registry with evaluators and hint generators
   */
  private initializeGateRegistry(): void {
    this.logger.info("Initializing enhanced gate registry...");

    // Register all evaluators from the factory
    const evaluators = GateEvaluatorFactory.getAllEvaluators();
    const hintGenerators = GateEvaluatorFactory.getAllHintGenerators();

    for (const [type, evaluator] of evaluators) {
      this.gateRegistry.registerEvaluator(type, evaluator);
    }

    for (const [type, hintGenerator] of hintGenerators) {
      this.gateRegistry.registerHintGenerator(type, hintGenerator);
    }

    this.logger.info(
      `Gate registry initialized with ${evaluators.size} evaluators and ${hintGenerators.size} hint generators`
    );
  }

  /**
   * Check if a gate uses legacy evaluation logic
   */
  private isLegacyGateType(gate: GateDefinition): boolean {
    // Legacy gate types that should use the old evaluator
    const legacyTypes = [
      "content_length",
      "keyword_presence",
      "format_validation",
      "section_validation",
      "custom",
    ];

    return gate.requirements.some((req) => legacyTypes.includes(req.type));
  }

  /**
   * Evaluate gate using enhanced registry
   */
  private async evaluateEnhancedGate(
    content: string,
    gate: GateDefinition,
    context?: Record<string, any>
  ): Promise<GateStatus> {
    const evaluationContext: GateEvaluationContext = {
      content,
      metadata: context,
    };

    try {
      const result = await this.gateRegistry.evaluateGate(
        gate.id,
        evaluationContext
      );

      // Convert enhanced result to legacy GateStatus format
      return {
        gateId: gate.id,
        passed: result.passed,
        requirements: gate.requirements,
        evaluationResults: [
          {
            requirementId: result.requirementId,
            passed: result.passed,
            score: result.score,
            message: result.message,
            details: result.details,
          },
        ],
        timestamp: Date.now(),
      };
    } catch (error) {
      this.logger.error(
        `Enhanced gate evaluation failed for ${gate.id}`,
        error
      );

      // Fall back to legacy evaluation
      return await this.legacyEvaluator.evaluateGate(content, gate, context);
    }
  }

  /**
   * Evaluate gate in workflow context
   */
  private async evaluateWorkflowGate(
    gate: GateDefinition,
    context: GateEvaluationContext
  ): Promise<GateStatus> {
    try {
      const result = await this.gateRegistry.evaluateGate(gate.id, context);

      return {
        gateId: gate.id,
        passed: result.passed,
        requirements: gate.requirements,
        evaluationResults: [
          {
            requirementId: result.requirementId,
            passed: result.passed,
            score: result.score,
            message: result.message,
            details: result.details,
          },
        ],
        timestamp: Date.now(),
      };
    } catch (error) {
      this.logger.error(
        `Workflow gate evaluation failed for ${gate.id}`,
        error
      );

      // Fall back to legacy evaluation
      return await this.legacyEvaluator.evaluateGate(
        context.content,
        gate,
        context.metadata
      );
    }
  }
}

/**
 * Create and configure an enhanced gate evaluator
 */
export function createEnhancedGateEvaluator(
  logger: Logger
): EnhancedGateEvaluator {
  return new EnhancedGateEvaluator(logger);
}
