/**
 * Gate Selection Engine - Intelligent Gate Selection
 *
 * Single responsibility: Select appropriate gates based on semantic analysis and context.
 * Clean dependencies: Only content analysis types and framework definitions.
 */

import type { Logger } from '../../logging/index.js';
import { ConfigManager } from '../../config/index.js';
import type { FrameworksConfig } from '../../types/index.js';
import { GateSelectionCriteria, GateSelectionResult } from '../core/gate-definitions.js';
import type { ContentAnalysisResult } from '../../semantic/types.js';
import type { FrameworkDefinition } from '../../frameworks/types/index.js';

/**
 * User preferences for gate selection
 */
export interface UserPreferences {
  strictValidation?: boolean;
  performanceMode?: boolean;
  qualityFocus?: 'speed' | 'accuracy' | 'balanced';
}

/**
 * Extended gate selection criteria with semantic analysis
 * Explicitly includes all base properties for strict TypeScript compilation compatibility
 */
export interface ExtendedGateSelectionCriteria extends GateSelectionCriteria {
  // Explicitly defined for GitHub Actions TypeScript compatibility
  framework?: string;
  category?: string;
  promptId?: string;
  executionMode?: 'prompt' | 'template' | 'chain';
  complexityLevel?: 'low' | 'medium' | 'high';

  // Extended properties
  semanticAnalysis?: ContentAnalysisResult;
  frameworkContext?: FrameworkDefinition;
  userPreferences?: UserPreferences;
}

/**
 * Gate selection engine with semantic awareness
 */
export class GateSelectionEngine {
  private logger: Logger;
  private selectionHistory: GateSelectionResult[] = [];
  private configManager: ConfigManager;
  private frameworksConfig: FrameworksConfig;
  private frameworksConfigListener: (newConfig: FrameworksConfig, previousConfig: FrameworksConfig) => void;

  private static readonly METHODOLOGY_GATES = new Set<string>([
    'framework-compliance',
    'educational-clarity',
    'research-quality',
    'technical-accuracy',
    'content-structure',
    'code-quality',
    'security-awareness',
  ]);

  constructor(logger: Logger, configManager: ConfigManager) {
    this.logger = logger;
    this.configManager = configManager;
    this.frameworksConfig = this.configManager.getFrameworksConfig();
    this.frameworksConfigListener = (newConfig: FrameworksConfig) => {
      this.frameworksConfig = { ...newConfig };
      this.logger.info(
        `Gate selection engine feature toggles updated (methodologyGates: ${this.frameworksConfig.enableMethodologyGates})`
      );
    };
    this.configManager.on('frameworksConfigChanged', this.frameworksConfigListener);
    this.logger.debug('[GATE SELECTION ENGINE] Initialized');
  }

  /**
   * Select appropriate gates based on criteria and semantic analysis
   *
   * @param criteria - Extended selection criteria with semantic analysis
   * @returns Gate selection result with reasoning
   */
  async selectGates(criteria: ExtendedGateSelectionCriteria): Promise<GateSelectionResult> {
    const startTime = Date.now();

    this.logger.info('🧠 [GATE SELECTION ENGINE] selectGates called:', {
      framework: criteria.framework,
      category: criteria.category,
      executionMode: criteria.executionMode,
      complexityLevel: criteria.complexityLevel,
      hasSemanticAnalysis: !!criteria.semanticAnalysis,
      hasFrameworkContext: !!criteria.frameworkContext
    });

    // Primary gate selection based on framework and category
    const primaryGates = this.selectPrimaryGates(criteria);

    // Semantic-enhanced gate selection
    const semanticGates = this.selectSemanticGates(criteria);

    // Merge and deduplicate
    const selectedGates = this.mergeGateSelections(primaryGates, semanticGates);
    const gatedSelection = this.frameworksConfig.enableMethodologyGates
      ? selectedGates
      : selectedGates.filter(gate => !GateSelectionEngine.METHODOLOGY_GATES.has(gate));

    // Generate reasoning
    const reasoning = this.generateSelectionReasoning(criteria, primaryGates, semanticGates);

    // Calculate confidence
    const confidence = this.calculateSelectionConfidence(criteria, gatedSelection);

    // Estimate execution time
    const estimatedExecutionTime = this.estimateExecutionTime(gatedSelection, criteria);

    // Determine fallback gates
    const fallbackGates = this.determineFallbackGates(criteria);

    const result: GateSelectionResult = {
      selectedGates: gatedSelection,
      reasoning,
      confidence,
      estimatedExecutionTime,
      fallbackGates
    };

    // Track selection history
    this.selectionHistory.push(result);
    if (this.selectionHistory.length > 50) {
      this.selectionHistory = this.selectionHistory.slice(-50);
    }

    const executionTime = Date.now() - startTime;
    this.logger.debug('[GATE SELECTION ENGINE] Selection completed:', {
      selectedGates: selectedGates.length,
      confidence,
      estimatedExecutionTime,
      actualSelectionTime: executionTime
    });

    return result;
  }

