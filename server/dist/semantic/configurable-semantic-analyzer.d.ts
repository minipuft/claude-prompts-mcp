/**
 * Content Analyzer - Semantic Analysis with LLM Integration
 *
 * BEHAVIOR:
 * - When LLM is configured: Provides intelligent semantic analysis
 * - When LLM is NOT configured: Returns minimal results immediately
 *
 * DESIGN RATIONALE:
 * - Structural analysis was removed as it provided zero value
 * - Chain detection is already handled by the command parser
 * - Pattern-matching keywords doesn't provide semantic understanding
 * - LLM infrastructure is preserved for future intelligent analysis
 */
import { ConvertedPrompt } from '../execution/types.js';
import { Logger } from '../logging/index.js';
import { SemanticAnalysisConfig } from '../types.js';
import type { ContentAnalysisResult, LLMClient } from './types.js';
/**
 * Content Analyzer Implementation
 * Returns minimal results when LLM not configured, semantic analysis when LLM available
 */
export declare class ContentAnalyzer {
    private logger;
    private config;
    private analysisCache;
    private llmClient?;
    constructor(logger: Logger, config: SemanticAnalysisConfig);
    /**
     * Set LLM client for semantic mode
     */
    setLLMClient(client: LLMClient): void;
    /**
     * Get current configuration
     */
    getConfig(): SemanticAnalysisConfig;
    /**
     * Update configuration
     */
    updateConfig(newConfig: Partial<SemanticAnalysisConfig>): void;
    /**
     * Check if LLM integration is enabled
     */
    isLLMEnabled(): boolean;
    /**
     * Main analysis method - returns minimal results or LLM-powered analysis
     */
    analyzePrompt(prompt: ConvertedPrompt): Promise<ContentAnalysisResult>;
    /**
     * Clear analysis cache
     */
    clearCache(): void;
    /**
     * Get analysis performance statistics
     */
    getPerformanceStats(): {
        cacheSize: number;
        cacheEnabled: boolean;
        llmIntegrationEnabled: boolean;
    };
    /**
     * Perform analysis - LLM if available, minimal otherwise
     */
    private performAnalysis;
    /**
     * Perform LLM-powered analysis
     */
    private performLLMAnalysis;
    /**
     * Analyze basic structural characteristics for LLM context
     * These are used as baseline information when performing LLM analysis
     */
    private analyzeStructuralCharacteristics;
    private calculateTemplateComplexity;
    private suggestExecutionGates;
    private generatePromptHash;
    private getCachedAnalysis;
    private cacheAnalysis;
    /**
     * Create minimal analysis result when LLM is not available
     * Returns safe defaults without attempting pattern matching
     */
    private createMinimalAnalysis;
    private normalizeExecutionType;
}
export type { ContentAnalysisResult, LLMClient } from './types.js';
/**
 * Create content analyzer
 */
export declare function createContentAnalyzer(logger: Logger, config: SemanticAnalysisConfig): ContentAnalyzer;
