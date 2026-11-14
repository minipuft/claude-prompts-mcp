// @lifecycle canonical - Handler for system status operations.

import { ActionHandler } from '../core/action-handler-base.js';

import type { ToolResponse } from '#shared/types/index.js';
import type {
  ProfileRegistryReading,
  ResourceLocationReport,
} from '#shared/types/resource-location-report.js';

function namesOrNone(names: readonly string[]): string {
  return names.length > 0 ? names.join(', ') : 'none';
}

/** `profile: …` for a registry beside the workspace's parent; nothing when there is none. */
function profileLine(profile: ProfileRegistryReading): string | undefined {
  switch (profile.state) {
    case 'none':
      return undefined;
    case 'labelled':
      return `profile: ${profile.label} (siblings: ${namesOrNone(profile.siblings)})`;
    case 'unlabelled':
      return (
        `profile: unlabelled (registry at ${profile.registryPath} names: ` +
        `${namesOrNone(profile.labels)})`
      );
    case 'unreadable':
      return `profile: registry at ${profile.registryPath} could not be read (${profile.reason})`;
  }
}

/**
 * The **Resource locations** section: every location in precedence order with what each kind
 * serves from it, the bundle's state, the profile's label, and each definition a same-id copy in
 * an earlier location hides. Rendering only — the report is built at the composition root.
 */
export function formatResourceLocations(report: ResourceLocationReport): string {
  const lines = ['**Resource locations**'];
  report.locations.forEach((location, index) => {
    const { prompt, gate, framework, style } = location.counts;
    lines.push(
      `${index + 1}. ${location.path} (${location.kind}) — ${prompt} prompts, ${gate} gates, ` +
        `${framework} frameworks, ${style} styles`
    );
  });
  lines.push(`bundled (${report.bundled})`);
  const profile = profileLine(report.profile);
  if (profile !== undefined) lines.push(profile);
  if (report.shadowed.length === 0) {
    lines.push('Shadowed: none');
  } else {
    lines.push('Shadowed:');
    for (const entry of report.shadowed) {
      lines.push(
        `- ${entry.id} (${entry.type}): served from ${entry.servedFrom}, ` +
          `hidden copy in ${entry.hiddenIn}`
      );
    }
  }
  return `${lines.join('\n')}\n\n`;
}

/**
 * The **Refused files** section: every resource file a loader will not load, with the loader's
 * reason and since when. The previous definition of each id keeps serving, so without this list a
 * hand edit that broke a file reads as an edit that changed nothing.
 */
export function formatRefusedFiles(report: ResourceLocationReport): string {
  if (report.refused.length === 0) return '**Refused files**: none\n\n';
  const lines = ['**Refused files**'];
  for (const entry of report.refused) {
    const since = entry.since !== undefined ? ` (since ${entry.since})` : '';
    // The reason's first line: a parser's message continues with the offending source lines, and
    // a refused file's content is what no surface returns (`resource-quarantine.ts`).
    const reason = entry.reason.split('\n')[0]?.trim() ?? '';
    lines.push(`- ${entry.path} — ${entry.type} \`${entry.id}\`${since}: ${reason}`);
  }
  return `${lines.join('\n')}\n\n`;
}

export class StatusActionHandler extends ActionHandler {
  async execute(args: any): Promise<ToolResponse> {
    const operation = args.operation || 'default';

    switch (operation) {
      case 'health':
        return await this.getSystemHealthStatus();
      case 'diagnostics':
        return await this.getSystemDiagnostics();
      case 'framework_status':
        return await this.getFrameworkStatus();
      case 'overview':
      case 'default':
      default:
        return await this.getSystemStatus({
          include_metrics: args.include_metrics,
        });
    }
  }

