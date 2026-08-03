// @lifecycle canonical - Pipeline state types for accumulators.

/**
 * Source tracking for gate additions.
 * Each source represents where a gate ID came from in the pipeline.
 */
export type GateSource =
  | 'inline-operator' // From :: operator in command, including judge-phase selections
  | 'framework-guide' // From framework guide
  | 'prompt-config' // From prompt/folder configuration
  | 'temporary-request' // User-provided temporary gate
  | 'chain-level' // From chain's finalValidation
  | 'registry-auto'; // From GateManager.selectGates() based on activation rules

/**
 * Priority levels for conflict resolution.
 * Higher number = higher priority (wins in conflicts).
 *
 * Priority order (highest to lowest):
 * 1. inline-operator (100) - User explicitly typed :: "criteria", including the
 *    re-invocation that answers a judge menu
 * 2. temporary-request (80) - User-provided gate spec via MCP
 * 3. prompt-config (60) - Prompt author's configured gates
 * 4. chain-level (50) - Chain's finalValidation configuration
 * 5. framework (40) - Framework gates
 * 6. registry-auto (20) - GateManager.selectGates() activation rules - lowest
 *
 * Rank 90 (`client-selection`) was removed 2026-08-02: it had no producer in any
 * revision, and the judge menu directs re-entry through `::`, so a judge-phase
 * choice arrives at rank 100. See ADR 0001 § Amendment.
 */
export const GATE_SOURCE_PRIORITY: Record<GateSource, number> = {
  'inline-operator': 100, // Explicit user intent - highest
  'temporary-request': 80, // User-provided gate spec
  'prompt-config': 60, // Prompt author's intent
  'chain-level': 50, // Chain configuration
  'framework-guide': 40, // Framework-derived
  'registry-auto': 20, // GateManager.selectGates() activation rules - lowest
} as const;

/**
 * Entry in the gate accumulator with full provenance tracking.
 */
export interface GateEntry {
  readonly id: string;
  readonly source: GateSource;
  readonly priority: number;
  readonly addedAt: number;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Diagnostic entry for warnings/errors collected across pipeline stages.
 */
export interface DiagnosticEntry {
  readonly level: 'error' | 'warning' | 'info' | 'debug';
  readonly stage: string;
  readonly message: string;
  readonly code?: string;
  readonly timestamp: number;
  readonly context?: Record<string, unknown>;
}

/**
 * Summary of gate counts by source for metrics/debugging.
 */
export type GateSourceCounts = Partial<Record<GateSource, number>>;

/**
 * Summary of diagnostic counts by level.
 */
export type DiagnosticLevelCounts = Record<DiagnosticEntry['level'], number>;
