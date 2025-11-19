// @lifecycle canonical - Matches prompts against search filters.
/**
 * Matching and fuzzy search logic for prompt discovery
 */

import { Logger } from '../../../logging/index.js';
import { ConvertedPrompt } from '../../../types/index.js';
import { PromptClassification, SmartFilters } from '../core/types.js';

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

  /**
   * Find similar prompts based on content similarity
   */
  findSimilarPrompts(
    targetPrompt: ConvertedPrompt,
    allPrompts: ConvertedPrompt[],
    limit: number = 5
  ): ConvertedPrompt[] {
    const similarities = allPrompts
      .filter((p) => p.id !== targetPrompt.id)
      .map((prompt) => ({
        prompt,
        similarity: this.calculateSimilarity(targetPrompt, prompt),
      }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);

    return similarities.map((s) => s.prompt);
  }

  /**
   * Calculate similarity score between two prompts
   */
  private calculateSimilarity(prompt1: ConvertedPrompt, prompt2: ConvertedPrompt): number {
    let similarity = 0;

    // Category similarity
    if (prompt1.category === prompt2.category) {
      similarity += 30;
    }

    // Name similarity (basic word overlap)
    const name1Words = new Set(prompt1.name.toLowerCase().split(/\s+/));
    const name2Words = new Set(prompt2.name.toLowerCase().split(/\s+/));
    const nameOverlap = this.calculateSetOverlap(name1Words, name2Words);
    similarity += nameOverlap * 20;

    // Description similarity
    if (prompt1.description && prompt2.description) {
      const desc1Words = new Set(prompt1.description.toLowerCase().split(/\s+/));
      const desc2Words = new Set(prompt2.description.toLowerCase().split(/\s+/));
      const descOverlap = this.calculateSetOverlap(desc1Words, desc2Words);
      similarity += descOverlap * 15;
    }

    // Arguments similarity
    const args1Count = prompt1.arguments?.length || 0;
    const args2Count = prompt2.arguments?.length || 0;
    if (args1Count > 0 || args2Count > 0) {
      const argsSimilarity =
        1 - Math.abs(args1Count - args2Count) / Math.max(args1Count, args2Count, 1);
      similarity += argsSimilarity * 10;
    }

    // Chain steps similarity
    const chain1Count = prompt1.chainSteps?.length || 0;
    const chain2Count = prompt2.chainSteps?.length || 0;
    if (chain1Count > 0 || chain2Count > 0) {
      const chainSimilarity =
        1 - Math.abs(chain1Count - chain2Count) / Math.max(chain1Count, chain2Count, 1);
      similarity += chainSimilarity * 15;
    }

    return Math.min(similarity, 100); // Cap at 100
  }

  /**
   * Calculate overlap between two sets
   */
  private calculateSetOverlap(set1: Set<string>, set2: Set<string>): number {
    const intersection = new Set([...set1].filter((x) => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    return union.size > 0 ? intersection.size / union.size : 0;
  }

  /**
   * Search prompts with autocomplete suggestions
   */
  generateSearchSuggestions(partialQuery: string, allPrompts: ConvertedPrompt[]): string[] {
    const suggestions: string[] = [];
    const query = partialQuery.toLowerCase();

    // Suggest prompt names that start with the query
    const nameMatches = allPrompts
      .filter((p) => p.name.toLowerCase().startsWith(query))
      .map((p) => p.name)
      .slice(0, 3);

    suggestions.push(...nameMatches);

    // Suggest prompt IDs that start with the query
    const idMatches = allPrompts
      .filter((p) => p.id.toLowerCase().startsWith(query))
      .map((p) => p.id)
      .slice(0, 3);

    suggestions.push(...idMatches);

    // Suggest categories that start with the query
    const categories = [...new Set(allPrompts.map((p) => p.category))]
      .filter((cat) => cat.toLowerCase().startsWith(query))
      .slice(0, 2);

    suggestions.push(...categories.map((cat) => `category:${cat}`));

    return [...new Set(suggestions)].slice(0, 8); // Remove duplicates, limit to 8
  }

  /**
   * Highlight search terms in text
   */
  highlightSearchTerms(text: string, searchTerms: string[]): string {
    let highlighted = text;

    for (const term of searchTerms) {
      const regex = new RegExp(`(${term})`, 'gi');
      highlighted = highlighted.replace(regex, '**$1**');
    }

    return highlighted;
  }

  /**
   * Extract key phrases from prompt for indexing
   */
  extractKeyPhrases(prompt: ConvertedPrompt): string[] {
    const phrases: string[] = [];

    // Extract from name
    phrases.push(...prompt.name.toLowerCase().split(/\s+/));

    // Extract from description
    if (prompt.description) {
      phrases.push(...prompt.description.toLowerCase().split(/\s+/));
    }

    // Extract from category
    phrases.push(prompt.category);

    // Extract from argument names
    if (prompt.arguments) {
      phrases.push(...prompt.arguments.map((arg) => arg.name.toLowerCase()));
    }

    // Filter out common words and short phrases
    const filtered = phrases
      .filter((phrase) => phrase.length > 2)
      .filter((phrase) => !['the', 'and', 'for', 'with', 'this', 'that'].includes(phrase));

    return [...new Set(filtered)]; // Remove duplicates
  }
}
