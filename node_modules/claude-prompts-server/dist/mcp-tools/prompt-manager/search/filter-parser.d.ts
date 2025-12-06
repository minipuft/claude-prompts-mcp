/**
 * Intelligent filter parsing for prompt discovery
 */
import { Logger } from '../../../logging/index.js';
import { SmartFilters } from '../core/types.js';
/**
 * Filter parsing engine for intelligent prompt discovery
 */
export declare class FilterParser {
    private logger;
    constructor(logger: Logger);
    /**
     * Parse intelligent filters for list operation
     */
    parseIntelligentFilters(filterText: string): SmartFilters;
    /**
     * Parse type filter (type:prompt, type:template, type:chain)
     */
    private parseTypeFilter;
    /**
     * Parse category filter (category:code, category:analysis)
     */
    private parseCategoryFilter;
    /**
     * Parse intent filter (intent:debugging, intent:analysis)
     */
    private parseIntentFilter;
    /**
     * Parse execution requirement filter (execution:required, execution:optional)
     */
    private parseExecutionFilter;
    /**
     * Parse gates filter (gates:yes, gates:no)
     */
    private parseGatesFilter;
    /**
     * Extract text search terms after removing filter syntax
     */
    private extractTextFilter;
    /**
     * Build filter description for display
     */
    buildFilterDescription(filters: SmartFilters): string[];
    /**
     * Generate filter examples for help
     */
    getFilterExamples(): string[];
    /**
     * Suggest filters based on common patterns
     */
    suggestFilters(searchText: string): string[];
    /**
     * Validate filter combination
     */
    validateFilterCombination(filters: SmartFilters): {
        valid: boolean;
        warnings: string[];
    };
}
