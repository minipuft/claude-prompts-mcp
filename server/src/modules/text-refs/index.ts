// @lifecycle canonical - Barrel exports for text reference utilities.
/**
 * Text Reference System (Canonical Chain Step Store)
 *
 * Provides a single source of truth for chain step results so every pipeline
 * stage, session manager, and template renderer reads from the same snapshot.
 */

import type { Logger } from '#shared/types/index.js';

import { NAMED_OUTPUT_NAMESPACE } from '#shared/utils/constants.js';

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
  /**
   * chainId -> outputMapping key -> the publishing step's whole content.
   *
   * Rendered under the reserved {@link NAMED_OUTPUT_NAMESPACE} object, never spread flat —
   * see {@link buildChainVariables}.
   */
  private readonly namedOutputs: Record<string, Record<string, string>> = {};

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Store a chain step result.
   * Canonical entrypoint for pipeline stages to persist user or placeholder output.
   *
   * If metadata.outputMapping is provided (e.g., { "findings": "output" }), the result is also
   * stored under those named keys, published to templates as `{{outputs.findings}}`.
   *
   * **The mapping's VALUES are not read** (P6-F2). Every key receives this step's whole
   * content, so `{ findings: 'output', verdict: 'output' }` publishes the same string twice
   * under two names. The value slot is reserved for a future sub-content selector; until a
   * selector exists, reading it would mean inventing semantics no author has written against.
   * The unread value is named in the debug line below rather than dropped silently.
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
      for (const [outputName, selector] of Object.entries(outputMapping)) {
        this.namedOutputs[chainId][outputName] = content;
        this.logger.debug(
          `[TextReferenceStore] Stored named output '${NAMED_OUTPUT_NAMESPACE}.${outputName}' for chain ${chainId} ` +
            `(whole step content; declared selector '${selector}' is not read — P6-F2)`
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
   *
   * Named outputs from `outputMapping` are published under the reserved
   * {@link NAMED_OUTPUT_NAMESPACE} object — `{{outputs.findings}}`, never `{{findings}}`.
   * The flat spread they used to get made them indistinguishable from an ordinary argument,
   * which is what let a withheld `chain_history` leak through an alias (P5-F2). There is no
   * dual read: the bare name is not published, so a template written against `{{findings}}`
   * renders empty and must migrate.
   *
   * Omitted entirely while empty, matching `previous_step_results` / `unknowns_ledger`, so a
   * template can branch on presence. A chain declaring no `outputMapping` therefore renders
   * byte-identically to a build without this namespace.
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

    // Named outputs land in their own namespace object, never spread flat.
    const namedOutputs = this.namedOutputs[chainId];
    if (namedOutputs && Object.keys(namedOutputs).length > 0) {
      variables[NAMED_OUTPUT_NAMESPACE] = { ...namedOutputs };
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
