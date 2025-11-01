import { Logger } from "../../logging/index.js";
import { ValidationError } from "../../utils/index.js";
import {
  type ChainOperator,
  type ChainStep,
  type ExecutionPlan,
  type ExecutionStep,
  type FrameworkOperator,
  type GateOperator,
  type OperatorDetectionResult,
  type ParallelOperator,
  type SymbolicCommandParseResult,
  type SymbolicOperator,
} from "./types/operator-types.js";

/**
 * Parser responsible for detecting and structuring symbolic command operators.
 *
 * The parser keeps regex-based detection isolated from the unified parser so that
 * the higher-level parsing flow only needs to reason about parsed operator metadata.
 */
export class SymbolicCommandParser {
  private readonly logger: Logger;

  private readonly OPERATOR_PATTERNS = {
    chain: /-->/g,
    gate: /\s*=\s*["'](.+?)["']\s*$/,
    framework: /^@([A-Za-z0-9_-]+)\s+/,
    parallel: /\s*\+\s*/g,
    conditional: /\s*\?\s*["'](.+?)["']\s*:\s*([A-Za-z0-9_-]+)/,
  } as const;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  detectOperators(command: string): OperatorDetectionResult {
    const operators: SymbolicOperator[] = [];
    const operatorTypes: string[] = [];

    const frameworkMatch = command.match(this.OPERATOR_PATTERNS.framework);
    if (frameworkMatch) {
      operatorTypes.push("framework");
      operators.push({
        type: "framework",
        frameworkId: frameworkMatch[1],
        normalizedId: frameworkMatch[1].toUpperCase(),
        temporary: true,
        scopeType: "execution",
      });
    }

    const chainMatches = command.match(this.OPERATOR_PATTERNS.chain);
    if (chainMatches && chainMatches.length > 0) {
      operatorTypes.push("chain");
      operators.push(this.parseChainOperator(command));
    }

    const gateMatch = command.match(this.OPERATOR_PATTERNS.gate);
    if (gateMatch) {
      operatorTypes.push("gate");
      operators.push({
        type: "gate",
        criteria: gateMatch[1],
        parsedCriteria: this.parseCriteria(gateMatch[1]),
        scope: "execution",
        retryOnFailure: true,
        maxRetries: 1,
      });
    }

    const parallelMatches = command.match(this.OPERATOR_PATTERNS.parallel);
    if (parallelMatches && parallelMatches.length > 0 && !(chainMatches && chainMatches.length > 0)) {
      operatorTypes.push("parallel");
      operators.push(this.parseParallelOperator(command));
    }

    const conditionalMatch = command.match(this.OPERATOR_PATTERNS.conditional);
    if (conditionalMatch) {
      operatorTypes.push("conditional");
      operators.push({
        type: "conditional",
        condition: conditionalMatch[1],
        conditionType: "presence",
        trueBranch: conditionalMatch[2],
        falseBranch: undefined,
      });
    }

    const complexity = this.calculateComplexity(operators);

    return {
      hasOperators: operators.length > 0,
      operatorTypes,
      operators,
      parseComplexity: complexity,
    };
  }

  private parseChainOperator(command: string): ChainOperator {
    // Remove framework operator prefix if present
    let cleanCommand = command.replace(this.OPERATOR_PATTERNS.framework, "");
    // NOTE: Do NOT strip gate patterns here - they conflict with regular arguments like input="value"
    // Gate operators should be detected and handled separately by the gate operator executor

    this.logger.debug(`[parseChainOperator] Original command: ${command}`);
    this.logger.debug(`[parseChainOperator] Clean command: ${cleanCommand}`);

    // Use argument-aware splitting that respects quoted strings
    const stepStrings = this.splitChainSteps(cleanCommand);

    this.logger.debug(`[parseChainOperator] Split into ${stepStrings.length} steps:`, stepStrings);

    const steps: ChainStep[] = stepStrings.map((stepStr, index) => {
      const stepMatch = stepStr.match(/^(?:>>)?([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/);
      if (!stepMatch) {
        this.logger.error(`[parseChainOperator] Failed to match step: "${stepStr}"`);
        throw new ValidationError(`Invalid chain step format: ${stepStr}`);
      }

      this.logger.debug(`[parseChainOperator] Step ${index + 1}: promptId="${stepMatch[1]}", args="${stepMatch[2]?.trim() ?? ""}"`);

      return {
        promptId: stepMatch[1],
        args: stepMatch[2]?.trim() ?? "",
        position: index,
        variableName: `step${index + 1}_result`,
      };
    });

    this.logger.debug(`[parseChainOperator] Final steps array length: ${steps.length}`);

    return {
      type: "chain",
      steps,
      contextPropagation: "automatic",
    };
  }

  /**
   * Split chain steps by --> delimiter while respecting quoted string boundaries
   * Handles: >>prompt1 input="test --> quoted" --> prompt2
   */
  private splitChainSteps(command: string): string[] {
    const steps: string[] = [];
    let current = '';
    let inQuotes = false;
    let i = 0;

    while (i < command.length) {
      const char = command[i];
      const next = command[i + 1];
      const next2 = command[i + 2];

      // Toggle quote state (handle escaped quotes)
      if (char === '"' && (i === 0 || command[i - 1] !== '\\')) {
        inQuotes = !inQuotes;
        current += char;
        i++;
        continue;
      }

      // Check for --> delimiter (only outside quotes)
      if (!inQuotes && char === '-' && next === '-' && next2 === '>') {
        if (current.trim()) {
          steps.push(current.trim());
        }
        current = '';
        i += 3; // Skip -->
        continue;
      }

      current += char;
      i++;
    }

    // Add final step
    if (current.trim()) {
      steps.push(current.trim());
    }

    return steps.filter(Boolean);
  }

  private parseParallelOperator(command: string): ParallelOperator {
    const promptStrings = command.split("+").map((segment) => segment.trim()).filter(Boolean);

    const prompts = promptStrings.map((promptStr, index) => {
      const promptMatch = promptStr.match(/^(?:>>)?([A-Za-z0-9_-]+)(?:\s+([\s\S]*))?$/);
      if (!promptMatch) {
        throw new ValidationError(`Invalid parallel prompt format: ${promptStr}`);
      }

      return {
        promptId: promptMatch[1],
        args: promptMatch[2]?.trim() ?? "",
        position: index,
      };
    });

    return {
      type: "parallel",
      prompts,
      aggregationStrategy: "merge",
    };
  }

  private parseCriteria(criteriaString: string): string[] {
    return criteriaString
      .split(/,|and|\||;/i)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }

  private calculateComplexity(operators: SymbolicOperator[]): "simple" | "moderate" | "complex" {
    if (operators.length <= 1) {
      return operators.length === 0 ? "simple" : "simple";
    }
    if (operators.length === 2) {
      return "moderate";
    }
    return "complex";
  }

  generateExecutionPlan(
    detection: OperatorDetectionResult,
    basePromptId: string,
    baseArgs: string,
  ): ExecutionPlan {
    const steps: ExecutionStep[] = [];
    let frameworkOverride: string | undefined;
    let finalValidation: GateOperator | undefined;

    const frameworkOp = detection.operators.find((op): op is FrameworkOperator => op.type === "framework");
    if (frameworkOp) {
      frameworkOverride = frameworkOp.normalizedId;
    }

    const gateOp = detection.operators.find((op): op is GateOperator => op.type === "gate");
    if (gateOp) {
      finalValidation = gateOp;
    }

    const chainOp = detection.operators.find((op): op is ChainOperator => op.type === "chain");
    if (chainOp) {
      chainOp.steps.forEach((step, index) => {
        steps.push({
          stepNumber: index + 1,
          type: "prompt",
          promptId: step.promptId,
          args: step.args,
          dependencies: index > 0 ? [index] : [],
          outputVariable: step.variableName,
        });
      });
    } else {
      steps.push({
        stepNumber: 1,
        type: "prompt",
        promptId: basePromptId,
        args: baseArgs,
        dependencies: [],
        outputVariable: "result",
      });
    }

    return {
      steps,
      frameworkOverride,
      finalValidation,
      estimatedComplexity: detection.operators.length,
      requiresSessionState: steps.length > 1,
    };
  }

  buildParseResult(
    command: string,
    operators: OperatorDetectionResult,
    basePromptId: string,
    baseArgs: string,
  ): SymbolicCommandParseResult {
    const executionPlan = this.generateExecutionPlan(operators, basePromptId, baseArgs);

    return {
      promptId: basePromptId,
      rawArgs: baseArgs,
      format: "symbolic",
      confidence: 0.95,
      operators,
      executionPlan,
      metadata: {
        originalCommand: command,
        parseStrategy: "symbolic",
        detectedFormat: `Symbolic (${operators.operatorTypes.join(", ")})`,
        warnings: [],
      },
    };
  }
}

export function createSymbolicCommandParser(logger: Logger): SymbolicCommandParser {
  return new SymbolicCommandParser(logger);
}