  private async getSystemStatus(args: { include_metrics?: boolean }): Promise<ToolResponse> {
    const { include_metrics = true } = args;

    if (!this.frameworkStateStore) {
      throw new Error('Framework state manager not initialized');
    }

    const health = this.frameworkStateStore.getSystemHealth(this.requestScope);
    const statusIcon = health.status === 'healthy' ? '✅' : '⚠️';

    const isFrameworkEnabled = health.frameworkSystemEnabled;
    const frameworkStatusIcon = isFrameworkEnabled ? '✅' : '🚫';
    const frameworkStatusText = isFrameworkEnabled
      ? `${frameworkStatusIcon} Enabled (${health.activeFramework})`
      : `${frameworkStatusIcon} Disabled (${health.activeFramework} selected)`;

    let response = `${statusIcon} **System Status Overview**\n\n`;
    response += `**Framework System**: ${frameworkStatusText}\n`;
    response += `**Status**: ${health.status}\n`;
    response += `**Uptime**: ${Math.floor((Date.now() - this.startTime) / 1000 / 60)} minutes\n\n`;

    // Wired unconditionally at startup, so an absent view is a composition-root regression and
    // fails here rather than rendering a status that silently omits where resources come from.
    if (this.context.resourceLocations === undefined) {
      throw new Error('Resource locations view not wired into system_control');
    }
    const locationReport = this.context.resourceLocations.report();
    response += formatResourceLocations(locationReport);
    response += formatRefusedFiles(locationReport);

    if (!isFrameworkEnabled && health.activeFramework) {
      response += `⚠️ **Notice**: ${health.activeFramework} is selected but framework injection is disabled.\n`;
      response += `Prompts will execute without framework guidance.\n`;
      response += `Use \`system_control framework enable\` to activate framework injection.\n\n`;
    }

    if (include_metrics) {
      // The same scoped ledger read `analytics` uses, so the two actions cannot disagree about
      // one workspace. They did: these three lines read process-wide counters nothing wrote, and
      // rendered 0/0 as `Success Rate: 0%` where `analytics` rendered the same zeroes as 100%
      // (P4.87).
      const ledger = this.tallyLedger();
      response += `📊 **Recorded Steps** (this workspace):\n`;
      response += `- Steps Recorded: ${ledger.records}\n`;
      response += `- Completed: ${ledger.completed}\n`;
      response += `- Failed: ${ledger.failed}\n\n`;
    }

    return this.createMinimalSystemResponse(response, 'status');
  }

  private async getSystemHealthStatus(): Promise<ToolResponse> {
    if (!this.frameworkStateStore) {
      throw new Error('Framework state manager not initialized');
    }

    const health = this.frameworkStateStore.getSystemHealth(this.requestScope);
    const statusIcon = health.status === 'healthy' ? '✅' : '⚠️';

    let response = `${statusIcon} **System Health Status**: ${health.status}\n\n`;
    response += `📊 **Metrics**:\n`;

    const isFrameworkEnabled = health.frameworkSystemEnabled;
    const injectionStatus = isFrameworkEnabled ? 'Working' : 'Inactive';
    const frameworkStatusText = isFrameworkEnabled
      ? `✅ Enabled - ${health.activeFramework} framework active`
      : `🚫 Disabled - ${health.activeFramework} selected but not injecting`;

    response += `- Framework System: ${frameworkStatusText}\n`;
    response += `- Framework Injection: ${injectionStatus}\n`;
    response += `- Available Frameworks: ${health.availableFrameworks.join(', ')}\n`;
    response += `- Total Framework Switches: ${health.switchingMetrics.totalSwitches}\n`;

    return this.createMinimalSystemResponse(response, 'health');
  }

  private async getSystemDiagnostics(): Promise<ToolResponse> {
    let response = `🔧 **System Diagnostics**\n\n`;

    try {
      if (this.frameworkStateStore) {
        const health = this.frameworkStateStore.getSystemHealth(this.requestScope);
        response += `Framework State: ${health.status}\n`;
        response += `Active Framework: ${health.activeFramework}\n`;
      }

      response += `Server Uptime: ${Date.now() - this.startTime}ms\n`;
    } catch (error) {
      response += `❌ Error during diagnostics: ${error}\n`;
    }

    return this.createMinimalSystemResponse(response, 'diagnostics');
  }

  private async getFrameworkStatus(): Promise<ToolResponse> {
    if (!this.frameworkStateStore) {
      throw new Error('Framework state manager not initialized');
    }

    const health = this.frameworkStateStore.getSystemHealth(this.requestScope);

    let response = `🎯 **Framework System Status**\n\n`;

    const isFrameworkEnabled = health.frameworkSystemEnabled;
    const injectionStatusIcon = isFrameworkEnabled ? '✅' : '🚫';
    const injectionStatusText = isFrameworkEnabled
      ? 'Active - Framework guidance being applied'
      : 'Inactive - Framework guidance disabled';

    response += `**Selected Framework**: ${health.activeFramework}\n`;
    response += `**Injection Status**: ${injectionStatusIcon} ${injectionStatusText}\n`;
    response += `**System State**: ${health.frameworkSystemEnabled ? 'Enabled' : 'Disabled'}\n`;
    response += `**Health Status**: ${health.status}\n`;
    response += `**Available Frameworks**: ${health.availableFrameworks.join(', ')}\n`;

    if (!isFrameworkEnabled && health.activeFramework) {
      response += `\n⚠️ **Warning**: Framework system is disabled while ${health.activeFramework} is selected.\n`;
      response += `This means prompts will NOT receive framework guidance.\n`;
      response += `To enable framework injection, use: \`system_control framework enable\`\n`;
    }

    return this.createMinimalSystemResponse(response, 'framework_status');
  }
}
