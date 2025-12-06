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
export declare class CategoryExtractor {
    private logger;
    constructor(logger: Logger);
    /**
     * Extract category from prompt using multiple detection strategies
     *
     * Priority order:
     * 1. Prompt metadata category (highest confidence)
     * 2. File path structure parsing
     * 3. Prompt ID pattern matching
     * 4. Default fallback
     */
    extractCategory(prompt: any): CategoryExtractionResult;
    /**
     * Extract category from file path structure
     * Examples:
     * - "/prompts/analysis/notes.md" -> "analysis"
     * - "/prompts/education/learning.md" -> "education"
     * - "analysis/query_refinement.md" -> "analysis"
     */
    private extractCategoryFromPath;
    /**
     * Extract category from prompt ID patterns
     * Examples:
     * - "analysis_notes" -> "analysis"
     * - "education_learning" -> "education"
     * - "debug_application" -> "debugging"
     */
    private extractCategoryFromPattern;
    /**
     * Validate if a category is recognized
     */
    private isValidCategory;
    /**
     * Intelligent gate selection with precedence logic
     *
     * Priority order:
     * 1. Explicit template gates (highest priority)
     * 2. Category-based gates
     * 3. Framework-based gates
     * 4. Default fallback gates (lowest priority)
     */
    selectGatesWithPrecedence(categoryResult: CategoryExtractionResult, frameworkGates?: string[], fallbackGates?: string[]): {
        selectedGates: string[];
        precedenceUsed: string[];
        reasoning: string;
    };
    /**
     * Get fallback category mapping for gate selection
     */
    static getCategoryGateMapping(): Record<string, string[]>;
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
    selectGatesWithEnhancedPrecedence(categoryResult: CategoryExtractionResult, frameworkGates?: string[], fallbackGates?: string[], temporaryGates?: string[], enhancedConfig?: any): {
        selectedGates: string[];
        precedenceUsed: string[];
        reasoning: string;
        temporaryGatesApplied: string[];
    };
}
/**
 * Convenience function for quick category extraction
 */
export declare function extractPromptCategory(prompt: any, logger: Logger): CategoryExtractionResult;
