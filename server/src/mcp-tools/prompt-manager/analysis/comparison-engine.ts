// @lifecycle canonical - Compares old vs new prompts for reviewers.
/**
 * Before/after analysis comparison engine
 */

import { Logger } from '../../../logging/index.js';
import { PromptClassification } from '../core/types.js';

/**
 * Comparison result interface
 */
export interface ComparisonResult {
  hasChanges: boolean;
  summary: string;
  changes: ComparisonChange[];
  recommendations: string[];
}

/**
 * Individual comparison change
 */
export interface ComparisonChange {
  type: 'execution_type' | 'framework_requirement' | 'gates' | 'confidence' | 'complexity';
  before: unknown;
  after: unknown;
  impact: 'positive' | 'negative' | 'neutral';
  description: string;
}

/**
 * Analysis comparison engine for tracking prompt evolution
 */
export class ComparisonEngine {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Compare two prompt analyses and generate change summary
   */
  compareAnalyses(
    before: PromptClassification,
    after: PromptClassification,
    promptId: string
  ): ComparisonResult {
    const changes: ComparisonChange[] = [];

    // Compare execution type
    if (before.executionType !== after.executionType) {
      changes.push({
        type: 'execution_type',
        before: before.executionType,
        after: after.executionType,
        impact: this.assessExecutionTypeChange(before.executionType, after.executionType),
        description: `Execution type changed from ${before.executionType} to ${after.executionType}`,
      });
    }

    // Compare framework requirements
    if (before.requiresFramework !== after.requiresFramework) {
      changes.push({
        type: 'framework_requirement',
        before: before.requiresFramework,
        after: after.requiresFramework,
        impact: after.requiresFramework ? 'positive' : 'neutral',
        description: `Framework requirement ${after.requiresFramework ? 'added' : 'removed'}`,
      });
    }

    // Compare gates
    const gateChanges = this.compareGates(before.suggestedGates, after.suggestedGates);
    changes.push(...gateChanges);

    // Compare confidence (if both are available and significantly different)
    if (Math.abs(before.confidence - after.confidence) > 0.2) {
      changes.push({
        type: 'confidence',
        before: before.confidence,
        after: after.confidence,
        impact: after.confidence > before.confidence ? 'positive' : 'negative',
        description: `Analysis confidence ${after.confidence > before.confidence ? 'improved' : 'decreased'} (${Math.round((after.confidence - before.confidence) * 100)}%)`,
      });
    }

    return {
      hasChanges: changes.length > 0,
      summary: this.generateSummary(changes),
      changes,
      recommendations: this.generateRecommendations(changes, before, after),
    };
  }

  /**
   * Compare gate suggestions
   */
  private compareGates(beforeGates: string[], afterGates: string[]): ComparisonChange[] {
    const changes: ComparisonChange[] = [];
    const beforeSet = new Set(beforeGates);
    const afterSet = new Set(afterGates);

    const addedGates = [...afterSet].filter((g) => !beforeSet.has(g));
    const removedGates = [...beforeSet].filter((g) => !afterSet.has(g));

    if (addedGates.length > 0) {
      changes.push({
        type: 'gates',
        before: beforeGates,
        after: afterGates,
        impact: 'positive',
        description: `Added quality gates: ${addedGates.join(', ')}`,
      });
    }

    if (removedGates.length > 0) {
      changes.push({
        type: 'gates',
        before: beforeGates,
        after: afterGates,
        impact: 'neutral',
        description: `Removed gates: ${removedGates.join(', ')}`,
      });
    }

    return changes;
  }

  /**
   * Assess the impact of execution type changes
   */
  private assessExecutionTypeChange(
    before: string,
    after: string
  ): 'positive' | 'negative' | 'neutral' {
    // Define execution type hierarchy (complexity order)
    const complexity: Record<string, number> = {
      prompt: 1,
      template: 2,
      chain: 3,
    };

    const beforeComplexity = complexity[before] || 0;
    const afterComplexity = complexity[after] || 0;

    if (afterComplexity > beforeComplexity) {
      return 'positive'; // Upgrading to more sophisticated type
    } else if (afterComplexity < beforeComplexity) {
      return 'neutral'; // Simplifying (could be positive optimization)
    }

    return 'neutral';
  }

