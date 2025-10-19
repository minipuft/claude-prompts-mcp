/**
 * Content Analyzer - Honest Analysis with Multiple Modes
 *
 * MODES:
 * - structural: Honest analysis based only on detectable template structure
 * - semantic: LLM-powered intelligent analysis (when integration available)
 *
 * HONEST LIMITATIONS:
 * - Clear reporting of what cannot be determined without LLM access
 * - No fake "semantic understanding" without actual intelligence
 * - Transparent fallback mechanisms
 */

import { ConvertedPrompt } from "../execution/types.js";
import { Logger } from "../logging/index.js";
import { SemanticAnalysisConfig, AnalysisMode } from "../types.js";

// Configuration constants - always use best practices
const FALLBACK_TO_STRUCTURAL = true;
const WARN_ON_LIMITATIONS = true;  
const HONEST_REPORTING = true;
const CACHE_ANALYSIS = true;
const CACHE_EXPIRY_MS = 300000; // 5 minutes

/**
 * Enhanced content analysis result with honest limitations reporting
 */
export interface ContentAnalysisResult {
  // Core execution strategy - HOW to execute this prompt (3-tier model)
  executionType: "prompt" | "template" | "chain";
  requiresExecution: boolean;
  requiresFramework: boolean;
  confidence: number;
  reasoning: string[];
  
  // Analysis capabilities and limitations
  capabilities: {
    canDetectStructure: boolean;
    canAnalyzeComplexity: boolean;
    canRecommendFramework: boolean;
    hasSemanticUnderstanding: boolean;
  };
  
  limitations: string[];
  warnings: string[];
  
  // Execution characteristics - WHAT makes this prompt complex
  executionCharacteristics: {
    hasConditionals: boolean;
    hasLoops: boolean;
    hasChainSteps: boolean;
    argumentCount: number;
    templateComplexity: number;
    hasSystemMessage: boolean;
    hasUserTemplate: boolean;
    // Detectable patterns (structural analysis)
    hasStructuredReasoning: boolean;
    hasMethodologyKeywords: boolean;
    hasComplexAnalysis: boolean;
    // Advanced chain features
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
  
  // Execution complexity
  complexity: "low" | "medium" | "high";
  suggestedGates: string[];
  
  // Framework recommendation (honest about limitations)
  frameworkRecommendation: {
    shouldUseFramework: boolean;
    reasoning: string[];
    confidence: number;
    requiresUserChoice?: boolean; // When semantic analysis is unavailable
    availableFrameworks?: string[]; // When user choice is needed
  };
  
  // Analysis metadata
  analysisMetadata: {
    version: string;
    mode: AnalysisMode;
    analysisTime: number;
    analyzer: "content";
    cacheHit: boolean;
    fallbackUsed?: boolean;
    llmUsed?: boolean;
    hooksUsed?: boolean;
  };
}

/**
 * LLM client interface for semantic analysis
 */
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


/**
 * Configurable Semantic Analyzer Implementation
 * Provides honest, mode-aware analysis with clear limitations
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
    this.logger.info("Configurable semantic analyzer configuration updated");
  }

  /**
   * Check if LLM integration is enabled
   */
  isLLMEnabled(): boolean {
    return this.config.llmIntegration.enabled;
  }

  /**
   * Main analysis method - mode-aware with honest limitations
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
            cacheHit: true
          }
        };
      }
    }

    try {
      // Perform mode-specific analysis
      const analysis = await this.performModeSpecificAnalysis(prompt, startTime);
      
      // Cache the result
      if (CACHE_ANALYSIS) {
        this.cacheAnalysis(promptHash, analysis);
      }
      
      this.logger.debug(`Analysis completed for prompt: ${prompt.id || 'unknown'} (mode: ${this.config.mode})`);
      return analysis;
      
    } catch (error) {
      this.logger.error("Configurable semantic analysis failed:", error);
      return this.createFallbackAnalysis(prompt, startTime, error);
    }
  }

  /**
   * Clear analysis cache
   */
  clearCache(): void {
    this.analysisCache.clear();
    this.logger.info("Configurable semantic analysis cache cleared");
  }

