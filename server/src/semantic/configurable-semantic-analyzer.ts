// @lifecycle canonical - Primary semantic analyzer for prompts and contexts.
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
import { BUILTIN_FRAMEWORK_TYPES } from '../frameworks/types/methodology-types.js';
import { Logger } from '../logging/index.js';
import { SemanticAnalysisConfig } from '../types.js';

import type { ContentAnalysisResult, LLMClient } from './types.js';

// Configuration constants
const CACHE_ANALYSIS = true;
const CACHE_EXPIRY_MS = 300000; // 5 minutes

/**
 * Content Analyzer Implementation
 * Returns minimal results when LLM not configured, semantic analysis when LLM available
 */
export class ContentAnalyzer {
  private logger: Logger;
  private config: SemanticAnalysisConfig;
  private analysisCache = new Map<string, { analysis: ContentAnalysisResult; timestamp: number }>();

  // Integration clients (optional)
  private llmClient?: LLMClient;

  constructor(logger: Logger, config: SemanticAnalysisConfig) {
    this.logger = logger;
    this.config = config;
  }

  /**
   * Set LLM client for semantic mode
   */
  setLLMClient(client: LLMClient): void {
    this.llmClient = client;
  }

  /**
   * Get current configuration
   */
  getConfig(): SemanticAnalysisConfig {
    return this.config;
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<SemanticAnalysisConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.info('Configurable semantic analyzer configuration updated');
  }

  /**
   * Check if LLM integration is enabled
   */
  isLLMEnabled(): boolean {
    return this.config.llmIntegration.enabled;
  }

  /**
   * Main analysis method - returns minimal results or LLM-powered analysis
   */
  async analyzePrompt(prompt: ConvertedPrompt): Promise<ContentAnalysisResult> {
    const startTime = performance.now();
    const promptHash = this.generatePromptHash(prompt);

    // Check cache first
    if (CACHE_ANALYSIS) {
      const cached = this.getCachedAnalysis(promptHash);
      if (cached) {
        this.logger.debug(`Using cached analysis for prompt: ${prompt.id}`);
        return {
          ...cached.analysis,
          analysisMetadata: {
            ...cached.analysis.analysisMetadata,
            cacheHit: true,
          },
        };
      }
    }

    try {
      // Perform analysis - LLM if available, minimal otherwise
      const analysis = await this.performAnalysis(prompt, startTime);

      // Cache the result
      if (CACHE_ANALYSIS) {
        this.cacheAnalysis(promptHash, analysis);
      }

      const mode = analysis.analysisMetadata.llmUsed ? 'semantic' : 'minimal';
      this.logger.debug(`Analysis completed for prompt: ${prompt.id || 'unknown'} (mode: ${mode})`);
      return analysis;
    } catch (error) {
      this.logger.error('Semantic analysis failed:', error);
      return this.createMinimalAnalysis(prompt, startTime);
    }
  }

  /**
   * Clear analysis cache
   */
  clearCache(): void {
    this.analysisCache.clear();
    this.logger.info('Configurable semantic analysis cache cleared');
  }

  /**
   * Get analysis performance statistics
   */
  getPerformanceStats() {
    return {
      cacheSize: this.analysisCache.size,
      cacheEnabled: CACHE_ANALYSIS,
      llmIntegrationEnabled: this.config.llmIntegration.enabled,
    };
  }

  // Private implementation methods

  /**
   * Perform analysis - LLM if available, minimal otherwise
   */
  private async performAnalysis(
    prompt: ConvertedPrompt,
    startTime: number
  ): Promise<ContentAnalysisResult> {
    // Try LLM integration if configured
    if (this.isLLMEnabled() && this.llmClient) {
      try {
        return await this.performLLMAnalysis(prompt, startTime);
      } catch (error) {
        this.logger.warn('LLM analysis failed, returning minimal results:', error);
      }
    }

    // Return minimal results when LLM not available
    return this.createMinimalAnalysis(prompt, startTime);
  }

  /**
   * Perform LLM-powered analysis
   */
  private async performLLMAnalysis(
    prompt: ConvertedPrompt,
    startTime: number
  ): Promise<ContentAnalysisResult> {
    const combinedText = `${prompt.systemMessage || ''}\n${prompt.userMessageTemplate || ''}`;

    const llmResult = await this.llmClient!.classify({
      text: combinedText,
      task: 'Analyze this prompt for execution strategy and framework requirements',
      categories: ['single', 'prompt', 'template', 'chain'],
      // Use built-in frameworks for LLM classification guidance
      // Note: Custom frameworks are handled by FrameworkManager at runtime
      methodologies: [...BUILTIN_FRAMEWORK_TYPES, 'none'],
    });

    const normalizedExecution = this.normalizeExecutionType(llmResult.executionType);

    // Build structural characteristics as baseline
    const structuralCharacteristics = this.analyzeStructuralCharacteristics(prompt);

    return {
      executionType: normalizedExecution.executionType,
      requiresExecution: true,
      requiresFramework: llmResult.recommendedFramework !== 'none',
      confidence: llmResult.confidence,
      reasoning: llmResult.reasoning,

      capabilities: {
        canDetectStructure: true,
        canAnalyzeComplexity: true,
        canRecommendFramework: true,
        hasSemanticUnderstanding: true, // TRUE - we have LLM access
      },

      limitations: [], // No major limitations in semantic mode
      warnings: [],

      executionCharacteristics: structuralCharacteristics,
      complexity: llmResult.complexity as any,
      suggestedGates: this.suggestExecutionGates(structuralCharacteristics, llmResult.complexity),

      frameworkRecommendation: {
        shouldUseFramework: llmResult.recommendedFramework !== 'none',
        reasoning: [`LLM recommends ${llmResult.recommendedFramework || 'no specific framework'}`],
        confidence: llmResult.confidence,
      },

      analysisMetadata: {
        version: '3.0.0',
        mode: 'semantic',
        analysisTime: performance.now() - startTime,
        analyzer: 'content',
        cacheHit: false,
        llmUsed: true,
      },
    };
  }

