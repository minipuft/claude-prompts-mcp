// @lifecycle canonical - Prompt discovery and analysis operations.

import { promptResourceMetadata } from '../../../../metadata/definitions/prompt-resource.js';
import { GateAnalyzer } from '../analysis/gate-analyzer.js';
import { PromptAnalyzer } from '../analysis/prompt-analyzer.js';
import { PromptResourceContext } from '../core/context.js';
import { FilterParser } from '../search/filter-parser.js';
import { PromptMatcher } from '../search/prompt-matcher.js';
import {
  canonicalPromptSnapshot,
  validateChainStepReferences,
  validateRequiredFields,
} from '../utils/validation.js';

import type { PromptResourceActionId } from '../../../../metadata/definitions/prompt-resource.js';

import { ToolResponse } from '#shared/types/index.js';

const PROMPT_RESOURCE_ACTIONS = promptResourceMetadata.data.actions;

const GOAL_KEYWORDS: Array<{ keywords: RegExp; actions: PromptResourceActionId[] }> = [
  { keywords: /gate|quality|review/i, actions: ['analyze_gates', 'update'] },
  { keywords: /create|add|new/i, actions: ['create'] },
  { keywords: /list|discover|catalog|show/i, actions: ['list'] },
  { keywords: /modify|edit|section/i, actions: ['update'] },
  { keywords: /delete|remove/i, actions: ['delete'] },
  { keywords: /reload|refresh/i, actions: ['reload'] },
];

export class PromptDiscoveryProcessor {
  private readonly context: PromptResourceContext;
  private readonly promptAnalyzer: PromptAnalyzer;
  private readonly gateAnalyzer: GateAnalyzer;
  private readonly filterParser: FilterParser;
  private readonly promptMatcher: PromptMatcher;

  constructor(context: PromptResourceContext) {
    this.context = context;
    this.promptAnalyzer = context.promptAnalyzer;
    this.gateAnalyzer = context.gateAnalyzer;
    this.filterParser = context.filterParser;
    this.promptMatcher = context.promptMatcher;
  }

