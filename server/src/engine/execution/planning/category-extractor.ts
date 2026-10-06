// @lifecycle canonical - Extracts categories for prompts.
/**
 * Category Extraction Utility
 *
 * Reports the category one execution runs under, from two sources:
 * 1. The prompt's own `category` (authoritative)
 * 2. Its file path, when a prompt object carries no category at all
 *
 * WHAT THIS DOES NOT DO, AND WHY. It does not decide whether a category is REAL. `PromptLoader`
 * already answered that: `loadFromDirectories` discovers each category from a directory under the
 * prompts root, stamps `prompt.category = categoryId` on every prompt it loads, and hands the same
 * set to `CategoryManager.loadCategories`. The category on a prompt IS the registry entry's id, so
 * re-validating it here is a second derivation of one question — and until B.91 the two disagreed:
 * an eight-name allow-list (`analysis, education, development, research, debugging, documentation,
 * content_processing, general`) shared exactly three names with the nine shipped directories, so
 * six real categories were rewritten to `general`.
 *
 * That rewrite was not cosmetic. Gate SELECTION reads `prompt.category` (`gate-enhancement-service`,
 * `ExecutionPlanner` -> `GateSetResolver`), so a gate scoped via `activation.prompt_categories` was
 * chosen and named in the `**Gates**:` attestation footer — while gate RENDER read the rewritten
 * `general` and `isGateActive` dropped the gate's text. The model was asked to attest guidance it
 * was never shown. Measured 2026-09-20 on the `workflow` category, which ships three prompts and a
 * gate scoped to it and was absent from the allow-list.
 *
 * A pattern-based third strategy (`^debug_|troubleshoot` -> `debugging`, and six more) was removed
 * with the allow-list: it INVENTED a category from a prompt id, four of the seven names it could
 * invent name no directory, and inventing one reproduces exactly the defect above for a prompt that
 * declares nothing. `scripts/validate-category-enumerations.js` fails when a hardcoded category
 * list reappears anywhere under `src/`.
 */

import type { Logger } from '#shared/types/index.js';

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
  source: 'metadata' | 'path' | 'fallback';
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
   * 1. Prompt metadata category (what the loader stamped on it)
   * 2. File path structure parsing
   * 3. Default fallback
   */
  extractCategory(prompt: any): CategoryExtractionResult {
    this.logger.debug('[CATEGORY EXTRACTOR] Extracting category from prompt:', {
      promptId: prompt?.id,
      promptCategory: prompt?.category,
      promptFile: prompt?.file,
      hasGateConfiguration: !!prompt?.gateConfiguration,
    });

    // Strategy 1: the category the loader assigned from the prompt's category directory. Taken as
    // given — see the module header for why validating it here is the defect, not the safeguard.
    if (prompt?.category && typeof prompt.category === 'string') {
      const metadataCategory = prompt.category.toLowerCase().trim();
      if (metadataCategory.length > 0) {
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

    // Strategy 3: Default fallback
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
   * Extract category from file path structure.
   *
   * STRUCTURAL, not lexical: the category is the directory the prompts root contains, whatever it
   * is called. `prompts/<category>/<something>` is the only shape this reads, and it requires a
   * segment AFTER the candidate so `prompts/notes.md` yields nothing rather than `notes.md`.
   *
   * A second loop used to scan every segment for a name on the allow-list, which is how an
   * absolute path could donate its own directory names as categories. It went with the list.
   *
   * Examples:
   * - "/server/resources/prompts/analysis/notes.md" -> "analysis"
   * - "/server/resources/prompts/knowledge-capture/capture/prompt.yaml" -> "knowledge-capture"
   * - "analysis/query_refinement.md" -> null (no `prompts` segment; strategy 1 owns this shape)
   */
  private extractCategoryFromPath(filePath: string): string | null {
    try {
      // Normalize path separators
      const normalizedPath = filePath.replace(/\\/g, '/');

      // Split path and look for category indicators
      const pathSegments = normalizedPath.split('/').filter((segment) => segment.length > 0);

      // Look for prompts directory structure: /prompts/{category}/{...}
      const promptsIndex = pathSegments.findIndex((segment) => segment === 'prompts');
      if (promptsIndex !== -1 && promptsIndex + 2 < pathSegments.length) {
        const categoryCandidate = pathSegments[promptsIndex + 1];
        if (categoryCandidate) {
          return categoryCandidate.toLowerCase();
        }
      }

      return null;
    } catch (error) {
      this.logger.warn('[CATEGORY EXTRACTOR] Error extracting category from path:', error);
      return null;
    }
  }
}

/**
 * Convenience function for quick category extraction
 */
export function extractPromptCategory(prompt: any, logger: Logger): CategoryExtractionResult {
  const extractor = new CategoryExtractor(logger);
  return extractor.extractCategory(prompt);
}
