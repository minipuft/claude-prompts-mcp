// @lifecycle canonical - Formats resource menus and judge responses for Claude.
import type { Logger } from '#infra/logging/index.js';
import type { ToolResponse } from '#shared/types/index.js';
import type { ResourceMenu } from './judge-resource-collector.js';
import type { ExecutionContext } from '../../execution/context/index.js';

/** Narrow type for framework judge prompt data — avoids frameworks/ import. */
export interface JudgePromptData {
  systemMessage?: string;
  userMessageTemplate?: string;
}

/** Provider that resolves a framework's judge prompt by framework ID. */
export type FrameworkJudgePromptProvider = (frameworkId: string) => JudgePromptData | undefined;

/**
 * Context about operators already specified in the command.
 */
export interface OperatorContext {
  hasFrameworkOperator: boolean;
  frameworkId?: string;
  hasInlineGates: boolean;
  inlineGateIds: string[];
  hasStyleSelector: boolean;
  styleId?: string;
}

/**
 * Formats collected resources as structured menus and builds judge responses
 * for the two-phase client-driven selection flow.
 *
 * Extracted from JudgeSelectionStage.
 */
export class JudgeMenuFormatter {
  constructor(
    private readonly logger: Logger,
    private readonly judgePromptProvider?: FrameworkJudgePromptProvider | null
  ) {}

