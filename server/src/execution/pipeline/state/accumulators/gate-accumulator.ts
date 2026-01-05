// @lifecycle canonical - Centralized gate collection with automatic deduplication.

import { GATE_SOURCE_PRIORITY } from '../types.js';

import type { Logger } from '../../../../logging/index.js';
import type { GateEntry, GateSource, GateSourceCounts } from '../types.js';

/**
 * Centralized gate collection with automatic deduplication.
 *
 * All pipeline stages MUST use this accumulator to add gates.
 * Direct mutation of gate arrays is prohibited.
 *
 * @example
 * ```typescript
 * // In a pipeline stage
 * context.gates.add('research-quality', 'registry-auto');
 * context.gates.addAll(methodologyGates, 'methodology');
 *
 * // Get final deduplicated list
 * const finalGates = context.gates.getAll();
 * ```
 */
export class GateAccumulator {
  private readonly gates = new Map<string, GateEntry>();
  private readonly logger: Logger;
  private frozen = false;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Add a gate with source tracking and automatic deduplication.
   *
   * If gate already exists:
   * - Higher priority source wins
   * - Same priority: first-in wins (no override)
   *
   * @returns true if gate was added/updated, false if skipped
   */
  add(gateId: string, source: GateSource, metadata?: Record<string, unknown>): boolean {
    if (this.frozen) {
      this.logger.warn('[GateAccumulator] Attempted to add gate after freeze', { gateId, source });
      return false;
    }

    const trimmedId = gateId?.trim();
    if (!trimmedId) {
      return false;
    }

    const priority = GATE_SOURCE_PRIORITY[source];
    const existing = this.gates.get(trimmedId);

    if (existing) {
      if (priority <= existing.priority) {
        this.logger.debug('[GateAccumulator] Skipped duplicate gate', {
          gateId: trimmedId,
          attemptedSource: source,
          existingSource: existing.source,
        });
        return false;
      }
      this.logger.debug('[GateAccumulator] Overriding gate with higher priority source', {
        gateId: trimmedId,
        oldSource: existing.source,
        newSource: source,
      });
    }

    const entry: GateEntry = {
      id: trimmedId,
      source,
      priority,
      addedAt: Date.now(),
      ...(metadata ? { metadata } : {}),
    };

    this.gates.set(trimmedId, entry);

    return true;
  }

  /**
   * Add multiple gates from the same source.
   *
   * @returns Number of gates actually added (excluding duplicates)
   */
  addAll(
    gateIds: readonly string[] | undefined,
    source: GateSource,
    metadata?: Record<string, unknown>
  ): number {
    if (!Array.isArray(gateIds)) {
      return 0;
    }
    return gateIds.filter((id) => this.add(id, source, metadata)).length;
  }

  /**
   * Check if a gate has been added (from any source).
   */
  has(gateId: string): boolean {
    return this.gates.has(gateId?.trim());
  }

  /**
   * Get all accumulated gate IDs (deduplicated).
   */
  getAll(): readonly string[] {
    return Array.from(this.gates.keys());
  }

  /**
   * Get gates filtered by source.
   */
  getBySource(source: GateSource): readonly string[] {
    return Array.from(this.gates.values())
      .filter((entry) => entry.source === source)
      .map((entry) => entry.id);
  }

  /**
   * Get full entry details (for debugging/auditing).
   */
  getEntries(): readonly GateEntry[] {
    return Array.from(this.gates.values());
  }

  /**
   * Get count of gates by source (for metrics).
   */
  getSourceCounts(): GateSourceCounts {
    const counts: GateSourceCounts = {};
    for (const entry of this.gates.values()) {
      counts[entry.source] = (counts[entry.source] ?? 0) + 1;
    }
    return counts;
  }

  /**
   * Freeze the accumulator - no more additions allowed.
   * Call this after all stages have contributed.
   */
  freeze(): void {
    this.frozen = true;
    this.logger.debug('[GateAccumulator] Frozen with gates', {
      count: this.gates.size,
      sources: this.getSourceCounts(),
    });
  }

  /**
   * Check if accumulator is frozen.
   */
  isFrozen(): boolean {
    return this.frozen;
  }

  /**
   * Clear all gates (for testing or reset).
   */
  clear(): void {
    if (this.frozen) {
      this.logger.warn('[GateAccumulator] Attempted to clear after freeze');
      return;
    }
    this.gates.clear();
  }

  /**
   * Get total gate count.
   */
  get size(): number {
    return this.gates.size;
  }
}
