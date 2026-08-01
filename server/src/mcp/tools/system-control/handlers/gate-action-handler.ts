// @lifecycle canonical - Handler for gate system operations.

import { ActionHandler } from '../core/action-handler-base.js';

import type { ToolResponse } from '#shared/types/index.js';

export class GateActionHandler extends ActionHandler {
  async execute(args: any): Promise<ToolResponse> {
    const operation = args.operation || 'status';

    switch (operation) {
      case 'enable':
        return await this.enableGateSystem({
          reason: args.reason,
          persist: args.persist,
        });
      case 'disable':
        return await this.disableGateSystem({
          reason: args.reason,
          persist: args.persist,
        });
      case 'status':
        return await this.getGateSystemStatus();
      case 'health':
        return await this.getGateSystemHealth();
      case 'list':
        return await this.listAvailableGates(args.search_query);
      default:
        throw new Error(
          `Unknown gates operation: ${operation}. Valid operations: enable, disable, status, health, list`
        );
    }
  }

  private async enableGateSystem(args: {
    reason?: string;
    persist?: boolean;
  }): Promise<ToolResponse> {
    if (!this.gateStateStore) {
      throw new Error('Gate system manager not initialized');
    }

    const currentState = this.gateStateStore.getCurrentState(this.requestScope);
    if (currentState.enabled) {
      return this.createMinimalSystemResponse(
        `ℹ️ Gate system is already enabled.`,
        'enable_gate_system'
      );
    }

    await this.gateStateStore.enableGateSystem(
      args.reason || 'User requested to enable gate system',
      this.requestScope
    );

    const persistenceNotes: string[] = [];
    if (args.persist) {
      const note = await this.context.persistGateConfig(true);
      if (note) persistenceNotes.push(note);
    }

    const response =
      `✅ **Gate System Enabled**\n\n` +
      `**Reason**: ${args.reason || 'User requested to enable gate system'}\n` +
      `**Status**: Gate system is now active\n` +
      `**Validation**: Quality gates will now be applied to prompt executions\n\n` +
      `🔍 All template and chain executions will now include gate validation and guidance.` +
      (persistenceNotes.length ? `\n\n${persistenceNotes.join('\n')}` : '');

    return this.createMinimalSystemResponse(response, 'enable_gate_system');
  }

  private async disableGateSystem(args: {
    reason?: string;
    persist?: boolean;
  }): Promise<ToolResponse> {
    if (!this.gateStateStore) {
      throw new Error('Gate system manager not initialized');
    }

    const currentState = this.gateStateStore.getCurrentState(this.requestScope);
    if (!currentState.enabled) {
      return this.createMinimalSystemResponse(
        `ℹ️ Gate system is already disabled.`,
        'disable_gate_system'
      );
    }

    await this.gateStateStore.disableGateSystem(
      args.reason || 'User requested to disable gate system',
      this.requestScope
    );

    const persistenceNotes: string[] = [];
    if (args.persist) {
      const note = await this.context.persistGateConfig(false);
      if (note) persistenceNotes.push(note);
    }

    const response =
      `⚠️ **Gate System Disabled**\n\n` +
      `**Reason**: ${args.reason || 'User requested to disable gate system'}\n` +
      `**Status**: Gate system is now inactive\n` +
      `**Impact**: Gate validation and guidance will be skipped\n\n` +
      `📝 Prompt executions will now skip quality gate validation.` +
      (persistenceNotes.length ? `\n\n${persistenceNotes.join('\n')}` : '');

    return this.createMinimalSystemResponse(response, 'disable_gate_system');
  }

  private async getGateSystemStatus(): Promise<ToolResponse> {
    if (!this.gateStateStore) {
      return this.createMinimalSystemResponse(
        `❌ Gate system manager not available.`,
        'gate_system_status'
      );
    }

    const currentState = this.gateStateStore.getCurrentState(this.requestScope);
    const health = this.gateStateStore.getSystemHealth(this.requestScope);

    let response = `🚪 **Gate System Status**\n\n`;
    response += `**System State**: ${currentState.enabled ? 'Enabled' : 'Disabled'}\n`;
    response += `**Health Status**: ${health.status}\n`;
    response += `**Total Validations**: ${health.totalValidations}\n`;
    response += `**Success Rate**: ${health.successRate}%\n`;
    response += `**Average Validation Time**: ${health.averageValidationTime}ms\n`;

    if (health.lastValidationTime) {
      response += `**Last Validation**: ${health.lastValidationTime.toISOString()}\n`;
    }

    if (health.issues.length > 0) {
      response += `\n⚠️ **Issues**:\n`;
      health.issues.forEach((issue) => {
        response += `- ${issue}\n`;
      });
    }

    response += `\n🔧 Control gates using: action="gates", operation="enable/disable"`;

    return this.createMinimalSystemResponse(response, 'gate_system_status');
  }

