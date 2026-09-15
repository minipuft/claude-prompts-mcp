// @lifecycle canonical - Gate read-only operations: list, inspect.

import type { ToolResponse } from '#shared/types/index.js';
import type { GateResourceContext } from '../core/context.js';
import type { GateManagerInput } from '../core/types.js';

export class GateDiscoveryProcessor {
  constructor(private readonly ctx: GateResourceContext) {}

  async handleList(args: GateManagerInput): Promise<ToolResponse> {
    const { enabled_only = true } = args;

    const gates = this.ctx.gateManager.list(enabled_only);
    const stats = this.ctx.gateManager.getStats();

    if (gates.length === 0) {
      return this.success(
        `📋 No gates found${enabled_only ? ' (enabled only)' : ''}\n\n` +
          `Use resource_manager(resource_type:"gate", action:"create", ...) to add a new gate.`
      );
    }

    const gateList = gates
      .map((gate) => {
        const typeIcon = gate.type === 'validation' ? '✓' : '📖';
        return `  ${typeIcon} ${gate.gateId}: ${gate.name}`;
      })
      .join('\n');

    return this.success(
      `📋 Gates (${gates.length} total)\n\n` +
        `${gateList}\n\n` +
        `📊 Registry Stats:\n` +
        `  - Total gates: ${stats.totalGates}\n` +
        `  - Enabled: ${stats.enabledGates}\n` +
        `  - Disabled: ${stats.totalGates - stats.enabledGates}`
    );
  }

  async handleInspect(args: GateManagerInput): Promise<ToolResponse> {
    const { id } = args;

    if (!id) {
      return this.error('Gate ID is required for inspect action');
    }

    const gate = this.ctx.gateManager.get(id);
    if (!gate) {
      return this.error(`Gate '${id}' not found`);
    }

    const typeIcon = gate.type === 'validation' ? '✓' : '📖';
    const guidance = gate.getGuidance();
    const guidancePreview = guidance.length > 500 ? guidance.substring(0, 500) + '...' : guidance;

    // Inspect shows the EFFECTIVE severity — the value the engine acts on. Defaults are applied
    // at load, so every definition carries one and there is no omitted case to render around.
    // `enforcementMode` has no schema default, so it is still absent unless the author set it.
    const definition = gate.getDefinition();
    const severityLine = `\n  - Severity: ${definition.severity}`;
    const enforcementModeLine =
      definition.enforcementMode !== undefined
        ? `\n  - Enforcement Mode: ${definition.enforcementMode}`
        : '';

    return this.success(
      `🚦 Gate: ${gate.name}\n\n` +
        `📋 Details:\n` +
        `  - ID: ${gate.gateId}\n` +
        `  - Type: ${typeIcon} ${gate.type}\n` +
        `  - Description: ${gate.description}` +
        `${severityLine}${enforcementModeLine}\n\n` +
        `📝 Guidance:\n${guidancePreview}`
    );
  }

  private success(text: string): ToolResponse {
    return { content: [{ type: 'text', text }], isError: false };
  }

  private error(text: string): ToolResponse {
    return { content: [{ type: 'text', text: `❌ ${text}` }], isError: true };
  }
}
