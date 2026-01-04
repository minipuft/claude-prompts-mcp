// @lifecycle canonical - Barrel exports for text reference utilities.
/**
 * Text Reference System (Canonical Chain Step Store)
 *
 * Provides a single source of truth for chain step results so every pipeline
 * stage, session manager, and template renderer reads from the same snapshot.
 */
export class TextReferenceManager {
    constructor(logger) {
        this.chainStepResults = {};
        // Named outputs from outputMapping (e.g., { "chainId": { "findings": "content" } })
        this.namedOutputs = {};
        this.logger = logger;
    }
    /**
     * Store a chain step result.
     * Canonical entrypoint for pipeline stages to persist user or placeholder output.
     *
     * If metadata.outputMapping is provided (e.g., { "findings": "output" }),
     * the result will also be stored under those named keys for semantic access.
     */
    storeChainStepResult(chainId, stepNumber, content, metadata) {
        if (!this.chainStepResults[chainId]) {
            this.chainStepResults[chainId] = {};
        }
        const stepResult = {
            content,
            timestamp: Date.now(),
        };
        if (metadata) {
            stepResult.metadata = metadata;
        }
        this.chainStepResults[chainId][stepNumber] = stepResult;
        this.logger.debug(`[TextReferenceManager] Stored step ${stepNumber} result for chain ${chainId} (${content.length} chars)`);
        // Store under named outputs if outputMapping is provided
        const outputMapping = metadata?.['outputMapping'];
        if (outputMapping) {
            if (!this.namedOutputs[chainId]) {
                this.namedOutputs[chainId] = {};
            }
            for (const outputName of Object.keys(outputMapping)) {
                this.namedOutputs[chainId][outputName] = content;
                this.logger.debug(`[TextReferenceManager] Stored named output '${outputName}' for chain ${chainId}`);
            }
        }
    }
    /**
     * Retrieve all step results for a chain as a map of step -> content.
     */
    getChainStepResults(chainId) {
        const chainResults = this.chainStepResults[chainId] || {};
        const results = {};
        Object.entries(chainResults).forEach(([stepNum, stepData]) => {
            results[Number(stepNum)] = stepData.content;
        });
        return results;
    }
    /**
     * Retrieve a specific step result.
     */
    getChainStepResult(chainId, stepNumber) {
        return this.chainStepResults[chainId]?.[stepNumber]?.content ?? null;
    }
    /**
     * Build template variables for downstream execution ({{stepN_result}}, {{previous_step_result}}, etc.).
     * Also includes any named outputs from outputMapping (e.g., {{findings}}).
     */
    buildChainVariables(chainId) {
        const stepResults = this.getChainStepResults(chainId);
        const variables = {};
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
    getChainStepMetadata(chainId, stepNumber) {
        return this.chainStepResults[chainId]?.[stepNumber]?.metadata ?? null;
    }
    /**
     * Clear all stored step results for a chain (used when sessions reset).
     */
    clearChainStepResults(chainId) {
        delete this.chainStepResults[chainId];
        delete this.namedOutputs[chainId];
        this.logger.debug(`[TextReferenceManager] Cleared all step results for chain ${chainId}`);
    }
    /**
     * Aggregate statistics about stored chains and steps.
     */
    getChainStats() {
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
    getStats() {
        return this.getChainStats();
    }
}
export { ArgumentHistoryTracker } from './argument-history-tracker.js';
//# sourceMappingURL=index.js.map