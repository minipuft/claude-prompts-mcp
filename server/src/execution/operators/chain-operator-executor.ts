import { Logger } from "../../logging/index.js";
import { createExecutionResponse } from "../../mcp-tools/shared/structured-response-builder.js";
import type { ToolResponse } from "../../types/index.js";
import type { ExecutionStep } from "../parsers/types/operator-types.js";

interface StepPromptReference {
  stepNumber: number;
  promptId: string;
  args: string;
}

export interface ChainExecutionInput {
  command: string;
  steps: ExecutionStep[];
  stepPrompts: StepPromptReference[];
}

export class ChainOperatorExecutor {
  constructor(private readonly logger: Logger) {}

  async execute(input: ChainExecutionInput): Promise<ToolResponse> {
    const { command, stepPrompts } = input;

    this.logger.debug("[SymbolicChain] Preparing execution plan", {
      command,
      stepCount: stepPrompts.length,
    });

    if (stepPrompts.length === 0) {
      return createExecutionResponse(
        "No executable steps detected in symbolic chain.",
        "execute",
        {
          executionType: "chain",
          stepsExecuted: 0,
        },
        true
      );
    }

    const lines: string[] = [];
    lines.push("## 🔗 Symbolic Chain Execution Plan\n");
    lines.push(`**Original Command**: \`${command}\`\n`);
    lines.push(`**Total Steps**: ${stepPrompts.length}\n\n`);

    for (const step of stepPrompts) {
      const argsText = step.args ? step.args : "(no arguments)";
      lines.push(`### Step ${step.stepNumber}: ${step.promptId}\n`);
      lines.push(`Command: \`>>${step.promptId}${step.args ? ` ${step.args}` : ''}\`\n`);
      lines.push(`Arguments: ${argsText}\n\n`);
    }

    lines.push("---\n");
    lines.push("Execute each step sequentially, passing the previous step's output as context where appropriate.\n");
    lines.push("This plan was generated dynamically from a symbolic command; adapt arguments as needed for each step.\n");

    const content = lines.join("");

    return createExecutionResponse(
      content,
      "execute",
      {
        executionType: "chain",
        stepsExecuted: stepPrompts.length,
      },
      true
    );
  }
}