  /**
   * Select primary gates based on framework and category
   */
  private selectPrimaryGates(criteria: ExtendedGateSelectionCriteria): string[] {
    if (!this.frameworksConfig.enableMethodologyGates) {
      return [];
    }
    const gates: string[] = [];

    // Framework-based selection
    if (criteria.framework) {
      switch (criteria.framework) {
        case 'ReACT':
          gates.push('framework-compliance', 'educational-clarity');
          break;
        case 'CAGEERF':
          gates.push('framework-compliance', 'research-quality');
          break;
        case '5W1H':
          gates.push('framework-compliance', 'technical-accuracy');
          break;
        case 'SCAMPER':
          gates.push('framework-compliance', 'content-structure');
          break;
        default:
          gates.push('framework-compliance');
      }
    }

    // Category-based selection
    if (criteria.category) {
      switch (criteria.category) {
        case 'analysis':
          gates.push('research-quality', 'technical-accuracy');
          break;
        case 'education':
          gates.push('educational-clarity', 'content-structure');
          break;
        case 'development':
          gates.push('code-quality', 'security-awareness');
          break;
        case 'research':
          gates.push('research-quality', 'technical-accuracy');
          break;
        default:
          gates.push('content-structure');
      }
    }

    return [...new Set(gates)]; // Remove duplicates
  }

  /**
   * Select gates based on semantic analysis
   */
  private selectSemanticGates(criteria: ExtendedGateSelectionCriteria): string[] {
    if (!this.frameworksConfig.enableMethodologyGates) {
      return [];
    }
    if (!criteria.semanticAnalysis) {
      return [];
    }

    const gates: string[] = [];
    const analysis = criteria.semanticAnalysis;

    // Example semantic-based selection (would be expanded with real analysis)
    if (analysis.confidence && analysis.confidence > 0.8) {
      gates.push('technical-accuracy');
    }

    if (criteria.executionMode === 'chain') {
      gates.push('educational-clarity');
    }

    if (criteria.complexityLevel === 'high') {
      gates.push('research-quality');
    }

    return gates;
  }

  /**
   * Merge multiple gate selections and remove duplicates
   */
  private mergeGateSelections(...selections: string[][]): string[] {
    const allGates = selections.flat();
    return [...new Set(allGates)];
  }

  /**
   * Generate human-readable reasoning for gate selection
   */
  private generateSelectionReasoning(
    criteria: ExtendedGateSelectionCriteria,
    primaryGates: string[],
    semanticGates: string[]
  ): string[] {
    const reasoning: string[] = [];

    if (criteria.framework) {
      reasoning.push(`Selected framework-specific gates for ${criteria.framework} methodology`);
    }

    if (criteria.category) {
      reasoning.push(`Applied category-specific gates for ${criteria.category} content`);
    }

    if (semanticGates.length > 0) {
      reasoning.push(`Enhanced selection with semantic analysis recommendations`);
    }

    if (criteria.complexityLevel) {
      reasoning.push(`Adjusted for ${criteria.complexityLevel} complexity level`);
    }

    if (criteria.userPreferences?.performanceMode) {
      reasoning.push(`Optimized for performance mode`);
    }

    return reasoning;
  }

  /**
   * Calculate confidence score for gate selection
   */
  private calculateSelectionConfidence(
    criteria: ExtendedGateSelectionCriteria,
    selectedGates: string[]
  ): number {
    let confidence = 0.5; // Base confidence

    // Increase confidence with more context
    if (criteria.framework) confidence += 0.2;
    if (criteria.category) confidence += 0.2;
    if (criteria.semanticAnalysis) confidence += 0.1;

    // Adjust based on gate count
    if (selectedGates.length >= 2 && selectedGates.length <= 4) {
      confidence += 0.1; // Good balance
    } else if (selectedGates.length > 4) {
      confidence -= 0.1; // Too many gates might be overwhelming
    }

    return Math.min(Math.max(confidence, 0), 1);
  }

  /**
   * Estimate execution time for selected gates
   */
  private estimateExecutionTime(selectedGates: string[], criteria: ExtendedGateSelectionCriteria): number {
    // Base time per gate (in milliseconds)
    const baseTimePerGate = 100;

    // Complexity multipliers
    const complexityMultipliers = {
      low: 0.8,
      medium: 1.0,
      high: 1.5
    };

    const multiplier = complexityMultipliers[criteria.complexityLevel || 'medium'];

    return selectedGates.length * baseTimePerGate * multiplier;
  }

  /**
   * Determine fallback gates if primary selection fails
   */
  private determineFallbackGates(criteria: ExtendedGateSelectionCriteria): string[] {
    // Default fallback gates
    const fallbacks = ['content-structure'];

    // Add framework-specific fallback if available
    if (criteria.framework) {
      fallbacks.push('framework-compliance');
    }

    return fallbacks;
  }

  /**
   * Get selection history for analysis
   */
  getSelectionHistory(): GateSelectionResult[] {
    return [...this.selectionHistory];
  }

  /**
   * Clear selection history
   */
  clearHistory(): void {
    this.selectionHistory = [];
    this.logger.debug('[GATE SELECTION ENGINE] Selection history cleared');
  }

  /**
   * Get selection statistics
   */
  getStatistics() {
    const totalSelections = this.selectionHistory.length;
    const averageGatesSelected = totalSelections > 0
      ? this.selectionHistory.reduce((sum, result) => sum + result.selectedGates.length, 0) / totalSelections
      : 0;
    const averageConfidence = totalSelections > 0
      ? this.selectionHistory.reduce((sum, result) => sum + result.confidence, 0) / totalSelections
      : 0;

    return {
      totalSelections,
      averageGatesSelected: Math.round(averageGatesSelected * 10) / 10,
      averageConfidence: Math.round(averageConfidence * 100) / 100,
      historySize: this.selectionHistory.length
    };
  }
}

/**
 * Factory function for creating gate selection engine
 */
export function createGateSelectionEngine(logger: Logger, configManager: ConfigManager): GateSelectionEngine {
  return new GateSelectionEngine(logger, configManager);
}

// Interfaces are already exported via declaration above
