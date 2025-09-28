/**
 * Semantic analysis and classification engine
 */

import { Logger } from "../../../logging/index.js";
import { ContentAnalyzer, ContentAnalysisResult } from "../../../semantic/configurable-semantic-analyzer.js";
import { ConvertedPrompt } from "../../../types/index.js";
import {
  PromptClassification,
  AnalysisResult,
  PromptManagerDependencies
} from "../core/types.js";

/**
 * Prompt analysis engine for semantic classification and intelligence feedback
 */
export class PromptAnalyzer {
  private logger: Logger;
  private semanticAnalyzer: ContentAnalyzer;

  constructor(dependencies: Pick<PromptManagerDependencies, 'logger' | 'semanticAnalyzer'>) {
    this.logger = dependencies.logger;
    this.semanticAnalyzer = dependencies.semanticAnalyzer;
  }

  /**
   * Analyze prompt for intelligence feedback (compact format)
   */
  async analyzePromptIntelligence(promptData: any): Promise<AnalysisResult> {
    // Create temporary ConvertedPrompt for analysis
    const tempPrompt: ConvertedPrompt = {
      id: promptData.id,
      name: promptData.name,
      description: promptData.description,
      category: promptData.category,
      systemMessage: promptData.systemMessage,
      userMessageTemplate: promptData.userMessageTemplate,
      arguments: promptData.arguments || [],
      chainSteps: promptData.chainSteps || []
    };

    const classification = await this.analyzePrompt(tempPrompt);

    // Build analysis-aware feedback showing current capabilities
    const analysisIcon = this.getAnalysisIcon(classification.analysisMode || classification.framework);
    let feedback = `${analysisIcon} ${classification.executionType}`;

    // Add gates info if present
    if (classification.suggestedGates.length > 0) {
      feedback += ` • gates: ${classification.suggestedGates.slice(0, 2).join(', ')}`;
    }
    feedback += '\n';

    // Analysis status line (show what analysis is actually doing)
    if (classification.analysisMode === 'disabled' || classification.framework === 'disabled') {
      feedback += `⚠️ Semantic analysis disabled - using basic structure detection\n`;
    } else if (classification.analysisMode === 'structural') {
      feedback += `🔧 Structural analysis mode - no semantic understanding\n`;
    } else if (classification.analysisMode === 'fallback' || classification.framework === 'fallback') {
      feedback += `🚨 Analysis failed - using fallback detection\n`;
    }

    // Show key limitations if present
    const importantLimitations = classification.limitations?.filter(l =>
      l.includes('disabled') || l.includes('No semantic') || l.includes('Framework recommendation unavailable')) || [];

    if (importantLimitations.length > 0) {
      const shortLimitation = importantLimitations[0].length > 50
        ? importantLimitations[0].substring(0, 47) + '...'
        : importantLimitations[0];
      feedback += `⚠️ ${shortLimitation}\n`;
    }

    // Generate capability-aware suggestions
    const suggestions = this.generateSuggestions(classification);

    return { classification, feedback, suggestions };
  }

  /**
   * Analyze prompt using semantic analyzer (configuration-aware)
   */
  async analyzePrompt(prompt: ConvertedPrompt): Promise<PromptClassification> {
    try {
      const analysis = await this.semanticAnalyzer.analyzePrompt(prompt);
      return {
        executionType: analysis.executionType,
        requiresExecution: analysis.requiresExecution,
        requiresFramework: analysis.requiresFramework,
        confidence: analysis.confidence,
        reasoning: analysis.reasoning,
        suggestedGates: analysis.suggestedGates,
        framework: 'configurable',
        // Enhanced configurable analysis information
        analysisMode: analysis.analysisMetadata.mode,
        capabilities: analysis.capabilities,
        limitations: analysis.limitations,
        warnings: analysis.warnings
      };
    } catch (error) {
      this.logger.error(`Configurable semantic analysis failed for ${prompt.id}:`, error);
      return this.createFallbackAnalysis(prompt, error);
    }
  }

  /**
   * Create fallback analysis when semantic analysis fails
   */
  private createFallbackAnalysis(prompt: ConvertedPrompt, error: any): PromptClassification {
    return {
      executionType: (prompt.chainSteps?.length ?? 0) > 0 ? 'chain' : 'template',
      requiresExecution: true,
      requiresFramework: true, // Default to requiring framework for fallback
      confidence: 0.5,
      reasoning: [`Fallback analysis: ${error}`],
      suggestedGates: ['execution_validation'],
      framework: 'fallback',
      analysisMode: 'fallback',
      capabilities: {
        canDetectStructure: false,
        canAnalyzeComplexity: false,
        canRecommendFramework: false,
        hasSemanticUnderstanding: false
      },
      limitations: ['Analysis failed - using minimal fallback'],
      warnings: ['⚠️ Analysis error occurred', '🚨 Using minimal fallback analysis']
    };
  }

