/**
 * LLM Integration Clients for Semantic Analysis
 *
 * Provides concrete implementations for different LLM providers
 * to enable intelligent semantic analysis when configured.
 */
import { Logger } from '../../logging/index.js';
import { LLMIntegrationConfig } from '../../types/index.js';
import type { LLMClient } from '../types.js';
/**
 * Base LLM client with common functionality
 */
declare abstract class BaseLLMClient implements LLMClient {
    protected logger: Logger;
    protected config: LLMIntegrationConfig;
    constructor(logger: Logger, config: LLMIntegrationConfig);
    abstract classify(request: {
        text: string;
        task: string;
        categories: string[];
        methodologies: string[];
    }): Promise<{
        executionType: string;
        confidence: number;
        reasoning: string[];
        recommendedFramework?: string;
        complexity: string;
    }>;
    /**
     * Common prompt construction for semantic analysis
     */
    protected buildAnalysisPrompt(request: {
        text: string;
        task: string;
        categories: string[];
        methodologies: string[];
    }): string;
    /**
     * Parse LLM response and validate format
     */
    protected parseResponse(response: string): {
        executionType: string;
        confidence: number;
        reasoning: string[];
        recommendedFramework?: string;
        complexity: string;
    };
}
/**
 * OpenAI client implementation
 */
export declare class OpenAIClient extends BaseLLMClient {
    classify(request: {
        text: string;
        task: string;
        categories: string[];
        methodologies: string[];
    }): Promise<{
        executionType: string;
        confidence: number;
        reasoning: string[];
        recommendedFramework?: string;
        complexity: string;
    }>;
}
/**
 * Anthropic client implementation
 */
export declare class AnthropicClient extends BaseLLMClient {
    classify(request: {
        text: string;
        task: string;
        categories: string[];
        methodologies: string[];
    }): Promise<{
        executionType: string;
        confidence: number;
        reasoning: string[];
        recommendedFramework?: string;
        complexity: string;
    }>;
}
/**
 * Custom endpoint client implementation
 */
export declare class CustomClient extends BaseLLMClient {
    classify(request: {
        text: string;
        task: string;
        categories: string[];
        methodologies: string[];
    }): Promise<{
        executionType: string;
        confidence: number;
        reasoning: string[];
        recommendedFramework?: string;
        complexity: string;
    }>;
}
/**
 * LLM client factory
 */
export declare class LLMClientFactory {
    static create(logger: Logger, config: LLMIntegrationConfig): LLMClient;
    /**
     * Test LLM client configuration
     */
    static testClient(logger: Logger, config: LLMIntegrationConfig): Promise<boolean>;
}
/**
 * Environment variable configuration helper
 * Provider is auto-detected from endpoint URL
 */
export declare function loadLLMConfigFromEnv(): Partial<LLMIntegrationConfig>;
export {};