  /**
   * Generate summary of changes
   */
  private generateSummary(changes: ComparisonChange[]): string {
    if (changes.length === 0) {
      return 'No significant changes detected';
    }

    const typeChanges = changes.filter((c) => c.type === 'execution_type');
    const gateChanges = changes.filter((c) => c.type === 'gates');
    const frameworkChanges = changes.filter((c) => c.type === 'framework_requirement');

    const parts: string[] = [];

    if (typeChanges.length > 0) {
      const change = typeChanges[0];
      if (change !== undefined) {
        parts.push(`🔄 **Type**: ${change.before} → ${change.after}`);
      }
    }

    if (frameworkChanges.length > 0) {
      const change = frameworkChanges[0];
      if (change !== undefined) {
        const status = change.after ? 'enabled' : 'disabled';
        parts.push(`🧠 **Framework**: ${status}`);
      }
    }

    if (gateChanges.length > 0) {
      const addedGates = gateChanges.filter((c) => c.description.includes('Added'));
      const removedGates = gateChanges.filter((c) => c.description.includes('Removed'));

      if (addedGates.length > 0) {
        parts.push(`✅ **Added Gates**`);
      }
      if (removedGates.length > 0) {
        parts.push(`❌ **Removed Gates**`);
      }
    }

    if (parts.length === 0) {
      return 'Analysis metrics updated';
    }

    return `📊 **Analysis Changes**: ${parts.join(' • ')}`;
  }

  /**
   * Generate recommendations based on changes
   */
  private generateRecommendations(
    changes: ComparisonChange[],
    before: PromptClassification,
    after: PromptClassification
  ): string[] {
    const recommendations: string[] = [];

    // Execution type recommendations
    const typeChanges = changes.filter((c) => c.type === 'execution_type');
    if (typeChanges.length > 0) {
      const change = typeChanges[0];
      if (change !== undefined) {
        if (change.after === 'chain' && change.before !== 'chain') {
          recommendations.push(
            '💡 Consider adding chain validation gates for multi-step execution'
          );
        } else if (change.after === 'template' && change.before === 'prompt') {
          recommendations.push('💡 Framework integration now available for structured analysis');
        } else if (change.after === 'prompt' && change.before !== 'prompt') {
          recommendations.push('⚡ Simplified execution should improve performance');
        }
      }
    }

    // Framework recommendations
    const frameworkChanges = changes.filter((c) => c.type === 'framework_requirement');
    if (frameworkChanges.length > 0) {
      const change = frameworkChanges[0];
      if (change !== undefined) {
        if (change.after && !change.before) {
          recommendations.push('🎯 Enable CAGEERF or ReACT framework for optimal results');
        } else if (!change.after && change.before) {
          recommendations.push('🚀 Framework overhead removed - consider basic prompt execution');
        }
      }
    }

    // Gate recommendations
    const gateChanges = changes.filter((c) => c.type === 'gates');
    if (gateChanges.some((c) => c.description.includes('Added'))) {
      recommendations.push('🔒 New quality gates will improve execution reliability');
    }

    // Confidence recommendations
    const confidenceChanges = changes.filter((c) => c.type === 'confidence');
    if (confidenceChanges.length > 0) {
      const change = confidenceChanges[0];
      if (change !== undefined) {
        if (change.impact === 'negative') {
          recommendations.push('⚠️ Lower confidence suggests prompt may need refinement');
        } else if (change.impact === 'positive') {
          recommendations.push('✅ Improved confidence indicates better prompt structure');
        }
      }
    }

    return recommendations;
  }

  /**
   * Generate change summary for display
   */
  generateDisplaySummary(result: ComparisonResult): string | null {
    if (!result.hasChanges) {
      return null;
    }

    let summary = result.summary;

    if (result.recommendations.length > 0) {
      summary += `\n\n💡 **Recommendations**:\n`;
      result.recommendations.forEach((rec, i) => {
        summary += `${i + 1}. ${rec}\n`;
      });
    }

    return summary;
  }

  /**
   * Track analysis evolution over time
   */
  trackEvolution(promptId: string, classification: PromptClassification): void {
    // Log significant analysis data for evolution tracking
    this.logger.debug(`Analysis evolution for ${promptId}:`, {
      executionType: classification.executionType,
      requiresFramework: classification.requiresFramework,
      confidence: classification.confidence,
      gates: classification.suggestedGates.length,
      analysisMode: classification.analysisMode,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Assess overall improvement direction
   */
  assessImprovement(changes: ComparisonChange[]): 'improved' | 'degraded' | 'neutral' {
    const positiveChanges = changes.filter((c) => c.impact === 'positive').length;
    const negativeChanges = changes.filter((c) => c.impact === 'negative').length;

    if (positiveChanges > negativeChanges) {
      return 'improved';
    } else if (negativeChanges > positiveChanges) {
      return 'degraded';
    }

    return 'neutral';
  }
}
