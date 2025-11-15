import { Logger } from "../../logging/index.js";
import { LightweightGateSystem } from "../../gates/core/index.js";
import type { GateOperator } from "../parsers/types/operator-types.js";
import type { TemporaryGateDefinition } from "../../gates/core/temporary-gate-registry.js";

export interface GateExecutionInput {
  gate: GateOperator;
  executionResult: unknown;
  executionId: string;
  gateId?: string;
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
    retryHints: string[];
    gateId?: string;
  }> {
    const { gate, executionResult, executionId } = input;

    let gateId = input.gateId;

    if (!gateId) {
      const gateDefinition = this.createTemporaryGateDefinition(gate);

      this.logger.debug("[SymbolicGate] Registering temporary gate", {
        gateCriteria: gate.parsedCriteria,
        executionId,
      });

      const createdGateId = await this.gateSystem.createTemporaryGate(
        gateDefinition,
        executionId,
      );

      gateId = createdGateId ?? undefined;

      if (!gateId) {
        this.logger.error("[SymbolicGate] Failed to create temporary gate");
        return {
          passed: false,
          gateResults: [],
          retryRequired: false,
          retryHints: [],
          gateId: undefined,
        };
      }
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
    const retryHints = results.flatMap((result: any) =>
      Array.isArray(result.retryHints) ? result.retryHints : [],
    );

    this.logger.info("[SymbolicGate] Gate evaluation completed", {
      executionId,
      passed,
      retryRequired,
    });

    return {
      passed,
      gateResults: results,
      retryRequired,
      retryHints,
      gateId,
    };
  }

  public generateGuidance(criteria: string[]): string {
    if (criteria.length === 0) {
      return "Validate the output against the inline criteria.";
    }

    return [
      "Evaluate the output against these criteria:",
      ...criteria.map((item, index) => `${index + 1}. ${item}`),
    ].join("\n");
  }

  public createTemporaryGateDefinition(
    gate: GateOperator,
  ): Omit<TemporaryGateDefinition, "id" | "created_at"> {
    return {
      name: `Inline Quality Criteria`,
      type: "quality",
      scope: gate.scope,
      description: `Inline validation criteria: ${gate.criteria}`,
      guidance: this.generateGuidance(gate.parsedCriteria),
      pass_criteria: gate.parsedCriteria,
      source: "automatic",
    };
  }
}
