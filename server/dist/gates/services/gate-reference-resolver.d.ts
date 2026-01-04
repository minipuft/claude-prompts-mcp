import type { GateDefinitionProvider } from '../core/gate-loader.js';
export type GateReferenceResolution = {
    referenceType: 'registered';
    gateId: string;
} | {
    referenceType: 'inline';
    criteria: string;
    /** Fuzzy match suggestions if criteria looks like a mistyped gate ID */
    suggestions?: string[];
};
/**
 * Resolves inline gate references by checking whether they match
 * canonical gate definitions or should remain inline criteria.
 *
 * Gate resolution is now fully dynamic - gates are identified by loading
 * from the definitions directory via GateLoader. No hardcoded gate sets.
 *
 * Includes fuzzy matching to suggest similar gate IDs for typos.
 */
export declare class GateReferenceResolver {
    private readonly gateLoader;
    private readonly cache;
    constructor(gateLoader: GateDefinitionProvider);
    resolve(reference: string): Promise<GateReferenceResolution>;
    private computeResolution;
    /**
     * Find similar gate IDs using fuzzy matching (Levenshtein distance)
     * Returns suggestions for typos within edit distance of 3
     */
    private findSuggestions;
    private isGateSlug;
    private buildCandidates;
}