  /**
   * Analyze basic structural characteristics for LLM context
   * These are used as baseline information when performing LLM analysis
   */
  private analyzeStructuralCharacteristics(prompt: ConvertedPrompt): any {
    const userTemplate = prompt.userMessageTemplate || '';
    const systemMessage = prompt.systemMessage || '';

    return {
      hasConditionals: /\{%.*if.*%\}|\{\{.*if.*\}\}/i.test(userTemplate),
      hasLoops: /\{%.*for.*%\}|\{\{.*each.*\}\}/i.test(userTemplate),
      hasChainSteps: Boolean(prompt.chainSteps?.length),
      argumentCount: prompt.arguments?.length || 0,
      templateComplexity: this.calculateTemplateComplexity(userTemplate),
      hasSystemMessage: Boolean(systemMessage.trim()),
      hasUserTemplate: Boolean(userTemplate.trim()),
      // These are set to false since we removed structural pattern detection
      hasStructuredReasoning: false,
      hasMethodologyKeywords: false,
      hasComplexAnalysis: false,
      advancedChainFeatures: undefined,
    };
  }

  // Helper methods

  private calculateTemplateComplexity(template: string): number {
    if (!template) return 0;

    let complexity = 0;

    const templateVars = (template.match(/\{\{.*?\}\}/g) || []).length;
    const nunjucksBlocks = (template.match(/\{%.*?%\}/g) || []).length;

    complexity += Math.min(templateVars / 10, 0.3);
    complexity += Math.min(nunjucksBlocks / 5, 0.4);
    complexity += Math.min(template.length / 1000, 0.3);

    return Math.min(complexity, 1);
  }

  private suggestExecutionGates(characteristics: any, complexity: string): string[] {
    const gates: string[] = ['execution_validation'];

    if (complexity === 'high') {
      gates.push('complexity_validation', 'performance_validation');
    }

    if (characteristics.hasConditionals) gates.push('conditional_logic_validation');
    if (characteristics.hasLoops) gates.push('iteration_validation');
    if (characteristics.hasChainSteps) gates.push('chain_validation');
    if (characteristics.argumentCount > 5) gates.push('argument_validation');

    return gates;
  }

  // Cache and utility methods

  private generatePromptHash(prompt: ConvertedPrompt): string {
    return [
      prompt.id,
      prompt.userMessageTemplate?.length || 0,
      prompt.systemMessage?.length || 0,
      prompt.arguments?.length || 0,
      this.config.llmIntegration.enabled ? 'llm' : 'minimal',
    ].join('-');
  }

  private getCachedAnalysis(promptHash: string) {
    const entry = this.analysisCache.get(promptHash);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > CACHE_EXPIRY_MS) {
      this.analysisCache.delete(promptHash);
      return null;
    }

    return entry;
  }

  private cacheAnalysis(promptHash: string, analysis: ContentAnalysisResult): void {
    this.analysisCache.set(promptHash, {
      analysis,
      timestamp: Date.now(),
    });
  }

  /**
   * Create minimal analysis result when LLM is not available
   * Returns safe defaults without attempting pattern matching
   */
  private createMinimalAnalysis(prompt: ConvertedPrompt, startTime: number): ContentAnalysisResult {
    return {
      executionType: 'single',
      requiresExecution: true,
      requiresFramework: false,
      confidence: 0.5,
      reasoning: ['Minimal analysis - LLM not configured'],

      capabilities: {
        canDetectStructure: false,
        canAnalyzeComplexity: false,
        canRecommendFramework: false,
        hasSemanticUnderstanding: false,
      },

      limitations: [
        'LLM integration not configured',
        'Framework recommendation not available',
        'Chain detection handled by command parser',
      ],
      warnings: [],

      executionCharacteristics: {
        hasConditionals: false,
        hasLoops: false,
        hasChainSteps: Boolean(prompt.chainSteps?.length),
        argumentCount: prompt.arguments?.length || 0,
        templateComplexity: 0,
        hasSystemMessage: Boolean(prompt.systemMessage),
        hasUserTemplate: Boolean(prompt.userMessageTemplate),
        hasStructuredReasoning: false,
        hasMethodologyKeywords: false,
        hasComplexAnalysis: false,
      },

      complexity: 'low',
      suggestedGates: ['basic_validation'],

      frameworkRecommendation: {
        shouldUseFramework: false,
        reasoning: ['Configure LLM integration for framework recommendations'],
        confidence: 0.1,
      },

      analysisMetadata: {
        version: '3.0.0',
        mode: 'minimal',
        analysisTime: performance.now() - startTime,
        analyzer: 'content',
        cacheHit: false,
      },
    };
  }

  private normalizeExecutionType(executionType: string): { executionType: 'single' | 'chain' } {
    const normalized = executionType.toLowerCase();
    if (normalized === 'chain') {
      return { executionType: 'chain' };
    }

    return { executionType: 'single' };
  }
}

export type { ContentAnalysisResult, LLMClient } from './types.js';

/**
 * Create content analyzer
 */
export function createContentAnalyzer(
  logger: Logger,
  config: SemanticAnalysisConfig
): ContentAnalyzer {
  return new ContentAnalyzer(logger, config);
}
