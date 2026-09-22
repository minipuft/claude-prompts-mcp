// @lifecycle canonical - Abstract base class for system_control action handlers.

import type { FrameworkManager } from '#engine/frameworks/framework-manager.js';
import type { FrameworkStateStore } from '#engine/frameworks/framework-state-store.js';
import type { GateStateStore } from '#engine/gates/gate-state-store.js';
import type { ExecutionRecord } from '#shared/types/chain-execution.js';
import type {
  StateStoreOptions,
  ConfigManager,
  Logger,
  ToolResponse,
} from '#shared/types/index.js';
import type { SystemControlContext } from './types.js';

/** What one scoped page of the execution ledger says about a workspace. */
export interface LedgerTally {
  records: number;
  completed: number;
  failed: number;
  averageDurationMs: number;
  reviewedRecords: number;
  attestations: number;
  byGate: Map<string, { passed: number; failed: number }>;
}

/**
 * Fold one record's gate verdicts into the running tally.
 *
 * A reminder has no evaluator — the reviewer attests to it. Counting one beside an evaluated
 * check would average a self-declaration into a pass rate, so it is listed as an attestation and
 * never as a pass.
 */
function foldVerdicts(record: ExecutionRecord, tally: LedgerTally): void {
  if (record.gateVerdicts.length === 0) return;
  tally.reviewedRecords += 1;

  for (const verdict of record.gateVerdicts) {
    if (verdict.tier === 'reminder') {
      tally.attestations += 1;
      continue;
    }
    const gate = tally.byGate.get(verdict.gateId) ?? { passed: 0, failed: 0 };
    if (verdict.verdict === 'PASS') gate.passed += 1;
    else gate.failed += 1;
    tally.byGate.set(verdict.gateId, gate);
  }
}

/** Pure fold over an already-scoped page of records — the whole derivation, in one place. */
function foldLedger(records: readonly ExecutionRecord[]): LedgerTally {
  const tally: LedgerTally = {
    records: records.length,
    completed: 0,
    failed: 0,
    averageDurationMs: 0,
    reviewedRecords: 0,
    attestations: 0,
    byGate: new Map(),
  };

  let durationTotal = 0;
  let durationSamples = 0;

  for (const record of records) {
    if (record.status === 'completed') tally.completed += 1;
    if (record.status === 'failed') tally.failed += 1;
    if (record.completedAt !== undefined) {
      durationTotal += record.completedAt - record.startedAt;
      durationSamples += 1;
    }
    foldVerdicts(record, tally);
  }

  tally.averageDurationMs = durationSamples > 0 ? durationTotal / durationSamples : 0;
  return tally;
}

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

  /**
   * Every per-workspace figure `system_control` reports, from one pass over the execution ledger
   * filtered to the request's scope.
   *
   * One derivation and one query on purpose. Before P4.87 the gate tally read the ledger with
   * this scope while every other figure in the same reply read a process-wide in-memory object,
   * so one reply mixed two populations — and Gate Adoption Rate divided one by the other. A
   * second running counter would drift from the ledger on restart anyway: the counter is in
   * memory, the ledger is not.
   *
   * `queryRecent` pages (default 50, hard ceiling 500), so these are counts over the most recent
   * page, not over all time. Callers say so when they render them.
   *
   * An `Execution Mode Distribution` section used to sit beside these, keyed on
   * `performanceTrends[].executionMode`. Only `updateAnalytics` can write that field, and only
   * from a `currentExecution` payload nobody passes, so the section rendered as a heading with
   * nothing under it on every server. It is gone with the counters.
   */
  protected tallyLedger(): LedgerTally {
    const records = this.context.executionRecordStore?.queryRecent(undefined, this.requestScope);
    return foldLedger(records ?? []);
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
