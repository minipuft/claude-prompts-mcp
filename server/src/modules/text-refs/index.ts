// @lifecycle canonical - Barrel exports for text reference utilities.
/**
 * Text Reference System (Canonical Chain Step Store)
 *
 * Provides a single source of truth for chain step results so every pipeline
 * stage, session manager, and template renderer reads from the same snapshot.
 */

import type { Logger } from '#shared/types/index.js';

type StoredStepResult = {
  content: string;
  timestamp: number;
  /**
   * Position the step held when its result was stored.
   *
   * Kept alongside the node-id key rather than used as the key: identity is what survives a
   * reordered or extended chain, but the *rendered* contract (`stepN_result`,
   * `previous_step_results`) is positional and templates already depend on those names.
   */
  ordinal: number;
  metadata?: Record<string, any>;
};

export class TextReferenceStore {
  private readonly logger: Logger;
  /** chainId -> nodeId -> result. Node-keyed since P3 Tier 2; was step-number-keyed. */
  private readonly chainStepResults: Record<string, Record<string, StoredStepResult>> = {};
  // Named outputs from outputMapping (e.g., { "chainId": { "findings": "content" } })
  private readonly namedOutputs: Record<string, Record<string, string>> = {};

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Store a chain step result.
   * Canonical entrypoint for pipeline stages to persist user or placeholder output.
   *
   * If metadata.outputMapping is provided (e.g., { "findings": "output" }),
   * the result will also be stored under those named keys for semantic access.
   */
  storeChainStepResult(
    chainId: string,
    nodeId: string,
    content: string,
    metadata?: Record<string, any>,
    ordinal?: number
  ): void {
    if (!this.chainStepResults[chainId]) {
      this.chainStepResults[chainId] = {};
    }

    const chainResults = this.chainStepResults[chainId];
    const stepResult: StoredStepResult = {
      content,
      timestamp: Date.now(),
      // No ordinal supplied (callers with no node list) falls back to insertion index, which
      // is the only position information available at that point.
      ordinal: ordinal ?? chainResults[nodeId]?.ordinal ?? Object.keys(chainResults).length,
    };
    if (metadata) {
      stepResult.metadata = metadata;
    }
    chainResults[nodeId] = stepResult;

    this.logger.debug(
      `[TextReferenceStore] Stored node ${nodeId} result for chain ${chainId} (${content.length} chars)`
    );

    // Store under named outputs if outputMapping is provided
    const outputMapping = metadata?.['outputMapping'] as Record<string, string> | undefined;
    if (outputMapping) {
      if (!this.namedOutputs[chainId]) {
        this.namedOutputs[chainId] = {};
      }
      for (const outputName of Object.keys(outputMapping)) {
        this.namedOutputs[chainId][outputName] = content;
        this.logger.debug(
          `[TextReferenceStore] Stored named output '${outputName}' for chain ${chainId}`
        );
      }
    }
  }

  /**
   * Retrieve all step results for a chain as a map of position -> content.
   *
   * Position-keyed on purpose: this is the read shape the rendering context and its consumers
   * already expect. Address a single result by node id via {@link getChainStepResult}.
   */
  getChainStepResults(chainId: string): Record<number, string> {
    const chainResults = this.chainStepResults[chainId] || {};
    const results: Record<number, string> = {};

    Object.values(chainResults).forEach((stepData) => {
      results[stepData.ordinal] = stepData.content;
    });

    return results;
  }

  /**
   * Retrieve a specific step result by node id.
   */
  getChainStepResult(chainId: string, nodeId: string): string | null {
    return this.chainStepResults[chainId]?.[nodeId]?.content ?? null;
  }

  /**
   * Build template variables for downstream execution ({{stepN_result}}, {{previous_step_result}}, etc.).
   * Also includes any named outputs from outputMapping (e.g., {{findings}}).
   */
  buildChainVariables(chainId: string): Record<string, any> {
    const stepResults = this.getChainStepResults(chainId);
    const variables: Record<string, any> = {};

    Object.entries(stepResults).forEach(([stepNum, content]) => {
      const stepIndex = Number(stepNum);
      variables[`step${stepIndex + 1}_result`] = content;
      variables[`previous_step_result`] = content;
    });

    variables['chain_id'] = chainId;
    variables['step_results'] = stepResults;

    // Include named outputs from outputMapping
    const namedOutputs = this.namedOutputs[chainId];
    if (namedOutputs) {
      Object.assign(variables, namedOutputs);
    }

    return variables;
  }

  /**
   * Retrieve metadata stored for a specific step result.
   */
  getChainStepMetadata(chainId: string, nodeId: string): Record<string, any> | null {
    return this.chainStepResults[chainId]?.[nodeId]?.metadata ?? null;
  }

  /**
   * Clear all stored step results for a chain (used when sessions reset).
   */
  clearChainStepResults(chainId: string): void {
    delete this.chainStepResults[chainId];
    delete this.namedOutputs[chainId];
    this.logger.debug(`[TextReferenceStore] Cleared all step results for chain ${chainId}`);
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
      const chainSteps = this.chainStepResults[chainId];
      if (chainSteps) {
        totalSteps += Object.keys(chainSteps).length;
      }
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
  getStats(): ReturnType<TextReferenceStore['getChainStats']> {
    return this.getChainStats();
  }
}

export { ArgumentHistoryTracker } from './argument-history-tracker.js';
export type { ArgumentHistoryEntry, ReviewContext, PersistedArgumentHistory } from './types.js';
