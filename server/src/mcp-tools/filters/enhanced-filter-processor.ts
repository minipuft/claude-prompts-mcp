/**
 * Enhanced Filter Processor
 *
 * Applies advanced filter logic to prompt collections with support for
 * complex queries, fuzzy matching, and performance optimization.
 */

import { ConvertedPrompt } from '../../types/index.js';
import { FilterParseResult } from '../types/shared-types.js';
import { AdvancedFilterParser } from './advanced-filter-parser.js';

/**
 * Enhanced filter processor with advanced matching capabilities
 */
export class EnhancedFilterProcessor {
  private static readonly FUZZY_THRESHOLD = 0.6; // Fuzzy matching threshold

  /**
   * Apply filters to prompt collection
   */
  static filterPrompts(
    prompts: ConvertedPrompt[],
    filterString: string,
    options: {
      maxResults?: number;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
      fuzzyMatching?: boolean;
    } = {}
  ): {
    prompts: ConvertedPrompt[];
    totalMatches: number;
    filterSummary: string;
    suggestions?: string[];
  } {
    // Parse the filter
    const parsedFilter = AdvancedFilterParser.parseFilter(filterString);
    const validation = AdvancedFilterParser.validateFilter(filterString);

    // Filter prompts
    let filteredPrompts = prompts.filter(prompt =>
      this.matchesFilter(prompt, parsedFilter, options.fuzzyMatching || false)
    );

    // Sort results
    if (options.sortBy) {
      filteredPrompts = this.sortPrompts(filteredPrompts, options.sortBy, options.sortOrder || 'asc');
    }

    // Limit results
    const totalMatches = filteredPrompts.length;
    if (options.maxResults && options.maxResults > 0) {
      filteredPrompts = filteredPrompts.slice(0, options.maxResults);
    }

    // Generate filter summary
    const filterSummary = this.generateFilterSummary(parsedFilter, totalMatches);

    return {
      prompts: filteredPrompts,
      totalMatches,
      filterSummary,
      suggestions: validation.valid ? undefined : validation.suggestions
    };
  }

  /**
   * Check if prompt matches the parsed filter
   */
  private static matchesFilter(
    prompt: ConvertedPrompt,
    filter: FilterParseResult,
    fuzzyMatching: boolean
  ): boolean {
    // Check structured filters
    if (!this.matchesStructuredFilters(prompt, filter)) {
      return false;
    }

    // Check text search
    if (filter.textSearch && !this.matchesTextSearch(prompt, filter.textSearch, fuzzyMatching)) {
      return false;
    }

    // Handle boolean operators (simplified implementation)
    if (filter.operators) {
      return this.evaluateBooleanOperators(prompt, filter);
    }

    return true;
  }

