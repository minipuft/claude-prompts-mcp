/**
 * Matching and fuzzy search logic for prompt discovery
 */
import { Logger } from '../../../logging/index.js';
import { ConvertedPrompt } from '../../../types/index.js';
import { PromptClassification, SmartFilters } from '../core/types.js';
/**
 * Prompt matching engine with fuzzy search capabilities
 */
export declare class PromptMatcher {
    private logger;
    constructor(logger: Logger);
    /**
     * Check if prompt matches the provided filters
     */
    matchesFilters(prompt: ConvertedPrompt, filters: SmartFilters, classification: PromptClassification): Promise<boolean>;
    /**
     * Intent-based matching against category and semantic content
     */
    private matchesIntent;
    /**
     * Enhanced text search with fuzzy matching
     */
    private matchesTextSearch;
    /**
     * Calculate relevance score for search results ordering
     */
    calculateRelevanceScore(prompt: ConvertedPrompt, classification: PromptClassification, filters: SmartFilters): number;
    /**
     * Find similar prompts based on content similarity
     */
    findSimilarPrompts(targetPrompt: ConvertedPrompt, allPrompts: ConvertedPrompt[], limit?: number): ConvertedPrompt[];
    /**
     * Calculate similarity score between two prompts
     */
    private calculateSimilarity;
    /**
     * Calculate overlap between two sets
     */
    private calculateSetOverlap;
    /**
     * Search prompts with autocomplete suggestions
     */
    generateSearchSuggestions(partialQuery: string, allPrompts: ConvertedPrompt[]): string[];
    /**
     * Highlight search terms in text
     */
    highlightSearchTerms(text: string, searchTerms: string[]): string;
    /**
     * Extract key phrases from prompt for indexing
     */
    extractKeyPhrases(prompt: ConvertedPrompt): string[];
}
