// @lifecycle canonical - LLM client wrappers used by semantic analyzer.
/**
 * LLM Integration Clients for Semantic Analysis
 *
 * Provides concrete implementations for different LLM providers
 * to enable intelligent semantic analysis when configured.
 */

import { Logger } from '../../logging/index.js';
import { LLMIntegrationConfig, LLMProvider } from '../../types/index.js';

import type { LLMClient } from '../types.js';

/**
 * Base LLM client with common functionality
 */
abstract class BaseLLMClient implements LLMClient {
  protected logger: Logger;
  protected config: LLMIntegrationConfig;

  constructor(logger: Logger, config: LLMIntegrationConfig) {
    this.logger = logger;
    this.config = config;
  }

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
  }): string {
    return `${request.task}

Prompt Text:
"""
${request.text}
"""

Available Execution Types: ${request.categories.join(', ')}
Available Methodologies: ${request.methodologies.join(', ')}

Please analyze this prompt and return:
1. executionType: One of [${request.categories.join(', ')}]
2. confidence: Number between 0 and 1
3. reasoning: Array of strings explaining your analysis
4. recommendedFramework: One of [${request.methodologies.join(', ')}] or "none"
5. complexity: One of ["low", "medium", "high"]

Respond in JSON format only.`;
  }

  /**
   * Parse LLM response and validate format
   */
  protected parseResponse(response: string): {
    executionType: string;
    confidence: number;
    reasoning: string[];
    recommendedFramework?: string;
    complexity: string;
  } {
    try {
      const parsed = JSON.parse(response);

      return {
        executionType: parsed.executionType || 'single',
        confidence: Math.max(0.1, Math.min(1.0, parsed.confidence || 0.5)),
        reasoning: Array.isArray(parsed.reasoning) ? parsed.reasoning : ['LLM analysis performed'],
        recommendedFramework:
          parsed.recommendedFramework === 'none' ? undefined : parsed.recommendedFramework,
        complexity: ['low', 'medium', 'high'].includes(parsed.complexity)
          ? parsed.complexity
          : 'medium',
      };
    } catch (error) {
      this.logger.warn('Failed to parse LLM response, using defaults:', error);
      return {
        executionType: 'template',
        confidence: 0.3,
        reasoning: ['Failed to parse LLM response'],
        complexity: 'medium',
      };
    }
  }
}

/**
 * OpenAI client implementation
 */
export class OpenAIClient extends BaseLLMClient {
  async classify(request: {
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
  }> {
    if (!this.config.apiKey) {
      throw new Error('OpenAI API key not configured');
    }

    const prompt = this.buildAnalysisPrompt(request);

    try {
      const response = await fetch(
        this.config.endpoint || 'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.config.model,
            messages: [
              {
                role: 'system',
                content:
                  'You are an expert at analyzing prompts for execution strategy and framework requirements. Always respond with valid JSON.',
              },
              {
                role: 'user',
                content: prompt,
              },
            ],
            max_tokens: this.config.maxTokens,
            temperature: this.config.temperature,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as any;
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('No content in OpenAI response');
      }

      this.logger.debug('OpenAI analysis completed successfully');
      return this.parseResponse(content);
    } catch (error) {
      this.logger.error('OpenAI API call failed:', error);
      throw error;
    }
  }
}

/**
 * Anthropic client implementation
 */
export class AnthropicClient extends BaseLLMClient {
  async classify(request: {
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
  }> {
    if (!this.config.apiKey) {
      throw new Error('Anthropic API key not configured');
    }

    const prompt = this.buildAnalysisPrompt(request);

    try {
      const response = await fetch(
        this.config.endpoint || 'https://api.anthropic.com/v1/messages',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            'Content-Type': 'application/json',
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: this.config.model || 'claude-3-haiku-20240307',
            max_tokens: this.config.maxTokens,
            temperature: this.config.temperature,
            messages: [
              {
                role: 'user',
                content: prompt,
              },
            ],
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as any;
      const content = data.content?.[0]?.text;

      if (!content) {
        throw new Error('No content in Anthropic response');
      }

      this.logger.debug('Anthropic analysis completed successfully');
      return this.parseResponse(content);
    } catch (error) {
      this.logger.error('Anthropic API call failed:', error);
      throw error;
    }
  }
}

/**
 * Custom endpoint client implementation
 */
export class CustomClient extends BaseLLMClient {
  async classify(request: {
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
  }> {
    if (!this.config.endpoint) {
      throw new Error('Custom endpoint not configured');
    }

    const prompt = this.buildAnalysisPrompt(request);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      if (this.config.apiKey) {
        headers['Authorization'] = `Bearer ${this.config.apiKey}`;
      }

      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: this.config.model,
          prompt: prompt,
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
        }),
      });

