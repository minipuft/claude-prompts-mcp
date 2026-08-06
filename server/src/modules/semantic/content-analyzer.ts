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

import type { ContentAnalysisResult, ContentAnalyzerPort, Logger } from '#shared/types/index.js';

import { ConvertedPrompt } from '#engine/execution/types.js';

// Configuration constants
const CACHE_ANALYSIS = true;
const CACHE_EXPIRY_MS = 300000; // 5 minutes

/**
 * Analyzes prompt content. Takes no configuration.
 *
 * It used to be constructed with `SemanticAnalysisConfig`, stored it, and exposed it through
 * `getConfig`/`updateConfig` — but read no field from it. The last real read (a model-integration
 * term in the cache key) went with the LLM side client, and both accessors had zero callers
 * outside tests. The `analysis.semanticAnalysis` config section is still parsed and still warns at
 * startup; it simply no longer reaches this class, because it never fed a decision here.
 */
export class ContentAnalyzer implements ContentAnalyzerPort {
  private logger: Logger;
  private analysisCache = new Map<string, { analysis: ContentAnalysisResult; timestamp: number }>();

  constructor(logger: Logger) {
    this.logger = logger;
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
export function createContentAnalyzer(logger: Logger): ContentAnalyzer {
  return new ContentAnalyzer(logger);
}
