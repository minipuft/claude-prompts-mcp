/**
 * Advanced Filter Parser for Enhanced Prompt Discovery
 *
 * Provides sophisticated filtering capabilities including regex patterns,
 * boolean operators, date comparisons, and multi-value filters.
 */

import { FilterParseResult } from '../types/shared-types.js';
import { FILTER_OPERATORS, CATEGORIES } from '../constants.js';

/**
 * Advanced filter parser with comprehensive pattern support
 */
export class AdvancedFilterParser {
  private static readonly REGEX_PATTERN = /^\/(.+)\/([gimsu]*)$/;
  private static readonly DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  private static readonly COMPARISON_PATTERN = /^(>=|<=|>|<|=)?(.+)$/;

  /**
   * Parse filter string into structured filter object
   */
  static parseFilter(filterString: string): FilterParseResult {
    const result: FilterParseResult = {
      structured: {}
    };

    // Handle empty or whitespace-only filters
    if (!filterString?.trim()) {
      return result;
    }

    // Split by whitespace but preserve quoted strings
    const tokens = this.tokenizeFilter(filterString);

    // Process tokens
    for (const token of tokens) {
      this.processToken(token, result);
    }

    return result;
  }

  /**
   * Tokenize filter string, preserving quoted strings and operators
   */
  private static tokenizeFilter(filterString: string): string[] {
    const tokens: string[] = [];
    let current = '';
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < filterString.length; i++) {
      const char = filterString[i];

      if ((char === '"' || char === "'") && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
        current += char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
        current += char;
        quoteChar = '';
      } else if (!inQuotes && /\s/.test(char)) {
        if (current.trim()) {
          tokens.push(current.trim());
          current = '';
        }
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      tokens.push(current.trim());
    }

    return tokens;
  }

  /**
   * Process individual token and update filter result
   */
  private static processToken(token: string, result: FilterParseResult): void {
    // Handle boolean operators
    if (this.isBooleanOperator(token)) {
      this.processBooleanOperator(token, result);
      return;
    }

    // Handle structured filters (key:value)
    if (token.includes(':')) {
      const [key, ...valueParts] = token.split(':');
      const value = valueParts.join(':'); // Rejoin in case value contains colons
      this.processStructuredFilter(key, value, result);
      return;
    }

    // Handle text search
    this.processTextSearch(token, result);
  }

  /**
   * Check if token is a boolean operator
   */
  private static isBooleanOperator(token: string): boolean {
    return ['AND', 'OR', 'NOT', '&&', '||', '!'].includes(token.toUpperCase());
  }

  /**
   * Process boolean operator
   */
  private static processBooleanOperator(token: string, result: FilterParseResult): void {
    // Initialize operators if not exists
    if (!result.operators) {
      result.operators = {};
    }

    const operator = token.toUpperCase();
    switch (operator) {
      case 'AND':
      case '&&':
        if (!result.operators.and) result.operators.and = [];
        break;
      case 'OR':
      case '||':
        if (!result.operators.or) result.operators.or = [];
        break;
      case 'NOT':
      case '!':
        // NOT operator will be handled with the next token
        break;
    }
  }

  /**
   * Process structured filter (key:value)
   */
  private static processStructuredFilter(key: string, value: string, result: FilterParseResult): void {
    const cleanKey = key.toLowerCase().trim();
    const cleanValue = value.trim();

    switch (cleanKey) {
      case 'type':
        this.processTypeFilter(cleanValue, result);
        break;
      case 'category':
        this.processCategoryFilter(cleanValue, result);
        break;
      case 'gates':
        this.processGatesFilter(cleanValue, result);
        break;
      case 'confidence':
        this.processConfidenceFilter(cleanValue, result);
        break;
      case 'created':
      case 'modified':
        this.processDateFilter(cleanKey, cleanValue, result);
        break;
      case 'complexity':
        this.processComplexityFilter(cleanValue, result);
        break;
      case 'name':
        this.processNameFilter(cleanValue, result);
        break;
      default:
        // Unknown structured filter, treat as text search
        this.processTextSearch(`${key}:${value}`, result);
    }
  }

  /**
   * Process type filter (prompt, template, chain)
   */
  private static processTypeFilter(value: string, result: FilterParseResult): void {
    const types = value.split(',').map(t => t.trim().toLowerCase());
    result.structured.type = (result.structured.type || []).concat(types);
  }

  /**
   * Process category filter
   */
  private static processCategoryFilter(value: string, result: FilterParseResult): void {
    const categories = value.split(',').map(c => c.trim().toLowerCase());
    result.structured.category = (result.structured.category || []).concat(categories);
  }

  /**
   * Process gates filter (yes/no/true/false)
   */
  private static processGatesFilter(value: string, result: FilterParseResult): void {
    const lowerValue = value.toLowerCase();
    if (['yes', 'true', '1'].includes(lowerValue)) {
      result.structured.gates = true;
    } else if (['no', 'false', '0'].includes(lowerValue)) {
      result.structured.gates = false;
    }
  }

  /**
   * Process confidence filter with comparison operators
   */
  private static processConfidenceFilter(value: string, result: FilterParseResult): void {
    const match = value.match(this.COMPARISON_PATTERN);
    if (!match) return;

    const [, operator = '=', numValue] = match;
    const confidence = parseFloat(numValue);

    if (isNaN(confidence)) return;

    result.structured.confidence = {
      operator: operator as any,
      value: confidence
    };
  }

