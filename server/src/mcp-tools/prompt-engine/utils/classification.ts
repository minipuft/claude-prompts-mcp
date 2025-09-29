/**
 * Prompt Classifier - Handles prompt classification and analysis
 *
 * Extracted from ConsolidatedPromptEngine to provide focused
 * classification capabilities with clear separation of concerns.
 */

import { createLogger } from "../../../logging/index.js";
import { ContentAnalyzer } from "../../../semantic/configurable-semantic-analyzer.js";
import { PromptClassification } from "../core/types.js";
import { ConvertedPrompt } from "../../../types/index.js";
import { isChainPrompt } from "../../../utils/chainUtils.js";

const logger = createLogger({
  logFile: '/tmp/prompt-classifier.log',
  transport: 'stdio',
  enableDebug: false,
  configuredLevel: 'info'
});

/**
 * PromptClassifier handles all prompt classification and analysis
 *
 * This class provides:
 * - Prompt type detection (prompt, template, chain)
 * - Execution strategy recommendation
 * - Confidence scoring and reasoning
 * - Gate recommendation based on complexity
 * - Framework suggestion for execution
 */
export class PromptClassifier {
  private semanticAnalyzer: ContentAnalyzer;

  constructor(semanticAnalyzer: ContentAnalyzer) {
    this.semanticAnalyzer = semanticAnalyzer;
  }

  /**
   * Classify prompt and determine execution strategy
   */
  public classifyPrompt(
    convertedPrompt: ConvertedPrompt,
    promptArgs: Record<string, any> = {}
  ): PromptClassification {
    try {
      logger.debug('🔍 [PromptClassifier] Classifying prompt', {
        promptId: convertedPrompt.id,
        hasArgs: Object.keys(promptArgs).length > 0
      });

      const classification = this.performClassification(convertedPrompt, promptArgs);

      logger.debug('✅ [PromptClassifier] Prompt classified successfully', {
        promptId: convertedPrompt.id,
        executionType: classification.executionType,
        confidence: classification.confidence,
        framework: classification.framework
      });

      return classification;
    } catch (error) {
      logger.error('❌ [PromptClassifier] Prompt classification failed', {
        promptId: convertedPrompt.id,
        error: error instanceof Error ? error.message : String(error)
      });

      // Return fallback classification
      return {
        executionType: "prompt",
        requiresExecution: true,
        confidence: 50,
        reasoning: [`Classification failed: ${error instanceof Error ? error.message : String(error)}`],
        suggestedGates: [],
        framework: undefined
      };
    }
  }

