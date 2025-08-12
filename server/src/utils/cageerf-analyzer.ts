/**
 * CAGEERF Framework Analyzer
 * Analyzes prompts for C.A.G.E.E.R.F methodology compliance and provides framework-specific insights
 * 
 * C.A.G.E.E.R.F Framework:
 * - Context: Environmental awareness and situational understanding
 * - Analysis: Systematic examination and assessment
 * - Goals: Clear objectives and expected outcomes
 * - Execution: Step-by-step implementation strategies
 * - Evaluation: Assessment criteria and validation methods
 * - Refinement: Iterative improvement processes
 * - Framework: Structured methodology and systematic approach
 */

import { ConvertedPrompt } from "../types/index.js";

export interface CAGEERFCompliance {
  context: {
    present: boolean;
    confidence: number;
    indicators: string[];
    suggestions: string[];
  };
  analysis: {
    present: boolean;
    confidence: number;
    indicators: string[];
    suggestions: string[];
  };
  goals: {
    present: boolean;
    confidence: number;
    indicators: string[];
    suggestions: string[];
  };
  execution: {
    present: boolean;
    confidence: number;
    indicators: string[];
    suggestions: string[];
  };
  evaluation: {
    present: boolean;
    confidence: number;
    indicators: string[];
    suggestions: string[];
  };
  refinement: {
    present: boolean;
    confidence: number;
    indicators: string[];
    suggestions: string[];
  };
  framework: {
    present: boolean;
    confidence: number;
    indicators: string[];
    suggestions: string[];
  };
}

export interface CAGEERFAnalysis {
  overallCompliance: number;
  frameworkScore: number;
  recommendedImprovements: string[];
  strengthAreas: string[];
  compliance: CAGEERFCompliance;
  templateSuggestions: TemplateEnhancement[];
}

export interface TemplateEnhancement {
  section: keyof CAGEERFCompliance;
  priority: 'high' | 'medium' | 'low';
  suggestion: string;
  templateAddition: string;
}

/**
 * CAGEERF Framework Analyzer for systematic prompt analysis
 */
export class CAGEERFAnalyzer {
  
  /**
   * Analyze a prompt for CAGEERF methodology compliance
   */
  analyzePrompt(prompt: ConvertedPrompt): CAGEERFAnalysis {
    const combinedText = this.getCombinedText(prompt);
    
    const compliance: CAGEERFCompliance = {
      context: this.analyzeContext(combinedText),
      analysis: this.analyzeAnalysis(combinedText),
      goals: this.analyzeGoals(combinedText),
      execution: this.analyzeExecution(combinedText),
      evaluation: this.analyzeEvaluation(combinedText),
      refinement: this.analyzeRefinement(combinedText),
      framework: this.analyzeFramework(combinedText)
    };

    const overallCompliance = this.calculateOverallCompliance(compliance);
    const frameworkScore = this.calculateFrameworkScore(compliance);
    const recommendedImprovements = this.generateRecommendations(compliance);
    const strengthAreas = this.identifyStrengths(compliance);
    const templateSuggestions = this.generateTemplateEnhancements(compliance);

    return {
      overallCompliance,
      frameworkScore,
      recommendedImprovements,
      strengthAreas,
      compliance,
      templateSuggestions
    };
  }

  /**
   * Analyze a text string for CAGEERF methodology compliance
   * Convenient method for performance testing and simple text analysis
   */
  analyzeText(text: string): CAGEERFAnalysis {
    // Convert string to minimal ConvertedPrompt object for analysis
    const prompt: ConvertedPrompt = {
      id: 'text-analysis',
      name: 'Text Analysis',
      description: 'Text analysis for CAGEERF compliance',
      category: 'analysis',
      userMessageTemplate: text || '',
      arguments: []
    };
    
    return this.analyzePrompt(prompt);
  }

