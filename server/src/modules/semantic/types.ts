// @lifecycle canonical - Type definitions for semantic services.
/**
 * Semantic analysis shared types
 *
 * ContentAnalysisResult is defined in shared/types/ (cross-layer contract).
 * Import directly from shared/types/index.js — no re-export shim.
 */

export interface LLMClient {
  classify(request: {
    text: string;
    task: string;
    categories: string[];
    frameworks: string[];
  }): Promise<{
    executionType: string;
    confidence: number;
    reasoning: string[];
    recommendedFramework?: string;
    complexity: string;
  }>;
}
