// @lifecycle canonical - Analyzes prompts for lifecycle and metadata.
/**
 * Classifies prompts by their structure: the single owner of a prompt's execution type and
 * complexity.
 */

import { PromptClassification, AnalysisResult } from '../core/types.js';

import type { ConvertedPrompt } from '#engine/execution/types.js';

/**
 * Prompt classification for `resource_manager` replies, listings and gate recommendations.
 *
 * It delegated to `ContentAnalyzer` until P4.127. That class answered `executionType: 'single'`
 * for every prompt, so a four-step chain was reported as `single` in the create reply while
 * `detectExecutionType`, the owner, said `chain` for the same prompt in the same call. The
 * classification now reads the owner, and the twin is gone.
 */
export class PromptAnalyzer {
  /**
   * Analyze prompt for intelligence feedback (compact format)
   */
  analyzePromptIntelligence(promptData: any): Promise<AnalysisResult> {
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

    const classification = this.classify(tempPrompt);

    // Concise single-line format: type plus suggested gates. Gate recommendations come from the
    // rule-based `GateAnalyzer`, which the lifecycle processor calls beside this.
    let feedback = `🧠 ${classification.executionType}`;
    if (classification.suggestedGates.length > 0) {
      feedback += ` • Suggested gates: ${classification.suggestedGates.join(', ')}`;
    }
    feedback += '\n';

    return Promise.resolve({ classification, feedback, suggestions: [] });
  }

  /**
   * Classify a prompt from its structure.
   */
  analyzePrompt(prompt: ConvertedPrompt): Promise<PromptClassification> {
    return Promise.resolve(this.classify(prompt));
  }

  private classify(prompt: ConvertedPrompt): PromptClassification {
    const executionType = this.detectExecutionType(prompt);
    return {
      executionType,
      requiresExecution: true,
      requiresFramework: false,
      confidence: 0.5,
      reasoning: [
        executionType === 'chain'
          ? `Chain with ${prompt.chainSteps?.length ?? 0} steps`
          : 'Single prompt: no chain steps',
        'Structural analysis only - prompt content is not inspected',
      ],
      suggestedGates: [],
    };
  }

  /**
   * Detect execution type from prompt structure.
   *
   * The single owner of this question: `GateAnalyzer` reads it rather than deriving its own.
   */
  detectExecutionType(prompt: ConvertedPrompt): 'single' | 'chain' {
    return prompt.chainSteps && prompt.chainSteps.length > 0 ? 'chain' : 'single';
  }

  /**
   * Analyze prompt complexity.
   *
   * The single owner of this question: `GateAnalyzer` reads `level` rather than deriving its own.
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
}
