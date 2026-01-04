/**
 * Semantic Integrations Module
 *
 * Central module for creating and managing semantic integrations
 * Handles LLM clients for content analysis
 */
import { Logger } from '../../logging/index.js';
import { SemanticAnalysisConfig } from '../../types/index.js';
import { ContentAnalyzer } from '../configurable-semantic-analyzer.js';
/**
 * Integration factory for content analyzer
 */
export declare class SemanticIntegrationFactory {
    private logger;
    constructor(logger: Logger);
    /**
     * Create fully configured semantic analyzer with all integrations
     */
    createConfiguredAnalyzer(config: SemanticAnalysisConfig): Promise<ContentAnalyzer>;
    /**
     * Create analyzer with environment variable overrides
     */
    createFromEnvironment(baseConfig: SemanticAnalysisConfig): Promise<ContentAnalyzer>;
    /**
     * Validate configuration and provide recommendations
     */
    validateConfiguration(config: SemanticAnalysisConfig): {
        isValid: boolean;
        warnings: string[];
        recommendations: string[];
    };
    /**
     * Generate configuration documentation
     */
    generateConfigurationGuide(): string;
}
export declare function createSemanticIntegrationFactory(logger: Logger): SemanticIntegrationFactory;
export { LLMClientFactory, loadLLMConfigFromEnv } from './llm-clients.js';
export type { LLMClient } from '../types.js';
