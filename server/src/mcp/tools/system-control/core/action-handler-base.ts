// @lifecycle canonical - Abstract base class for system_control action handlers.

import type { FrameworkManager } from '#engine/frameworks/framework-manager.js';
import type { FrameworkStateStore } from '#engine/frameworks/framework-state-store.js';
import type { GateStateStore } from '#engine/gates/gate-state-store.js';
import type {
  StateStoreOptions,
  ConfigManager,
  Logger,
  ToolResponse,
} from '#shared/types/index.js';
import type { SystemControlContext } from './types.js';
import type { SafeConfigWriter } from '../../config-utils.js';

/**
 * Base class for system_control action handlers.
 *
 * Provides typed access to shared context and formatting helpers.
 */
export abstract class ActionHandler {
  constructor(protected readonly context: SystemControlContext) {}
  abstract execute(args: any): Promise<ToolResponse>;

  // ── Convenience getters ──────────────────────────────────────────────

  protected get logger(): Logger {
    return this.context.logger;
  }
  protected get startTime(): number {
    return this.context.startTime;
  }
  protected get frameworkManager(): FrameworkManager | undefined {
    return this.context.frameworkManager;
  }
  protected get frameworkStateStore(): FrameworkStateStore | undefined {
    return this.context.frameworkStateStore;
  }
  protected get gateStateStore(): GateStateStore | undefined {
    return this.context.gateStateStore;
  }
  protected get configManager(): ConfigManager | undefined {
    return this.context.configManager;
  }
  protected get safeConfigWriter(): SafeConfigWriter | undefined {
    return this.context.safeConfigWriter;
  }
  protected get onRestart(): ((reason: string) => Promise<void>) | undefined {
    return this.context.onRestart;
  }
  protected get mcpToolsManager(): any {
    return this.context.mcpToolsManager;
  }
  protected get requestScope(): StateStoreOptions | undefined {
    return this.context.requestScope;
  }

  // ── Shared response helpers ──────────────────────────────────────────

  protected createMinimalSystemResponse(text: string, action: string): ToolResponse {
    return this.context.createMinimalSystemResponse(text, action);
  }

  // ── Formatting utilities ─────────────────────────────────────────────

  protected getExecutionsByMode(): Record<string, number> {
    const modeData: Record<string, number> = {};
    this.context.systemAnalytics.performanceTrends.forEach((trend) => {
      if (trend.executionMode) {
        modeData[trend.executionMode] = (modeData[trend.executionMode] || 0) + 1;
      }
    });
    return modeData;
  }

  protected formatUptime(uptime: number): string {
    const seconds = Math.floor(uptime / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  protected formatExecutionTime(time: number): string {
    return `${Math.round(time)}ms`;
  }

  protected formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }
    return `${Math.round(value * 100) / 100}${units[unitIndex]}`;
  }

  protected getHealthIcon(status: string): string {
    switch (status) {
      case 'healthy':
        return '✅';
      case 'warning':
        return '⚠️';
      case 'error':
        return '❌';
      case 'critical':
        return '🚨';
      default:
        return '❓';
    }
  }

  protected getSuccessRate(): number {
    const total = this.context.systemAnalytics.totalExecutions;
    if (total === 0) return 100;
    return Math.round((this.context.systemAnalytics.successfulExecutions / total) * 100);
  }

  protected formatTrendContext(trend: {
    framework?: string;
    executionMode?: string;
    success?: boolean;
  }): string {
    let ctx = '';
    if (trend.framework) ctx += ` [${trend.framework}]`;
    if (trend.executionMode) ctx += ` (${trend.executionMode})`;
    if (trend.success !== undefined) ctx += trend.success ? ' ✓' : ' ✗';
    return ctx;
  }

  protected formatTrendValue(metric: string, value: number): string {
    switch (metric) {
      case 'executionTime':
        return `${Math.round(value)}ms`;
      case 'memoryDelta':
        return `${value > 0 ? '+' : ''}${this.formatBytes(value)}`;
      case 'successRate':
        return `${Math.round(value * 100)}%`;
      case 'gateValidationTime':
        return `${Math.round(value)}ms validation`;
      default:
        return String(value);
    }
  }
}
