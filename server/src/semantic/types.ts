/**
 * Semantic analysis shared types
 *
 * Provides lightweight type definitions that can be shared without
 * importing the full semantic analyzer implementation. This helps prevent
 * circular dependencies across logging, frameworks, and semantic modules.
 */

export interface ContentAnalysisResult {
  executionType: "prompt" | "template" | "chain";
  requiresExecution: boolean;
  requiresFramework: boolean;
  confidence: number;
  reasoning: string[];
  capabilities: {
    canDetectStructure: boolean;
    canAnalyzeComplexity: boolean;
    canRecommendFramework: boolean;
    hasSemanticUnderstanding: boolean;
  };
  limitations: string[];
  warnings: string[];
  executionCharacteristics: {
    hasConditionals: boolean;
    hasLoops: boolean;
    hasChainSteps: boolean;
    argumentCount: number;
    templateComplexity: number;
    hasSystemMessage: boolean;
    hasUserTemplate: boolean;
    hasStructuredReasoning: boolean;
    hasMethodologyKeywords: boolean;
    hasComplexAnalysis: boolean;
    advancedChainFeatures?: {
      hasDependencies: boolean;
      hasParallelSteps: boolean;
      hasAdvancedStepTypes: boolean;
      hasAdvancedErrorHandling: boolean;
      hasStepConfigurations: boolean;
      hasCustomTimeouts: boolean;
      requiresAdvancedExecution: boolean;
      complexityScore: number;
    };
  };
  complexity: "low" | "medium" | "high";
  suggestedGates: string[];
  frameworkRecommendation: {
    shouldUseFramework: boolean;
    reasoning: string[];
    confidence: number;
    requiresUserChoice?: boolean;
    availableFrameworks?: string[];
  };
  analysisMetadata: {
    version: string;
    mode: "structural" | "semantic";
    analysisTime: number;
    analyzer: "content";
    cacheHit: boolean;
    fallbackUsed?: boolean;
    llmUsed?: boolean;
    hooksUsed?: boolean;
  };
}

export interface LLMClient {
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
