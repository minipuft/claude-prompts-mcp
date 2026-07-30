// @lifecycle canonical - Manages chain executions within the MCP prompt engine.
import { ChainManagementCommand } from './types.js';
import { LightweightGateSystem } from '../../../../engine/gates/core/index.js';
import { ToolResponse } from '../../../../shared/types/index.js';
import { ResponseFormatter } from '../processors/response-formatter.js';

import type { ConvertedPrompt } from '../../../../engine/execution/types.js';
import type {
  ChainSession,
  ChainSessionService,
  ChainSessionRouterPort,
  StateStoreOptions,
} from '../../../../shared/types/index.js';

/**
 * Detects whether an incoming command is a chain management operation.
 */
export function detectChainManagementCommand(command: string): ChainManagementCommand | null {
  if (!command) {
    return null;
  }

  const validActions = ['validate', 'list', 'gates', 'status'];
  const indicators = ['chain', 'chains'];
  const normalized = command.trim().toLowerCase();

  for (const action of validActions) {
    for (const indicator of indicators) {
      const actionPattern = new RegExp(`\\b${action}\\s+${indicator}`, 'i');
      const indicatorPattern = new RegExp(`\\b${indicator}\\s+${action}`, 'i');

      if (actionPattern.test(normalized) || indicatorPattern.test(normalized)) {
        const parts = normalized.split(/\s+/);
        const actionIndex = parts.indexOf(action);
        const indicatorIndex = parts.indexOf(indicator);
        let target = '';

        if (actionIndex < indicatorIndex) {
          target = parts.slice(indicatorIndex + 1).join(' ');
        } else {
          target = parts.slice(actionIndex + 1).join(' ');
        }

        const [targetName, ...paramParts] = target.split(/\s+/);
        const parameters = parseKeyValueParams(paramParts.join(' '));

        return {
          action,
          target: targetName ?? '',
          parameters,
        };
      }
    }
  }

  return null;
}

/**
 * Chain management handler that surfaces session-aware data.
 */
export class ChainSessionRouter implements ChainSessionRouterPort {
  private promptLookup: Map<string, ConvertedPrompt> = new Map();

  constructor(
    initialPrompts: ConvertedPrompt[],
    private readonly sessionManager: ChainSessionService,
    private readonly responseFormatter: ResponseFormatter,
    private readonly gateSystem: LightweightGateSystem
  ) {
    this.updatePrompts(initialPrompts);
  }

  updatePrompts(prompts: ConvertedPrompt[]): void {
    this.promptLookup.clear();
    for (const prompt of prompts) {
      this.promptLookup.set(prompt.id.toLowerCase(), prompt);
      if (prompt.name) {
        this.promptLookup.set(prompt.name.toLowerCase(), prompt);
      }
    }
  }

