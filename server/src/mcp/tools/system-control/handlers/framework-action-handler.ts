// @lifecycle canonical - Handler for framework management operations.

import { getDefaultRuntimeLoader } from '../../../../engine/frameworks/methodology/index.js';
import { ActionHandler } from '../core/action-handler-base.js';

import type { ToolResponse } from '../../../../shared/types/index.js';

export class FrameworkActionHandler extends ActionHandler {
  async execute(args: any): Promise<ToolResponse> {
    const operation = args.operation || 'default';

    switch (operation) {
      case 'switch':
        return await this.switchFramework({
          framework: args.framework,
          reason: args.reason,
        });
      case 'list':
        return await this.listFrameworks({
          show_details: args.show_details,
        });
      case 'enable':
        return await this.enableFrameworkSystem({
          reason: args.reason,
        });
      case 'disable':
        return await this.disableFrameworkSystem({
          reason: args.reason,
        });
      case 'inspect':
        return await this.inspectMethodology({
          methodology_id: args.methodology_id || args.framework,
        });
      case 'list_frameworks':
        return await this.listMethodologiesAction({
          show_details: args.show_details,
        });
      default:
        throw new Error(
          `Unknown framework operation: ${operation}. Valid operations: switch, list, enable, disable, inspect, list_frameworks`
        );
    }
  }

  private async switchFramework(args: {
    framework?: string;
    reason?: string;
  }): Promise<ToolResponse> {
    if (!this.frameworkManager) {
      throw new Error('Framework manager not initialized');
    }

    if (!args.framework) {
      throw new Error('Framework parameter is required for switch operation');
    }

    const result = await this.frameworkManager.switchFramework(
      args.framework,
      args.reason || `User requested switch to ${args.framework}`
    );

    if (!result.success) {
      throw new Error(result.error || 'Framework switch failed');
    }

    const framework = result.framework!;
    let response = `🔄 **Framework Switch Successful**\n\n`;
    response += `**Current**: ${framework.name} (${framework.id})\n`;
    response += `**Description**: ${framework.description}\n`;
    response += `**Type**: ${framework.type}\n\n`;
    response += `**Guidelines**: ${framework.executionGuidelines.join(' • ')}\n\n`;
    response += `✅ All future prompt executions will now use the ${framework.id} methodology.`;

    return this.createMinimalSystemResponse(response, 'switch_framework');
  }

  private async listFrameworks(args: { show_details?: boolean }): Promise<ToolResponse> {
    if (!this.frameworkManager) {
      throw new Error('Framework manager not initialized');
    }

    const frameworks = this.frameworkManager.listFrameworks();
    const currentState = this.frameworkStateStore?.getCurrentState();
    const activeFramework = currentState?.activeFramework || 'CAGEERF';

    const runtimeLoader = getDefaultRuntimeLoader();
    const methodologyIds = runtimeLoader.discoverMethodologies();

    let response = `📋 **Available Frameworks**\n\n`;

    frameworks.forEach((framework: any) => {
      const isActive = framework.id.toUpperCase() === activeFramework.toUpperCase();
      const status = isActive ? '🟢 ACTIVE' : '⚪ Available';
      const frameworkDef = runtimeLoader.loadMethodology(framework.id.toLowerCase());

      response += `**${framework.name}** ${status}\n`;

      if (args.show_details) {
        response += `   📝 ${framework.description}\n`;
        response += `   🎯 Type: ${framework.type}\n`;

        if (frameworkDef) {
          if (frameworkDef.methodologyGates?.length) {
            response += `   🚧 Methodology Gates: ${frameworkDef.methodologyGates.length}\n`;
          }
          if (frameworkDef.phases?.processingSteps?.length) {
            response += `   📊 Processing Steps: ${frameworkDef.phases.processingSteps.length}\n`;
          }
          if (frameworkDef.phases?.qualityIndicators) {
            const indicatorCount = Object.keys(frameworkDef.phases.qualityIndicators).length;
            response += `   ✅ Quality Indicators: ${indicatorCount} categories\n`;
          }
        }

        if (framework.executionGuidelines && framework.executionGuidelines.length > 0) {
          response += `   📋 Guidelines: ${framework.executionGuidelines
            .slice(0, 2)
            .join(' • ')}\n`;
        }
        response += `\n`;
      }
    });

    if (!args.show_details) {
      response += `\n💡 Use 'show_details: true' for more information about each framework.\n`;
    }

    if (methodologyIds.length > 0) {
      response += `\n📦 Data-driven frameworks: ${methodologyIds.length} available`;
      response += `\n🔍 Use \`operation:"list_frameworks"\` for methodology-specific details`;
    }

    response += `\n🔄 Switch frameworks using: action="framework", operation="switch", framework="<name>"`;

    return this.createMinimalSystemResponse(response, 'list_frameworks');
  }

