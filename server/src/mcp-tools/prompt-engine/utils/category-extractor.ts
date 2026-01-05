// @lifecycle canonical - Extracts categories for prompts.
/**
 * Category Extraction Utility
 *
 * Implements intelligent category detection from multiple sources:
 * 1. Prompt metadata (PromptData.category)
 * 2. File path structure (/prompts/analysis/ -> analysis)
 * 3. Pattern-based detection (fallback)
 *
 * Part of Gate System Intelligent Selection Upgrade -
 */

import type { Logger } from '../../../logging/index.js';

/**
 * Template gate configuration
 */
export interface GateConfigurationInfo {
  include?: string[];
  exclude?: string[];
  framework_gates?: boolean;
}

/**
 * Extracted category and gate information with source tracking
 */
export interface CategoryExtractionResult {
  /** The determined category */
  category: string;
  /** Source of the category determination */
  source: 'metadata' | 'path' | 'pattern' | 'fallback';
  /** Confidence level (0-100) */
  confidence: number;
  /** Template-level gate configuration */
  gateConfiguration?: GateConfigurationInfo;
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
      promptFile: prompt?.file,
      hasGateConfiguration: !!prompt?.gateConfiguration,
    });

    // Strategy 1: Use prompt metadata category (highest priority)
    if (prompt?.category && typeof prompt.category === 'string') {
      const metadataCategory = prompt.category.toLowerCase().trim();
      if (this.isValidCategory(metadataCategory)) {
        return {
          category: metadataCategory,
          source: 'metadata',
          confidence: 95,
          gateConfiguration: prompt.gateConfiguration,
          sourceData: {
            metadata: prompt.category,
            filePath: prompt.file,
            promptId: prompt.id,
          },
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
          gateConfiguration: prompt.gateConfiguration,
          sourceData: {
            filePath: prompt.file,
            promptId: prompt.id,
          },
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
          gateConfiguration: prompt.gateConfiguration,
          sourceData: {
            promptId: prompt.id,
            filePath: prompt.file,
          },
        };
      }
    }

    // Strategy 4: Default fallback
    this.logger.debug('[CATEGORY EXTRACTOR] No category detected, using fallback');
    return {
      category: 'general',
      source: 'fallback',
      confidence: 30,
      gateConfiguration: prompt?.gateConfiguration,
      sourceData: {
        promptId: prompt?.id,
        filePath: prompt?.file,
      },
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
      const pathSegments = normalizedPath.split('/').filter((segment) => segment.length > 0);

      // Look for prompts directory structure: /prompts/{category}/
      const promptsIndex = pathSegments.findIndex((segment) => segment === 'prompts');
      if (promptsIndex !== -1 && promptsIndex + 1 < pathSegments.length) {
        const categoryCandidate = pathSegments[promptsIndex + 1];
        if (categoryCandidate && this.isValidCategory(categoryCandidate)) {
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
      { pattern: /^content_|_content$|process|format/i, category: 'content_processing' },
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
      'general',
    ];

    return validCategories.includes(category.toLowerCase());
  }

  /**
   * Intelligent gate selection with precedence logic
   *
   * Priority order:
   * 1. Explicit template gates (highest priority)
   * 2. Category-based gates
   * 3. Framework-based gates
   * 4. Default fallback gates (lowest priority)
   */
  selectGatesWithPrecedence(
    categoryResult: CategoryExtractionResult,
    frameworkGates: string[] = [],
    fallbackGates: string[] = ['content-structure']
  ): {
    selectedGates: string[];
    precedenceUsed: string[];
    reasoning: string;
  } {
    const { category, gateConfiguration } = categoryResult;
    const categoryGates = CategoryExtractor.getCategoryGateMapping()[category] || [];

    this.logger.debug('[GATE PRECEDENCE] Input for gate selection:', {
      category,
      templateGates: gateConfiguration,
      categoryGates,
      frameworkGates,
      fallbackGates,
    });

    let selectedGates: string[] = [];
    let precedenceUsed: string[] = [];
    let reasoning = '';

    //  Start with template gates if specified
    if (gateConfiguration) {
      if (gateConfiguration.include && gateConfiguration.include.length > 0) {
        selectedGates.push(...gateConfiguration.include);
        precedenceUsed.push('template-include');
        reasoning += `Template includes: [${gateConfiguration.include.join(', ')}]. `;
      }

      // Add category gates if framework_gates is true (default)
      if (gateConfiguration.framework_gates !== false) {
        const additionalCategoryGates = categoryGates.filter(
          (gate) => !selectedGates.includes(gate)
        );
        selectedGates.push(...additionalCategoryGates);
        if (additionalCategoryGates.length > 0) {
          precedenceUsed.push('category-gates');
          reasoning += `Category gates: [${additionalCategoryGates.join(', ')}]. `;
        }

        // Add framework gates
        const additionalFrameworkGates = frameworkGates.filter(
          (gate) => !selectedGates.includes(gate)
        );
        selectedGates.push(...additionalFrameworkGates);
        if (additionalFrameworkGates.length > 0) {
          precedenceUsed.push('framework-gates');
          reasoning += `Framework gates: [${additionalFrameworkGates.join(', ')}]. `;
        }
      }

      // Apply exclusions
      if (gateConfiguration.exclude && gateConfiguration.exclude.length > 0) {
        const originalCount = selectedGates.length;
        selectedGates = selectedGates.filter((gate) => !gateConfiguration.exclude!.includes(gate));
        if (selectedGates.length < originalCount) {
          precedenceUsed.push('template-exclude');
          reasoning += `Template excludes: [${gateConfiguration.exclude.join(', ')}]. `;
        }
      }
    } else {
      // No template configuration - use standard precedence

      // Category gates
      selectedGates.push(...categoryGates);
      if (categoryGates.length > 0) {
        precedenceUsed.push('category-gates');
        reasoning += `Category gates: [${categoryGates.join(', ')}]. `;
      }

      // Framework gates
      const additionalFrameworkGates = frameworkGates.filter(
        (gate) => !selectedGates.includes(gate)
      );
      selectedGates.push(...additionalFrameworkGates);
      if (additionalFrameworkGates.length > 0) {
        precedenceUsed.push('framework-gates');
        reasoning += `Framework gates: [${additionalFrameworkGates.join(', ')}]. `;
      }
    }

    // Fallback if no gates selected
    if (selectedGates.length === 0) {
      selectedGates.push(...fallbackGates);
      precedenceUsed.push('fallback');
      reasoning += `Fallback gates: [${fallbackGates.join(', ')}]. `;
    }

    // Remove duplicates (shouldn't happen with our logic, but safety check)
    selectedGates = [...new Set(selectedGates)];

    this.logger.info('[GATE PRECEDENCE] Final gate selection:', {
      category,
      selectedGates,
      precedenceUsed,
      reasoning: reasoning.trim(),
    });

    return {
      selectedGates,
      precedenceUsed,
      reasoning: reasoning.trim(),
    };
  }

  /**
   * Get fallback category mapping for gate selection
   */
  public static getCategoryGateMapping(): Record<string, string[]> {
    return {
      analysis: ['research-quality', 'technical-accuracy'],
      education: ['educational-clarity', 'content-structure'],
      development: ['code-quality', 'security-awareness'],
      research: ['research-quality', 'fact-checking'],
      debugging: ['technical-accuracy', 'problem-solving'],
      documentation: ['content-structure', 'clarity'],
      content_processing: ['content-structure', 'format-consistency'],
      general: ['content-structure'],
    };
  }

  /**
   * Enhanced gate selection with 5-level precedence including temporary gates
   *
   * Priority order ():
   * 1. Temporary gates (highest priority - execution-specific)
   * 2. Explicit template gates
   * 3. Category-based gates
   * 4. Framework-based gates
   * 5. Default fallback gates (lowest priority)
   */
  selectGatesWithEnhancedPrecedence(
    categoryResult: CategoryExtractionResult,
    frameworkGates: string[] = [],
    fallbackGates: string[] = ['content-structure'],
    temporaryGates: string[] = [],
    enhancedConfig?: any
  ): {
    selectedGates: string[];
    precedenceUsed: string[];
    reasoning: string;
    temporaryGatesApplied: string[];
  } {
    const { category, gateConfiguration } = categoryResult;
    const categoryGates = CategoryExtractor.getCategoryGateMapping()[category] || [];

    this.logger.debug('[ENHANCED GATE PRECEDENCE] Input for enhanced gate selection:', {
      category,
      templateGates: gateConfiguration,
      categoryGates,
      frameworkGates,
      fallbackGates,
      temporaryGates,
      enhancedConfig,
    });

    let selectedGates: string[] = [];
    let precedenceUsed: string[] = [];
    let reasoning = '';
    let temporaryGatesApplied: string[] = [];

    //  Start with temporary gates (highest priority)
    if (temporaryGates.length > 0) {
      selectedGates.push(...temporaryGates);
      precedenceUsed.push('temporary-gates');
      temporaryGatesApplied = [...temporaryGates];
      reasoning += `Temporary gates: [${temporaryGates.join(', ')}]. `;
    }

    // Add template gates if specified
    if (gateConfiguration) {
      if (gateConfiguration.include && gateConfiguration.include.length > 0) {
        const additionalTemplateGates = gateConfiguration.include.filter(
          (gate) => !selectedGates.includes(gate)
        );
        selectedGates.push(...additionalTemplateGates);
        if (additionalTemplateGates.length > 0) {
          precedenceUsed.push('template-include');
          reasoning += `Template includes: [${additionalTemplateGates.join(', ')}]. `;
        }
      }

      // Add category gates if framework_gates is true (default)
      if (gateConfiguration.framework_gates !== false) {
        const additionalCategoryGates = categoryGates.filter(
          (gate) => !selectedGates.includes(gate)
        );
        selectedGates.push(...additionalCategoryGates);
        if (additionalCategoryGates.length > 0) {
          precedenceUsed.push('category-gates');
          reasoning += `Category gates: [${additionalCategoryGates.join(', ')}]. `;
        }

        // Add framework gates
        const additionalFrameworkGates = frameworkGates.filter(
          (gate) => !selectedGates.includes(gate)
        );
        selectedGates.push(...additionalFrameworkGates);
        if (additionalFrameworkGates.length > 0) {
          precedenceUsed.push('framework-gates');
          reasoning += `Framework gates: [${additionalFrameworkGates.join(', ')}]. `;
        }
      }

      // Apply exclusions (can remove temporary, template, category, or framework gates)
      if (gateConfiguration.exclude && gateConfiguration.exclude.length > 0) {
        const originalCount = selectedGates.length;
        selectedGates = selectedGates.filter((gate) => !gateConfiguration.exclude!.includes(gate));

        // Update temporary gates applied if they were excluded
        temporaryGatesApplied = temporaryGatesApplied.filter(
          (gate) => !gateConfiguration.exclude!.includes(gate)
        );

        if (selectedGates.length < originalCount) {
          precedenceUsed.push('template-exclude');
          reasoning += `Template excludes: [${gateConfiguration.exclude.join(', ')}]. `;
        }
      }
    } else {
      // No template configuration - use standard precedence (skip template level)

      // Category gates
      const additionalCategoryGates = categoryGates.filter((gate) => !selectedGates.includes(gate));
      selectedGates.push(...additionalCategoryGates);
      if (additionalCategoryGates.length > 0) {
        precedenceUsed.push('category-gates');
        reasoning += `Category gates: [${additionalCategoryGates.join(', ')}]. `;
      }

      // Framework gates
      const additionalFrameworkGates = frameworkGates.filter(
        (gate) => !selectedGates.includes(gate)
      );
      selectedGates.push(...additionalFrameworkGates);
      if (additionalFrameworkGates.length > 0) {
        precedenceUsed.push('framework-gates');
        reasoning += `Framework gates: [${additionalFrameworkGates.join(', ')}]. `;
      }
    }

    // Fallback if no gates selected
    if (selectedGates.length === 0) {
      selectedGates.push(...fallbackGates);
      precedenceUsed.push('fallback');
      reasoning += `Fallback gates: [${fallbackGates.join(', ')}]. `;
    }

    // Remove duplicates (shouldn't happen with our logic, but safety check)
    selectedGates = [...new Set(selectedGates)];
    temporaryGatesApplied = [...new Set(temporaryGatesApplied)];

    this.logger.info('[ENHANCED GATE PRECEDENCE] Final enhanced gate selection:', {
      category,
      selectedGates,
      precedenceUsed,
      temporaryGatesApplied,
      reasoning: reasoning.trim(),
    });

    return {
      selectedGates,
      precedenceUsed,
      reasoning: reasoning.trim(),
      temporaryGatesApplied,
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
