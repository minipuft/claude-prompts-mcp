/**
 * Framework-Semantic Integration -  Implementation
 * Intelligent framework switching and consensus mechanisms
 *
 * Key Integration Points:
 * - Semantic Analysis provides WHAT the prompt needs (complexity, structure, requirements)
 * - Framework Manager provides HOW to approach it (methodology, system prompts)
 * - Integration layer coordinates between systems WITHOUT interference
 */
import { Logger } from '../../logging/index.js';
import { ContentAnalyzer } from '../../semantic/configurable-semantic-analyzer.js';
import { ConvertedPrompt } from '../../types/index.js';
import { FrameworkManager } from '../framework-manager.js';
import { FrameworkStateManager } from '../framework-state-manager.js';
import { PromptGuidanceService } from '../prompt-guidance/service.js';
import { FrameworkExecutionContext, FrameworkSwitchingConfig, FrameworkSwitchRecommendation, FrameworkUsageInsights, IntegratedAnalysisResult } from '../types/index.js';
import type { ContentAnalysisResult } from '../../semantic/types.js';
/**
 * Integration types are sourced from the semantic integration type module
 */
/**
 * Framework-Semantic Integration Engine
 * Coordinates framework selection based on semantic analysis and user preference
 */
export declare class FrameworkSemanticIntegration {
    private frameworkManager;
    private frameworkStateManager;
    private semanticAnalyzer;
    private logger;
    private config;
    private promptGuidanceService?;
    private lastFrameworkSwitch;
    private frameworkUsageHistory;
    constructor(frameworkManager: FrameworkManager, frameworkStateManager: FrameworkStateManager, semanticAnalyzer: ContentAnalyzer, logger: Logger, config?: Partial<FrameworkSwitchingConfig>);
    /**
     * Main integration method - combines semantic analysis with framework selection
     * Enhanced with prompt guidance coordination
     */
    analyzeWithFrameworkIntegration(prompt: ConvertedPrompt, userFrameworkPreference?: string, includePromptGuidance?: boolean): Promise<IntegratedAnalysisResult>;
    /**
     * Get framework performance insights for optimization
     */
    getFrameworkUsageInsights(): FrameworkUsageInsights;
    /**
     * Intelligent framework switching based on performance and alignment
     */
    evaluateFrameworkSwitch(prompt: ConvertedPrompt, currentResult: IntegratedAnalysisResult): Promise<FrameworkSwitchRecommendation | null>;
    /**
     * Enhance framework criteria with user preferences, context, and analysis capabilities
     */
    private enhanceFrameworkCriteria;
    /**
     * Select framework using rule-based selection logic and user preference
     */
    private selectOptimalFramework;
    /**
     * Validate alignment between semantic analysis and selected framework
     */
    private validateFrameworkAlignment;
    /**
     * Generate alternative framework options for consensus
     */
    private generateAlternativeFrameworks;
    /**
     * Generate integrated recommendations combining semantic and framework insights
     */
    private generateIntegratedRecommendations;
    private calculateConfidenceAlignment;
    private calculateComplexityMatch;
    private calculateExecutionTypeCompatibility;
    private generateExecutionApproach;
    private getFrameworkSpecificGates;
    private generateOptimizationSuggestions;
    /**
     * Estimate processing time based on semantic analysis
     */
    private estimateProcessingTime;
    /**
     * Estimate memory usage based on semantic analysis
     */
    private estimateMemoryUsage;
    private updateFrameworkUsage;
    private generateUsageRecommendations;
    private estimateImprovementPotential;
    private createNonFrameworkIntegratedResult;
    /**
     * Set prompt guidance service for intelligent coordination
     */
    setPromptGuidanceService(promptGuidanceService: PromptGuidanceService): void;
    /**
     * Check if prompt guidance is available and ready
     */
    hasPromptGuidance(): boolean;
    /**
     * Apply semantic-guided prompt enhancement
     */
    applySemanticGuidedEnhancement(prompt: ConvertedPrompt, semanticAnalysis: ContentAnalysisResult, frameworkContext: FrameworkExecutionContext): Promise<any>;
    private createFallbackIntegratedResult;
}
/**
 * Create and configure framework-semantic integration with configurable analyzer
 */
export declare function createFrameworkSemanticIntegration(frameworkManager: FrameworkManager, frameworkStateManager: FrameworkStateManager, logger: Logger, semanticAnalyzer: ContentAnalyzer, config?: Partial<FrameworkSwitchingConfig>): Promise<FrameworkSemanticIntegration>;