  private async inspectMethodology(args: { methodology_id?: string }): Promise<ToolResponse> {
    const methodologyId = args.methodology_id?.toLowerCase();
    const runtimeLoader = getDefaultRuntimeLoader();

    if (!methodologyId) {
      const available = runtimeLoader.discoverMethodologies();
      return this.createMinimalSystemResponse(
        `📋 **Available Frameworks**\n\n` +
          `Use \`operation:"inspect" methodology_id:"<id>"\` to inspect a specific methodology.\n\n` +
          `Available: ${available.join(', ')}`,
        'inspect_methodology'
      );
    }

    const definition = runtimeLoader.loadMethodology(methodologyId);

    if (!definition) {
      const available = runtimeLoader.discoverMethodologies();
      return this.createMinimalSystemResponse(
        `❌ **Methodology Not Found**: \`${methodologyId}\`\n\n` +
          `Available frameworks: ${available.join(', ')}`,
        'inspect_methodology'
      );
    }

    let response = `🔍 **Methodology: ${definition.name}**\n\n`;
    response += `**ID**: ${definition.id}\n`;
    response += `**Version**: ${definition.version || '1.0.0'}\n`;
    response += `**Type**: ${definition.type || definition.methodology}\n`;
    response += `**Status**: ${definition.enabled !== false ? '✅ Enabled' : '❌ Disabled'}\n\n`;

    if (definition.systemPromptGuidance) {
      response += `**System Guidance**:\n${definition.systemPromptGuidance.slice(0, 500)}${
        definition.systemPromptGuidance.length > 500 ? '...' : ''
      }\n\n`;
    }

    if (definition.gates?.include?.length) {
      response += `**Included Gates**: ${definition.gates.include.join(', ')}\n`;
    }
    if (definition.methodologyGates?.length) {
      response += `**Methodology Gates** (${definition.methodologyGates.length}):\n`;
      definition.methodologyGates.slice(0, 3).forEach((gate: any) => {
        response += `  • ${gate.name} (${gate.priority || 'medium'})\n`;
      });
      if (definition.methodologyGates.length > 3) {
        response += `  ... and ${definition.methodologyGates.length - 3} more\n`;
      }
      response += '\n';
    }

    if (definition.frameworkElements?.requiredSections?.length) {
      response += `**Required Sections**: ${definition.frameworkElements.requiredSections.join(
        ', '
      )}\n\n`;
    }

    if (definition.phases) {
      const processingSteps = definition.phases.processingSteps?.length || 0;
      const executionSteps = definition.phases.executionSteps?.length || 0;
      response += `**Processing Steps**: ${processingSteps}\n`;
      response += `**Execution Steps**: ${executionSteps}\n`;

      if (definition.phases.qualityIndicators) {
        const indicatorCount = Object.keys(definition.phases.qualityIndicators).length;
        response += `**Quality Indicators**: ${indicatorCount} categories\n`;
      }
      response += '\n';
    }

    if (definition.toolDescriptions) {
      response += `**Tool Description Overrides**: ${Object.keys(definition.toolDescriptions).join(
        ', '
      )}\n\n`;
    }

    response += `💡 Use \`action:"framework" operation:"switch" framework:"${definition.id}"\` to activate this methodology.`;

    return this.createMinimalSystemResponse(response, 'inspect_methodology');
  }

