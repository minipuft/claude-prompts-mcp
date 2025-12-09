// @lifecycle canonical - Registers semantic analyzer integrations.
/**
 * Semantic Integrations Module
 *
 * Central module for creating and managing semantic integrations
 * Handles LLM clients for content analysis
 */

import { Logger } from '../../logging/index.js';
import { SemanticAnalysisConfig } from '../../types/index.js';
import { ContentAnalyzer, createContentAnalyzer } from '../configurable-semantic-analyzer.js';
import { LLMClientFactory, loadLLMConfigFromEnv } from './llm-clients.js';

/**
 * Integration factory for content analyzer
 */
export class SemanticIntegrationFactory {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Create fully configured semantic analyzer with all integrations
   */
  async createConfiguredAnalyzer(config: SemanticAnalysisConfig): Promise<ContentAnalyzer> {
    const analyzer = createContentAnalyzer(this.logger, config);

    // Setup LLM integration if enabled
    if (config.llmIntegration.enabled && config.llmIntegration.endpoint) {
      try {
        const llmClient = LLMClientFactory.create(this.logger, config.llmIntegration);
        analyzer.setLLMClient(llmClient);
        // Auto-detect provider from endpoint
        const provider = config.llmIntegration.endpoint?.includes('api.openai.com')
          ? 'openai'
          : config.llmIntegration.endpoint?.includes('api.anthropic.com')
            ? 'anthropic'
            : 'custom';
        this.logger.info(
          `LLM integration configured: ${provider} (auto-detected from ${config.llmIntegration.endpoint})`
        );

        // Test the client
        const testResult = await LLMClientFactory.testClient(this.logger, config.llmIntegration);
        if (!testResult) {
          this.logger.warn('LLM client test failed - integration may not work correctly');
        }
      } catch (error) {
        this.logger.error('Failed to setup LLM integration:', error);
        this.logger.warn('LLM integration failed - minimal analysis will be used');
      }
    }

    return analyzer;
  }

  /**
   * Create analyzer with environment variable overrides
   */
  async createFromEnvironment(baseConfig: SemanticAnalysisConfig): Promise<ContentAnalyzer> {
    // Merge with environment variables
    const envLLMConfig = loadLLMConfigFromEnv();

    const mergedConfig: SemanticAnalysisConfig = {
      ...baseConfig,
      llmIntegration: {
        ...baseConfig.llmIntegration,
        ...envLLMConfig,
      },
    };

    return this.createConfiguredAnalyzer(mergedConfig);
  }

  /**
   * Validate configuration and provide recommendations
   */
  validateConfiguration(config: SemanticAnalysisConfig): {
    isValid: boolean;
    warnings: string[];
    recommendations: string[];
  } {
    const warnings: string[] = [];
    const recommendations: string[] = [];
    const isValid = true;

    // Check LLM integration configuration
    if (config.llmIntegration.enabled) {
      if (!config.llmIntegration.endpoint) {
        warnings.push('LLM integration enabled but no endpoint specified');
        recommendations.push(
          "Set endpoint URL (provider will be auto-detected): 'https://api.openai.com/v1/chat/completions', 'https://api.anthropic.com/v1/messages', or custom endpoint"
        );
      }

      if (
        !config.llmIntegration.apiKey &&
        config.llmIntegration.endpoint &&
        !config.llmIntegration.endpoint.includes('localhost')
      ) {
        warnings.push('LLM integration missing API key');
        recommendations.push('Set API key for LLM provider or use environment variables');
      }

      if (config.llmIntegration.maxTokens < 100) {
        warnings.push('LLM max tokens is very low, may cause truncated responses');
        recommendations.push('Consider increasing max tokens to at least 500');
      }
    } else {
      // LLM not configured - minimal analysis will be used
      recommendations.push(
        'Configure LLM integration for intelligent semantic analysis and framework recommendations'
      );
    }

    return { isValid, warnings, recommendations };
  }

  /**
   * Generate configuration documentation
   */
  generateConfigurationGuide(): string {
    return `
# Content Analysis Setup Guide

## Analysis Behavior

### Without LLM Integration (Default)
- Returns minimal analysis results immediately
- Chain detection is handled by the command parser
- Framework selection requires explicit user choice
- No performance overhead from pattern matching

### With LLM Integration
- Full semantic understanding of prompts
- Intelligent framework recommendations
- Context-aware complexity analysis
- Requires API key and endpoint configuration

## LLM Integration Setup

### Environment Variables
\`\`\`bash
export MCP_LLM_ENABLED=true
export MCP_LLM_API_KEY=your_api_key
export MCP_LLM_MODEL=gpt-4
export MCP_LLM_MAX_TOKENS=1000
export MCP_LLM_TEMPERATURE=0.1
\`\`\`

### Configuration
\`\`\`json
{
  "analysis": {
    "semanticAnalysis": {
      "llmIntegration": {
        "enabled": true,
        "endpoint": "https://api.openai.com/v1/chat/completions",
        "apiKey": "your_api_key",
        "model": "gpt-4"
      }
    }
  }
}
\`\`\`

## Testing Configuration

### Test LLM Integration
\`\`\`bash
# Test via environment variables
MCP_LLM_ENABLED=true MCP_LLM_API_KEY=key npm test
\`\`\`

## Performance Considerations

- **Caching**: Analysis results are cached for 5 minutes
- **Minimal Mode**: When LLM not configured, returns immediately with no overhead
- **Rate Limits**: Be aware of LLM API rate limits when using semantic analysis

## Security Considerations

- **API Keys**: Use environment variables, never commit to config files
- **Timeouts**: LLM requests have configurable timeouts
`;
  }
}

// Export main factory instance
export function createSemanticIntegrationFactory(logger: Logger): SemanticIntegrationFactory {
  return new SemanticIntegrationFactory(logger);
}

// Re-export integration components
export { LLMClientFactory, loadLLMConfigFromEnv } from './llm-clients.js';
export type { LLMClient } from '../types.js';