  /**
   * Get combined text from prompt for analysis
   */
  private getCombinedText(prompt: ConvertedPrompt): string {
    if (!prompt) {
      return "";
    }
    
    // Enhanced null safety for all fields
    const systemMessage = prompt.systemMessage?.trim() || "";
    const userMessage = prompt.userMessageTemplate?.trim() || "";
    const description = prompt.description?.trim() || "";
    
    return `${systemMessage} ${userMessage} ${description}`.trim().toLowerCase();
  }

  /**
   * Analyze Context component of CAGEERF
   */
  private analyzeContext(text: string): CAGEERFCompliance['context'] {
    const indicators: string[] = [];
    const suggestions: string[] = [];
    let confidence = 0;

    // Context patterns
    const contextPatterns = {
      environmental: /(?:context|environment|setting|situation|background|circumstances)/,
      awareness: /(?:consider|taking into account|given|understanding|recognizing)/,
      stakeholders: /(?:audience|users?|stakeholders?|participants?|team)/,
      constraints: /(?:constraints?|limitations?|boundaries?|restrictions?)/,
      requirements: /(?:requirements?|needs?|specifications?|criteria)/
    };

    // Check for context indicators
    if (contextPatterns.environmental.test(text)) {
      indicators.push("Environmental awareness mentioned");
      confidence += 0.25;
    }

    if (contextPatterns.awareness.test(text)) {
      indicators.push("Contextual consideration language");
      confidence += 0.2;
    }

    if (contextPatterns.stakeholders.test(text)) {
      indicators.push("Stakeholder awareness");
      confidence += 0.2;
    }

    if (contextPatterns.constraints.test(text)) {
      indicators.push("Constraint recognition");
      confidence += 0.2;
    }

    if (contextPatterns.requirements.test(text)) {
      indicators.push("Requirements awareness");
      confidence += 0.15;
    }

    // Generate suggestions for missing context elements
    if (confidence < 0.3) {
      suggestions.push("Add contextual background and environmental considerations");
    }
    if (!contextPatterns.stakeholders.test(text)) {
      suggestions.push("Include stakeholder or audience identification");
    }
    if (!contextPatterns.constraints.test(text)) {
      suggestions.push("Consider adding constraint or limitation awareness");
    }

    return {
      present: confidence > 0.2,
      confidence: Math.min(1.0, confidence),
      indicators,
      suggestions
    };
  }

  /**
   * Analyze Analysis component of CAGEERF
   */
  private analyzeAnalysis(text: string): CAGEERFCompliance['analysis'] {
    const indicators: string[] = [];
    const suggestions: string[] = [];
    let confidence = 0;

    // Analysis patterns
    const analysisPatterns = {
      systematic: /(?:systematic|methodical|structured|organized|comprehensive)/,
      examination: /(?:analyze|examine|investigate|assess|evaluate|review)/,
      breakdown: /(?:break down|decompose|dissect|separate|categorize)/,
      comparison: /(?:compare|contrast|differentiate|distinguish|versus)/,
      critical: /(?:critical|deep|thorough|detailed|in-depth)/
    };

    // Check for analysis indicators
    if (analysisPatterns.systematic.test(text)) {
      indicators.push("Systematic approach language");
      confidence += 0.25;
    }

    if (analysisPatterns.examination.test(text)) {
      indicators.push("Examination and assessment terms");
      confidence += 0.2;
    }

    if (analysisPatterns.breakdown.test(text)) {
      indicators.push("Decomposition methodology");
      confidence += 0.2;
    }

    if (analysisPatterns.comparison.test(text)) {
      indicators.push("Comparative analysis elements");
      confidence += 0.2;
    }

    if (analysisPatterns.critical.test(text)) {
      indicators.push("Critical thinking indicators");
      confidence += 0.15;
    }

    // Generate suggestions for missing analysis elements
    if (confidence < 0.4) {
      suggestions.push("Add systematic analysis and examination methodology");
    }
    if (!analysisPatterns.breakdown.test(text)) {
      suggestions.push("Include decomposition or breakdown strategies");
    }
    if (!analysisPatterns.critical.test(text)) {
      suggestions.push("Incorporate critical thinking and deep analysis");
    }

    return {
      present: confidence > 0.25,
      confidence: Math.min(1.0, confidence),
      indicators,
      suggestions
    };
  }