  private async listMethodologiesAction(args: { show_details?: boolean }): Promise<ToolResponse> {
    const runtimeLoader = getDefaultRuntimeLoader();
    const methodologyIds = runtimeLoader.discoverMethodologies();

    if (methodologyIds.length === 0) {
      return this.createMinimalSystemResponse(
        `📋 **No Frameworks Found**\n\n` +
          `Ensure YAML files exist in \`resources/frameworks/<id>/framework.yaml\`.`,
        'list_frameworks'
      );
    }

    let response = `📋 **Available Frameworks** (${methodologyIds.length})\n\n`;

    for (const id of methodologyIds) {
      const definition = runtimeLoader.loadMethodology(id);
      if (!definition) continue;

      const status = definition.enabled !== false ? '✅' : '⚪';
      response += `${status} **${definition.name}** (\`${definition.id}\`)\n`;

      if (args.show_details) {
        response += `   Type: ${definition.type || definition.methodology}\n`;
        if (definition.methodologyGates?.length) {
          response += `   Gates: ${definition.methodologyGates.length} methodology-specific\n`;
        }
        if (definition.phases?.processingSteps?.length) {
          response += `   Processing Steps: ${definition.phases.processingSteps.length}\n`;
        }
        response += '\n';
      }
    }

    if (!args.show_details) {
      response += `\n💡 Use \`show_details:true\` for more information.`;
    }

    response += `\n🔍 Use \`operation:"inspect" methodology_id:"<id>"\` for full details.`;

    return this.createMinimalSystemResponse(response, 'list_frameworks');
  }

  private async enableFrameworkSystem(args: {
    reason?: string;
    persist?: boolean;
  }): Promise<ToolResponse> {
    if (!this.frameworkStateStore) {
      throw new Error('Framework state manager not initialized');
    }

    const currentState = this.frameworkStateStore.getCurrentState(this.requestScope);
    if (currentState.frameworkSystemEnabled) {
      return this.createMinimalSystemResponse(
        `ℹ️ Framework system is already enabled.`,
        'enable_framework_system'
      );
    }

    try {
      await (this.frameworkStateStore as any).enableFrameworkSystem?.(
        args.reason || 'User requested to enable framework system'
      );
    } catch {
      // Method may not exist
    }

    const persistenceNotes: string[] = [];
    if (args.persist) {
      const note = await this.context.persistFrameworkConfig(true);
      if (note) persistenceNotes.push(note);
    }

    const response =
      `✅ **Framework System Enabled**\n\n` +
      `**Reason**: ${args.reason || 'User requested to enable framework system'}\n` +
      `**Status**: Framework system is now active\n` +
      `**Active Framework**: ${currentState.activeFramework}\n\n` +
      `🎯 All prompt executions will now use framework-guided processing.` +
      (persistenceNotes.length ? `\n\n${persistenceNotes.join('\n')}` : '');

    return this.createMinimalSystemResponse(response, 'enable_framework_system');
  }

  private async disableFrameworkSystem(args: {
    reason?: string;
    persist?: boolean;
  }): Promise<ToolResponse> {
    if (!this.frameworkStateStore) {
      throw new Error('Framework state manager not initialized');
    }

    const currentState = this.frameworkStateStore.getCurrentState(this.requestScope);
    if (!currentState.frameworkSystemEnabled) {
      return this.createMinimalSystemResponse(
        `ℹ️ Framework system is already disabled.`,
        'disable_framework_system'
      );
    }

    try {
      await (this.frameworkStateStore as any).disableFrameworkSystem?.(
        args.reason || 'User requested to disable framework system'
      );
    } catch {
      // Method may not exist
    }

    const persistenceNotes: string[] = [];
    if (args.persist) {
      const note = await this.context.persistFrameworkConfig(false);
      if (note) persistenceNotes.push(note);
    }

    const response =
      `⚠️ **Framework System Disabled**\n\n` +
      `**Reason**: ${args.reason || 'User requested to disable framework system'}\n` +
      `**Status**: Framework system is now inactive\n` +
      `**Previous Framework**: ${currentState.activeFramework}\n\n` +
      `📝 Prompt executions will now use basic processing without framework guidance.` +
      (persistenceNotes.length ? `\n\n${persistenceNotes.join('\n')}` : '');

    return this.createMinimalSystemResponse(response, 'disable_framework_system');
  }
}
