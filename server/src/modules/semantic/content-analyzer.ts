// @lifecycle canonical - Primary content analyzer for prompts and contexts.
/**
 * Content Analyzer
 *
 * Returns a conservative, structure-free description of a prompt: execution type, a fixed
 * confidence, and the handful of shape facts readable off `ConvertedPrompt` directly — does it
 * have chain steps, how many arguments, is there a system message.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 * - Pattern-match keywords to infer intent. Removed previously; it produced confident-looking
 *   output with no signal behind it.
 * - Detect chains. The command parser owns that and sees the actual parse.
 * - Call a model. No analysis path here does — evaluation by a model is the `%judge` gate flow,
 *   which runs in the client's own subagent rather than through an outbound API.
 *
 * Results are cached per prompt shape for five minutes.
 */

import { SemanticAnalysisConfig } from '../../types.js';

import type { ContentAnalysisResult, ContentAnalyzerPort, Logger } from '#shared/types/index.js';

import { ConvertedPrompt } from '#engine/execution/types.js';

// Configuration constants
const CACHE_ANALYSIS = true;
const CACHE_EXPIRY_MS = 300000; // 5 minutes

export class ContentAnalyzer implements ContentAnalyzerPort {
  private logger: Logger;
  private config: SemanticAnalysisConfig;
  private analysisCache = new Map<string, { analysis: ContentAnalysisResult; timestamp: number }>();

  constructor(logger: Logger, config: SemanticAnalysisConfig) {
    this.logger = logger;
    this.config = config;
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
    this.logger.info('Content analyzer configuration updated');
  }

  /**
   * Reports the `analysis.semanticAnalysis.llmIntegration.enabled` config flag.
   *
   * This does NOT indicate that model-backed analysis is available — no such path exists here.
   * Two callers branch on it to decide how much detail their responses carry
   * (`prompt-analyzer`, `prompt-lifecycle-processor`), so it reports the flag rather than a
   * hardcoded `false`, which would change user-visible output. Its fate is tied to the config
   * section it reads, resolved in T4 of
   * `plans/semantic-llm-sidecar-retirement-2026-08-05.md`.
   */
  isLLMEnabled(): boolean {
    return this.config.llmIntegration.enabled;
  }

  /**
   * Main analysis method
   */
  async analyzePrompt(prompt: ConvertedPrompt): Promise<ContentAnalysisResult> {
    const startTime = performance.now();
    const promptHash = this.generatePromptHash(prompt);

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

    const analysis = this.buildAnalysis(prompt, startTime);

    if (CACHE_ANALYSIS) {
      this.cacheAnalysis(promptHash, analysis);
    }

    this.logger.debug(`Analysis completed for prompt: ${prompt.id || 'unknown'}`);
    return analysis;
  }

  /**
   * Clear analysis cache
   */
  clearCache(): void {
    this.analysisCache.clear();
    this.logger.info('Content analysis cache cleared');
  }

  /**
   * Get analysis performance statistics
   */
  getPerformanceStats() {
    return {
      cacheSize: this.analysisCache.size,
      cacheEnabled: CACHE_ANALYSIS,
    };
  }

  // Cache and utility methods

  private generatePromptHash(prompt: ConvertedPrompt): string {
    return [
      prompt.id,
      prompt.userMessageTemplate?.length || 0,
      prompt.systemMessage?.length || 0,
      prompt.arguments?.length || 0,
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
   * Build the result: safe defaults plus the shape facts readable from the prompt.
   *
   * Pure and total — it reads only its arguments and has no branch that can throw, which is why
   * `analyzePrompt` no longer wraps it in a try/catch whose only recovery was to call this same
   * method a second time.
   */
  private buildAnalysis(prompt: ConvertedPrompt, startTime: number): ContentAnalysisResult {
    return {
      executionType: 'single',
      requiresExecution: true,
      requiresFramework: false,
      confidence: 0.5,
      reasoning: ['Structural analysis only - prompt content is not inspected'],

      capabilities: {
        canDetectStructure: false,
        canAnalyzeComplexity: false,
        canRecommendFramework: false,
        hasSemanticUnderstanding: false,
      },

      limitations: [
        'Prompt content is not inspected; only its shape is reported',
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
        hasFrameworkKeywords: false,
        hasComplexAnalysis: false,
      },

      complexity: 'low',
      suggestedGates: ['basic_validation'],

      frameworkRecommendation: {
        shouldUseFramework: false,
        reasoning: ['Framework recommendation requires explicit user choice'],
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
}

export type { ContentAnalysisResult } from '#shared/types/index.js';

/**
 * Create content analyzer
 */
export function createContentAnalyzer(
  logger: Logger,
  config: SemanticAnalysisConfig
): ContentAnalyzer {
  return new ContentAnalyzer(logger, config);
}
