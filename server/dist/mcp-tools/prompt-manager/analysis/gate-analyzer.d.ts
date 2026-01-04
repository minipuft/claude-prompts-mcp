/**
 * Gate Analyzer Module
 *
 * Analyzes prompt content to suggest appropriate gates and temporary gate definitions.
 * Integrates with the temporary gate system to provide intelligent gate recommendations.
 */
import type { ConvertedPrompt, TemporaryGateDefinition } from '../../../execution/types.js';
import type { PromptManagerDependencies } from '../core/types.js';
/**
 * Gate analysis result
 */
export interface GateAnalysisResult {
    /** Recommended persistent gates */
    recommendedGates: string[];
    /** Suggested temporary gates */
    suggestedTemporaryGates: TemporaryGateDefinition[];
    /** Analysis reasoning */
    reasoning: string[];
    /** Confidence score (0.0-1.0) */
    confidence: number;
    /** Gate configuration preview */
    gateConfigurationPreview: {
        include?: string[];
        exclude?: string[];
        framework_gates?: boolean;
        inline_gate_definitions?: TemporaryGateDefinition[];
    };
}
/**
 * Analyzes prompts for gate recommendations
 */
export declare class GateAnalyzer {
    private logger;
    private dependencies;
    constructor(dependencies: PromptManagerDependencies);
    /**
     * Analyze a prompt for gate recommendations
     */
    analyzePromptForGates(prompt: ConvertedPrompt): Promise<GateAnalysisResult>;
    /**
     * Extract gate suggestion context from prompt
     */
    private extractGateSuggestionContext;
    /**
     * Analyze prompt content for gate indicators
     */
    private analyzePromptContent;
    /**
     * Generate gate recommendations based on analysis
     */
    private generateGateRecommendations;
    /**
     * Generate temporary gate suggestions
     */
    private generateTemporaryGateSuggestions;
    /**
     * Calculate confidence score
     */
    private calculateConfidence;
    /**
     * Generate reasoning for recommendations
     */
    private generateReasoning;
    /**
     * Generate gate configuration preview
     */
    private generateGateConfigurationPreview;
    /**
     * Extract intent keywords from content
     */
    private extractIntentKeywords;
    /**
     * Get intent-based gate recommendations
     */
    private getIntentBasedGates;
    /**
     * Get category-based gate mapping
     */
    private getCategoryGateMapping;
    /**
     * Get framework-specific gates
     */
    private getFrameworkGates;
}