  private async getGateSystemHealth(): Promise<ToolResponse> {
    if (!this.gateStateStore) {
      return this.createMinimalSystemResponse(
        `❌ Gate system manager not available.`,
        'gate_system_health'
      );
    }

    const health = this.gateStateStore.getSystemHealth(this.requestScope);

    let response = `🏥 **Gate System Health Report**\n\n`;

    const statusIcon =
      health.status === 'healthy' ? '✅' : health.status === 'degraded' ? '⚠️' : '❌';
    response += `**Overall Status**: ${statusIcon} ${health.status.toUpperCase()}\n\n`;

    response += `**Performance Metrics**:\n`;
    response += `- Enabled: ${health.enabled ? 'Yes' : 'No'}\n`;
    response += `- Total Validations: ${health.totalValidations}\n`;
    response += `- Success Rate: ${health.successRate}%\n`;
    response += `- Average Validation Time: ${health.averageValidationTime}ms\n`;

    if (health.lastValidationTime) {
      response += `- Last Validation: ${health.lastValidationTime.toISOString()}\n`;
    }

    if (health.status === 'healthy') {
      response += '\n✅ System is performing optimally. No action required.\n';
    } else if (health.status === 'degraded') {
      response += '\n⚠️ System performance is degraded. Monitor closely.\n';
      if (health.issues.length > 0) {
        response += '\n**Issues Detected**:\n';
        health.issues.forEach((issue) => {
          response += `- ${issue}\n`;
        });
      }
    } else if (health.status === 'disabled') {
      response += '\n🚫 Gate system is currently disabled.\n';
      response += "Enable using: `action='gates', operation='enable'`\n";
    }

    return this.createMinimalSystemResponse(response, 'gate_system_health');
  }

  private async listAvailableGates(searchQuery?: string): Promise<ToolResponse> {
    const gateGuidanceRenderer = this.context.gateGuidanceRenderer;
    const gateDefinitions = (await gateGuidanceRenderer?.getAvailableGateDefinitions()) || [];

    const filteredGates = searchQuery
      ? gateDefinitions.filter(
          (gate) =>
            gate.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
            gate.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (gate.description?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false)
        )
      : gateDefinitions;

    if (filteredGates.length === 0) {
      const noResultsMsg = searchQuery
        ? `No gates found matching "${searchQuery}". Try: \`>>gates\` to list all.`
        : 'No quality gates discovered. Ensure gate configuration is available.';

      return this.createMinimalSystemResponse(
        `📋 **Available Quality Gates**\n\n${noResultsMsg}`,
        'gate_list'
      );
    }

    const lines: string[] = ['📋 **Available Quality Gates**', ''];

    if (searchQuery) {
      lines.push(`🔍 Filtered by: "${searchQuery}"`, '');
    }

    for (const gate of filteredGates) {
      lines.push(`### ${gate.name}`);
      lines.push(`**ID**: \`${gate.id}\``);
      if (gate.description) {
        lines.push(`${gate.description}`);
      }
      lines.push('');
    }

    lines.push('---', '');
    lines.push('**Usage Syntax**:', '');
    lines.push('```');
    lines.push(`:: ${filteredGates[0]?.id || 'gate-id'}              # Use canonical gate`);
    lines.push(`:: security:"validate inputs"   # Named inline gate`);
    lines.push(`:: "custom criteria"            # Anonymous inline gate`);
    lines.push('```');
    lines.push('');
    lines.push(
      `**Total Gates**: ${filteredGates.length}${searchQuery ? ` (filtered from ${gateDefinitions.length})` : ''}`
    );

    return this.createMinimalSystemResponse(lines.join('\n'), 'gate_list');
  }
}