  /**
   * Analyze Goals component of CAGEERF
   */
  private analyzeGoals(text: string): CAGEERFCompliance['goals'] {
    const indicators: string[] = [];
    const suggestions: string[] = [];
    let confidence = 0;

    // Goals patterns
    const goalsPatterns = {
      objectives: /(?:goal|objective|aim|purpose|intent|target)/,
      outcomes: /(?:outcome|result|output|deliverable|achievement)/,
      success: /(?:success|criteria|metrics|measure|indicator)/,
      specific: /(?:specific|clear|defined|explicit|precise)/,
      measurable: /(?:measurable|quantifiable|trackable|metric)/
    };

    // Check for goals indicators
    if (goalsPatterns.objectives.test(text)) {
      indicators.push("Clear objectives mentioned");
      confidence += 0.3;
    }

    if (goalsPatterns.outcomes.test(text)) {
      indicators.push("Expected outcomes identified");
      confidence += 0.25;
    }

    if (goalsPatterns.success.test(text)) {
      indicators.push("Success criteria present");
      confidence += 0.2;
    }

    if (goalsPatterns.specific.test(text)) {
      indicators.push("Specific goal definition");
      confidence += 0.15;
    }

    if (goalsPatterns.measurable.test(text)) {
      indicators.push("Measurable outcomes");
      confidence += 0.1;
    }

    // Generate suggestions for missing goals elements
    if (confidence < 0.3) {
      suggestions.push("Define clear objectives and expected outcomes");
    }
    if (!goalsPatterns.success.test(text)) {
      suggestions.push("Add success criteria and measurement indicators");
    }
    if (!goalsPatterns.specific.test(text)) {
      suggestions.push("Make goals more specific and well-defined");
    }

    return {
      present: confidence > 0.2,
      confidence: Math.min(1.0, confidence),
      indicators,
      suggestions
    };
  }

  /**
   * Analyze Execution component of CAGEERF
   */
  private analyzeExecution(text: string): CAGEERFCompliance['execution'] {
    const indicators: string[] = [];
    const suggestions: string[] = [];
    let confidence = 0;

    // Execution patterns
    const executionPatterns = {
      stepwise: /(?:step|phase|stage|sequence|process|procedure)/,
      implementation: /(?:implement|execute|perform|carry out|conduct)/,
      methodology: /(?:method|approach|strategy|technique|framework)/,
      order: /(?:first|then|next|finally|following|order)/,
      action: /(?:action|task|activity|operation|practice)/
    };

    // Check for execution indicators
    if (executionPatterns.stepwise.test(text)) {
      indicators.push("Step-by-step approach");
      confidence += 0.3;
    }

    if (executionPatterns.implementation.test(text)) {
      indicators.push("Implementation language");
      confidence += 0.25;
    }

    if (executionPatterns.methodology.test(text)) {
      indicators.push("Methodological approach");
      confidence += 0.2;
    }

    if (executionPatterns.order.test(text)) {
      indicators.push("Sequential execution indicators");
      confidence += 0.15;
    }

    if (executionPatterns.action.test(text)) {
      indicators.push("Action-oriented language");
      confidence += 0.1;
    }

    // Generate suggestions for missing execution elements
    if (confidence < 0.4) {
      suggestions.push("Add step-by-step execution methodology");
    }
    if (!executionPatterns.order.test(text)) {
      suggestions.push("Include sequential order and process flow");
    }
    if (!executionPatterns.methodology.test(text)) {
      suggestions.push("Define clear implementation approach");
    }

    return {
      present: confidence > 0.25,
      confidence: Math.min(1.0, confidence),
      indicators,
      suggestions
    };
  }

