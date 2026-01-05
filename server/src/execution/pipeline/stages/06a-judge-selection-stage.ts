// @lifecycle canonical - Implements two-phase client-driven judge selection for resource enhancement.
import { getDefaultRuntimeLoader } from '../../../frameworks/methodology/index.js';
import { BasePipelineStage } from '../stage.js';

import type { ConfigManager } from '../../../config/index.js';
import type { MethodologyDefinition } from '../../../frameworks/methodology/methodology-definition-types.js';
import type { GateDefinitionProvider } from '../../../gates/core/gate-loader.js';
import type { LightweightGateDefinition } from '../../../gates/types.js';
import type { Logger } from '../../../logging/index.js';
import type { StyleManager } from '../../../styles/index.js';
import type { ConvertedPrompt, ToolResponse } from '../../../types/index.js';
import type { ExecutionContext } from '../../context/execution-context.js';

/**
 * Provider function to get all converted prompts.
 */
type PromptsProvider = () => ConvertedPrompt[];

/**
 * Collected resources organized by category for the judge menu.
 */
interface ResourceMenu {
  styles: ConvertedPrompt[];
  frameworks: ConvertedPrompt[];
  gates: LightweightGateDefinition[];
}

/**
 * Provider for framework resources (derived from methodology definitions).
 */
type FrameworkResourceProvider = () => Promise<ConvertedPrompt[]> | ConvertedPrompt[];

/**
 * Context about operators already specified in the command.
 */
interface OperatorContext {
  hasFrameworkOperator: boolean;
  frameworkId?: string;
  hasInlineGates: boolean;
  inlineGateIds: string[];
  hasStyleSelector: boolean;
  styleId?: string;
}

/**
 * Pipeline Stage 6a: Judge Selection (Two-Phase Client-Driven Flow)
 *
 * This stage implements a two-phase resource selection system:
 *
 * ** - Judge Phase** (triggered by `%judge`):
 * - Collects all available resources (styles, frameworks, gates)
 * - Returns a judge prompt with resource menu for Claude to analyze
 * - Pipeline terminates early with the judge response
 *
 * ** - Execution Phase** (follow-up call with operators):
 * - Client reruns prompt_engine with inline operators (@framework, ::gates, #style)
 * - Pipeline continues with normal execution using operator-derived selections
 *
 * Dependencies: context.mcpRequest, context.executionPlan
 * Output:
 *   - Judge Phase: context.response (early return)
 *   - Execution Phase: operator-derived selections applied to framework state
 */
export class JudgeSelectionStage extends BasePipelineStage {
  readonly name = 'JudgeSelection';

  constructor(
    private readonly promptsProvider: PromptsProvider | null,
    private readonly gateLoader: GateDefinitionProvider | null,
    private readonly configManager: ConfigManager | null,
    logger: Logger,
    private readonly frameworksProvider?: FrameworkResourceProvider | null,
    private readonly styleManager?: StyleManager | null
  ) {
    super(logger);
  }

  async execute(context: ExecutionContext): Promise<void> {
    this.logEntry(context);

    // Skip if session blueprint restored (resuming a chain)
    if (context.state.session.isBlueprintRestored) {
      this.logExit({ skipped: 'Session blueprint restored' });
      return;
    }

    const inlineStyleApplied = this.applyInlineStyleSelection(context);

    // Check if this is a judge phase trigger
    const isJudgePhase = this.shouldTriggerJudgePhase(context);

    if (!isJudgePhase) {
      this.logExit({
        skipped: 'Not judge phase',
        inlineStyleApplied,
      });
      return;
    }

    // === JUDGE PHASE ===
    // Check if judge system is enabled in config
    const isJudgeEnabled = this.configManager?.isJudgeEnabled() ?? true;
    if (!isJudgeEnabled) {
      this.logExit({ skipped: 'Judge system disabled in config' });
      return;
    }

    try {
      // Collect all available resources
      const resources = await this.collectAllResources();

      // Check if we have any resources to offer
      const totalResources =
        resources.styles.length + resources.frameworks.length + resources.gates.length;

      if (totalResources === 0) {
        this.logger.warn('[JudgeSelectionStage] No resources available for selection');
        this.logExit({ skipped: 'No resources available' });
        return;
      }

      // Build the judge response with resource menu
      // #todo: If a framework is active, override the base judge template with the methodology-specific judgePrompt from the guide/definition.
      const judgeResponse = this.buildJudgeResponse(resources, context);

      // Set early return - pipeline will terminate with this response
      context.setResponse(judgeResponse);
      context.state.framework.judgePhaseTriggered = true;

      this.logExit({
        judgePhaseTriggered: true,
        stylesCount: resources.styles.length,
        frameworksCount: resources.frameworks.length,
        gatesCount: resources.gates.length,
        totalResources,
        inlineStyleApplied,
      });
    } catch (error) {
      this.handleError(error, 'Judge phase resource collection failed');
    }
  }

