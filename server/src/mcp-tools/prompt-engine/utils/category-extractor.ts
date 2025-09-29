/**
 * Category Extraction Utility
 *
 * Implements intelligent category detection from multiple sources:
 * 1. Prompt metadata (PromptData.category)
 * 2. File path structure (/prompts/analysis/ -> analysis)
 * 3. Pattern-based detection (fallback)
 *
 * Part of Gate System Intelligent Selection Upgrade - Phase 1
 */

import type { Logger } from '../../../logging/index.js';
import path from 'path';

/**
 * Extracted category information with source tracking
 */
export interface CategoryExtractionResult {
  /** The determined category */
  category: string;
  /** Source of the category determination */
  source: 'metadata' | 'path' | 'pattern' | 'fallback';
  /** Confidence level (0-100) */
  confidence: number;
  /** Original data used for extraction */
  sourceData?: {
    metadata?: string;
    filePath?: string;
    promptId?: string;
  };
}

/**
 * Category extractor with intelligent detection
 */
export class CategoryExtractor {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Extract category from prompt using multiple detection strategies
   *
   * Priority order:
   * 1. Prompt metadata category (highest confidence)
   * 2. File path structure parsing
   * 3. Prompt ID pattern matching
   * 4. Default fallback
   */
  extractCategory(prompt: any): CategoryExtractionResult {
    this.logger.debug('[CATEGORY EXTRACTOR] Extracting category from prompt:', {
      promptId: prompt?.id,
      promptCategory: prompt?.category,
      promptFile: prompt?.file
    });

    // Strategy 1: Use prompt metadata category (highest priority)
    if (prompt?.category && typeof prompt.category === 'string') {
      const metadataCategory = prompt.category.toLowerCase().trim();
      if (this.isValidCategory(metadataCategory)) {
        return {
          category: metadataCategory,
          source: 'metadata',
          confidence: 95,
          sourceData: {
            metadata: prompt.category,
            filePath: prompt.file,
            promptId: prompt.id
          }
        };
      }
    }

    // Strategy 2: Extract from file path structure
    if (prompt?.file && typeof prompt.file === 'string') {
      const pathCategory = this.extractCategoryFromPath(prompt.file);
      if (pathCategory) {
        return {
          category: pathCategory,
          source: 'path',
          confidence: 85,
          sourceData: {
            filePath: prompt.file,
            promptId: prompt.id
          }
        };
      }
    }

    // Strategy 3: Pattern-based detection from prompt ID
    if (prompt?.id && typeof prompt.id === 'string') {
      const patternCategory = this.extractCategoryFromPattern(prompt.id);
      if (patternCategory) {
        return {
          category: patternCategory,
          source: 'pattern',
          confidence: 60,
          sourceData: {
            promptId: prompt.id,
            filePath: prompt.file
          }
        };
      }
    }

    // Strategy 4: Default fallback
    this.logger.debug('[CATEGORY EXTRACTOR] No category detected, using fallback');
    return {
      category: 'general',
      source: 'fallback',
      confidence: 30,
      sourceData: {
        promptId: prompt?.id,
        filePath: prompt?.file
      }
    };
  }

  /**
   * Extract category from file path structure
   * Examples:
   * - "/prompts/analysis/notes.md" -> "analysis"
   * - "/prompts/education/learning.md" -> "education"
   * - "analysis/query_refinement.md" -> "analysis"
   */
  private extractCategoryFromPath(filePath: string): string | null {
    try {
      // Normalize path separators
      const normalizedPath = filePath.replace(/\\/g, '/');

      // Split path and look for category indicators
      const pathSegments = normalizedPath.split('/').filter(segment => segment.length > 0);

      // Look for prompts directory structure: /prompts/{category}/
      const promptsIndex = pathSegments.findIndex(segment => segment === 'prompts');
      if (promptsIndex !== -1 && promptsIndex + 1 < pathSegments.length) {
        const categoryCandidate = pathSegments[promptsIndex + 1];
        if (this.isValidCategory(categoryCandidate)) {
          return categoryCandidate;
        }
      }

      // Look for direct category directory structure: {category}/
      for (const segment of pathSegments) {
        if (this.isValidCategory(segment)) {
          return segment;
        }
      }

      return null;
    } catch (error) {
      this.logger.warn('[CATEGORY EXTRACTOR] Error extracting category from path:', error);
      return null;
    }
  }

  /**
   * Extract category from prompt ID patterns
   * Examples:
   * - "analysis_notes" -> "analysis"
   * - "education_learning" -> "education"
   * - "debug_application" -> "debugging"
   */
  private extractCategoryFromPattern(promptId: string): string | null {
    const patterns = [
      { pattern: /^analysis_|_analysis$|analysis/i, category: 'analysis' },
      { pattern: /^education_|_education$|learning|teach/i, category: 'education' },
      { pattern: /^develop_|_develop$|code|programming/i, category: 'development' },
      { pattern: /^research_|_research$|investigate/i, category: 'research' },
      { pattern: /^debug_|_debug$|troubleshoot/i, category: 'debugging' },
      { pattern: /^doc_|_doc$|documentation|readme/i, category: 'documentation' },
      { pattern: /^content_|_content$|process|format/i, category: 'content_processing' }
    ];

    for (const { pattern, category } of patterns) {
      if (pattern.test(promptId)) {
        return category;
      }
    }

    return null;
  }

  /**
   * Validate if a category is recognized
   */
  private isValidCategory(category: string): boolean {
    const validCategories = [
      'analysis',
      'education',
      'development',
      'research',
      'debugging',
      'documentation',
      'content_processing',
      'general'
    ];

    return validCategories.includes(category.toLowerCase());
  }

  /**
   * Get fallback category mapping for gate selection
   */
  public static getCategoryGateMapping(): Record<string, string[]> {
    return {
      'analysis': ['research-quality', 'technical-accuracy'],
      'education': ['educational-clarity', 'content-structure'],
      'development': ['code-quality', 'security-awareness'],
      'research': ['research-quality', 'fact-checking'],
      'debugging': ['technical-accuracy', 'problem-solving'],
      'documentation': ['content-structure', 'clarity'],
      'content_processing': ['content-structure', 'format-consistency'],
      'general': ['content-structure']
    };
  }
}

/**
 * Convenience function for quick category extraction
 */
export function extractPromptCategory(prompt: any, logger: Logger): CategoryExtractionResult {
  const extractor = new CategoryExtractor(logger);
  return extractor.extractCategory(prompt);
}