  /**
   * Get analysis performance statistics
   */
  getPerformanceStats() {
    return {
      cacheSize: this.analysisCache.size,
      cacheEnabled: CACHE_ANALYSIS,
      mode: this.config.mode,
      llmIntegrationEnabled: this.config.llmIntegration.enabled
    };
  }

  // Private implementation methods

  /**
   * Perform analysis based on configured mode
   */
  private async performModeSpecificAnalysis(
    prompt: ConvertedPrompt, 
    startTime: number
  ): Promise<ContentAnalysisResult> {
    switch (this.config.mode) {
      case 'semantic':
        return await this.performSemanticAnalysis(prompt, startTime);
      case 'structural':
      default:
        return this.performStructuralAnalysis(prompt, startTime);
    }
  }

  /**
   * Perform semantic analysis using LLM integration
   */
  private async performSemanticAnalysis(
    prompt: ConvertedPrompt, 
    startTime: number
  ): Promise<ContentAnalysisResult> {
    // Try LLM integration
    if (this.isLLMEnabled() && this.llmClient) {
      try {
        return await this.performLLMAnalysis(prompt, startTime);
      } catch (error) {
        this.logger.warn("LLM analysis failed:", error);
      }
    }
    
    // Fallback to structural analysis with warning
    if (FALLBACK_TO_STRUCTURAL) {
      this.logger.info("Falling back to structural analysis - semantic analysis unavailable");
      const structuralAnalysis = this.performStructuralAnalysis(prompt, startTime);
      
      // Add fallback warning
      structuralAnalysis.warnings.push(
        "⚠️ Semantic analysis unavailable - using structural analysis only",
        "💡 Configure LLM integration or Claude hooks for intelligent analysis"
      );
      structuralAnalysis.analysisMetadata.fallbackUsed = true;
      
      return structuralAnalysis;
    }
    
    throw new Error("Semantic analysis mode enabled but no integration available");
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
      task: "Analyze this prompt for execution strategy and framework requirements",
      categories: ["prompt", "template", "chain"],
      methodologies: ["CAGEERF", "ReACT", "5W1H", "SCAMPER", "none"]
    });

    // Build structural characteristics as baseline
    const structuralCharacteristics = this.analyzeStructuralCharacteristics(prompt);
    
    return {
      executionType: llmResult.executionType as any,
      requiresExecution: true,
      requiresFramework: llmResult.recommendedFramework !== "none",
      confidence: llmResult.confidence,
      reasoning: llmResult.reasoning,
      
      capabilities: {
        canDetectStructure: true,
        canAnalyzeComplexity: true,
        canRecommendFramework: true,
        hasSemanticUnderstanding: true // TRUE - we have LLM access
      },
      
      limitations: [], // No major limitations in semantic mode
      warnings: [],
      
      executionCharacteristics: structuralCharacteristics,
      complexity: llmResult.complexity as any,
      suggestedGates: this.suggestExecutionGates(structuralCharacteristics, llmResult.complexity),
      
      frameworkRecommendation: {
        shouldUseFramework: llmResult.recommendedFramework !== "none",
        reasoning: [`LLM recommends ${llmResult.recommendedFramework || "no specific framework"}`],
        confidence: llmResult.confidence
      },
      
      analysisMetadata: {
        version: "3.0.0",
        mode: "semantic",
        analysisTime: performance.now() - startTime,
        analyzer: "content",
        cacheHit: false,
        llmUsed: true
      }
    };
  }


  /**
   * Perform honest structural analysis - NO FAKE SEMANTIC UNDERSTANDING
   */
  private performStructuralAnalysis(
    prompt: ConvertedPrompt, 
    startTime: number
  ): ContentAnalysisResult {
    const structuralCharacteristics = this.analyzeStructuralCharacteristics(prompt);
    const executionType = this.determineExecutionTypeFromStructure(structuralCharacteristics, prompt);
    const complexity = this.analyzeStructuralComplexity(structuralCharacteristics);
    
    const limitations = [
      "No semantic understanding of prompt content",
      "Cannot analyze methodology requirements intelligently",
      "Framework recommendation requires explicit user choice"
    ];

    const warnings = [];
    if (WARN_ON_LIMITATIONS) {
      warnings.push(
        "⚠️ Using structural analysis only",
        "💡 Enable semantic analysis for intelligent framework recommendations",
        "📖 Configure LLM integration or Claude hooks for full capabilities"
      );
    }

    return {
      executionType,
      requiresExecution: true,
      requiresFramework: this.shouldUseFrameworkStructurally(executionType, structuralCharacteristics),
      confidence: 0.9, // High confidence in structural facts
      reasoning: [
        "Analysis based on template structure only",
        `Detected ${executionType} execution type from structural patterns`,
        "Framework selection requires explicit user choice or semantic analysis"
      ],
      
      capabilities: {
        canDetectStructure: true,
        canAnalyzeComplexity: true,
        canRecommendFramework: false, // HONEST - we can't recommend without understanding
        hasSemanticUnderstanding: false // HONEST - no semantic understanding
      },
      
      limitations,
      warnings,
      
      executionCharacteristics: structuralCharacteristics,
      complexity,
      suggestedGates: this.suggestExecutionGates(structuralCharacteristics, complexity),
      
      frameworkRecommendation: {
        shouldUseFramework: this.shouldUseFrameworkStructurally(executionType, structuralCharacteristics),
        reasoning: [
          "Framework recommendation unavailable in structural mode",
          "User should specify preferred framework explicitly"
        ],
        confidence: 0.5, // Low confidence - we don't really know
        requiresUserChoice: true,
        availableFrameworks: ["CAGEERF", "ReACT", "5W1H", "SCAMPER"]
      },
      
      analysisMetadata: {
        version: "3.0.0",
        mode: "structural",
        analysisTime: performance.now() - startTime,
        analyzer: "content",
        cacheHit: false
      }
    };
  }

  /**
   * Analyze structural characteristics that can be definitively detected
   */
  private analyzeStructuralCharacteristics(prompt: ConvertedPrompt): any {
    const userTemplate = prompt.userMessageTemplate || "";
    const systemMessage = prompt.systemMessage || "";
    const combinedText = `${systemMessage} ${userTemplate}`.toLowerCase();
    
    const characteristics = {
      hasConditionals: /\{%.*if.*%\}|\{\{.*if.*\}\}/i.test(userTemplate),
      hasLoops: /\{%.*for.*%\}|\{\{.*each.*\}\}/i.test(userTemplate),
      hasChainSteps: Boolean(prompt.chainSteps?.length) || /step.*\d+|phase.*\d+|then.*do|next.*action/i.test(combinedText),
      argumentCount: prompt.arguments?.length || 0,
      templateComplexity: this.calculateTemplateComplexity(userTemplate),
      hasSystemMessage: Boolean(systemMessage.trim()),
      hasUserTemplate: Boolean(userTemplate.trim()),
      
      // Pattern matching (can be done structurally)
      hasStructuredReasoning: this.detectStructuralReasoningPatterns(combinedText),
      hasMethodologyKeywords: this.detectMethodologyKeywords(combinedText),
      hasComplexAnalysis: this.detectStructuralComplexityPatterns(combinedText, prompt),
      advancedChainFeatures: undefined as any
    };

    // Detect advanced chain features if present
    if (characteristics.hasChainSteps) {
      characteristics.advancedChainFeatures = this.detectAdvancedChainFeatures(prompt);
    }

    return characteristics;
  }

  /**
   * Detect structural reasoning patterns (not semantic understanding)
   */
  private detectStructuralReasoningPatterns(text: string): boolean {
    const reasoningPatterns = [
      /analyz/i, /evaluat/i, /assess/i, /compar/i, /review/i,
      /break down/i, /step.*by.*step/i, /systematic/i, /methodical/i,
      /context/i, /goals/i, /execution/i, /refin/i, /framework/i,
      /approach/i, /strategy/i, /process/i, /methodology/i
    ];
    
    return reasoningPatterns.some(pattern => pattern.test(text));
  }

  /**
   * Detect methodology-specific keywords
   */
  private detectMethodologyKeywords(text: string): boolean {
    const methodologyKeywords = [
      // CAGEERF keywords
      /context/i, /analysis/i, /goals/i, /execution/i, /evaluation/i, /refinement/i,
      // ReACT keywords  
      /reasoning/i, /acting/i, /observation/i, /thought/i, /action/i,
      // 5W1H keywords
      /who/i, /what/i, /when/i, /where/i, /why/i, /how/i,
      // SCAMPER keywords
      /substitute/i, /combine/i, /adapt/i, /modify/i, /eliminate/i, /reverse/i,
      // General methodology indicators
      /framework/i, /approach/i, /methodology/i, /systematic/i, /structured/i
    ];
    
    const matchCount = methodologyKeywords.filter(pattern => pattern.test(text)).length;
    return matchCount >= 2;
  }

  /**
   * Detect structural complexity patterns
   */
  private detectStructuralComplexityPatterns(text: string, prompt: ConvertedPrompt): boolean {
    const complexityIndicators = [
      text.length > 200,
      prompt.arguments && prompt.arguments.length > 3,
      /deep.*analys/i.test(text), /comprehensive/i.test(text),
      /detailed/i.test(text), /thorough/i.test(text),
      /multi.*step/i.test(text), /phase/i.test(text),
      /criteria/i.test(text), /requirements/i.test(text)
    ];
    
    return complexityIndicators.filter(Boolean).length >= 2;
  }

  /**
   * Determine execution type from structural analysis only
   */
  private determineExecutionTypeFromStructure(
    characteristics: any, 
    prompt: ConvertedPrompt
  ): "prompt" | "template" | "chain" {
    
    // CHAIN: Sequential execution indicators
    if (characteristics.hasChainSteps || prompt.chainSteps?.length) {
      return "chain";
    }
    
    // CHAIN: Complex orchestration with conditionals AND loops (formerly workflow)
    if (characteristics.hasConditionals && characteristics.hasLoops) {
      return "chain";
    }
    
    // CHAIN: Very complex templates (formerly workflow)
    if (characteristics.argumentCount > 5 && characteristics.templateComplexity > 0.7) {
      return "chain";
    }
    
    // TEMPLATE: Has template syntax or structural complexity
    if (characteristics.templateComplexity > 0.3 || 
        characteristics.argumentCount > 2 || 
        characteristics.hasConditionals || 
        characteristics.hasLoops) {
      return "template";
    }
    
    // PROMPT: Simple variable substitution
    return "prompt";
  }

  /**
   * Determine if framework should be used based on structural analysis
   */
  private shouldUseFrameworkStructurally(
    executionType: string,
    characteristics: any
  ): boolean {
    // In structural mode, we're conservative
    // Only recommend framework for clearly complex cases
    return executionType === "template" || 
           executionType === "chain" ||
           characteristics.hasMethodologyKeywords;
  }

  // Helper methods from original SemanticAnalyzer

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

  private analyzeStructuralComplexity(characteristics: any): "low" | "medium" | "high" {
    let complexity = 0;
    
    complexity += characteristics.templateComplexity * 0.3;
    complexity += (characteristics.argumentCount / 10) * 0.2;
    
    if (characteristics.hasConditionals) complexity += 0.2;
    if (characteristics.hasLoops) complexity += 0.2;
    if (characteristics.hasChainSteps) complexity += 0.3;
    
    if (characteristics.advancedChainFeatures) {
      const chainFeatures = characteristics.advancedChainFeatures;
      if (chainFeatures.hasDependencies) complexity += 0.4;
      if (chainFeatures.hasParallelSteps) complexity += 0.3;
      if (chainFeatures.requiresAdvancedExecution) complexity += 0.3;
      complexity += chainFeatures.complexityScore * 0.3;
    }
    
    if (complexity < 0.3) return "low";
    if (complexity < 0.7) return "medium";
    return "high";
  }

  private detectAdvancedChainFeatures(prompt: ConvertedPrompt) {
    const chainSteps = prompt.chainSteps || [];
    
    let hasDependencies = false;
    let hasParallelSteps = false;
    let hasAdvancedStepTypes = false;
    let hasAdvancedErrorHandling = false;
    let hasStepConfigurations = false;
    let hasCustomTimeouts = false;
    let complexityScore = 0;
    
    for (const step of chainSteps) {
      if ((step as any).dependencies?.length > 0) {
        hasDependencies = true;
        complexityScore += 0.3;
      }
      if ((step as any).parallelGroup) {
        hasParallelSteps = true;
        complexityScore += 0.2;
      }
      if ((step as any).stepType && (step as any).stepType !== 'prompt') {
        hasAdvancedStepTypes = true;
        complexityScore += 0.2;
      }
      if ((step as any).onError || (step as any).retries) {
        hasAdvancedErrorHandling = true;
        complexityScore += 0.15;
      }
      if ((step as any).config) {
        hasStepConfigurations = true;
        complexityScore += 0.1;
      }
      if ((step as any).timeout) {
        hasCustomTimeouts = true;
        complexityScore += 0.05;
      }
    }
    
    const requiresAdvancedExecution = hasDependencies || hasParallelSteps || hasAdvancedStepTypes || hasAdvancedErrorHandling;
    
    return {
      hasDependencies,
      hasParallelSteps,
      hasAdvancedStepTypes,
      hasAdvancedErrorHandling,
      hasStepConfigurations,
      hasCustomTimeouts,
      requiresAdvancedExecution,
      complexityScore: Math.min(complexityScore, 1.0)
    };
  }

  private suggestExecutionGates(characteristics: any, complexity: string): string[] {
    const gates: string[] = ["execution_validation"];
    
    if (complexity === "high") {
      gates.push("complexity_validation", "performance_validation");
    }
    
    if (characteristics.hasConditionals) gates.push("conditional_logic_validation");
    if (characteristics.hasLoops) gates.push("iteration_validation");
    if (characteristics.hasChainSteps) gates.push("chain_validation");
    if (characteristics.argumentCount > 5) gates.push("argument_validation");
    
    return gates;
  }


  // Cache and utility methods

  private generatePromptHash(prompt: ConvertedPrompt): string {
    return [
      prompt.id,
      prompt.userMessageTemplate?.length || 0,
      prompt.systemMessage?.length || 0,
      prompt.arguments?.length || 0,
      this.config.mode
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
      timestamp: Date.now()
    });
  }

  private createFallbackAnalysis(
    prompt: ConvertedPrompt, 
    startTime: number, 
    error: any
  ): ContentAnalysisResult {
    return {
      executionType: "prompt",
      requiresExecution: true,
      requiresFramework: false,
      confidence: 0.3,
      reasoning: ["Fallback analysis due to processing error"],
      
      capabilities: {
        canDetectStructure: false,
        canAnalyzeComplexity: false,
        canRecommendFramework: false,
        hasSemanticUnderstanding: false
      },
      
      limitations: [
        "Analysis failed - using minimal fallback",
        "No reliable analysis available"
      ],
      warnings: [
        "⚠️ Analysis error occurred",
        "🚨 Using minimal fallback analysis"
      ],
      
      executionCharacteristics: {
        hasConditionals: false,
        hasLoops: false,
        hasChainSteps: false,
        argumentCount: prompt.arguments?.length || 0,
        templateComplexity: 0,
        hasSystemMessage: Boolean(prompt.systemMessage),
        hasUserTemplate: Boolean(prompt.userMessageTemplate),
        hasStructuredReasoning: false,
        hasMethodologyKeywords: false,
        hasComplexAnalysis: false,
        advancedChainFeatures: undefined
      },
      
      complexity: "low",
      suggestedGates: ["basic_validation"],
      
      frameworkRecommendation: {
        shouldUseFramework: false,
        reasoning: ["Fallback analysis - framework processing disabled"],
        confidence: 0.1
      },
      
      analysisMetadata: {
        version: "3.0.0",
        mode: this.config.mode || "structural",
        analysisTime: performance.now() - startTime,
        analyzer: "content",
        cacheHit: false,
        fallbackUsed: true
      }
    };
  }
}

/**
 * Create content analyzer
 */
export function createContentAnalyzer(
  logger: Logger,
  config: SemanticAnalysisConfig
): ContentAnalyzer {
  return new ContentAnalyzer(logger, config);
}