  /**
   * Analyze Evaluation component of CAGEERF
   */
  private analyzeEvaluation(text: string): CAGEERFCompliance['evaluation'] {
    const indicators: string[] = [];
    const suggestions: string[] = [];
    let confidence = 0;

    // Evaluation patterns
    const evaluationPatterns = {
      assessment: /(?:evaluate|assess|review|validate|verify|check)/,
      criteria: /(?:criteria|standard|benchmark|threshold|requirement)/,
      quality: /(?:quality|effectiveness|efficiency|performance|accuracy)/,
      testing: /(?:test|trial|experiment|proof|validation)/,
      feedback: /(?:feedback|review|input|response|evaluation)/
    };

    // Check for evaluation indicators
    if (evaluationPatterns.assessment.test(text)) {
      indicators.push("Assessment methodology");
      confidence += 0.25;
    }

    if (evaluationPatterns.criteria.test(text)) {
      indicators.push("Evaluation criteria present");
      confidence += 0.25;
    }

    if (evaluationPatterns.quality.test(text)) {
      indicators.push("Quality indicators");
      confidence += 0.2;
    }

    if (evaluationPatterns.testing.test(text)) {
      indicators.push("Testing and validation");
      confidence += 0.2;
    }

    if (evaluationPatterns.feedback.test(text)) {
      indicators.push("Feedback mechanisms");
      confidence += 0.1;
    }

    // Generate suggestions for missing evaluation elements
    if (confidence < 0.3) {
      suggestions.push("Add evaluation and assessment methodology");
    }
    if (!evaluationPatterns.criteria.test(text)) {
      suggestions.push("Define clear evaluation criteria and standards");
    }
    if (!evaluationPatterns.testing.test(text)) {
      suggestions.push("Include testing and validation approaches");
    }

    return {
      present: confidence > 0.2,
      confidence: Math.min(1.0, confidence),
      indicators,
      suggestions
    };
  }

  /**
   * Analyze Refinement component of CAGEERF
   */
  private analyzeRefinement(text: string): CAGEERFCompliance['refinement'] {
    const indicators: string[] = [];
    const suggestions: string[] = [];
    let confidence = 0;

    // Refinement patterns
    const refinementPatterns = {
      iterative: /(?:iterative|iterate|refine|improve|enhance|optimize)/,
      feedback: /(?:feedback|learn|adapt|adjust|modify|update)/,
      continuous: /(?:continuous|ongoing|evolving|progressive|incremental)/,
      improvement: /(?:improvement|enhancement|optimization|upgrade|better)/,
      cycle: /(?:cycle|loop|repeat|revisit|return|review)/
    };

    // Check for refinement indicators
    if (refinementPatterns.iterative.test(text)) {
      indicators.push("Iterative improvement language");
      confidence += 0.25;
    }

    if (refinementPatterns.feedback.test(text)) {
      indicators.push("Feedback incorporation");
      confidence += 0.25;
    }

    if (refinementPatterns.continuous.test(text)) {
      indicators.push("Continuous improvement");
      confidence += 0.2;
    }

    if (refinementPatterns.improvement.test(text)) {
      indicators.push("Improvement focus");
      confidence += 0.2;
    }

    if (refinementPatterns.cycle.test(text)) {
      indicators.push("Cyclical refinement");
      confidence += 0.1;
    }

    // Generate suggestions for missing refinement elements
    if (confidence < 0.3) {
      suggestions.push("Add iterative refinement and improvement processes");
    }
    if (!refinementPatterns.feedback.test(text)) {
      suggestions.push("Include feedback incorporation mechanisms");
    }
    if (!refinementPatterns.continuous.test(text)) {
      suggestions.push("Consider continuous improvement approaches");
    }

    return {
      present: confidence > 0.2,
      confidence: Math.min(1.0, confidence),
      indicators,
      suggestions
    };
  }