  /**
   * Process date filter with comparison operators
   */
  private static processDateFilter(field: string, value: string, result: FilterParseResult): void {
    const match = value.match(this.COMPARISON_PATTERN);
    if (!match) return;

    const [, operator = '=', dateValue] = match;

    let date: Date;
    if (this.DATE_PATTERN.test(dateValue)) {
      date = new Date(dateValue);
    } else {
      // Try parsing relative dates like "1d", "1w", "1m"
      date = this.parseRelativeDate(dateValue);
    }

    if (!date || isNaN(date.getTime())) return;

    result.structured.created = {
      operator: operator as any,
      value: date
    };
  }

  /**
   * Process complexity filter
   */
  private static processComplexityFilter(value: string, result: FilterParseResult): void {
    const complexities = value.split(',').map(c => c.trim().toLowerCase());
    const validComplexities = complexities.filter(c =>
      ['simple', 'medium', 'complex', 'advanced'].includes(c)
    );

    if (validComplexities.length > 0) {
      result.structured.complexity = validComplexities;
    }
  }

  /**
   * Process name filter with regex support
   */
  private static processNameFilter(value: string, result: FilterParseResult): void {
    // Check if it's a regex pattern
    const regexMatch = value.match(this.REGEX_PATTERN);
    if (regexMatch) {
      // Add regex pattern to text search for now
      // In a full implementation, this would be handled separately
      this.processTextSearch(value, result);
    } else {
      this.processTextSearch(value, result);
    }
  }

  /**
   * Process text search
   */
  private static processTextSearch(token: string, result: FilterParseResult): void {
    // Remove quotes if present
    const cleanToken = token.replace(/^["']|["']$/g, '');

    if (result.textSearch) {
      result.textSearch += ` ${cleanToken}`;
    } else {
      result.textSearch = cleanToken;
    }
  }

  /**
   * Parse relative date strings like "1d", "1w", "1m"
   */
  private static parseRelativeDate(dateValue: string): Date {
    const match = dateValue.match(/^(\d+)([dwmy])$/);
    if (!match) return new Date(dateValue); // Fallback to standard parsing

    const [, amount, unit] = match;
    const num = parseInt(amount);
    const now = new Date();

    switch (unit) {
      case 'd': // days
        return new Date(now.getTime() - num * 24 * 60 * 60 * 1000);
      case 'w': // weeks
        return new Date(now.getTime() - num * 7 * 24 * 60 * 60 * 1000);
      case 'm': // months (approximate)
        return new Date(now.getTime() - num * 30 * 24 * 60 * 60 * 1000);
      case 'y': // years (approximate)
        return new Date(now.getTime() - num * 365 * 24 * 60 * 60 * 1000);
      default:
        return new Date(dateValue);
    }
  }

  /**
   * Validate filter syntax and provide suggestions
   */
  static validateFilter(filterString: string): {
    valid: boolean;
    errors: string[];
    suggestions: string[];
  } {
    const errors: string[] = [];
    const suggestions: string[] = [];

    try {
      const parsed = this.parseFilter(filterString);

      // Check for common mistakes
      if (filterString.includes(':') && !parsed.structured) {
        errors.push('Invalid filter syntax. Use format key:value');
        suggestions.push('Example: category:analysis type:chain');
      }

      // Check for invalid category names
      if (parsed.structured.category) {
        const validCategories = Object.values(CATEGORIES);
        const invalidCategories = parsed.structured.category.filter(
          cat => !validCategories.includes(cat as any)
        );

        if (invalidCategories.length > 0) {
          errors.push(`Invalid categories: ${invalidCategories.join(', ')}`);
          suggestions.push(`Valid categories: ${validCategories.join(', ')}`);
        }
      }

      // Check for invalid type names
      if (parsed.structured.type) {
        const validTypes = ['prompt', 'template', 'chain'];
        const invalidTypes = parsed.structured.type.filter(
          type => !validTypes.includes(type)
        );

        if (invalidTypes.length > 0) {
          errors.push(`Invalid types: ${invalidTypes.join(', ')}`);
          suggestions.push(`Valid types: ${validTypes.join(', ')}`);
        }
      }

      return {
        valid: errors.length === 0,
        errors,
        suggestions
      };

    } catch (error) {
      return {
        valid: false,
        errors: ['Filter parsing failed: ' + (error as Error).message],
        suggestions: [
          'Use simple text search or structured filters like category:analysis',
          'Check for unmatched quotes or invalid syntax'
        ]
      };
    }
  }

  /**
   * Get filter help and examples
   */
  static getFilterHelp(): string {
    return `
**Advanced Filter Syntax:**

**Structured Filters:**
- \`type:prompt,template,chain\` - Filter by prompt type
- \`category:analysis,development\` - Filter by category
- \`gates:yes/no\` - Filter by quality gates
- \`confidence:>80\` - Filter by confidence level
- \`created:>2025-01-01\` - Filter by creation date
- \`complexity:simple,medium\` - Filter by complexity level

**Text Search:**
- \`search terms\` - Basic text search in name/description
- \`"exact phrase"\` - Exact phrase matching
- \`name:/regex/i\` - Regex pattern matching (case-insensitive)

**Comparison Operators:**
- \`>\`, \`<\`, \`>=\`, \`<=\`, \`=\` for numbers and dates
- \`confidence:>=85\`, \`created:>2025-01-01\`

**Boolean Operators:**
- \`AND\`, \`OR\`, \`NOT\` for complex queries
- \`category:analysis AND type:chain\`

**Examples:**
- \`category:development type:chain confidence:>80\`
- \`"error handling" OR "debugging" category:analysis\`
- \`created:>1w complexity:medium,complex\`
- \`NOT category:deprecated gates:yes\`
`;
  }
}