  /**
   * Check if prompt matches structured filters
   */
  private static matchesStructuredFilters(
    prompt: ConvertedPrompt,
    filter: FilterParseResult
  ): boolean {
    const { structured } = filter;

    // Type filter
    if (structured.type && structured.type.length > 0) {
      const promptType = this.getPromptType(prompt);
      if (!structured.type.includes(promptType)) {
        return false;
      }
    }

    // Category filter
    if (structured.category && structured.category.length > 0) {
      if (!structured.category.includes(prompt.category.toLowerCase())) {
        return false;
      }
    }

    // Gates filter
    if (structured.gates !== undefined) {
      const hasGates = this.promptHasGates(prompt);
      if (structured.gates !== hasGates) {
        return false;
      }
    }

    // Confidence filter
    if (structured.confidence) {
      const confidence = this.getPromptConfidence(prompt);
      if (!this.evaluateComparison(confidence, structured.confidence.operator, structured.confidence.value)) {
        return false;
      }
    }

    // Date filter
    if (structured.created) {
      const createdDate = this.getPromptCreatedDate(prompt);
      if (createdDate && !this.evaluateComparison(createdDate.getTime(), structured.created.operator, structured.created.value.getTime())) {
        return false;
      }
    }

    // Complexity filter
    if (structured.complexity && structured.complexity.length > 0) {
      const complexity = this.getPromptComplexity(prompt);
      if (!structured.complexity.includes(complexity)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if prompt matches text search
   */
  private static matchesTextSearch(
    prompt: ConvertedPrompt,
    searchText: string,
    fuzzyMatching: boolean
  ): boolean {
    const searchFields = [
      prompt.name || '',
      prompt.description || '',
      prompt.category || '',
      ...(prompt.arguments?.map(arg => arg.name) || [])
    ];

    const searchContent = searchFields.join(' ').toLowerCase();
    const searchTerms = searchText.toLowerCase().split(/\s+/);

    if (fuzzyMatching) {
      return searchTerms.every(term =>
        this.fuzzyMatch(searchContent, term) >= this.FUZZY_THRESHOLD
      );
    } else {
      return searchTerms.every(term =>
        searchContent.includes(term)
      );
    }
  }

  /**
   * Evaluate boolean operators (simplified implementation)
   */
  private static evaluateBooleanOperators(
    prompt: ConvertedPrompt,
    filter: FilterParseResult
  ): boolean {
    // This is a simplified implementation
    // In a full implementation, you'd build an expression tree
    return true; // For now, just pass through
  }

  /**
   * Get prompt type
   */
  private static getPromptType(prompt: ConvertedPrompt): string {
    if (prompt.chainSteps && prompt.chainSteps.length > 0) {
      return 'chain';
    }
    // Simple heuristic: if it has variables, it's a template
    if (prompt.userMessageTemplate?.includes('{{')) {
      return 'template';
    }
    return 'prompt';
  }

  /**
   * Check if prompt has quality gates
   */
  private static promptHasGates(prompt: ConvertedPrompt): boolean {
    // This would check for actual gates in a real implementation
    // For now, use a simple heuristic
    return prompt.arguments && prompt.arguments.length > 2;
  }

  /**
   * Get prompt confidence score
   */
  private static getPromptConfidence(prompt: ConvertedPrompt): number {
    // Simple confidence calculation based on completeness
    let score = 50; // Base score

    if (prompt.description && prompt.description.length > 10) score += 20;
    if (prompt.arguments && prompt.arguments.length > 0) score += 15;
    if (prompt.userMessageTemplate && prompt.userMessageTemplate.length > 20) score += 10;
    if (prompt.systemMessage) score += 5;

    return Math.min(100, score);
  }

  /**
   * Get prompt created date
   */
  private static getPromptCreatedDate(prompt: ConvertedPrompt): Date | null {
    // In a real implementation, this would come from metadata
    // For now, return null
    return null;
  }

  /**
   * Get prompt complexity level
   */
  private static getPromptComplexity(prompt: ConvertedPrompt): string {
    const factors = [
      prompt.arguments?.length || 0,
      prompt.chainSteps?.length || 0,
      (prompt.userMessageTemplate?.match(/\{\{/g) || []).length,
      prompt.systemMessage ? 1 : 0
    ];

    const complexityScore = factors.reduce((sum, factor) => sum + factor, 0);

    if (complexityScore <= 2) return 'simple';
    if (complexityScore <= 5) return 'medium';
    if (complexityScore <= 8) return 'complex';
    return 'advanced';
  }

  /**
   * Evaluate comparison operators
   */
  private static evaluateComparison(
    value: number,
    operator: string,
    targetValue: number
  ): boolean {
    switch (operator) {
      case '>': return value > targetValue;
      case '<': return value < targetValue;
      case '>=': return value >= targetValue;
      case '<=': return value <= targetValue;
      case '=': return value === targetValue;
      default: return value === targetValue;
    }
  }

  /**
   * Fuzzy string matching using Jaro-Winkler algorithm (simplified)
   */
  private static fuzzyMatch(text: string, pattern: string): number {
    if (text === pattern) return 1.0;
    if (text.includes(pattern)) return 0.8;

    // Simple character-based similarity
    const longer = text.length > pattern.length ? text : pattern;
    const shorter = text.length > pattern.length ? pattern : text;

    if (longer.length === 0) return 1.0;

    const editDistance = this.levenshteinDistance(text, pattern);
    return (longer.length - editDistance) / longer.length;
  }

  /**
   * Calculate Levenshtein distance
   */
  private static levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i += 1) {
      matrix[0][i] = i;
    }

    for (let j = 0; j <= str2.length; j += 1) {
      matrix[j][0] = j;
    }

    for (let j = 1; j <= str2.length; j += 1) {
      for (let i = 1; i <= str1.length; i += 1) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1,
          matrix[j - 1][i] + 1,
          matrix[j - 1][i - 1] + indicator
        );
      }
    }

    return matrix[str2.length][str1.length];
  }

  /**
   * Sort prompts by specified field
   */
  private static sortPrompts(
    prompts: ConvertedPrompt[],
    sortBy: string,
    order: 'asc' | 'desc'
  ): ConvertedPrompt[] {
    return prompts.sort((a, b) => {
      let aValue: any;
      let bValue: any;

      switch (sortBy) {
        case 'name':
          aValue = a.name || '';
          bValue = b.name || '';
          break;
        case 'category':
          aValue = a.category || '';
          bValue = b.category || '';
          break;
        case 'complexity':
          aValue = this.getPromptComplexity(a);
          bValue = this.getPromptComplexity(b);
          break;
        case 'confidence':
          aValue = this.getPromptConfidence(a);
          bValue = this.getPromptConfidence(b);
          break;
        default:
          aValue = a.id || '';
          bValue = b.id || '';
      }

      const comparison = aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      return order === 'asc' ? comparison : -comparison;
    });
  }

  /**
   * Generate human-readable filter summary
   */
  private static generateFilterSummary(filter: FilterParseResult, matchCount: number): string {
    const parts: string[] = [];

    if (filter.structured.type) {
      parts.push(`Type: ${filter.structured.type.join(', ')}`);
    }

    if (filter.structured.category) {
      parts.push(`Category: ${filter.structured.category.join(', ')}`);
    }

    if (filter.structured.gates !== undefined) {
      parts.push(`Gates: ${filter.structured.gates ? 'Yes' : 'No'}`);
    }

    if (filter.structured.confidence) {
      parts.push(`Confidence: ${filter.structured.confidence.operator}${filter.structured.confidence.value}`);
    }

    if (filter.structured.complexity) {
      parts.push(`Complexity: ${filter.structured.complexity.join(', ')}`);
    }

    if (filter.textSearch) {
      parts.push(`Search: "${filter.textSearch}"`);
    }

    const summary = parts.length > 0
      ? `Filtered by: ${parts.join(', ')}`
      : 'No filters applied';

    return `${summary} • Found ${matchCount} ${matchCount === 1 ? 'match' : 'matches'}`;
  }
}