  /**
   * Analyze Framework component of CAGEERF
   */
  private analyzeFramework(text: string): CAGEERFCompliance['framework'] {
    const indicators: string[] = [];
    const suggestions: string[] = [];
    let confidence = 0;

    // Framework patterns
    const frameworkPatterns = {
      structured: /(?:framework|structure|methodology|systematic|organized)/,
      principles: /(?:principle|guideline|rule|standard|best practice)/,
      model: /(?:model|template|pattern|approach|schema)/,
      consistency: /(?:consistent|standard|uniform|coherent|aligned)/,
      systematic: /(?:systematic|methodical|disciplined|rigorous|comprehensive)/
    };

    // Check for framework indicators
    if (frameworkPatterns.structured.test(text)) {
      indicators.push("Structured framework language");
      confidence += 0.3;
    }

    if (frameworkPatterns.principles.test(text)) {
      indicators.push("Principled approach");
      confidence += 0.25;
    }

    if (frameworkPatterns.model.test(text)) {
      indicators.push("Model-based thinking");
      confidence += 0.2;
    }

    if (frameworkPatterns.consistency.test(text)) {
      indicators.push("Consistency emphasis");
      confidence += 0.15;
    }

    if (frameworkPatterns.systematic.test(text)) {
      indicators.push("Systematic methodology");
      confidence += 0.1;
    }

    // Generate suggestions for missing framework elements
    if (confidence < 0.4) {
      suggestions.push("Incorporate structured framework and methodology");
    }
    if (!frameworkPatterns.principles.test(text)) {
      suggestions.push("Add guiding principles and best practices");
    }
    if (!frameworkPatterns.systematic.test(text)) {
      suggestions.push("Emphasize systematic and methodical approach");
    }

    return {
      present: confidence > 0.25,
      confidence: Math.min(1.0, confidence),
      indicators,
      suggestions
    };
  }

  /**
   * Calculate overall CAGEERF compliance score
   */
  private calculateOverallCompliance(compliance: CAGEERFCompliance): number {
    const scores = Object.values(compliance).map(component => component.confidence);
    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
  }

  /**
   * Calculate framework-specific score
   */
  private calculateFrameworkScore(compliance: CAGEERFCompliance): number {
    const weights = {
      context: 0.15,
      analysis: 0.20,
      goals: 0.15,
      execution: 0.20,
      evaluation: 0.15,
      refinement: 0.10,
      framework: 0.05
    };

    let weightedScore = 0;
    Object.entries(compliance).forEach(([key, component]) => {
      weightedScore += component.confidence * weights[key as keyof typeof weights];
    });

    return weightedScore;
  }

  /**
   * Generate recommendations for improvement
   */
  private generateRecommendations(compliance: CAGEERFCompliance): string[] {
    const recommendations: string[] = [];
    
    Object.entries(compliance).forEach(([key, component]) => {
      if (component.confidence < 0.5) {
        recommendations.push(`Strengthen ${key.toUpperCase()}: ${component.suggestions[0] || 'Improve framework compliance'}`);
      }
    });

    // Add priority recommendations
    if (compliance.goals.confidence < 0.3) {
      recommendations.unshift("HIGH PRIORITY: Define clear goals and expected outcomes");
    }
    if (compliance.execution.confidence < 0.3) {
      recommendations.unshift("HIGH PRIORITY: Add systematic execution methodology");
    }

    return recommendations;
  }

  /**
   * Identify strength areas
   */
  private identifyStrengths(compliance: CAGEERFCompliance): string[] {
    const strengths: string[] = [];
    
    Object.entries(compliance).forEach(([key, component]) => {
      if (component.confidence > 0.7) {
        strengths.push(`Strong ${key.toUpperCase()}: ${component.indicators.join(', ')}`);
      }
    });

    return strengths;
  }

