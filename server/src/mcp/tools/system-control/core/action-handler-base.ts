// @lifecycle canonical - Abstract base class for system_control action handlers.

import type { FrameworkManager } from '#engine/frameworks/framework-manager.js';
import type { FrameworkStateStore } from '#engine/frameworks/framework-state-store.js';
import type { GateStateStore } from '#engine/gates/gate-state-store.js';
import type { ExecutionRecord, GateVerdictSummary } from '#shared/types/chain-execution.js';
import type {
  StateStoreOptions,
  ConfigManager,
  Logger,
  ToolResponse,
} from '#shared/types/index.js';
import type { SystemControlContext } from './types.js';

export interface GateOutcomeTally {
  passed: number;
  failed: number;
  bypassed: number;
  reminderAttestations: number;
  semanticReportAcceptance: { accepted: number; rejected: number; invalid: number };
  recordedToolChecks: { passed: number; notPassed: number };
  legacyUnverifiedAcceptance: { passed: number; failed: number };
  dispositions: { held: number; advisoryCleared: number; informationalCleared: number };
}

/** What one scoped page of the execution ledger says; acceptance is not model accuracy. */
export interface LedgerTally {
  records: number;
  completed: number;
  failed: number;
  averageDurationMs: number;
  reviewedRecords: number;
  attestations: number;
  byGate: Map<string, GateOutcomeTally>;
}

function emptyGateTally(): GateOutcomeTally {
  return {
    passed: 0,
    failed: 0,
    bypassed: 0,
    reminderAttestations: 0,
    semanticReportAcceptance: { accepted: 0, rejected: 0, invalid: 0 },
    recordedToolChecks: { passed: 0, notPassed: 0 },
    legacyUnverifiedAcceptance: { passed: 0, failed: 0 },
    dispositions: { held: 0, advisoryCleared: 0, informationalCleared: 0 },
  };
}

function foldGateOutcome(verdict: GateVerdictSummary, gate: GateOutcomeTally): void {
  if (verdict.verdict === 'BYPASS' || verdict.disposition === 'bypassed') {
    gate.bypassed += 1;
    return; // Contextual bypassReview.checkResults belong to older attempts, never this action.
  }
  foldDisposition(verdict.disposition, gate.dispositions);
  const tools = verdict.toolChecks ?? [];
  const semantic = verdict.semanticResult;
  if (verdict.tier === 'reminder') {
    gate.reminderAttestations += 1;
    if (semantic === undefined && tools.length === 0) return;
  }
  if (verdict.verdict === 'PASS') gate.passed += 1;
  if (verdict.verdict === 'FAIL') gate.failed += 1;
  foldSemanticReport(semantic, gate.semanticReportAcceptance);
  for (const tool of tools) {
    if (tool.passed) gate.recordedToolChecks.passed += 1;
    else gate.recordedToolChecks.notPassed += 1;
  }
  foldLegacyAcceptance(verdict, gate);
}

function foldDisposition(
  disposition: GateVerdictSummary['disposition'],
  tally: GateOutcomeTally['dispositions']
): void {
  if (disposition === 'held') tally.held += 1;
  if (disposition === 'advisory-cleared') tally.advisoryCleared += 1;
  if (disposition === 'informational-cleared') tally.informationalCleared += 1;
}

function foldSemanticReport(
  result: GateVerdictSummary['semanticResult'],
  tally: GateOutcomeTally['semanticReportAcceptance']
): void {
  if (result === undefined) return;
  if (!result.valid) tally.invalid += 1;
  else if (result.passed) tally.accepted += 1;
  else tally.rejected += 1;
}

function foldLegacyAcceptance(verdict: GateVerdictSummary, gate: GateOutcomeTally): void {
  if (verdict.semanticResult !== undefined || (verdict.toolChecks?.length ?? 0) > 0) return;
  if (verdict.verdict === 'PASS') gate.legacyUnverifiedAcceptance.passed += 1;
  if (verdict.verdict === 'FAIL') gate.legacyUnverifiedAcceptance.failed += 1;
}

function foldVerdicts(record: ExecutionRecord, tally: LedgerTally): void {
  if (record.gateVerdicts.length === 0) return;
  tally.reviewedRecords += 1;
  for (const verdict of record.gateVerdicts) {
    const gate = tally.byGate.get(verdict.gateId) ?? emptyGateTally();
    foldGateOutcome(verdict, gate);
    tally.byGate.set(verdict.gateId, gate);
    if (
      verdict.tier === 'reminder' &&
      verdict.verdict !== 'BYPASS' &&
      verdict.disposition !== 'bypassed'
    )
      tally.attestations += 1;
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
}
