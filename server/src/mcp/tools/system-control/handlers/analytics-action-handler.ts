// @lifecycle canonical - Handler for analytics and metrics operations.

import { ActionHandler } from '../core/action-handler-base.js';

import type { ToolResponse } from '#shared/types/index.js';
import type { SystemAnalytics } from '../core/types.js';

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
        return await this.getAnalytics({
          include_history: args.include_history,
        });
    }
  }

  private resetAnalyticsData(): void {
    this.context.systemAnalytics = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      averageExecutionTime: 0,
      gateValidationCount: 0,
      uptime: Date.now() - this.startTime,
      performanceTrends: [],
    };
  }

  private async resetMetrics(args: { confirm?: boolean }): Promise<ToolResponse> {
    if (!args.confirm) {
      return this.createMinimalSystemResponse(
        "❌ Metrics reset cancelled. Set 'confirm: true' to reset all switching performance metrics.",
        'reset_metrics'
      );
    }

    const beforeMetrics = { ...this.context.systemAnalytics };

    this.resetAnalyticsData();

    if (this.frameworkStateStore) {
      // The caller's workspace, as this handler's status read is scoped. Unscoped, a reset
      // from one workspace cleared the launch workspace's counters instead.
      this.frameworkStateStore.resetMetrics(this.requestScope);
    }

    let response = `# 🔄 Metrics Reset Completed\n\n`;
    response += `**Reset Timestamp**: ${new Date().toISOString()}\n\n`;

    response += '## Metrics Before Reset\n\n';
    response += `**Total Executions**: ${beforeMetrics.totalExecutions}\n`;
    response += `**Successful**: ${beforeMetrics.successfulExecutions}\n`;
    response += `**Failed**: ${beforeMetrics.failedExecutions}\n`;
    response += `**Average Time**: ${this.formatExecutionTime(
      beforeMetrics.averageExecutionTime
    )}\n\n`;

    response += '## Metrics After Reset\n\n';
    response += `**Total Executions**: ${this.context.systemAnalytics.totalExecutions}\n`;
    response += `**Successful**: ${this.context.systemAnalytics.successfulExecutions}\n`;
    response += `**Failed**: ${this.context.systemAnalytics.failedExecutions}\n`;
    response += `**Average Time**: ${this.formatExecutionTime(
      this.context.systemAnalytics.averageExecutionTime
    )}\n\n`;

    response +=
      '✅ All switching performance metrics have been reset. Framework switching monitoring will start fresh.';

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

  /**
   * A gate's pass/fail tally across the ledger page, plus the number of reviewed records.
   *
   * `gateValidationCount` had no writer anywhere — it was initialized to `0` here and in the
   * router and read only by the report, so "Gate Validations: 0" and "Gate Adoption Rate: 0%"
   * were printed on a server that had run hundreds of gated steps (P4.77). It is now refreshed
   * from `execution_records`, which since P4.76 carries the reviewer's per-gate verdicts.
   *
   * Refreshed on read rather than incremented on write: the ledger already holds every verdict
   * with its own scope filter, and a second running counter would be a fact with two sources
   * that drift apart on restart, since the counter is in memory and the ledger is not.
   */
  private tallyGateVerdicts(): {
    reviewedRecords: number;
    byGate: Map<string, { passed: number; failed: number }>;
  } {
    const byGate = new Map<string, { passed: number; failed: number }>();
    let reviewedRecords = 0;

    for (const record of this.context.executionRecordStore?.queryRecent(
      undefined,
      this.requestScope
    ) ?? []) {
      const verdicts = record.gateVerdicts;
      if (verdicts.length === 0) continue;
      reviewedRecords += 1;
      for (const verdict of verdicts) {
        const tally = byGate.get(verdict.gateId) ?? { passed: 0, failed: 0 };
        if (verdict.verdict === 'PASS') tally.passed += 1;
        else tally.failed += 1;
        byGate.set(verdict.gateId, tally);
      }
    }

    return { reviewedRecords, byGate };
  }

  private async getAnalytics(args: { include_history?: boolean }): Promise<ToolResponse> {
    const { include_history = false } = args;

    const gateTally = this.tallyGateVerdicts();
    this.context.systemAnalytics.gateValidationCount = gateTally.reviewedRecords;

    const analytics = this.context.systemAnalytics;
    const successRate = this.getSuccessRate();
    const avgTime = this.formatExecutionTime(analytics.averageExecutionTime);

    let response = '# 📊 System Analytics Report\n\n';

    response += '## 📈 Overall Performance\n\n';
    response += `**Total Executions**: ${analytics.totalExecutions}\n`;
    response += `**Success Rate**: ${successRate}%\n`;
    response += `**Failed Executions**: ${analytics.failedExecutions}\n`;
    response += `**Average Execution Time**: ${avgTime}\n`;
    response += `**System Uptime**: ${this.formatUptime(analytics.uptime)}\n\n`;

    response += '## 🎯 Execution Mode Distribution\n\n';
    const executionsByMode = this.getExecutionsByMode();
    const totalModeExecutions = Object.values(executionsByMode).reduce((a, b) => a + b, 0);
    Object.entries(executionsByMode).forEach(([mode, count]) => {
      const percentage =
        totalModeExecutions > 0 ? Math.round((count / totalModeExecutions) * 100) : 0;
      response += `- **${
        mode.charAt(0).toUpperCase() + mode.slice(1)
      } Mode**: ${count} executions (${percentage}%)\n`;
    });
    response += '\n';

    response += '## 🛡️ Quality Gate Analytics\n\n';
    response += `**Gate Validations**: ${analytics.gateValidationCount}\n`;
    response += `**Gate Adoption Rate**: ${
      analytics.totalExecutions > 0
        ? Math.round((analytics.gateValidationCount / analytics.totalExecutions) * 100)
        : 0
    }%\n`;

    // Per gate, not just a total: a 90% adoption rate over one gate that always passes and one
    // that always fails is two different systems, and the total cannot tell them apart. Omitted
    // entirely when no record carries a verdict, so the section appears only once there is
    // something in it.
    if (gateTally.byGate.size > 0) {
      response += '\n**Per-Gate Outcomes** (reviewed steps in the ledger)\n\n';
      for (const [gateId, tally] of gateTally.byGate) {
        response += `- \`${gateId}\`: ${tally.passed} passed / ${tally.failed} failed\n`;
      }
    }
    response += '\n';

    if (analytics.memoryUsage) {
      response += '## 💾 System Resources\n\n';
      const mem = analytics.memoryUsage;
      response += `**Heap Used**: ${this.formatBytes(mem.heapUsed)}\n`;
      response += `**Heap Total**: ${this.formatBytes(mem.heapTotal)}\n`;
      response += `**RSS**: ${this.formatBytes(mem.rss)}\n`;
      response += `**External**: ${this.formatBytes(mem.external)}\n\n`;
    }

    if (include_history && analytics.performanceTrends.length > 0) {
      response += '## 📈 Performance Trends\n\n';

      const trendsByMetric = analytics.performanceTrends.reduce<
        Record<string, Array<SystemAnalytics['performanceTrends'][number]>>
      >((acc, trend) => {
        const bucket = acc[trend.metric] ?? [];
        bucket.push(trend);
        acc[trend.metric] = bucket;
        return acc;
      }, {});

      Object.entries(trendsByMetric).forEach(([metric, trends]) => {
        const recentTrends = (trends ?? []).slice(-10);
        response += `### ${metric.charAt(0).toUpperCase() + metric.slice(1)} Trends\n`;
        recentTrends.forEach((trend, index) => {
          const isoTime = new Date(trend.timestamp).toISOString();
          const time = isoTime.split('T')[1]?.split('.')[0] ?? isoTime;
          const contextInfo = this.formatTrendContext(trend);
          response += `${index + 1}. ${time}: ${this.formatTrendValue(
            trend.metric,
            trend.value
          )}${contextInfo}\n`;
        });
        response += '\n';
      });
    }

    response += `\n---\n*Generated at: ${new Date().toISOString()}*`;

    return this.createMinimalSystemResponse(response, 'analytics');
  }
}