  /**
   * Apply inline style selector (#style) from the parsed command to framework state.
   */
  private applyInlineStyleSelection(context: ExecutionContext): boolean {
    const styleFromCommand =
      context.parsedCommand?.styleSelection ?? context.parsedCommand?.executionPlan?.styleSelection;

    if (!styleFromCommand) {
      return false;
    }

    const normalizedStyle = styleFromCommand.toLowerCase();
    if (context.state.framework.clientSelectedStyle === normalizedStyle) {
      return true;
    }

    context.state.framework.clientSelectedStyle = normalizedStyle;
    context.diagnostics.info(this.name, 'Inline style selection applied from command', {
      style: normalizedStyle,
    });
    this.logger.debug('[JudgeSelectionStage] Applied inline style selector:', normalizedStyle);
    return true;
  }

  /**
   * Determine if this request should trigger the judge phase.
   *
   * Judge phase is triggered when:
   * - `%judge` modifier is used
   */
  private shouldTriggerJudgePhase(context: ExecutionContext): boolean {
    const modifiers = context.getExecutionModifiers();
    return modifiers?.judge === true;
  }

  /**
   * Extract operator context from the parsed command.
   * Used to make the judge menu context-aware.
   */
  private getOperatorContext(context: ExecutionContext): OperatorContext {
    const parsedCommand = context.parsedCommand;

    // Check for framework operator in execution plan
    const frameworkOverride = parsedCommand?.executionPlan?.frameworkOverride;

    // Check for inline gates from :: operator
    // For single prompts: inlineGateCriteria on parsedCommand
    // For chains: finalValidation on executionPlan contains global gate criteria
    let inlineGates = parsedCommand?.inlineGateCriteria ?? [];

    // Also check executionPlan.finalValidation for chain-level gates
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
   * Get a cleaned version of the command for display (operators stripped).
   * Command format: >>prompt_id @FRAMEWORK :: gate or %modifier >>prompt_id
   */
  private getCleanCommandForDisplay(context: ExecutionContext): string {
    const command = context.mcpRequest?.command ?? '';

    // Strip % modifiers at start (%judge, %clean, %lean, etc.)
    let clean = command.replace(/^%[a-z]+\s+/i, '');

    // Strip framework operator (@FRAMEWORK anywhere in the command)
    clean = clean.replace(/\s*@[A-Za-z0-9_-]+\s*/g, ' ');

    // Strip style selector (#style:<id> or #style(<id>))
    clean = clean.replace(/#style(?:[:=]|\()[A-Za-z0-9_-]+\)?/gi, ' ');

    // Strip gate operator (:: "criteria" at end)
    clean = clean.replace(/\s*::\s*["']?[^"'\s]+["']?\s*$/, '');

    // Normalize whitespace
    clean = clean.replace(/\s+/g, ' ');

    return clean.trim();
  }

  /**
   * Get methodology-specific judge prompt if a framework is active.
   */
  private getActiveMethodologyJudgePrompt(context: ExecutionContext) {
    const frameworkId = context.frameworkContext?.selectedFramework?.methodology;
    if (!frameworkId) {
      return undefined;
    }

    try {
      const loader = getDefaultRuntimeLoader();
      const definition = loader.loadMethodology(frameworkId.toLowerCase());
      return definition?.judgePrompt;
    } catch (error) {
      this.logger.warn('[JudgeSelectionStage] Failed to load methodology judge prompt', {
        frameworkId,
        error,
      });
      return undefined;
    }
  }

  /**
   * Build the judge response with resource menu and selection instructions.
   * Context-aware: adapts based on operators already specified in the command.
   */
  private buildJudgeResponse(resources: ResourceMenu, context: ExecutionContext): ToolResponse {
    const operatorContext = this.getOperatorContext(context);
    const menu = this.formatResourceMenuForClaude(resources, operatorContext);
    const cleanCommand = this.getCleanCommandForDisplay(context);
    const originalCommand = context.mcpRequest.command ?? '';

    // Escape command for inclusion in code block
    const escapedCommand = originalCommand.replace(/"/g, '\\"');

    // Build context-aware header if operators are present
    const contextHeader = this.buildOperatorContextHeader(operatorContext);

    // Build framework instructions only if no framework operator present
    const frameworkInstructions = operatorContext.hasFrameworkOperator
      ? ''
      : `1. **Framework** (optional): Select a methodology framework if the task requires structured reasoning
   - CAGEERF: Complex analysis requiring Context → Analysis → Goals → Execution → Evaluation → Refinement
   - ReACT: Tasks requiring interleaved Reasoning and Acting
   - 5W1H: Investigative tasks (Who, What, When, Where, Why, How)
   - SCAMPER: Creative/innovation tasks (Substitute, Combine, Adapt, Modify, Put to uses, Eliminate, Reverse)

`;

    const methodologyJudgePrompt = this.getActiveMethodologyJudgePrompt(context);

    const introLines = methodologyJudgePrompt
      ? [
          methodologyJudgePrompt.systemMessage ?? '',
          '',
          '### Methodology-Specific Instructions',
          methodologyJudgePrompt.userMessageTemplate ?? '',
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
      '- Use `@Framework` to set methodology, `::` for gates, and `#id` for response style (e.g., `#analytical`).',
      '- Use `%judge` only for the judge phase; follow-up calls should rely on inline operators.',
    ];

    const responseText = responseLines.filter((line) => line !== undefined).join('\n');

    return {
      content: [{ type: 'text', text: responseText }],
      isError: false,
    };
  }

  /**
   * Build a context header showing operators already specified in the command.
   */
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

  /**
   * Collect all available resources from styles, frameworks, and gates.
   */
  private async collectAllResources(): Promise<ResourceMenu> {
    // Styles come from StyleManager (YAML definitions) - single source of truth
    const styles = await this.loadAllStyles();

    // Frameworks come from methodology definitions (single source of truth)
    const frameworks = await this.collectFrameworkResources();

    // Load gates from gate loader
    const gates = await this.loadAllGates();

    return { styles, frameworks, gates };
  }

  /**
   * Load all styles from StyleManager, converting to ConvertedPrompt format for consistency.
   */
  private async loadAllStyles(): Promise<ConvertedPrompt[]> {
    if (!this.styleManager) {
      // Fallback to prompt-based styles if no StyleManager
      const allPrompts = this.promptsProvider?.() ?? [];
      const guidancePrompts = allPrompts.filter((p) => p.category === 'guidance');
      return guidancePrompts.filter((p) => !this.isFrameworkPromptId(p.id));
    }

    try {
      const styleIds = this.styleManager.listStyles();
      return styleIds.map((id) => {
        const style = this.styleManager!.getStyle(id);
        return {
          id,
          name: style?.name ?? id,
          description: style?.description ?? '',
          category: 'style',
          userMessageTemplate: '',
          arguments: [],
        };
      });
    } catch (error) {
      this.logger.warn('[JudgeSelectionStage] Failed to load styles from StyleManager:', error);
      return [];
    }
  }

  /**
   * Detect framework-marked guidance prompt IDs (legacy; retained for style filtering).
   */
  private isFrameworkPromptId(id: string): boolean {
    const normalized = id.toLowerCase();
    return (
      normalized.includes('cageerf') ||
      normalized.includes('react') ||
      normalized.includes('5w1h') ||
      normalized.includes('scamper')
    );
  }

  /**
   * Build framework resources from methodology definitions to avoid duplicate Markdown prompts.
   */
  private async collectFrameworkResources(): Promise<ConvertedPrompt[]> {
    // Allow injection for testing
    if (this.frameworksProvider) {
      try {
        const provided = await this.frameworksProvider();
        if (Array.isArray(provided)) {
          return provided;
        }
      } catch (error) {
        this.logger.warn(
          '[JudgeSelectionStage] Framework provider failed, falling back to loader',
          {
            error,
          }
        );
      }
    }

    try {
      const loader = getDefaultRuntimeLoader();
      const ids = loader.discoverMethodologies();

      const resources: ConvertedPrompt[] = [];

      for (const id of ids) {
        const definition = loader.loadMethodology(id);
        if (!definition || definition.enabled === false) {
          continue;
        }

        resources.push(this.mapMethodologyToFrameworkResource(definition));
      }

      return resources;
    } catch (error) {
      this.logger.warn('[JudgeSelectionStage] Failed to load methodologies for framework menu', {
        error,
      });
      return [];
    }
  }

  /**
   * Convert methodology definition into a lightweight framework resource for the judge menu.
   */
  private mapMethodologyToFrameworkResource(definition: MethodologyDefinition): ConvertedPrompt {
    const description =
      (definition as any).description ||
      definition.systemPromptGuidance?.trim().split('\n')[0] ||
      'Methodology framework';

    return {
      id: (definition.methodology || definition.id).toLowerCase(),
      name: definition.name || definition.methodology || definition.id,
      description,
      category: 'guidance',
      userMessageTemplate: '',
      arguments: [],
      registerWithMcp: false,
    };
  }

  /**
   * Load all available gate definitions.
   */
  private async loadAllGates(): Promise<LightweightGateDefinition[]> {
    if (!this.gateLoader) {
      return [];
    }

    try {
      return await this.gateLoader.listAvailableGateDefinitions();
    } catch (error) {
      this.logger.warn('[JudgeSelectionStage] Failed to load gates:', error);
      return [];
    }
  }

  /**
   * Format collected resources as a structured menu for Claude.
   * Context-aware: hides framework section if already specified, marks pre-selected gates.
   */
  private formatResourceMenuForClaude(
    resources: ResourceMenu,
    operatorContext: OperatorContext
  ): string {
    const sections: string[] = [];

    // Response Styles section (always shown)
    if (resources.styles.length > 0) {
      sections.push('#### Response Styles');
      sections.push(
        resources.styles.map((r) => `- **${r.id}**: ${r.description || r.name}`).join('\n')
      );
    }

    // Methodology Frameworks section - HIDE if framework already specified via @ operator
    if (!operatorContext.hasFrameworkOperator && resources.frameworks.length > 0) {
      sections.push('\n#### Methodology Frameworks');
      sections.push(
        resources.frameworks.map((r) => `- **${r.id}**: ${r.description || r.name}`).join('\n')
      );
    }

    // Quality Gates section - show pre-selected gates with checkmarks
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
}
