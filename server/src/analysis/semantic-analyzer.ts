/**
 * Unified Semantic Analyzer
 * FOCUSED ROLE: Three-Tier Execution Strategy Analysis
 * 
 * Core Responsibilities:
 * - Determine execution type (prompt/template/chain/workflow)
 * - Distinguish between basic prompts (variable substitution) and framework-aware templates
 * - Analyze prompt structure and complexity
 * - Predict execution requirements and framework applicability
 * - Suggest appropriate validation gates
 * 
 * Three-Tier Model (Phase 2 - Simplified):
 * - PROMPT: Basic variable substitution, no framework processing
 * - TEMPLATE: Framework-aware execution with methodology guidance, complex conditionals/loops
 * - CHAIN: Sequential execution using prompts and/or templates
 * 
 * NOT Responsible for:
 * - Framework methodology selection (CAGEERF/ReACT/etc.)
 * - System prompt generation
 * - Framework switching logic
 */

import { ConvertedPrompt } from "../types/index.js";
import { Logger } from "../logging/index.js";

/**
 * Semantic analysis result - THREE-TIER execution strategy model
 * Phase 2: Simplified to prompt/template/chain only
 */
export interface SemanticAnalysis {
  // Core execution strategy - HOW to execute this prompt (3-tier model)
  executionType: "prompt" | "template" | "chain";
  requiresExecution: boolean;
  requiresFramework: boolean; // NEW: Whether framework processing is needed
  confidence: number;
  reasoning: string[];
  
  // Execution characteristics - WHAT makes this prompt complex
  executionCharacteristics: {
    hasConditionals: boolean;
    hasLoops: boolean;
    hasChainSteps: boolean;
    argumentCount: number;
    templateComplexity: number;
    hasSystemMessage: boolean;
    hasUserTemplate: boolean;
    // NEW: Framework applicability indicators
    hasStructuredReasoning: boolean;
    hasMethodologyKeywords: boolean;
    hasComplexAnalysis: boolean;
    // NEW: Advanced chain features
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
  
  // Execution complexity - HOW complex is the execution
  complexity: "low" | "medium" | "high";
  suggestedGates: string[];
  
  // NEW: Framework recommendation
  frameworkRecommendation: {
    shouldUseFramework: boolean;
    reasoning: string[];
    confidence: number;
  };
  
  // Analysis metadata
  analysisMetadata: {
    version: string;
    analysisTime: number;
    analyzer: "semantic";
    cacheHit: boolean;
  };
}

/**
 * Semantic analyzer configuration
 */
export interface SemanticAnalyzerConfig {
  enableCaching: boolean;
  cacheExpiryMs: number;
  performanceThresholds: {
    templateComplexity: number;
    argumentCount: number;
    contentLength: number;
  };
}

/**
 * Unified Semantic Analyzer Implementation
 * Consolidates all execution strategy analysis into one focused component
 */
export class SemanticAnalyzer {
  private logger: Logger;
  private config: SemanticAnalyzerConfig;
  private analysisCache = new Map<string, { analysis: SemanticAnalysis; timestamp: number }>();

  constructor(logger: Logger, config: Partial<SemanticAnalyzerConfig> = {}) {
    this.logger = logger;
    this.config = {
      enableCaching: config.enableCaching ?? true,
      cacheExpiryMs: config.cacheExpiryMs ?? 300000, // 5 minutes
      performanceThresholds: {
        templateComplexity: 0.5,
        argumentCount: 5,
        contentLength: 1000,
        ...config.performanceThresholds
      }
    };
  }

