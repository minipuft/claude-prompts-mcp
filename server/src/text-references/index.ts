// @lifecycle canonical - Barrel exports for text reference utilities.
/**
 * Text Reference System (Canonical Chain Step Store)
 *
 * Provides a single source of truth for chain step results so every pipeline
 * stage, session manager, and template renderer reads from the same snapshot.
 */

import { Logger } from '../logging/index.js';

type StoredStepResult = {
  content: string;
  timestamp: number;
  metadata?: Record<string, any>;
};

export class TextReferenceManager {
  private readonly logger: Logger;
  private readonly chainStepResults: Record<string, Record<number, StoredStepResult>> = {};

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Store a chain step result.
   * Canonical entrypoint for pipeline stages to persist user or placeholder output.
   */
  storeChainStepResult(
    chainId: string,
    stepNumber: number,
    content: string,
    metadata?: Record<string, any>
  ): void {
    if (!this.chainStepResults[chainId]) {
      this.chainStepResults[chainId] = {};
    }

    this.chainStepResults[chainId][stepNumber] = {
      content,
      timestamp: Date.now(),
      metadata,
    };

    this.logger.debug(
      `[TextReferenceManager] Stored step ${stepNumber} result for chain ${chainId} (${content.length} chars)`
    );
  }

  /**
   * Retrieve all step results for a chain as a map of step -> content.
   */
  getChainStepResults(chainId: string): Record<number, string> {
    const chainResults = this.chainStepResults[chainId] || {};
    const results: Record<number, string> = {};

    Object.entries(chainResults).forEach(([stepNum, stepData]) => {
      results[Number(stepNum)] = stepData.content;
    });

    return results;
  }

  /**
   * Retrieve a specific step result.
   */
  getChainStepResult(chainId: string, stepNumber: number): string | null {
    return this.chainStepResults[chainId]?.[stepNumber]?.content ?? null;
  }

  /**
   * Build template variables for downstream execution ({{stepN_result}}, {{previous_step_result}}, etc.).
   */
  buildChainVariables(chainId: string): Record<string, any> {
    const stepResults = this.getChainStepResults(chainId);
    const variables: Record<string, any> = {};

    Object.entries(stepResults).forEach(([stepNum, content]) => {
      const stepIndex = Number(stepNum);
      variables[`step${stepIndex + 1}_result`] = content;
      variables[`previous_step_result`] = content;
      variables[`input`] = content;
    });

    variables['chain_id'] = chainId;
    variables['step_results'] = stepResults;

    return variables;
  }

  /**
   * Retrieve metadata stored for a specific step result.
   */
  getChainStepMetadata(chainId: string, stepNumber: number): Record<string, any> | null {
    return this.chainStepResults[chainId]?.[stepNumber]?.metadata ?? null;
  }

  /**
   * Clear all stored step results for a chain (used when sessions reset).
   */
  clearChainStepResults(chainId: string): void {
    delete this.chainStepResults[chainId];
    this.logger.debug(`[TextReferenceManager] Cleared all step results for chain ${chainId}`);
  }

  /**
   * Aggregate statistics about stored chains and steps.
   */
  getChainStats(): {
    totalChains: number;
    totalSteps: number;
    chainsWithSteps: string[];
  } {
    const chainIds = Object.keys(this.chainStepResults);
    let totalSteps = 0;

    chainIds.forEach((chainId) => {
      totalSteps += Object.keys(this.chainStepResults[chainId]).length;
    });

    return {
      totalChains: chainIds.length,
      totalSteps,
      chainsWithSteps: chainIds,
    };
  }

  /**
   * Canonical stats accessor used by diagnostics.
   */
  getStats(): ReturnType<TextReferenceManager['getChainStats']> {
    return this.getChainStats();
  }
}

export { ArgumentHistoryTracker } from './argument-history-tracker.js';
export type { ArgumentHistoryEntry, ReviewContext, PersistedArgumentHistory } from './types.js';
