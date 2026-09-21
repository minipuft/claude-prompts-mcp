// @lifecycle canonical - Parses filter expressions for prompt searches.
/**
 * Intelligent filter parsing for prompt discovery
 */

import { SmartFilters } from '../core/types.js';
import { validateFilterSyntax } from '../utils/validation.js';

import type { Logger } from '#shared/types/index.js';

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
}