  /**
   * Main semantic analysis method - EXECUTION STRATEGY ANALYSIS
   * Analyzes prompt to determine optimal execution approach
   */
  async analyzePrompt(prompt: ConvertedPrompt): Promise<SemanticAnalysis> {
    const startTime = performance.now();
    const promptHash = this.generatePromptHash(prompt);

    // Check cache first
    if (this.config.enableCaching) {
      const cached = this.getCachedAnalysis(promptHash);
      if (cached) {
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
      // Perform comprehensive execution strategy analysis
      const analysis = this.performSemanticAnalysis(prompt, startTime);
      
      // Cache the result
      if (this.config.enableCaching) {
        this.cacheAnalysis(promptHash, analysis);
      }
      
      this.logger.debug(`Semantic analysis completed for prompt: ${prompt.id || 'unknown'}`);
      return analysis;
      
    } catch (error) {
      this.logger.error("Semantic analysis failed:", error);
      return this.createFallbackAnalysis(prompt, startTime);
    }
  }

  /**
   * Get analysis performance statistics
   */
  getPerformanceStats() {
    return {
      cacheSize: this.analysisCache.size,
      cacheEnabled: this.config.enableCaching
    };
  }

  /**
   * Clear analysis cache
   */
  clearCache(): void {
    this.analysisCache.clear();
    this.logger.info("Semantic analysis cache cleared");
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<SemanticAnalyzerConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.info("Semantic analyzer configuration updated");
  }

  // Private implementation methods

  /**
   * Core semantic analysis implementation - Enhanced for three-tier model and advanced chains
   */
  private performSemanticAnalysis(prompt: ConvertedPrompt, startTime: number): SemanticAnalysis {
    // Analyze execution characteristics
    const executionCharacteristics: any = this.analyzeExecutionCharacteristics(prompt);
    
    // NEW: Detect advanced chain features if this is a chain
    if (executionCharacteristics.hasChainSteps) {
      executionCharacteristics.advancedChainFeatures = this.detectAdvancedChainFeatures(prompt);
    }
    
    // Determine execution type based on characteristics (including advanced chain features)
    const executionType = this.determineExecutionType(executionCharacteristics, prompt);
    
    // Analyze execution complexity (enhanced with advanced chain complexity)
    const complexity = this.analyzeExecutionComplexity(executionCharacteristics, prompt);
    
    // Suggest appropriate gates based on execution requirements (enhanced for advanced chains)
    const suggestedGates = this.suggestExecutionGates(executionCharacteristics, complexity);
    
    // Calculate confidence in execution strategy (enhanced with advanced chain confidence)
    const confidence = this.calculateExecutionConfidence(executionCharacteristics);
    
    // Generate reasoning for execution strategy (enhanced with advanced chain reasoning)
    const reasoning = this.generateExecutionReasoning(executionCharacteristics, executionType, complexity);
    
    // NEW: Determine framework applicability
    const frameworkRecommendation = this.generateFrameworkRecommendation(executionCharacteristics, executionType);
    
    const analysisTime = performance.now() - startTime;
    
    return {
      executionType,
      requiresExecution: this.requiresExecution(executionType, executionCharacteristics),
      requiresFramework: frameworkRecommendation.shouldUseFramework, // NEW
      confidence,
      reasoning,
      executionCharacteristics,
      complexity,
      suggestedGates,
      frameworkRecommendation, // NEW
      analysisMetadata: {
        version: "2.0.0", // Updated version for three-tier model
        analysisTime,
        analyzer: "semantic",
        cacheHit: false
      }
    };
  }

  /**
   * Analyze execution characteristics of the prompt - Enhanced for three-tier model
   */
  private analyzeExecutionCharacteristics(prompt: ConvertedPrompt) {
    const userTemplate = prompt.userMessageTemplate || "";
    const systemMessage = prompt.systemMessage || "";
    const combinedText = `${systemMessage} ${userTemplate}`.toLowerCase();
    
    return {
      hasConditionals: /\{%.*if.*%\}|\{\{.*if.*\}\}/i.test(userTemplate),
      hasLoops: /\{%.*for.*%\}|\{\{.*each.*\}\}/i.test(userTemplate),
      hasChainSteps: /step.*\d+|phase.*\d+|then.*do|next.*action/i.test(combinedText) || Boolean(prompt.chainSteps?.length),
      argumentCount: prompt.arguments?.length || 0,
      templateComplexity: this.calculateTemplateComplexity(userTemplate),
      hasSystemMessage: Boolean(systemMessage.trim()),
      hasUserTemplate: Boolean(userTemplate.trim()),
      
      // NEW: Framework applicability indicators
      hasStructuredReasoning: this.detectStructuredReasoning(combinedText),
      hasMethodologyKeywords: this.detectMethodologyKeywords(combinedText),
      hasComplexAnalysis: this.detectComplexAnalysis(combinedText, prompt)
    };
  }

  /**
   * Detect if prompt requires structured reasoning (framework-appropriate)
   */
  private detectStructuredReasoning(text: string): boolean {
    const reasoningPatterns = [
      /analyz/i, /evaluat/i, /assess/i, /compar/i, /review/i,
      /break down/i, /step.*by.*step/i, /systematic/i, /methodical/i,
      /context/i, /goals/i, /execution/i, /refin/i, /framework/i,
      /approach/i, /strategy/i, /process/i, /methodology/i
    ];
    
    return reasoningPatterns.some(pattern => pattern.test(text));
  }

  /**
   * Detect methodology-specific keywords that suggest framework usage
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
    return matchCount >= 2; // Require at least 2 methodology indicators
  }

  /**
   * Detect complex analysis requirements suggesting template over basic prompt
   */
  private detectComplexAnalysis(text: string, prompt: ConvertedPrompt): boolean {
    const complexityIndicators = [
      text.length > 200, // Long text suggests complexity
      prompt.arguments && prompt.arguments.length > 3, // Many arguments
      /deep.*analys/i.test(text), /comprehensive/i.test(text),
      /detailed/i.test(text), /thorough/i.test(text),
      /multi.*step/i.test(text), /phase/i.test(text),
      /criteria/i.test(text), /requirements/i.test(text)
    ];
    
    return complexityIndicators.filter(Boolean).length >= 2;
  }

  /**
   * Detect advanced chain features that require enhanced execution capabilities
   * NEW: Enhanced chain detection for Phase 1 implementation
   */
  private detectAdvancedChainFeatures(prompt: ConvertedPrompt): {
    hasDependencies: boolean;
    hasParallelSteps: boolean;
    hasAdvancedStepTypes: boolean;
    hasAdvancedErrorHandling: boolean;
    hasStepConfigurations: boolean;
    hasCustomTimeouts: boolean;
    requiresAdvancedExecution: boolean;
    complexityScore: number;
  } {
    const chainSteps = prompt.chainSteps || [];
    
    let hasDependencies = false;
    let hasParallelSteps = false;
    let hasAdvancedStepTypes = false;
    let hasAdvancedErrorHandling = false;
    let hasStepConfigurations = false;
    let hasCustomTimeouts = false;
    let complexityScore = 0;
    
    for (const step of chainSteps) {
      // Check for dependencies
      if (step.dependencies && step.dependencies.length > 0) {
        hasDependencies = true;
        complexityScore += 0.3;
      }
      
      // Check for parallel groups
      if (step.parallelGroup) {
        hasParallelSteps = true;
        complexityScore += 0.2;
      }
      
      // Check for advanced step types
      if (step.stepType && step.stepType !== 'prompt') {
        hasAdvancedStepTypes = true;
        complexityScore += 0.2;
      }
      
      // Check for advanced error handling
      if (step.onError || step.retries) {
        hasAdvancedErrorHandling = true;
        complexityScore += 0.15;
      }
      
      // Check for step configurations
      if (step.config) {
        hasStepConfigurations = true;
        complexityScore += 0.1;
      }
      
      // Check for custom timeouts
      if (step.timeout) {
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

  /**
   * Determine execution type based on characteristics - THREE-TIER MODEL ONLY
   * Phase 2: Removed workflow detection, enhanced template classification
   */
  private determineExecutionType(
    characteristics: any, 
    prompt: ConvertedPrompt
  ): "prompt" | "template" | "chain" {
    
    // CHAIN: Sequential execution indicators
    if (characteristics.hasChainSteps || prompt.isChain) {
      return "chain";
    }
    
    // TEMPLATE: Complex template processing (includes former workflow logic)
    // Now handles complex conditionals, loops, and advanced template features
    if (characteristics.hasConditionals && characteristics.hasLoops) {
      return "template"; // Formerly classified as workflow
    }
    
    if (characteristics.argumentCount > this.config.performanceThresholds.argumentCount && 
        characteristics.templateComplexity > this.config.performanceThresholds.templateComplexity) {
      return "template"; // Formerly classified as workflow
    }
    
    // TEMPLATE vs PROMPT distinction - KEY LOGIC
    const frameworkIndicators = [
      characteristics.hasStructuredReasoning,
      characteristics.hasMethodologyKeywords, 
      characteristics.hasComplexAnalysis,
      characteristics.hasSystemMessage && characteristics.templateComplexity > 0.4
    ].filter(Boolean).length;
    
    // TEMPLATE: Framework-aware execution needed
    if (frameworkIndicators >= 2) {
      return "template";
    }
    
    // Complex content but no framework indicators -> still template (but lower framework confidence)
    if (characteristics.templateComplexity > 0.6 || characteristics.argumentCount > 4) {
      return "template"; 
    }
    
    // PROMPT: Basic variable substitution (simple, fast execution)
    return "prompt";
  }

  /**
   * Analyze execution complexity - Enhanced with advanced chain features
   */
  private analyzeExecutionComplexity(characteristics: any, prompt: ConvertedPrompt): "low" | "medium" | "high" {
    let complexity = 0;
    
    // Template complexity factors
    complexity += characteristics.templateComplexity * 0.3;
    complexity += (characteristics.argumentCount / 10) * 0.2;
    
    // Execution complexity factors
    if (characteristics.hasConditionals) complexity += 0.2;
    if (characteristics.hasLoops) complexity += 0.2;
    if (characteristics.hasChainSteps) complexity += 0.3;
    
    // NEW: Advanced chain complexity factors
    if (characteristics.advancedChainFeatures) {
      const chainFeatures = characteristics.advancedChainFeatures;
      
      // Dependencies add significant complexity
      if (chainFeatures.hasDependencies) complexity += 0.4;
      
      // Parallel execution adds coordination complexity
      if (chainFeatures.hasParallelSteps) complexity += 0.3;
      
      // Advanced step types add execution complexity
      if (chainFeatures.hasAdvancedStepTypes) complexity += 0.2;
      
      // Advanced error handling adds logic complexity
      if (chainFeatures.hasAdvancedErrorHandling) complexity += 0.15;
      
      // Step configurations add setup complexity
      if (chainFeatures.hasStepConfigurations) complexity += 0.1;
      
      // Custom timeouts add timing complexity
      if (chainFeatures.hasCustomTimeouts) complexity += 0.05;
      
      // Use the calculated complexity score from chain features
      complexity += chainFeatures.complexityScore * 0.5;
    }
    
    // Content complexity factors
    const contentLength = (prompt.userMessageTemplate || "").length;
    complexity += Math.min(contentLength / this.config.performanceThresholds.contentLength, 0.3);
    
    // Enhanced thresholds accounting for advanced features
    if (complexity < 0.3) return "low";      // Simple chains and prompts
    if (complexity < 0.8) return "medium";   // Standard chains with some advanced features
    return "high";                           // Complex chains with multiple advanced features
  }

  /**
   * Suggest validation gates for execution - Enhanced with advanced chain gates
   */
  private suggestExecutionGates(characteristics: any, complexity: string): string[] {
    const gates: string[] = [];
    
    // Always suggest execution validation
    gates.push("execution_validation");
    
    // Complexity-based gates
    if (complexity === "high") {
      gates.push("complexity_validation", "performance_validation");
    }
    
    // Execution-specific gates
    if (characteristics.hasConditionals) {
      gates.push("conditional_logic_validation");
    }
    
    if (characteristics.hasLoops) {
      gates.push("iteration_validation");
    }
    
    if (characteristics.hasChainSteps) {
      gates.push("chain_validation");
    }
    
    if (characteristics.argumentCount > 5) {
      gates.push("argument_validation");
    }
    
    // NEW: Advanced chain-specific gates
    if (characteristics.advancedChainFeatures) {
      const chainFeatures = characteristics.advancedChainFeatures;
      
      // Dependency-specific gates
      if (chainFeatures.hasDependencies) {
        gates.push("dependency_validation", "topological_sort_validation");
      }
      
      // Parallel execution gates
      if (chainFeatures.hasParallelSteps) {
        gates.push("parallel_execution_validation", "concurrency_validation");
      }
      
      // Advanced step type gates
      if (chainFeatures.hasAdvancedStepTypes) {
        gates.push("step_type_validation", "step_configuration_validation");
      }
      
      // Error handling gates
      if (chainFeatures.hasAdvancedErrorHandling) {
        gates.push("error_handling_validation", "retry_policy_validation");
      }
      
      // Configuration gates
      if (chainFeatures.hasStepConfigurations) {
        gates.push("step_config_validation", "parameter_validation");
      }
      
      // Timeout gates
      if (chainFeatures.hasCustomTimeouts) {
        gates.push("timeout_validation", "timing_validation");
      }
      
      // Advanced gate validation for high complexity chains
      if (chainFeatures.requiresAdvancedExecution) {
        gates.push("advanced_chain_validation", "workflow_compatibility_validation");
      }
    }
    
    return gates;
  }

  /**
   * Generate framework recommendation based on analysis
   */
  private generateFrameworkRecommendation(
    characteristics: any, 
    executionType: string
  ): { shouldUseFramework: boolean; reasoning: string[]; confidence: number } {
    const reasoning: string[] = [];
    let shouldUseFramework = false;
    let confidence = 0.5;

    // Templates should use framework by default
    if (executionType === "template") {
      shouldUseFramework = true;
      confidence = 0.8;
      reasoning.push("Template execution type indicates framework processing needed");
      
      if (characteristics.hasStructuredReasoning) {
        confidence += 0.1;
        reasoning.push("Structured reasoning patterns detected");
      }
      
      if (characteristics.hasMethodologyKeywords) {
        confidence += 0.1;
        reasoning.push("Methodology keywords suggest framework guidance beneficial");
      }
      
      if (characteristics.hasComplexAnalysis) {
        confidence += 0.05;
        reasoning.push("Complex analysis requirements identified");
      }
    }
    
    // Chains and workflows may benefit from framework guidance
    else if (executionType === "chain" || executionType === "workflow") {
      shouldUseFramework = true;
      confidence = 0.6;
      reasoning.push(`${executionType} execution can benefit from framework coordination`);
    }
    
    // Basic prompts don't need framework processing
    else if (executionType === "prompt") {
      shouldUseFramework = false;
      confidence = 0.9;
      reasoning.push("Basic prompt execution - framework processing not needed");
      reasoning.push("Simple variable substitution is sufficient");
    }

    return {
      shouldUseFramework,
      reasoning,
      confidence: Math.max(0.1, Math.min(1, confidence))
    };
  }

  // Helper methods

  private calculateTemplateComplexity(template: string): number {
    if (!template) return 0;
    
    let complexity = 0;
    
    // Template syntax complexity
    const templateVars = (template.match(/\{\{.*?\}\}/g) || []).length;
    const nunjucksBlocks = (template.match(/\{%.*?%\}/g) || []).length;
    
    complexity += Math.min(templateVars / 10, 0.3);
    complexity += Math.min(nunjucksBlocks / 5, 0.4);
    
    // Content complexity
    complexity += Math.min(template.length / 1000, 0.3);
    
    return Math.min(complexity, 1);
  }

  private requiresExecution(executionType: string, characteristics: any): boolean {
    // All types require execution now - "prompt" is fastest, "template" has framework processing
    return true;
  }

  private calculateExecutionConfidence(characteristics: any): number {
    let confidence = 0.7; // Base confidence
    
    // Execution characteristics confidence factors
    if (characteristics.hasUserTemplate) confidence += 0.1;
    if (characteristics.argumentCount > 0) confidence += 0.05;
    if (characteristics.hasSystemMessage) confidence += 0.05;
    
    // Template complexity confidence
    if (characteristics.templateComplexity > 0) confidence += 0.1;
    
    return Math.max(0.1, Math.min(1, confidence));
  }

  private generateExecutionReasoning(
    characteristics: any, 
    executionType: string, 
    complexity: string
  ): string[] {
    const reasoning: string[] = [];
    
    reasoning.push(`Execution strategy determined as ${executionType} based on prompt analysis`);
    reasoning.push(`Execution complexity assessed as ${complexity}`);
    
    if (characteristics.hasConditionals) {
      reasoning.push("Contains conditional logic requiring template processing");
    }
    
    if (characteristics.hasLoops) {
      reasoning.push("Contains loops requiring template-based iterative processing");
    }
    
    if (characteristics.hasChainSteps) {
      reasoning.push("Contains chain steps requiring sequential execution");
    }
    
    if (characteristics.argumentCount > 5) {
      reasoning.push("High argument count suggests complex template processing");
    }
    
    // NEW: Advanced chain reasoning
    if (characteristics.advancedChainFeatures) {
      const chainFeatures = characteristics.advancedChainFeatures;
      
      if (chainFeatures.requiresAdvancedExecution) {
        reasoning.push("Advanced chain features detected - requires enhanced execution capabilities");
      }
      
      if (chainFeatures.hasDependencies) {
        reasoning.push("Chain contains step dependencies - requires topological sorting and dependency resolution");
      }
      
      if (chainFeatures.hasParallelSteps) {
        reasoning.push("Chain contains parallel step groups - requires coordination and parallel execution support");
      }
      
      if (chainFeatures.hasAdvancedStepTypes) {
        reasoning.push("Chain contains non-prompt steps (tool/gate/condition) - requires multi-modal step execution");
      }
      
      if (chainFeatures.hasAdvancedErrorHandling) {
        reasoning.push("Chain has advanced error handling - requires retry mechanisms and sophisticated error recovery");
      }
      
      if (chainFeatures.hasStepConfigurations) {
        reasoning.push("Chain steps have advanced configurations - requires enhanced parameter handling");
      }
      
      if (chainFeatures.complexityScore > 0.5) {
        reasoning.push(`High chain complexity score (${(chainFeatures.complexityScore * 100).toFixed(1)}%) indicates advanced orchestration requirements`);
      }
    }
    
    return reasoning;
  }

  // Cache management methods

  private generatePromptHash(prompt: ConvertedPrompt): string {
    return [
      prompt.id,
      prompt.userMessageTemplate?.length || 0,
      prompt.systemMessage?.length || 0,
      prompt.arguments?.length || 0
    ].join('-');
  }

  private getCachedAnalysis(promptHash: string) {
    const entry = this.analysisCache.get(promptHash);
    if (!entry) return null;
    
    // Check if cache entry is expired
    if (Date.now() - entry.timestamp > this.config.cacheExpiryMs) {
      this.analysisCache.delete(promptHash);
      return null;
    }
    
    return entry;
  }

  private cacheAnalysis(promptHash: string, analysis: SemanticAnalysis): void {
    this.analysisCache.set(promptHash, {
      analysis,
      timestamp: Date.now()
    });
  }

  private createFallbackAnalysis(prompt: ConvertedPrompt, startTime: number): SemanticAnalysis {
    return {
      executionType: "prompt", // Default to basic prompt for fallback
      requiresExecution: true,
      requiresFramework: false, // NEW: No framework for fallback
      confidence: 0.3,
      reasoning: ["Fallback analysis due to processing error"],
      executionCharacteristics: {
        hasConditionals: false,
        hasLoops: false,
        hasChainSteps: false,
        argumentCount: prompt.arguments?.length || 0,
        templateComplexity: 0,
        hasSystemMessage: Boolean(prompt.systemMessage),
        hasUserTemplate: Boolean(prompt.userMessageTemplate),
        // NEW: Framework applicability defaults
        hasStructuredReasoning: false,
        hasMethodologyKeywords: false,
        hasComplexAnalysis: false,
        // NEW: Advanced chain features defaults (not present in fallback)
        advancedChainFeatures: undefined
      },
      complexity: "low",
      suggestedGates: ["execution_validation"],
      // NEW: Framework recommendation
      frameworkRecommendation: {
        shouldUseFramework: false,
        reasoning: ["Fallback analysis - framework processing disabled"],
        confidence: 0.9
      },
      analysisMetadata: {
        version: "2.0.0", // Updated version
        analysisTime: Date.now() - startTime,
        analyzer: "semantic",
        cacheHit: false
      }
    };
  }
}

/**
 * Create unified semantic analyzer
 */
export function createSemanticAnalyzer(
  logger: Logger, 
  config?: Partial<SemanticAnalyzerConfig>
): SemanticAnalyzer {
  return new SemanticAnalyzer(logger, config);
}