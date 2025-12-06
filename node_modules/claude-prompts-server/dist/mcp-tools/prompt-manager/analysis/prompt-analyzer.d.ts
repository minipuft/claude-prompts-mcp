/**
 * Semantic analysis and classification engine
 */
import { ConvertedPrompt } from '../../../types/index.js';
import { PromptClassification, AnalysisResult, PromptManagerDependencies } from '../core/types.js';
/**
 * Prompt analysis engine for semantic classification and intelligence feedback
 */
export declare class PromptAnalyzer {
    private logger;
    private semanticAnalyzer;
    constructor(dependencies: Pick<PromptManagerDependencies, 'logger' | 'semanticAnalyzer'>);
    /**
     * Analyze prompt for intelligence feedback (compact format)
     */
    analyzePromptIntelligence(promptData: any): Promise<AnalysisResult>;
    /**
     * Analyze prompt using semantic analyzer (configuration-aware)
     */
    analyzePrompt(prompt: ConvertedPrompt): Promise<PromptClassification>;
    /**
     * Create fallback analysis when semantic analysis fails
     */
    private createFallbackAnalysis;
    /**
     * Create fallback analysis when semantic analysis is disabled
     */
    createDisabledAnalysisFallback(prompt: ConvertedPrompt): PromptClassification;
    /**
     * Get analysis icon based on analysis mode/framework
     */
    private getAnalysisIcon;
    /**
     * Generate capability-aware suggestions
     */
    private generateSuggestions;
    /**
     * Detect execution type from prompt structure
     */
    detectExecutionType(prompt: ConvertedPrompt): 'single' | 'chain';
    /**
     * Analyze prompt complexity
     */
    analyzeComplexity(prompt: ConvertedPrompt): {
        level: 'low' | 'medium' | 'high';
        factors: string[];
        score: number;
    };
    /**
     * Check if prompt requires framework support
     */
    requiresFramework(prompt: ConvertedPrompt): boolean;
}
