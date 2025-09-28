/**
 * Semantic Integrations Module
 *
 * Central module for creating and managing semantic integrations
 * Handles LLM clients for content analysis
 */

import { Logger } from "../../logging/index.js";
import { SemanticAnalysisConfig } from "../../types/index.js";
import {
  ContentAnalyzer,
  createContentAnalyzer
} from "../configurable-semantic-analyzer.js";
import { 
  LLMClientFactory,
  loadLLMConfigFromEnv 
} from "./llm-clients.js";

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
        const provider = config.llmIntegration.endpoint?.includes('api.openai.com') ? 'openai' :
                        config.llmIntegration.endpoint?.includes('api.anthropic.com') ? 'anthropic' : 'custom';
        this.logger.info(`LLM integration configured: ${provider} (auto-detected from ${config.llmIntegration.endpoint})`);
        
        // Test the client
        const testResult = await LLMClientFactory.testClient(this.logger, config.llmIntegration);
        if (!testResult) {
          this.logger.warn("LLM client test failed - integration may not work correctly");
        }
      } catch (error) {
        this.logger.error("Failed to setup LLM integration:", error);
        if (config.mode === 'semantic') {
          this.logger.warn("Semantic mode requested but LLM integration failed");
        }
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
        ...envLLMConfig
      }
    };

    // Override mode if environment variable is set
    if (process.env.MCP_ANALYSIS_MODE) {
      const mode = process.env.MCP_ANALYSIS_MODE as any;
      if (['structural', 'semantic'].includes(mode)) {
        mergedConfig.mode = mode;
        this.logger.info(`Analysis mode overridden by environment: ${mode}`);
      }
    }

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
    let isValid = true;

    // Check semantic mode requirements
    if (config.mode === 'semantic') {
      if (!config.llmIntegration.enabled) {
        warnings.push("Semantic mode enabled but LLM integration not configured");
        recommendations.push("Enable LLM integration with endpoint and API key for semantic analysis");
        
        // Always fallback to structural analysis - no failure case
      } else if (!config.llmIntegration.endpoint) {
        warnings.push("Semantic mode enabled but no LLM endpoint configured");
        recommendations.push("Set LLM endpoint URL (e.g., https://api.openai.com/v1/chat/completions)");
      }
    }

    // Check LLM integration configuration
    if (config.llmIntegration.enabled) {
      if (!config.llmIntegration.endpoint) {
        warnings.push("LLM integration enabled but no endpoint specified");
        recommendations.push("Set endpoint URL (provider will be auto-detected): 'https://api.openai.com/v1/chat/completions', 'https://api.anthropic.com/v1/messages', or custom endpoint");
      }

      if (!config.llmIntegration.apiKey && config.llmIntegration.endpoint && !config.llmIntegration.endpoint.includes('localhost')) {
        warnings.push("LLM integration missing API key");
        recommendations.push("Set API key for LLM provider or use environment variables");
      }

      if (config.llmIntegration.maxTokens < 100) {
        warnings.push("LLM max tokens is very low, may cause truncated responses");
        recommendations.push("Consider increasing max tokens to at least 500");
      }
    }


    // General recommendations
    if (config.mode === 'structural') {
      // Recommend semantic mode if LLM is properly configured
      if (config.llmIntegration.enabled && config.llmIntegration.endpoint && 
          (config.llmIntegration.endpoint.includes('localhost') || config.llmIntegration.endpoint.includes('127.0.0.1') || config.llmIntegration.apiKey)) {
        recommendations.push("LLM integration is configured - consider using semantic mode for better analysis");
      }
      
      // Always warn on limitations for better user experience
    }

    // Always cache for better performance

    return { isValid, warnings, recommendations };
  }

  /**
   * Generate configuration documentation
   */
  generateConfigurationGuide(): string {
    return `
# Content Analysis Setup Guide

## Analysis Modes

### Structural Mode (Default)
- **Description**: Honest analysis based only on detectable template structure
- **Capabilities**: Detects templates, chains, complexity from syntax
- **Limitations**: No semantic understanding, requires explicit framework selection
- **Use Case**: Reliable analysis without external dependencies

### Semantic Mode
- **Description**: LLM-powered intelligent analysis
- **Capabilities**: Full semantic understanding, framework recommendations
- **Requirements**: LLM integration OR Claude hooks configuration
- **Use Case**: Maximum intelligence when integrations are available


## LLM Integration Setup

### Environment Variables
\`\`\`bash
export MCP_LLM_ENABLED=true
export MCP_LLM_PROVIDER=openai  # or anthropic, custom
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
      "enabled": true,
      "mode": "semantic",
      "llmIntegration": {
        "enabled": true,
        "provider": "openai",
        "apiKey": "your_api_key",
        "model": "gpt-4"
      }
    }
  }
}
\`\`\`

## Claude Hooks Setup

### Environment Variables
\`\`\`bash
export MCP_HOOKS_ENABLED=true
export MCP_HOOKS_PATH=/path/to/your/hook.py
export MCP_HOOKS_PYTHON=python3
export MCP_HOOKS_TIMEOUT=30000
\`\`\`

### Hook Script Requirements
- Executable Python script
- Accepts JSON data file as argument
- Outputs JSON with analysis result
- Should handle timeouts gracefully

### Example Hook Script
Use the provided example hook script as a starting point:
\`\`\`bash
# Create example hook
node -e "
const { ClaudeHookRunnerImpl } = require('./path/to/claude-hook-runner.js');
const runner = new ClaudeHookRunnerImpl(logger, config);
runner.createExampleHook('./example-hook.py');
"
\`\`\`

## Testing Configuration

### Test LLM Integration
\`\`\`bash
# Test via environment variables
MCP_LLM_ENABLED=true MCP_LLM_PROVIDER=openai MCP_LLM_API_KEY=key npm test
\`\`\`

### Test Claude Hooks
\`\`\`bash
# Test hook execution
python3 your-hook.py test-data.json
\`\`\`

## Performance Considerations

- **Caching**: Enable caching for repeated analysis of same prompts
- **Timeouts**: Set appropriate timeouts for external integrations
- **Fallback**: Always enable fallback to structural analysis
- **Rate Limits**: Be aware of LLM API rate limits

## Security Considerations

- **API Keys**: Use environment variables, never commit to config files
- **Hook Scripts**: Validate hook scripts for security issues
- **Timeouts**: Prevent runaway hook executions
- **Sandboxing**: Consider sandboxing hook execution environment
`;
  }
}

// Export main factory instance
export function createSemanticIntegrationFactory(logger: Logger): SemanticIntegrationFactory {
  return new SemanticIntegrationFactory(logger);
}

// Re-export integration components
export { LLMClientFactory, loadLLMConfigFromEnv } from "./llm-clients.js";
export type { LLMClient } from "../configurable-semantic-analyzer.js";