  /**
   * Generate template enhancements based on analysis
   */
  private generateTemplateEnhancements(compliance: CAGEERFCompliance): TemplateEnhancement[] {
    const enhancements: TemplateEnhancement[] = [];

    // Context enhancements
    if (compliance.context.confidence < 0.5) {
      enhancements.push({
        section: 'context',
        priority: 'high',
        suggestion: 'Add contextual background section',
        templateAddition: '\n## Context\nConsider the following context and environmental factors:\n- {{context_factors}}\n- Stakeholders: {{stakeholders}}\n- Constraints: {{constraints}}\n'
      });
    }

    // Goals enhancements
    if (compliance.goals.confidence < 0.5) {
      enhancements.push({
        section: 'goals',
        priority: 'high',
        suggestion: 'Define clear objectives and success criteria',
        templateAddition: '\n## Goals & Objectives\n**Primary Objective**: {{primary_goal}}\n**Success Criteria**: {{success_metrics}}\n**Expected Outcomes**: {{expected_outcomes}}\n'
      });
    }

    // Execution enhancements
    if (compliance.execution.confidence < 0.5) {
      enhancements.push({
        section: 'execution',
        priority: 'high',
        suggestion: 'Add step-by-step execution methodology',
        templateAddition: '\n## Execution Steps\n1. **Preparation**: {{prep_steps}}\n2. **Implementation**: {{implementation_steps}}\n3. **Validation**: {{validation_steps}}\n'
      });
    }

    // Evaluation enhancements
    if (compliance.evaluation.confidence < 0.4) {
      enhancements.push({
        section: 'evaluation',
        priority: 'medium',
        suggestion: 'Include assessment and validation criteria',
        templateAddition: '\n## Evaluation Criteria\n**Quality Standards**: {{quality_criteria}}\n**Validation Methods**: {{validation_methods}}\n**Assessment Metrics**: {{assessment_metrics}}\n'
      });
    }

    // Refinement enhancements
    if (compliance.refinement.confidence < 0.4) {
      enhancements.push({
        section: 'refinement',
        priority: 'medium',
        suggestion: 'Add iterative improvement process',
        templateAddition: '\n## Refinement Process\n**Feedback Integration**: {{feedback_process}}\n**Iterative Improvements**: {{improvement_cycle}}\n**Optimization Opportunities**: {{optimization_areas}}\n'
      });
    }

    return enhancements;
  }

  /**
   * Get human-readable CAGEERF analysis summary
   */
  getAnalysisSummary(analysis: CAGEERFAnalysis): string {
    const overallScore = Math.round(analysis.overallCompliance * 100);
    const frameworkScore = Math.round(analysis.frameworkScore * 100);
    
    let summary = `🎯 **CAGEERF Framework Analysis**\n`;
    summary += `📊 **Overall Compliance**: ${overallScore}% | **Framework Score**: ${frameworkScore}%\n\n`;
    
    // Compliance breakdown
    summary += `🔍 **Component Analysis**:\n`;
    Object.entries(analysis.compliance).forEach(([key, component]) => {
      const score = Math.round(component.confidence * 100);
      const status = component.present ? '✅' : '❌';
      summary += `   ${status} **${key.toUpperCase()}**: ${score}%\n`;
    });
    
    summary += `\n`;
    
    // Strengths
    if (analysis.strengthAreas.length > 0) {
      summary += `💪 **Strengths**:\n`;
      analysis.strengthAreas.forEach(strength => {
        summary += `   • ${strength}\n`;
      });
      summary += `\n`;
    }
    
    // Recommendations
    if (analysis.recommendedImprovements.length > 0) {
      summary += `🚀 **Improvement Recommendations**:\n`;
      analysis.recommendedImprovements.slice(0, 5).forEach((rec, index) => {
        summary += `   ${index + 1}. ${rec}\n`;
      });
      summary += `\n`;
    }
    
    // Template suggestions
    if (analysis.templateSuggestions.length > 0) {
      summary += `📝 **Template Enhancement Suggestions**:\n`;
      analysis.templateSuggestions.slice(0, 3).forEach(suggestion => {
        const priority = suggestion.priority === 'high' ? '🔥' : suggestion.priority === 'medium' ? '⚡' : '💡';
        summary += `   ${priority} ${suggestion.suggestion}\n`;
      });
    }
    
    return summary;
  }
}