      if (!response.ok) {
        throw new Error(`Custom endpoint error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as any;
      // Assume the custom endpoint returns the analysis directly
      const content = data.response || data.content || data.text;

      if (!content) {
        throw new Error('No content in custom endpoint response');
      }

      this.logger.debug('Custom endpoint analysis completed successfully');
      return this.parseResponse(content);
    } catch (error) {
      this.logger.error('Custom endpoint call failed:', error);
      throw error;
    }
  }
}

/**
 * Detect LLM provider from endpoint URL
 */
function detectProviderFromEndpoint(endpoint: string | null): LLMProvider {
  if (!endpoint) {
    throw new Error('Endpoint URL is required for provider auto-detection');
  }

  const url = endpoint.toLowerCase();

  if (url.includes('api.openai.com')) {
    return 'openai';
  } else if (url.includes('api.anthropic.com')) {
    return 'anthropic';
  } else {
    return 'custom';
  }
}

/**
 * LLM client factory
 */
export class LLMClientFactory {
  static create(logger: Logger, config: LLMIntegrationConfig): LLMClient {
    try {
      const provider = detectProviderFromEndpoint(config.endpoint);

      switch (provider) {
        case 'openai':
          return new OpenAIClient(logger, config);
        case 'anthropic':
          return new AnthropicClient(logger, config);
        case 'custom':
          return new CustomClient(logger, config);
        default:
          throw new Error(`Unsupported LLM provider: ${provider}`);
      }
    } catch (error) {
      throw new Error(
        `Failed to create LLM client: ${error instanceof Error ? error.message : 'Unknown error'}. ` +
          `Please ensure the endpoint URL is valid and follows the format: ` +
          `"https://api.openai.com/v1/chat/completions" for OpenAI, ` +
          `"https://api.anthropic.com/v1/messages" for Anthropic, ` +
          `or a custom endpoint URL for other providers.`
      );
    }
  }

  /**
   * Test LLM client configuration
   */
  static async testClient(logger: Logger, config: LLMIntegrationConfig): Promise<boolean> {
    try {
      // Auto-detect provider before testing
      const provider = detectProviderFromEndpoint(config.endpoint);
      logger.debug(`Auto-detected LLM provider: ${provider} from endpoint: ${config.endpoint}`);

      const client = LLMClientFactory.create(logger, config);

      const testResult = await client.classify({
        text: 'Analyze this simple test prompt with two arguments: {{input}} and {{context}}',
        task: 'Test classification',
        categories: ['prompt', 'template'],
        methodologies: ['CAGEERF', 'none'],
      });

      // Basic validation that we got a valid response
      return Boolean(
        testResult.executionType && testResult.confidence > 0 && testResult.reasoning.length > 0
      );
    } catch (error) {
      logger.error('LLM client test failed:', error);
      return false;
    }
  }
}

/**
 * Environment variable configuration helper
 * Provider is auto-detected from endpoint URL
 */
export function loadLLMConfigFromEnv(): Partial<LLMIntegrationConfig> {
  const env = process.env;
  return {
    enabled: env['MCP_LLM_ENABLED'] === 'true',
    apiKey: env['MCP_LLM_API_KEY'] || null,
    endpoint: env['MCP_LLM_ENDPOINT'] || null,
    model: env['MCP_LLM_MODEL'] || 'gpt-4',
    maxTokens: parseInt(env['MCP_LLM_MAX_TOKENS'] || '1000'),
    temperature: parseFloat(env['MCP_LLM_TEMPERATURE'] || '0.1'),
  };
}
