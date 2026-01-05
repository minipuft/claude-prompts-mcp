// @lifecycle canonical - Parses filter expressions for prompt searches.
/**
 * Intelligent filter parsing for prompt discovery
 */

import { Logger } from '../../../logging/index.js';
import { SmartFilters } from '../core/types.js';
import { validateFilterSyntax } from '../utils/validation.js';

/**
 * Filter parsing engine for intelligent prompt discovery
 */
export class FilterParser {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Parse intelligent filters for list operation
   */
  parseIntelligentFilters(filterText: string): SmartFilters {
    const filters: SmartFilters = {};

    if (!filterText) return filters;

    try {
      // Validate filter syntax
      validateFilterSyntax(filterText);

      // Parse various filter patterns
      this.parseTypeFilter(filterText, filters);
      this.parseCategoryFilter(filterText, filters);
      this.parseIntentFilter(filterText, filters);
      this.parseExecutionFilter(filterText, filters);
      this.parseGatesFilter(filterText, filters);

      // Extract remaining text as search term
      const cleanedText = this.extractTextFilter(filterText);
      if (cleanedText) {
        filters.text = cleanedText;
      }

      this.logger.info(`Parsed filters for "${filterText}":`, filters);
    } catch (error) {
      this.logger.warn(
        `Filter parsing error: ${error instanceof Error ? error.message : String(error)}`
      );
      // Return text-only filter as fallback
      if (filterText) {
        filters.text = filterText;
      }
    }

    return filters;
  }

  /**
   * Parse type filter (type:prompt, type:template, type:chain)
   */
  private parseTypeFilter(filterText: string, filters: SmartFilters): void {
    const typeMatch = filterText.match(/type:(\w+)/i);
    const type = typeMatch?.[1]?.toLowerCase();

    if (type && ['prompt', 'template', 'chain'].includes(type)) {
      filters.type = type;
    }
  }

  /**
   * Parse category filter (category:code, category:analysis)
   */
  private parseCategoryFilter(filterText: string, filters: SmartFilters): void {
    const categoryMatch = filterText.match(/category:([a-z-_]+)/i);
    const category = categoryMatch?.[1]?.toLowerCase();

    if (category) {
      filters.category = category;
    }
  }

  /**
   * Parse intent filter (intent:debugging, intent:analysis)
   */
  private parseIntentFilter(filterText: string, filters: SmartFilters): void {
    const intentMatch = filterText.match(/intent:([a-z-_\s]+)/i);
    const intent = intentMatch?.[1];

    if (intent) {
      filters.intent = intent.trim().toLowerCase();
    }
  }

  /**
   * Parse execution requirement filter (execution:required, execution:optional)
   */
  private parseExecutionFilter(filterText: string, filters: SmartFilters): void {
    if (filterText.includes('execution:required')) {
      filters.execution = true;
    } else if (filterText.includes('execution:optional')) {
      filters.execution = false;
    }
  }

  /**
   * Parse gates filter (gates:yes, gates:no)
   */
  private parseGatesFilter(filterText: string, filters: SmartFilters): void {
    if (filterText.includes('gates:yes')) {
      filters.gates = true;
    } else if (filterText.includes('gates:no')) {
      filters.gates = false;
    }
  }

  /**
   * Extract text search terms after removing filter syntax
   */
  private extractTextFilter(filterText: string): string {
    const cleanedText = filterText
      .replace(/type:\w+/gi, '')
      .replace(/category:[a-z-_]+/gi, '')
      .replace(/intent:[a-z-_\s]+/gi, '')
      .replace(/confidence:[<>]?\d+(?:-\d+)?/g, '')
      .replace(/execution:(required|optional)/gi, '')
      .replace(/gates:(yes|no)/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    return cleanedText;
  }

  /**
   * Build filter description for display
   */
  buildFilterDescription(filters: SmartFilters): string[] {
    const descriptions: string[] = [];

    if (filters.type) {
      descriptions.push(`**Type**: ${filters.type}`);
    }

    if (filters.category) {
      descriptions.push(`**Category**: ${filters.category}`);
    }

    if (filters.intent) {
      descriptions.push(`**Intent**: "${filters.intent}"`);
    }

    if (filters.text) {
      descriptions.push(`**Search**: "${filters.text}"`);
    }

    if (filters.execution !== undefined) {
      descriptions.push(`**Execution**: ${filters.execution ? 'Required' : 'Optional'}`);
    }

    if (filters.gates !== undefined) {
      descriptions.push(`**Quality Gates**: ${filters.gates ? 'Required' : 'None'}`);
    }

    return descriptions;
  }

  /**
   * Generate filter examples for help
   */
  getFilterExamples(): string[] {
    return [
      'type:template - Show only template prompts',
      'category:analysis - Show prompts in analysis category',
      'intent:debugging - Find prompts for debugging tasks',
      'execution:required - Show prompts that require execution',
      'gates:yes - Show prompts with quality gates',
      'react component - Text search for "react component"',
      'type:chain category:development - Combined filters',
    ];
  }

  /**
   * Suggest filters based on common patterns
   */
  suggestFilters(searchText: string): string[] {
    const suggestions: string[] = [];
    const text = searchText.toLowerCase();

    // Suggest type filters based on common terms
    if (text.includes('template') || text.includes('variable')) {
      suggestions.push('type:template');
    }
    if (text.includes('chain') || text.includes('multi') || text.includes('step')) {
      suggestions.push('type:chain');
    }
    if (text.includes('simple') || text.includes('basic')) {
      suggestions.push('type:prompt');
    }

    // Suggest category filters based on common terms
    if (text.includes('code') || text.includes('develop') || text.includes('program')) {
      suggestions.push('category:development');
    }
    if (text.includes('analy') || text.includes('review') || text.includes('examine')) {
      suggestions.push('category:analysis');
    }
    if (text.includes('research') || text.includes('investigate')) {
      suggestions.push('category:research');
    }

    // Suggest intent filters based on common tasks
    if (text.includes('debug') || text.includes('fix') || text.includes('error')) {
      suggestions.push('intent:debugging');
    }
    if (text.includes('test') || text.includes('validate')) {
      suggestions.push('intent:testing');
    }
    if (text.includes('optimize') || text.includes('improve')) {
      suggestions.push('intent:optimization');
    }

    return suggestions.slice(0, 3); // Limit to 3 suggestions
  }

  /**
   * Validate filter combination
   */
  validateFilterCombination(filters: SmartFilters): {
    valid: boolean;
    warnings: string[];
  } {
    const warnings: string[] = [];

    // Check for conflicting filters
    if (filters.type === 'prompt' && filters.gates === true) {
      warnings.push('Basic prompts typically do not have quality gates');
    }

    if (filters.execution === false && filters.type === 'chain') {
      warnings.push('Chain prompts typically require execution');
    }

    if (filters.intent && filters.category) {
      // Check if intent and category are compatible
      const categoryIntentMap: Record<string, string[]> = {
        development: ['debugging', 'testing', 'optimization'],
        analysis: ['research', 'investigation', 'review'],
        content: ['writing', 'editing', 'creation'],
      };

      const compatibleIntents = categoryIntentMap[filters.category] || [];
      if (
        compatibleIntents.length > 0 &&
        !compatibleIntents.some((intent) => filters.intent?.includes(intent))
      ) {
        warnings.push(`Intent "${filters.intent}" may not match category "${filters.category}"`);
      }
    }

    return {
      valid: warnings.length === 0,
      warnings,
    };
  }
}
