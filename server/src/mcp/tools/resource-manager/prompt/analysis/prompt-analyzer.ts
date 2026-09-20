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
      // Never a hardcoded id: analysis failed, so there is no basis to name a gate, and naming
      // one that does not resolve through the gate registry would be a suggestion the caller
      // cannot act on.
      suggestedGates: [],
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
}
