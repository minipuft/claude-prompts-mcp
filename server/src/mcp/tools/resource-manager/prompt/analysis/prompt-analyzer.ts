// @lifecycle canonical - Analyzes prompts for lifecycle and metadata.
/**
 * Semantic analysis and classification engine
 */

import { PromptClassification, AnalysisResult, PromptResourceDependencies } from '../core/types.js';

import type { ConvertedPrompt } from '#engine/execution/types.js';

import { ContentAnalyzer } from '#modules/semantic/content-analyzer.js';
import { type Logger } from '#shared/types/index.js';

/**
 * Prompt analysis engine for semantic classification and intelligence feedback
 */
export class PromptAnalyzer {
  private logger: Logger;
  private semanticAnalyzer: ContentAnalyzer;

  constructor(dependencies: Pick<PromptResourceDependencies, 'logger' | 'semanticAnalyzer'>) {
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
      chainSteps: promptData.chainSteps || [],
    };

    const classification = await this.analyzePrompt(tempPrompt);

    // Concise single-line format: type plus suggested gates.
    //
    // This used to be suppressed behind an LLM-integration flag that defaulted off, so the
    // common case emitted "API Analysis Disabled" and dropped the gate suggestions. Nothing
    // downstream needed a model: the classification comes from `ContentAnalyzer` and the gate
    // recommendations from the rule-based `GateAnalyzer`, which `prompt-discovery-processor`
    // already calls with no such gate.
    const analysisIcon = this.getAnalysisIcon(
      classification.analysisMode || classification.framework
    );
    let feedback = `${analysisIcon} ${classification.executionType}`;

    // Add suggested gates if present
    if (classification.suggestedGates.length > 0) {
      feedback += ` • Suggested gates: ${classification.suggestedGates.join(', ')}`;
    }
    feedback += '\n';

    // Generate capability-aware suggestions (empty for now in concise mode)
    const suggestions: string[] = [];

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
        capabilities: analysis.capabilities,
        limitations: analysis.limitations,
        warnings: analysis.warnings,
        ...(analysis.analysisMetadata.mode ? { analysisMode: analysis.analysisMetadata.mode } : {}),
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
    const isChain = (prompt.chainSteps?.length ?? 0) > 0;
    return {
      executionType: isChain ? 'chain' : 'single',
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
        hasSemanticUnderstanding: false,
      },
      limitations: ['Analysis failed - using minimal fallback'],
      warnings: ['⚠️ Analysis error occurred', '🚨 Using minimal fallback analysis'],
    };
  }

  /**
   * Icon for the analysis feedback line.
   *
   * Two inputs are reachable: `'minimal'` from the normal path (`ContentAnalyzer` sets that mode
   * unconditionally) and `'fallback'` from the catch in `analyzePrompt`. Everything else falls to
   * the default, which is the same icon `'minimal'` would pick — so callers get 🧠 unless analysis
   * actually failed.
   */
  private getAnalysisIcon(mode: string | undefined): string {
    return mode === 'fallback' ? '🚨' : '🧠';
  }

  /**
   * Detect execution type from prompt structure
   */
  detectExecutionType(prompt: ConvertedPrompt): 'single' | 'chain' {
    if (prompt.chainSteps && prompt.chainSteps.length > 0) {
      return 'chain';
    }

    const hasTemplateVars = /\{\{.*?\}\}/g.test(prompt.userMessageTemplate || '');
    const hasComplexArgs = (prompt.arguments?.length || 0) > 2;

    if (hasTemplateVars || hasComplexArgs) {
      return 'single';
    }

    return 'single';
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
