import { Logger } from "../../logging/index.js";
import { LightweightGateSystem } from "../../gates/core/index.js";
import type { GateOperator } from "../parsers/types/operator-types.js";

export interface GateExecutionInput {
  gate: GateOperator;
  executionResult: unknown;
  executionId: string;
}

export class GateOperatorExecutor {
  constructor(
    private readonly gateSystem: LightweightGateSystem,
    private readonly logger: Logger,
  ) {}

  async execute(input: GateExecutionInput): Promise<{
    passed: boolean;
    gateResults: any[];
    retryRequired: boolean;
  }> {
    const { gate, executionResult, executionId } = input;

    const gateDefinition = {
      name: `inline_gate_${Date.now()}`,
      type: "quality" as const,
      scope: gate.scope,
      description: `Inline validation criteria: ${gate.criteria}`,
      guidance: this.generateGuidance(gate.parsedCriteria),
      pass_criteria: gate.parsedCriteria,
      source: "automatic" as const,
    };

    this.logger.debug("[SymbolicGate] Registering temporary gate", {
      gateCriteria: gate.parsedCriteria,
      executionId,
    });

    const gateId = await this.gateSystem.createTemporaryGate(
      gateDefinition,
      executionId,
    );

    if (!gateId) {
      this.logger.error("[SymbolicGate] Failed to create temporary gate");
      return {
        passed: false,
        gateResults: [],
        retryRequired: false,
      };
    }

    const contentString =
      typeof executionResult === "string"
        ? executionResult
        : JSON.stringify(executionResult);

    const results = await this.gateSystem.validateContent(
      [gateId],
      contentString,
      {
        metadata: { executionId },
      },
    );

    const passed = results.every((result: any) => result.passed);
    const retryRequired = !passed && gate.retryOnFailure && gate.maxRetries > 0;

    this.logger.info("[SymbolicGate] Gate evaluation completed", {
      executionId,
      passed,
      retryRequired,
    });

    return {
      passed,
      gateResults: results,
      retryRequired,
    };
  }

  private generateGuidance(criteria: string[]): string {
    if (criteria.length === 0) {
      return "Validate the output against the inline criteria.";
    }

    return [
      "Evaluate the output against these criteria:",
      ...criteria.map((item, index) => `${index + 1}. ${item}`),
    ].join("\n");
  }
}
