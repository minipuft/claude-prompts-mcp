// @lifecycle canonical - Matches prompts against search filters.
/**
 * Matching and fuzzy search logic for prompt discovery
 */

import { PromptClassification, SmartFilters } from '../core/types.js';

import type { ConvertedPrompt } from '#engine/execution/types.js';

import { type Logger } from '#shared/types/index.js';

/**
 * Prompt matching engine with fuzzy search capabilities
 */
export class PromptMatcher {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Check if prompt matches the provided filters
   */
  async matchesFilters(
    prompt: ConvertedPrompt,
    filters: SmartFilters,
    classification: PromptClassification
  ): Promise<boolean> {
    // Debug logging
    this.logger.info(`Filtering prompt ${prompt.id}:`, {
      filters,
      executionType: classification.executionType,
      category: prompt.category,
    });

    // Empty filters match everything
    if (Object.keys(filters).length === 0) return true;

    // Type filter
    if (filters.type && classification.executionType !== filters.type) {
      this.logger.info(`Type filter rejected: ${classification.executionType} !== ${filters.type}`);
      return false;
    }

    // Category filter
    if (filters.category && prompt.category !== filters.category) {
      return false;
    }

    // Execution requirement filter
    if (filters.execution !== undefined && filters.execution !== classification.requiresExecution) {
      return false;
    }

    // Gates filter
    if (filters.gates !== undefined) {
      const hasGates = classification.suggestedGates.length > 0;
      if (filters.gates !== hasGates) {
        return false;
      }
    }

    // Intent-based matching
    if (filters.intent && !this.matchesIntent(prompt, classification, filters.intent)) {
      return false;
    }

    // Text search with fuzzy matching
    if (filters.text && !this.matchesTextSearch(prompt, classification, filters.text)) {
      return false;
    }

    return true;
  }

  /**
   * Intent-based matching against category and semantic content
   */
  private matchesIntent(
    prompt: ConvertedPrompt,
    classification: PromptClassification,
    intent: string
  ): boolean {
    const intentSearchable = [
      prompt.category,
      prompt.name,
      prompt.description,
      classification.executionType,
      ...classification.reasoning,
      ...classification.suggestedGates,
    ]
      .join(' ')
      .toLowerCase();

    // Check if intent matches category, content, or reasoning
    return intentSearchable.includes(intent.toLowerCase());
  }

  /**
   * Enhanced text search with fuzzy matching
   */
  private matchesTextSearch(
    prompt: ConvertedPrompt,
    classification: PromptClassification,
    searchText: string
  ): boolean {
    const searchWords = searchText.toLowerCase().split(/\s+/);
    const searchable = [
      prompt.id,
      prompt.name,
      prompt.description,
      classification.executionType,
      ...classification.suggestedGates,
    ]
      .join(' ')
      .toLowerCase();

    // Check if all search words are found (allows partial word matching)
    return searchWords.every((word: string) => {
      return (
        searchable.includes(word) ||
        // Basic fuzzy match - check if any searchable word starts with the search word
        searchable
          .split(/\s+/)
          .some(
            (searchableWord: string) =>
              searchableWord.startsWith(word) || word.startsWith(searchableWord.slice(0, 3))
          )
      );
    });
  }

  /**
   * Calculate relevance score for search results ordering
   */
  calculateRelevanceScore(
    prompt: ConvertedPrompt,
    classification: PromptClassification,
    filters: SmartFilters
  ): number {
    let score = 0;

    // Base score from classification confidence
    score += classification.confidence * 10;

    // Boost for exact matches
    if (filters.text) {
      const searchText = filters.text.toLowerCase();

      // Exact name match gets highest boost
      if (prompt.name.toLowerCase().includes(searchText)) {
        score += 50;
      }

      // Exact ID match gets high boost
      if (prompt.id.toLowerCase().includes(searchText)) {
        score += 40;
      }

      // Description match gets medium boost
      if (prompt.description?.toLowerCase().includes(searchText)) {
        score += 20;
      }

      // Category match gets small boost
      if (prompt.category.toLowerCase().includes(searchText)) {
        score += 10;
      }
    }

    // Boost for type matches
    if (filters.type && classification.executionType === filters.type) {
      score += 15;
    }

    // Boost for category matches
    if (filters.category && prompt.category === filters.category) {
      score += 15;
    }

    // Boost for prompts with quality gates
    if (classification.suggestedGates.length > 0) {
      score += 5;
    }

    // Boost for framework-ready prompts
    if (classification.requiresFramework) {
      score += 5;
    }

    return score;
  }
}