  async listPrompts(args: any): Promise<ToolResponse> {
    this.context.dependencies.logger.debug(
      `[PromptResource] List prompts called with search_query: "${args.search_query || ''}"`
    );
    const filters = this.filterParser.parseIntelligentFilters(args.search_query || '');
    this.context.dependencies.logger.debug('[PromptResource] Parsed filters', filters);
    const matchingPrompts: Array<{
      prompt: any;
      classification: any;
    }> = [];

    this.context.dependencies.logger.debug(
      `[PromptResource] Processing ${this.getConvertedPrompts().length} prompts`
    );
    for (const prompt of this.getConvertedPrompts()) {
      try {
        const classification = await this.promptAnalyzer.analyzePrompt(prompt);
        this.context.dependencies.logger.debug(
          `[PromptResource] Analyzing prompt ${prompt.id}, type: ${classification.executionType}`
        );

        const matches = await this.promptMatcher.matchesFilters(prompt, filters, classification);
        this.context.dependencies.logger.debug(
          `[PromptResource] Prompt ${prompt.id} matches filters: ${matches}`
        );
        if (matches) {
          matchingPrompts.push({ prompt, classification });
        }
      } catch (error) {
        this.context.dependencies.logger.warn(`Failed to analyze prompt ${prompt.id}:`, error);
      }
    }

    matchingPrompts.sort((a, b) => {
      const scoreA = this.promptMatcher.calculateRelevanceScore(
        a.prompt,
        a.classification,
        filters
      );
      const scoreB = this.promptMatcher.calculateRelevanceScore(
        b.prompt,
        b.classification,
        filters
      );
      return scoreB - scoreA;
    });

    if (matchingPrompts.length === 0) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `📭 No prompts found matching filter: "${args.search_query || 'all'}"\n\n💡 Try broader search terms or use filters like 'type:template', 'category:analysis'`,
          },
        ],
        isError: false,
      };
    }

    const groupedByCategory = matchingPrompts.reduce(
      (acc, item) => {
        const category = item.prompt.category || 'uncategorized';
        if (!acc[category]) acc[category] = [];
        acc[category].push(item);
        return acc;
      },
      {} as Record<string, typeof matchingPrompts>
    );

    const detailLevel = args.detail ?? 'summary';
    let result: string;

    if (detailLevel === 'summary') {
      result = `📚 **Prompts** (${matchingPrompts.length})\n`;

      for (const [category, prompts] of Object.entries(groupedByCategory)) {
        const ids = prompts.map(({ prompt }) => prompt.id).join(', ');
        result += `\n**${category}**: ${ids}`;
      }

      result += `\n\n_Use \`detail:"full"\` for complete details, or \`>>id\` to execute._`;
    } else {
      // Full detail mode - show complete prompt information
      result = `📚 **Prompt Library** (${matchingPrompts.length} prompts)\n`;

      for (const [category, prompts] of Object.entries(groupedByCategory)) {
        result += `\n---\n## 📁 ${category.toUpperCase()}\n`;

        for (const { prompt, classification } of prompts) {
          const executionIcon = this.getExecutionTypeIcon(classification.executionType);
          const frameworkIcon = classification.requiresFramework ? '🧠' : '⚡';

          result += `\n### ${executionIcon} ${prompt.name} \`${prompt.id}\`\n`;
          result += `${frameworkIcon} **Type**: ${classification.executionType}`;
          if (classification.requiresFramework) {
            result += ` (framework recommended)`;
          }
          result += `\n`;

          // Full description (no truncation)
          if (prompt.description) {
            result += `\n**Description**: ${prompt.description}\n`;
          }

          // Full arguments with types and descriptions
          if (prompt.arguments?.length > 0) {
            result += `\n**Arguments**:\n`;
            for (const arg of prompt.arguments) {
              const requiredMark = arg.required ? ' *(required)*' : '';
              const typeMark = arg.type ? ` \`${arg.type}\`` : '';
              result += `- \`${arg.name}\`${typeMark}${requiredMark}`;
              if (arg.description) {
                result += `: ${arg.description}`;
              }
              result += `\n`;
            }
          }

          // Instruction bodies are DELIBERATELY not listed here. A catalogue call names no
          // prompt, so returning every prompt's `systemMessage` served two things badly:
          //
          //  - exposure: one listing call handed over the whole instruction surface of every
          //    installed prompt, including any that arrived in a third-party pack;
          //  - correctness: a `systemMessage` is not a description. Measured 2026-08-25, 10 of
          //    11 shipped ones are second-person instruction ("You are a creative director…"),
          //    so a catalogue returned a pile of competing role assignments the model is not
          //    executing. That is role ambiguity, not information.
          //
          // `inspect` with `detail:"full"` still returns both bodies, because there the caller
          // has named the one prompt they want. Nothing became unreachable; it now takes asking.
          // The pointer names `detail:"full"` explicitly -- a bare `inspect` returns metadata
          // only, so omitting it would send the reader to a call that does not answer them.
          const bodies: string[] = [];
          if (prompt.systemMessage) bodies.push('system message');
          if (prompt.userMessageTemplate) bodies.push('user message template');
          if (bodies.length > 0) {
            result +=
              `\n**Content**: ${bodies.join(' + ')} — ` +
              `\`action:"inspect", id:"${prompt.id}", detail:"full"\`\n`;
          }

          // Chain steps (full details)
          if (prompt.chainSteps?.length > 0) {
            result += `\n**Chain Steps** (${prompt.chainSteps.length}):\n`;
            for (let i = 0; i < prompt.chainSteps.length; i++) {
              const step = prompt.chainSteps[i];
              result += `${i + 1}. \`${step.promptId || step.id || 'step-' + (i + 1)}\``;
              if (step.stepName || step.name) {
                result += ` - ${step.stepName || step.name}`;
              }
              if (step.description) {
                result += `\n   ${step.description}`;
              }
              result += `\n`;
            }
          }

          // Gate configuration
          if (prompt.gateConfiguration) {
            result += `\n**Gate Configuration**:\n`;
            if (prompt.gateConfiguration.include?.length > 0) {
              result += `- Include: ${prompt.gateConfiguration.include.join(', ')}\n`;
            }
            if (prompt.gateConfiguration.exclude?.length > 0) {
              result += `- Exclude: ${prompt.gateConfiguration.exclude.join(', ')}\n`;
            }
            if (prompt.gateConfiguration.framework_gates !== undefined) {
              result += `- Framework gates: ${prompt.gateConfiguration.framework_gates}\n`;
            }
          }
        }
      }

      if (args.filter || args.search_query) {
        const filterDescriptions = this.filterParser.buildFilterDescription(filters);
        if (filterDescriptions.length > 0) {
          result += `\n---\n🔍 **Applied Filters**:\n`;
          filterDescriptions.forEach((desc) => {
            result += `- ${desc}\n`;
          });
        }
      }
    }

    return {
      content: [{ type: 'text' as const, text: result }],
      isError: false,
    };
  }

  async analyzePromptType(args: any): Promise<ToolResponse> {
    validateRequiredFields(args, ['id']);
    const prompt = this.getConvertedPrompts().find((p) => p.id === args.id);
    if (!prompt) {
      return {
        content: [{ type: 'text' as const, text: `Prompt not found: ${args.id}` }],
        isError: true,
      };
    }

    const analysis = await this.promptAnalyzer.analyzePrompt(prompt);

    let recommendation = `🔍 **Prompt Type Analysis**: ${prompt.name}\n\n`;
    recommendation += `📊 **Normalized Execution Type**: ${analysis.executionType}\n`;
    recommendation += `🧠 **Framework Recommended**: ${analysis.requiresFramework ? 'Yes' : 'No'}\n\n`;

    recommendation += `📋 **Analysis Details**:\n`;
    analysis.reasoning.forEach((reason, i) => {
      recommendation += `${i + 1}. ${reason}\n`;
    });

    recommendation += `\n🔄 **Recommendations**:\n`;
    recommendation += `✅ **Well-aligned**: Current execution type matches content appropriately\n`;

    if (analysis.suggestedGates.length > 0) {
      recommendation += `\n🔒 **Suggested Quality Gates**: ${analysis.suggestedGates.join(', ')}\n`;
    }

    return {
      content: [{ type: 'text' as const, text: recommendation }],
      isError: false,
    };
  }

  async inspectPrompt(args: any): Promise<ToolResponse> {
    validateRequiredFields(args, ['id']);
    const prompt = this.getConvertedPrompts().find((p) => p.id === args.id);
    if (!prompt) {
      return {
        content: [{ type: 'text' as const, text: `Prompt not found: ${args.id}` }],
        isError: true,
      };
    }

    const classification = await this.promptAnalyzer.analyzePrompt(prompt);
    const history = await this.context.versionHistoryService.loadHistory('prompt', prompt.id);
    const currentVersion = history?.current_version ?? 0;
    const gateConfig = prompt.gateConfiguration;
    const { detail } = args as { detail?: string };
    const isFull = detail === 'full';

    let response = `🔍 **Prompt Inspect**: ${prompt.name} (\`${prompt.id}\`)\n\n`;
    response += `⚡ **Type**: ${classification.executionType}\n`;
    response += `🧠 **Requires Framework**: ${classification.requiresFramework ? 'Yes' : 'No'}\n`;
    response += `📜 **Current Version**: ${currentVersion}\n`;
    if (prompt.description) {
      response += `📝 **Description**: ${prompt.description}\n`;
    }

    if (isFull) {
      // Full arguments with types and descriptions
      if (prompt.arguments.length > 0) {
        response += `\n**Arguments**:\n`;
        for (const arg of prompt.arguments) {
          const requiredMark = arg.required === true ? ' *(required)*' : '';
          const typeMark = arg.type !== undefined ? ` \`${arg.type}\`` : '';
          response += `- \`${arg.name}\`${typeMark}${requiredMark}`;
          if (arg.description !== undefined && arg.description !== '') {
            response += `: ${arg.description}`;
          }
          response += `\n`;
        }
      }

      // System message (full content)
      if (prompt.systemMessage !== undefined && prompt.systemMessage !== '') {
        response += `\n**System Message**:\n\`\`\`\n${prompt.systemMessage}\n\`\`\`\n`;
      }

      // User message template (full content)
      if (prompt.userMessageTemplate !== '') {
        response += `\n**User Message Template**:\n\`\`\`\n${prompt.userMessageTemplate}\n\`\`\`\n`;
      }

      // Chain steps (full details) + integrity check
      const steps = prompt.chainSteps;
      if (steps != null && steps.length > 0) {
        response += `\n**Chain Steps** (${steps.length}):\n`;
        steps.forEach((step, i) => {
          const stepId = step.promptId !== '' ? step.promptId : 'step-' + String(i + 1);
          response += `${i + 1}. \`${stepId}\``;
          if (step.stepName !== '') {
            response += ` - ${step.stepName}`;
          }
          response += `\n`;
        });

        const allPromptIds = this.getConvertedPrompts().map((p) => p.id);
        const refValidation = validateChainStepReferences(steps, allPromptIds);
        if (!refValidation.valid) {
          response += `\n**Chain Integrity**:\n`;
          for (const warning of refValidation.warnings) {
            response += `- ${warning}\n`;
          }
        }
      }

      // Gate configuration
      if (gateConfig != null) {
        response += `\n**Gate Configuration**:\n`;
        const incl = gateConfig.include;
        const excl = gateConfig.exclude;
        if (incl != null && incl.length > 0) {
          response += `- Include: ${incl.join(', ')}\n`;
        }
        if (excl != null && excl.length > 0) {
          response += `- Exclude: ${excl.join(', ')}\n`;
        }
        if (gateConfig.framework_gates !== undefined) {
          response += `- Framework gates: ${String(gateConfig.framework_gates)}\n`;
        }
        const inlineGates = gateConfig.inline_gate_definitions;
        if (Array.isArray(inlineGates) && inlineGates.length > 0) {
          response += `- Inline gates (${inlineGates.length}):\n`;
          for (const gate of inlineGates) {
            response += `  - **${gate.name}** (${gate.type}): ${gate.description ?? ''}\n`;
          }
        }
      }
    } else {
      // Summary mode
      if (prompt.arguments?.length) {
        response += `🔧 **Arguments**: ${prompt.arguments.map((arg: any) => arg.name).join(', ')}\n`;
      }
      if (prompt.chainSteps?.length) {
        response += `🔗 **Chain Steps**: ${prompt.chainSteps.length}\n`;
      }
      if (gateConfig) {
        response += `🛡️ **Gates**: ${JSON.stringify(gateConfig)}\n`;
      }
    }

    return {
      content: [{ type: 'text' as const, text: response }],
      structuredContent: {
        action: 'inspect',
        resource_type: 'prompt',
        id: prompt.id,
        current_version: currentVersion,
        prompt: canonicalPromptSnapshot(prompt.id, prompt),
        config_path: this.context.dependencies.configManager.getConfigPath(),
        server_root: this.context.dependencies.configManager.getServerRoot(),
        resource_root: this.context.dependencies.configManager.getResolvedPromptsDirectory(),
      },
      isError: false,
    };
  }

  async analyzePromptGates(args: any): Promise<ToolResponse> {
    validateRequiredFields(args, ['id']);
    const prompt = this.getConvertedPrompts().find((p) => p.id === args.id);
    if (!prompt) {
      return {
        content: [{ type: 'text' as const, text: `Prompt not found: ${args.id}` }],
        isError: true,
      };
    }

    const analysis = await this.gateAnalyzer.analyzePromptForGates(prompt);
    const totalGatesCount =
      analysis.recommendedGates.length + analysis.suggestedTemporaryGates.length;

    let response = `Gate Analysis: ${prompt.name}\n\n`;

    if (totalGatesCount > 0) {
      response += `Recommended Gates (${totalGatesCount} total):\n`;
      analysis.recommendedGates.forEach((gate) => {
        response += `• ${gate}\n`;
      });
      analysis.suggestedTemporaryGates.forEach((gate) => {
        response += `• ${gate.name} (temporary, ${gate.scope} scope)\n`;
      });
      response += `\n`;
    } else {
      response += `No specific gate recommendations for this prompt.\n\n`;
    }

    response += `Gate Configuration:\n`;
    response += `\`\`\`json\n${JSON.stringify(analysis.gateConfigurationPreview, null, 2)}\n\`\`\`\n`;

    return { content: [{ type: 'text' as const, text: response }], isError: false };
  }

  async guidePromptActions(args: any): Promise<ToolResponse> {
    const goal = typeof args.goal === 'string' ? args.goal.trim() : '';
    const includeLegacy = args.include_legacy === true;
    const rankedActions = this.rankActionsForGuide(goal, includeLegacy);
    const recommended = rankedActions.slice(0, Math.min(4, rankedActions.length));
    const quickReference = rankedActions.slice(0, Math.min(8, rankedActions.length));
    const highRisk = PROMPT_RESOURCE_ACTIONS.filter(
      (action) => action.status !== 'working' && action.id !== 'guide'
    );

    const sections: string[] = [];
    sections.push('🧭 **Prompt Resource Guide**');
    sections.push(
      goal
        ? `🎯 **Goal**: ${goal}`
        : '🎯 **Goal**: Provide authoring/lifecycle assistance using canonical actions.'
    );

    if (recommended.length > 0) {
      sections.push('### Recommended Actions');
      recommended.forEach((action) => {
        sections.push(this.formatActionSummary(action));
      });
    }

    if (quickReference.length > 0) {
      sections.push('### Quick Reference');
      quickReference.forEach((action) => {
        const argsText = action.requiredArgs.length > 0 ? action.requiredArgs.join(', ') : 'None';
        sections.push(
          `- \`${action.id}\` (${this.describeActionStatus(action)}) — Required: ${argsText}`
        );
      });
    }

    if (highRisk.length > 0 && !includeLegacy) {
      sections.push('### Heads-Up (Advanced or Unstable Actions)');
      highRisk.slice(0, 3).forEach((action) => {
        const issueText =
          action.issues && action.issues.length > 0
            ? `Issues: ${action.issues.map((issue) => issue.summary).join(', ')}`
            : 'Advanced workflow.';
        sections.push(`- \`${action.id}\`: ${issueText}`);
      });
      sections.push('Set `include_legacy:true` to see full details on advanced actions.');
    }

    sections.push(
      '💡 Use `resource_manager(resource_type:"prompt", action:"<id>", ...)` with the required arguments above.'
    );

    return {
      content: [{ type: 'text' as const, text: sections.join('\n\n') }],
      isError: false,
    };
  }

  private rankActionsForGuide(goal: string, includeLegacy: boolean) {
    const normalizedGoal = goal.toLowerCase();
    const candidates = PROMPT_RESOURCE_ACTIONS.filter(
      (action) =>
        action.id !== 'guide' &&
        (includeLegacy || action.status === 'working' || action.id === 'list')
    );

    const scored = candidates.map((action) => ({
      action,
      score: this.computeGuideScore(action, normalizedGoal),
    }));

    return scored.sort((a, b) => b.score - a.score).map((entry) => entry.action);
  }

  private computeGuideScore(action: any, normalizedGoal: string): number {
    let score = action.status === 'working' ? 5 : 2;
    if (!normalizedGoal) {
      if (action.category === 'lifecycle') {
        score += 1;
      }
      if (action.id === 'list') {
        score += 1;
      }
      return score;
    }

    if (action.description.toLowerCase().includes(normalizedGoal)) {
      score += 3;
    }

    if (normalizedGoal.includes(action.id.replace(/_/g, ' '))) {
      score += 2;
    }

    for (const matcher of GOAL_KEYWORDS) {
      if (
        matcher.keywords.test(normalizedGoal) &&
        matcher.actions.includes(action.id as PromptResourceActionId)
      ) {
        score += 6;
      }
    }

    return score;
  }

  private formatActionSummary(action: any): string {
    const argsText = action.requiredArgs.length > 0 ? action.requiredArgs.join(', ') : 'None';
    const status = this.describeActionStatus(action);
    let summary = `- \`${action.id}\` (${status}) — ${action.description}\n  Required: ${argsText}`;
    if (action.issues && action.issues.length > 0) {
      const issueList = action.issues
        .map((issue: any) => `${issue.severity === 'high' ? '❗' : '⚠️'} ${issue.summary}`)
        .join(' • ');
      summary += `\n  Issues: ${issueList}`;
    }
    return summary;
  }

  private describeActionStatus(action: any): string {
    switch (action.status) {
      case 'working':
        return '✅ Working';
      case 'planned':
        return '🗺️ Planned';
      case 'untested':
        return '🧪 Untested';
      case 'deprecated':
        return '🛑 Deprecated';
      default:
        return `⚠️ ${action.status}`;
    }
  }

  private getExecutionTypeIcon(executionType: string): string {
    return executionType === 'chain' ? '🔗' : '⚡';
  }

  private getConvertedPrompts() {
    return this.context.getData().convertedPrompts;
  }
}
