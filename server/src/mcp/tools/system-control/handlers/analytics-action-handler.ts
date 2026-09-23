// @lifecycle canonical - Handler for analytics and metrics operations.

import { ActionHandler } from '../core/action-handler-base.js';

import type { ToolResponse } from '#shared/types/index.js';

export class AnalyticsActionHandler extends ActionHandler {
  async execute(args: any): Promise<ToolResponse> {
    const operation = args.operation || 'default';

    switch (operation) {
      case 'reset':
        return await this.resetMetrics({
          confirm: args.confirm,
        });
      case 'history':
        return await this.getSwitchHistory({
          limit: args.limit,
        });
      case 'view':
      case 'default':
      default:
        return await this.getAnalytics();
    }
  }

  private async resetMetrics(args: { confirm?: boolean }): Promise<ToolResponse> {
    if (!args.confirm) {
      return this.createMinimalSystemResponse(
        "❌ Metrics reset cancelled. Set 'confirm: true' to reset all switching performance metrics.",
        'reset_metrics'
      );
    }

    if (this.frameworkStateStore) {
      // The caller's workspace, as this handler's status read is scoped. Unscoped, a reset
      // from one workspace cleared the launch workspace's counters instead.
      this.frameworkStateStore.resetMetrics(this.requestScope);
    }

    let response = `# 🔄 Metrics Reset Completed\n\n`;
    response += `**Reset Timestamp**: ${new Date().toISOString()}\n\n`;

    // Only what this action actually clears is reported. It used to print four execution
    // counters before and after, all of them constant zero because nothing wrote them (P4.87);
    // printing `0 → 0` made a reset look like it had done something to figures it never touched.
    response += '## What Was Reset\n\n';
    response += `**Framework switch metrics** (this workspace): cleared\n\n`;

    response += '## What Was Not Reset\n\n';
    response +=
      '**Execution ledger**: untouched. It is an append-only record, and every per-workspace ' +
      'figure in the analytics report is read from it — clearing it here would delete history ' +
      'rather than reset a counter.\n\n';

    response += '✅ Framework switching monitoring will start fresh.';

    return this.createMinimalSystemResponse(response, 'reset_metrics');
  }

  private async getSwitchHistory(args: { limit?: number }): Promise<ToolResponse> {
    if (!this.frameworkStateStore) {
      throw new Error('Framework state manager not initialized');
    }

    const { limit = 20 } = args;

    const history = this.frameworkStateStore.getSwitchHistory(limit);
    const currentState = this.frameworkStateStore.getCurrentState(this.requestScope);

    let response = `# 📈 Framework Switch History\n\n`;
    response += `**Current Framework**: ${currentState.activeFramework}\n`;
    response += `**History Entries**: ${history.length}\n\n`;

    if (history.length === 0) {
      response += 'No framework switches recorded yet.\n\n';
    } else {
      response += '## Recent Switches\n\n';

      history.forEach((entry, index) => {
        response += `### ${index + 1}. ${entry.from} → ${entry.to}\n\n`;
        response += `**Timestamp**: ${entry.timestamp.toISOString()}\n`;
        response += `**Reason**: ${entry.reason}\n\n`;
      });
    }

    response += '---\n\n';
    response += '**Note**: This history helps track framework usage patterns and audit changes.';

    return this.createMinimalSystemResponse(response, 'switch_history');
  }

  private async getAnalytics(): Promise<ToolResponse> {
    // One scope, one query: every figure under the two workspace headings below comes from this
    // tally, which filters `execution_records` on the calling workspace (P4.87).
    const ledger = this.tallyLedger();

    let response = '# 📊 System Analytics Report\n\n';

    response += '## 📈 Recorded Steps (this workspace)\n\n';
    if (ledger.records === 0) {
      response +=
        'No steps recorded for this workspace yet. The execution ledger records chain steps; ' +
        'a single-prompt run writes no row, so it is counted nowhere here.\n\n';
    } else {
      response += `**Steps Recorded**: ${ledger.records} (most recent page)\n`;
      response += `**Completed**: ${ledger.completed}\n`;
      response += `**Failed**: ${ledger.failed}\n`;
      response += `**Average Step Duration**: ${this.formatExecutionTime(
        ledger.averageDurationMs
      )}\n\n`;
    }

    response += '## 🛡️ Quality Gate Analytics (this workspace)\n\n';
    response += `**Gate Validations**: ${ledger.reviewedRecords}\n`;
    // Numerator and denominator now come from the same scoped page. It used to divide this
    // workspace's reviewed steps by a process-wide execution counter nothing wrote, which made
    // the rate 0% on every server (P4.87).
    response += `**Gate Review Coverage**: ${
      ledger.records > 0 ? Math.round((ledger.reviewedRecords / ledger.records) * 100) : 0
    }% of recorded steps\n`;

    // Per gate, not just a total: a 90% adoption rate over one gate that always passes and one
    // that always fails is two different systems, and the total cannot tell them apart. Omitted
    // entirely when no record carries a verdict, so the section appears only once there is
    // something in it.
    if (ledger.byGate.size > 0) {
      response += '\n**Per-Gate Outcomes** (reviewed steps in the ledger)\n\n';
      for (const [gateId, tally] of ledger.byGate) {
        response += `- \`${gateId}\`: ${tally.passed} passed / ${tally.failed} failed\n`;
      }
    }
    if (ledger.attestations > 0) {
      response += `\n**Reminder Attestations**: ${ledger.attestations} (self-declared, not graded)\n`;
    }
    response += '\n';

    // Everything below belongs to the server PROCESS, which may serve several workspaces. The
    // heading says so rather than letting a reader carry the workspace scope down the page.
    response += '## 🖥️ This Server Process (all workspaces)\n\n';
    // Read now, not from a cached copy. Both used to come from an in-memory object refreshed only
    // when tool descriptions hot-reloaded, so a server that never reloaded reported `Uptime: 0s`
    // and its startup heap for as long as it ran.
    response += `**Uptime**: ${this.formatUptime(Date.now() - this.startTime)}\n\n`;

    const mem = process.memoryUsage();
    response += '### 💾 Resources\n\n';
    response += `**Heap Used**: ${this.formatBytes(mem.heapUsed)}\n`;
    response += `**Heap Total**: ${this.formatBytes(mem.heapTotal)}\n`;
    response += `**RSS**: ${this.formatBytes(mem.rss)}\n`;
    response += `**External**: ${this.formatBytes(mem.external)}\n\n`;

    response += `\n---\n*Generated at: ${new Date().toISOString()}*`;

    return this.createMinimalSystemResponse(response, 'analytics');
  }
}