  /**
   * Create fallback analysis when semantic analysis is disabled
   */
  createDisabledAnalysisFallback(prompt: ConvertedPrompt): PromptClassification {
    const hasChainSteps = Boolean(prompt.chainSteps?.length);
    const hasComplexArgs = (prompt.arguments?.length || 0) > 2;
    const hasTemplateVars = /\{\{.*?\}\}/g.test(prompt.userMessageTemplate || '');

    // Basic execution type detection without semantic analysis
    let executionType: 'prompt' | 'template' | 'chain' = 'prompt';
    if (hasChainSteps) {
      executionType = 'chain';
    } else if (hasComplexArgs || hasTemplateVars) {
      executionType = 'template';
    }

    return {
      executionType,
      requiresExecution: true,
      requiresFramework: false, // Conservative - don't assume framework needed
      confidence: 0.7, // High confidence in basic structural facts
      reasoning: [
        "Semantic analysis unavailable - using basic structural detection",
        `Detected ${executionType} type from file structure`,
        "Framework recommendation unavailable"
      ],
      suggestedGates: ['basic_validation'],
      framework: 'disabled',
      // Analysis metadata
      analysisMode: 'disabled',
      capabilities: {
        canDetectStructure: true,
        canAnalyzeComplexity: false,
        canRecommendFramework: false,
        hasSemanticUnderstanding: false
      },
      limitations: [
        "Semantic analysis unavailable (no LLM integration)",
        "No intelligent framework recommendations available",
        "Limited complexity analysis capabilities"
      ],
      warnings: [
        "⚠️ Semantic analysis unavailable",
        "💡 Configure LLM integration in config for semantic analysis",
        "🔧 Using basic structural detection only"
      ]
    };
  }

  /**
   * Get analysis icon based on analysis mode/framework
   */
  private getAnalysisIcon(mode: string | undefined): string {
    switch (mode) {
      case 'disabled': return '🔧'; // Basic structural detection
      case 'structural': return '🔬'; // Structural analysis
      case 'hybrid': return '🔍'; // Enhanced structural
      case 'semantic': return '🧠'; // Full semantic analysis
      case 'fallback': return '🚨'; // Error fallback
      case 'configurable': return '🧠'; // Configured semantic analysis
      default: return '🧠'; // Default intelligent analysis
    }
  }

  /**
   * Generate capability-aware suggestions
   */
  private generateSuggestions(classification: PromptClassification): string[] {
    const suggestions: string[] = [];

    if (classification.analysisMode === 'disabled' || classification.framework === 'disabled') {
      suggestions.push("💡 Enable semantic analysis for enhanced capabilities");
      suggestions.push("🎯 Framework recommendation unavailable");
    } else if (classification.analysisMode === 'structural') {
      suggestions.push("💡 Configure LLM integration for intelligent analysis");
    } else if (classification.analysisMode === 'fallback' || classification.framework === 'fallback') {
      suggestions.push("🚨 Fix analysis configuration");
    }

    if (!classification.capabilities?.canRecommendFramework) {
      suggestions.push("🎯 Framework recommendation unavailable");
    }

    return suggestions;
  }

  /**
   * Detect execution type from prompt structure
   */
  detectExecutionType(prompt: ConvertedPrompt): 'prompt' | 'template' | 'chain' {
    if (prompt.chainSteps && prompt.chainSteps.length > 0) {
      return 'chain';
    }

    const hasTemplateVars = /\{\{.*?\}\}/g.test(prompt.userMessageTemplate || '');
    const hasComplexArgs = (prompt.arguments?.length || 0) > 2;

    if (hasTemplateVars || hasComplexArgs) {
      return 'template';
    }

    return 'prompt';
  }

  /**
   * Analyze prompt complexity
   */
  analyzeComplexity(prompt: ConvertedPrompt): {
    level: 'low' | 'medium' | 'high';
    factors: string[];
    score: number;
  } {
    const factors: string[] = [];
    let score = 0;

    // Check for chain steps
    if (prompt.chainSteps && prompt.chainSteps.length > 0) {
      factors.push(`Chain with ${prompt.chainSteps.length} steps`);
      score += prompt.chainSteps.length * 2;
    }

    // Check for arguments
    if (prompt.arguments && prompt.arguments.length > 0) {
      factors.push(`${prompt.arguments.length} arguments`);
      score += prompt.arguments.length;
    }

    // Check for template complexity
    const templateVars = (prompt.userMessageTemplate || '').match(/\{\{.*?\}\}/g);
    if (templateVars && templateVars.length > 0) {
      factors.push(`${templateVars.length} template variables`);
      score += templateVars.length;
    }

    // Check for system message complexity
    if (prompt.systemMessage && prompt.systemMessage.length > 100) {
      factors.push('Complex system message');
      score += 2;
    }

    let level: 'low' | 'medium' | 'high' = 'low';
    if (score > 10) {
      level = 'high';
    } else if (score > 5) {
      level = 'medium';
    }

    return { level, factors, score };
  }

  /**
   * Check if prompt requires framework support
   */
  requiresFramework(prompt: ConvertedPrompt): boolean {
    const complexity = this.analyzeComplexity(prompt);

    // Chain prompts typically benefit from framework guidance
    if (prompt.chainSteps && prompt.chainSteps.length > 0) {
      return true;
    }

    // Complex templates with many arguments
    if (complexity.level === 'high') {
      return true;
    }

    // Complex system messages suggest structured analysis
    if (prompt.systemMessage && prompt.systemMessage.length > 200) {
      return true;
    }

    return false;
  }
}