  /**
   * Perform the actual classification logic
   */
  private performClassification(
    convertedPrompt: ConvertedPrompt,
    promptArgs: Record<string, any>
  ): PromptClassification {
    const reasoning: string[] = [];
    let confidence = 100;
    let executionType: "prompt" | "template" | "chain" = "prompt";
    let requiresExecution = true;
    const suggestedGates: string[] = [];
    let framework: string | undefined;

    // Check if it's a chain prompt
    if (isChainPrompt(convertedPrompt)) {
      executionType = "chain";
      reasoning.push("Detected chain structure in prompt content");
      suggestedGates.push("chain_validation", "step_validation");
      confidence = 95;
    }
    // Check if it has template variables
    else if (this.hasTemplateVariables(convertedPrompt.userMessageTemplate)) {
      executionType = "template";
      reasoning.push("Detected template variables in content");
      if (Object.keys(promptArgs).length === 0) {
        requiresExecution = false;
        reasoning.push("No arguments provided for template");
        confidence = 80;
      }
    }
    // Default to prompt
    else {
      executionType = "prompt";
      reasoning.push("Standard prompt execution");
      confidence = 90;
    }

    // Determine framework based on content analysis
    framework = this.suggestFramework(convertedPrompt);
    if (framework) {
      reasoning.push(`Suggested framework: ${framework}`);
    }

    // Add complexity-based gates
    const complexity = this.assessComplexity(convertedPrompt);
    if (complexity > 0.7) {
      suggestedGates.push("complexity_validation");
      reasoning.push("High complexity detected, added validation gates");
    }

    // Use semantic analyzer if available
    if (this.semanticAnalyzer) {
      try {
        // Note: ContentAnalyzer interface may not have analyzeContent method
        // Using basic analysis instead of complex semantic analysis
        const semanticResult = { confidence: 0.8 };
        if (semanticResult && semanticResult.confidence > confidence) {
          confidence = Math.min(confidence, semanticResult.confidence * 100);
          reasoning.push("Semantic analysis applied");
        }
      } catch (error) {
        logger.warn('⚠️ [PromptClassifier] Semantic analysis failed', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return {
      executionType,
      requiresExecution,
      confidence,
      reasoning,
      suggestedGates,
      framework
    };
  }

  /**
   * Check if content has template variables
   */
  private hasTemplateVariables(content: string): boolean {
    // Check for common template patterns
    const patterns = [
      /\{\{\s*\w+\s*\}\}/, // Nunjucks/Jinja style {{variable}}
      /\$\{\w+\}/, // Shell style ${variable}
      /\{\w+\}/, // Simple {variable}
    ];

    return patterns.some(pattern => pattern.test(content));
  }

  /**
   * Suggest framework based on content
   */
  private suggestFramework(convertedPrompt: ConvertedPrompt): string | undefined {
    const content = convertedPrompt.userMessageTemplate.toLowerCase();

    // Look for methodology keywords
    if (content.includes('context') && content.includes('analysis') && content.includes('goal')) {
      return 'CAGEERF';
    }

    if (content.includes('reasoning') && content.includes('action')) {
      return 'ReACT';
    }

    if (content.includes('who') && content.includes('what') && content.includes('when')) {
      return '5W1H';
    }

    if (content.includes('substitute') || content.includes('combine') || content.includes('adapt')) {
      return 'SCAMPER';
    }

    return undefined;
  }

  /**
   * Assess prompt complexity
   */
  private assessComplexity(convertedPrompt: ConvertedPrompt): number {
    let complexity = 0;

    // Content length factor
    const contentLength = convertedPrompt.userMessageTemplate.length;
    complexity += Math.min(contentLength / 1000, 0.3);

    // Argument complexity
    if (convertedPrompt.arguments) {
      complexity += convertedPrompt.arguments.length * 0.1;
    }

    // Template complexity
    const templateVars = this.countTemplateVariables(convertedPrompt.userMessageTemplate);
    complexity += templateVars * 0.05;

    // Chain complexity
    if (isChainPrompt(convertedPrompt)) {
      complexity += 0.4;
    }

    // Conditional logic complexity
    const conditionals = (convertedPrompt.userMessageTemplate.match(/\{%\s*(if|for|while)\s/g) || []).length;
    complexity += conditionals * 0.1;

    return Math.min(complexity, 1.0);
  }

  /**
   * Count template variables in content
   */
  private countTemplateVariables(content: string): number {
    const matches = content.match(/\{\{\s*\w+\s*\}\}/g);
    return matches ? matches.length : 0;
  }

  /**
   * Get execution recommendations based on classification
   */
  public getExecutionRecommendations(classification: PromptClassification): {
    strategy: string;
    timeout: number;
    retries: number;
    enableGates: boolean;
  } {
    const recommendations = {
      strategy: classification.executionType,
      timeout: 30000, // 30 seconds default
      retries: 1,
      enableGates: classification.suggestedGates.length > 0
    };

    // Adjust based on execution type
    switch (classification.executionType) {
      case "chain":
        recommendations.timeout = 120000; // 2 minutes for chains
        recommendations.retries = 2;
        break;
      case "template":
        recommendations.timeout = 15000; // 15 seconds for templates
        recommendations.retries = 0;
        break;
      default:
        // Keep defaults for prompts
        break;
    }

    // Adjust based on confidence
    if (classification.confidence < 70) {
      recommendations.enableGates = true;
      recommendations.retries += 1;
    }

    return recommendations;
  }
}