  async tryHandleCommand(command: string, scope?: StateStoreOptions): Promise<ToolResponse | null> {
    const match = detectChainManagementCommand(command);
    if (!match) {
      return null;
    }

    try {
      switch (match.action) {
        case 'validate':
        case 'status':
          return await this.handleValidate(match.target, match.parameters, scope);
        case 'list':
          return await this.handleList(match.parameters, scope);
        case 'gates':
          return await this.handleGates(match.target, match.parameters, scope);
        default:
          return this.responseFormatter.formatErrorResponse(
            `Unknown chain management action: ${match.action}`
          );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.responseFormatter.formatErrorResponse(
        `Chain management command failed: ${message}`
      );
    }
  }

  private async handleValidate(
    target: string,
    parameters: Record<string, any>,
    scope?: StateStoreOptions
  ): Promise<ToolResponse> {
    const prompt = this.findPrompt(target);
    if (prompt) {
      const steps = prompt.chainSteps ?? [];
      const lines: string[] = [
        `## ✅ Chain Validation: ${prompt.name}`,
        `**Prompt ID**: ${prompt.id}`,
        `**Steps**: ${steps.length}`,
      ];

      if (prompt.description) {
        lines.push(`**Description**: ${prompt.description}`);
      }

      if (steps.length > 0) {
        lines.push('\n**Defined Steps:**');
        steps.forEach((step, index) => {
          lines.push(`- Step ${index + 1}: ${step.stepName || step.promptId} (${step.promptId})`);
        });
      }

      const gateSection = this.buildPromptGateSummary(prompt);
      if (gateSection) {
        lines.push('\n**Gate Configuration:**');
        lines.push(gateSection);
      }

      return this.responseFormatter.formatPromptEngineResponse(lines.join('\n'), undefined, {
        metadata: {
          type: 'chain_validation',
          promptId: prompt.id,
          steps: steps.length,
        },
      });
    }

    const session =
      this.sessionManager.getSessionByChainIdentifier(target, { includeDormant: true, ...scope }) ??
      (target ? this.sessionManager.getSession(target, scope) : undefined);
    if (session) {
      const context = this.sessionManager.getChainContext(session.sessionId, scope);
      const metadata = context['chain_metadata'] as Record<string, any> | undefined;
      const lines: string[] = [
        `## 🔁 Active Chain Run`,
        `**Chain**: ${metadata?.['name'] ?? session.chainId}`,
        `**Chain ID**: ${session.chainId}`,
        `**Resume With**: \`chain_id=${session.chainId}\``,
        `**Progress**: ${session.state.currentStep}/${session.state.totalSteps}`,
        `**Started**: ${new Date(session.startTime).toISOString()}`,
        `**Archive Run ID**: ${session.sessionId} (history only)`,
      ];

      const gates = metadata?.['gates'];
      if (gates && Array.isArray(gates) && gates.length > 0) {
        lines.push(`**Gate IDs**: ${gates.join(', ')}`);
      }

      return this.responseFormatter.formatPromptEngineResponse(lines.join('\n'), undefined, {
        metadata: {
          type: 'chain_session',
          chainId: session.chainId,
          resumeHint: `chain_id=${session.chainId}`,
          archivalRunId: session.sessionId,
        },
      });
    }

    const scopeParam = parameters['scope'];
    const scopeLabel = scopeParam ? ` for "${scopeParam}"` : '';
    return this.responseFormatter.formatErrorResponse(
      `Chain "${target || '<unspecified>'}" not found${scopeLabel}.`
    );
  }

  private async handleList(
    parameters: Record<string, any>,
    scope?: StateStoreOptions
  ): Promise<ToolResponse> {
    const limitParam = parameters['limit'];
    const limit = limitParam ? Number(limitParam) : 20;
    const activeSessions = this.sessionManager.listActiveSessions(limit, scope);

    if (activeSessions.length === 0) {
      return this.responseFormatter.formatPromptEngineResponse(
        'No active chain sessions detected.',
        undefined,
        { metadata: { type: 'chain_list', count: 0 } }
      );
    }

    const lines: string[] = ['## 📋 Active Chain Sessions'];
    activeSessions.forEach((summary) => {
      lines.push(
        `- **${summary.chainId}** → resume with \`chain_id=${summary.chainId}\` (archive run ${summary.sessionId})` +
          ` — Step ${summary.currentStep}/${summary.totalSteps}` +
          `${summary.pendingReview ? ' — pending gate review' : ''}`
      );
    });

    return this.responseFormatter.formatPromptEngineResponse(lines.join('\n'), undefined, {
      metadata: { type: 'chain_list', count: activeSessions.length },
    });
  }

  private async handleGates(
    target: string,
    _parameters: Record<string, any>,
    scope?: StateStoreOptions
  ): Promise<ToolResponse> {
    const prompt = this.findPrompt(target);
    const session =
      this.sessionManager.getSessionByChainIdentifier(target, { includeDormant: true, ...scope }) ??
      (target ? this.sessionManager.getSession(target, scope) : undefined);

    if (!prompt && !session) {
      return this.responseFormatter.formatErrorResponse(
        `No chain prompt or session found for "${target}".`
      );
    }

    const sections: string[] = ['## 🔒 Chain Gate Overview'];
    if (prompt) {
      sections.push(`### Prompt: ${prompt.name}`);
      const promptGateSection = this.buildPromptGateSummary(prompt);
      sections.push(promptGateSection ?? 'No prompt-level gates configured.');
    }

    if (session) {
      sections.push(`### Chain Run: ${session.chainId}`);
      sections.push(`Resume with \`chain_id=${session.chainId}\``);
      sections.push(this.buildSessionGateSummary(session, scope));
    }

    return this.responseFormatter.formatPromptEngineResponse(sections.join('\n\n'), undefined, {
      metadata: {
        type: 'chain_gates',
        target: target || prompt?.id || session?.chainId,
        resumeHint: session?.chainId ? `chain_id=${session.chainId}` : undefined,
        archivalRunId: session?.sessionId,
      },
    });
  }

  private findPrompt(identifier: string): ConvertedPrompt | undefined {
    if (!identifier) {
      return undefined;
    }
    return this.promptLookup.get(identifier.toLowerCase());
  }

  private buildPromptGateSummary(prompt: ConvertedPrompt): string | null {
    // `gateConfiguration` is the single source for a prompt's gate config — see ADR 0001.
    const gateConfig = prompt.gateConfiguration;

    if (!gateConfig) {
      return null;
    }

    const lines: string[] = [];

    const include = gateConfig.include;
    if (include && include.length > 0) {
      lines.push(`- Included Gates: ${include.join(', ')}`);
    }

    const exclude = gateConfig.exclude;
    if (exclude && exclude.length > 0) {
      lines.push(`- Excluded Gates: ${exclude.join(', ')}`);
    }

    const inlineDefinitions = gateConfig.inline_gate_definitions;
    if (inlineDefinitions && inlineDefinitions.length > 0) {
      lines.push(
        `- Inline Gate Definitions: ${inlineDefinitions.map((gate) => gate.name).join(', ')}`
      );
    }

    const frameworkGates = gateConfig.framework_gates ?? true;
    if (frameworkGates === false) {
      lines.push('- Framework Gates: disabled');
    }

    return lines.length > 0 ? lines.join('\n') : null;
  }

  private buildSessionGateSummary(session: ChainSession, scope?: StateStoreOptions): string {
    const inlineIds = this.sessionManager.getInlineGateIds(session.sessionId, scope) ?? [];
    const registry = this.gateSystem.getTemporaryGateRegistry?.();
    const tempGates = registry ? registry.getTemporaryGatesForScope('chain', session.chainId) : [];

    const lines: string[] = [
      `- Inline Gates: ${inlineIds.length ? inlineIds.join(', ') : 'none'}`,
      `- Chain-Scoped Temporary Gates: ${
        tempGates.length ? tempGates.map((gate) => gate.name).join(', ') : 'none'
      }`,
    ];

    if (session.pendingGateReview) {
      lines.push(
        `- Pending Gate Review: ${session.pendingGateReview.gateIds?.join(', ') || 'unspecified'}`
      );
    }

    return lines.join('\n');
  }
}

function parseKeyValueParams(paramString: string): Record<string, any> {
  const params: Record<string, any> = {};
  if (!paramString || paramString.trim() === '') {
    return params;
  }

  const keyValuePattern = /(\w+)[:=]([^\s]+)/g;
  let match;

  while ((match = keyValuePattern.exec(paramString)) !== null) {
    const [, key, value] = match;
    if (key === undefined || value === undefined) {
      continue;
    }

    if (value.toLowerCase() === 'true') {
      params[key] = true;
    } else if (value.toLowerCase() === 'false') {
      params[key] = false;
    } else if (!isNaN(Number(value))) {
      params[key] = Number(value);
    } else {
      params[key] = value;
    }
  }

  return params;
}