  /**
   * Build the complete judge response with resource menu and selection instructions.
   */
  buildJudgeResponse(resources: ResourceMenu, context: ExecutionContext): ToolResponse {
    const operatorContext = this.getOperatorContext(context);
    const menu = this.formatResourceMenuForClaude(resources, operatorContext);
    const cleanCommand = this.getCleanCommandForDisplay(context);
    const originalCommand = context.mcpRequest.command ?? '';
    const escapedCommand = originalCommand.replace(/"/g, '\\"');
    const contextHeader = this.buildOperatorContextHeader(operatorContext);

    const frameworkInstructions = operatorContext.hasFrameworkOperator
      ? ''
      : `1. **Framework** (optional): Select a framework if the task requires structured reasoning
   - CAGEERF: Complex analysis requiring Context → Analysis → Goals → Execution → Evaluation → Refinement
   - ReACT: Tasks requiring interleaved Reasoning and Acting
   - 5W1H: Investigative tasks (Who, What, When, Where, Why, How)
   - SCAMPER: Creative/innovation tasks (Substitute, Combine, Adapt, Modify, Put to uses, Eliminate, Reverse)

`;

    const frameworkJudgePrompt = this.getActiveFrameworkJudgePrompt(context);

    const introLines = frameworkJudgePrompt
      ? [
          frameworkJudgePrompt.systemMessage ?? '',
          '',
          '### Framework-Specific Instructions',
          frameworkJudgePrompt.userMessageTemplate ?? '',
          '',
        ]
      : [
          'You are an expert resource selector. Analyze the task below and select appropriate enhancement resources to improve the response quality.',
        ];

    const responseLines = [
      '## Resource Selection Required',
      '',
      ...introLines,
      contextHeader,
      '---',
      '',
      '### Your Task',
      '```',
      cleanCommand,
      '```',
      '',
      '---',
      '',
      '### Available Resources',
      '',
      menu,
      '',
      '---',
      '',
      '### Selection Instructions',
      '',
      'Analyze the task and select resources that will enhance the response:',
      '',
      `${frameworkInstructions}${
        operatorContext.hasFrameworkOperator ? '1' : '2'
      }. **Style** (recommended): Select a response style matching the task type`,
      '   - analytical: Systematic analysis and data-driven responses',
      '   - procedural: Step-by-step instructions and processes',
      '   - creative: Innovative thinking and brainstorming',
      '   - reasoning: Logical decomposition and problem-solving',
      '',
      `${
        operatorContext.hasFrameworkOperator ? '2' : '3'
      }. **Gates** (optional): Select quality gates to ensure specific aspects`,
      '   - Select gates relevant to the task domain (code, research, security, etc.)',
      '',
      '---',
      '',
      '### How to Apply Selections',
      '',
      'Call `prompt_engine` again using inline operators (no extra parameters):',
      '',
      '```',
      `prompt_engine({`,
      `  command: "${escapedCommand}${
        operatorContext.hasFrameworkOperator ? '' : ' @<framework>'
      } :: <gate_id or criteria> #<analytical|procedural|creative|reasoning>"`,
      `})`,
      '```',
      '',
      '**Notes:**',
      '- Use `@Framework` to set framework, `::` for gates, and `#id` for response style (e.g., `#analytical`).',
      '- Use `%judge` only for the judge phase; follow-up calls should rely on inline operators.',
    ];

    const responseText = responseLines.filter((line) => line !== undefined).join('\n');

    return {
      content: [{ type: 'text', text: responseText }],
      isError: false,
    };
  }

  /**
   * Extract operator context from the parsed command.
   */
  getOperatorContext(context: ExecutionContext): OperatorContext {
    const parsedCommand = context.parsedCommand;

    const frameworkOverride = parsedCommand?.executionPlan?.frameworkOverride;
    let inlineGates = parsedCommand?.inlineGateCriteria ?? [];

    const finalValidation = parsedCommand?.executionPlan?.finalValidation;
    if (finalValidation && 'parsedCriteria' in finalValidation) {
      const chainGates = (finalValidation as { parsedCriteria?: string[] }).parsedCriteria ?? [];
      inlineGates = [...new Set([...inlineGates, ...chainGates])];
    }

    const styleSelection =
      parsedCommand?.styleSelection ?? parsedCommand?.executionPlan?.styleSelection;

    const operatorContext: OperatorContext = {
      hasFrameworkOperator: Boolean(frameworkOverride),
      hasInlineGates: inlineGates.length > 0,
      inlineGateIds: inlineGates,
      hasStyleSelector: Boolean(styleSelection),
    };

    if (frameworkOverride) {
      operatorContext.frameworkId = frameworkOverride;
    }
    if (styleSelection) {
      operatorContext.styleId = styleSelection;
    }

    return operatorContext;
  }

  /**
   * Format collected resources as a structured menu for Claude.
   */
  formatResourceMenuForClaude(resources: ResourceMenu, operatorContext: OperatorContext): string {
    const sections: string[] = [];

    if (resources.styles.length > 0) {
      sections.push('#### Response Styles');
      sections.push(
        resources.styles.map((r) => `- **${r.id}**: ${r.description || r.name}`).join('\n')
      );
    }

    if (!operatorContext.hasFrameworkOperator && resources.frameworks.length > 0) {
      sections.push('\n#### Framework Frameworks');
      sections.push(
        resources.frameworks.map((r) => `- **${r.id}**: ${r.description || r.name}`).join('\n')
      );
    }

    if (resources.gates.length > 0) {
      sections.push('\n#### Quality Gates');
      const preSelectedSet = new Set(operatorContext.inlineGateIds);
      sections.push(
        resources.gates
          .map((g) => {
            const isPreSelected = preSelectedSet.has(g.id);
            const marker = isPreSelected ? '[x]' : '[ ]';
            const suffix = isPreSelected ? ' *(from command)*' : '';
            return `- ${marker} **${g.id}**: ${g.description || g.name}${suffix}`;
          })
          .join('\n')
      );
    }

    return sections.join('\n');
  }

  private buildOperatorContextHeader(operatorContext: OperatorContext): string {
    const parts: string[] = [];

    if (operatorContext.hasFrameworkOperator && operatorContext.frameworkId) {
      parts.push(`**Framework:** ${operatorContext.frameworkId.toUpperCase()} (from command)`);
    }

    if (operatorContext.hasInlineGates && operatorContext.inlineGateIds.length > 0) {
      parts.push(`**Gates:** ${operatorContext.inlineGateIds.join(', ')} (from command)`);
    }

    if (operatorContext.hasStyleSelector && operatorContext.styleId) {
      parts.push(`**Style:** ${operatorContext.styleId} (from command)`);
    }

    if (parts.length === 0) {
      return '';
    }

    return `\n### Already Specified\n${parts.join('\n')}\n`;
  }

  private getCleanCommandForDisplay(context: ExecutionContext): string {
    const command = context.mcpRequest?.command ?? '';

    let clean = command.replace(/^%[a-z]+\s+/i, '');
    clean = clean.replace(/\s*@[A-Za-z0-9_-]+\s*/g, ' ');
    clean = clean.replace(/#style(?:[:=]|\()[A-Za-z0-9_-]+\)?/gi, ' ');
    clean = clean.replace(/\s*::\s*["']?[^"'\s]+["']?\s*$/, '');
    clean = clean.replace(/\s+/g, ' ');

    return clean.trim();
  }

  private getActiveFrameworkJudgePrompt(context: ExecutionContext): JudgePromptData | undefined {
    const frameworkId = context.frameworkContext?.selectedFramework?.type;
    if (!frameworkId || !this.judgePromptProvider) {
      return undefined;
    }

    try {
      return this.judgePromptProvider(frameworkId.toLowerCase());
    } catch (error) {
      this.logger.warn('[JudgeMenuFormatter] Failed to load framework judge prompt', {
        frameworkId,
        error,
      });
      return undefined;
    }
  }
}
