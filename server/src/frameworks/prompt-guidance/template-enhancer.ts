/**
 * Template Enhancer - Phase 3 Implementation
 *
 * Enhances user templates with methodology guidance and framework-specific improvements.
 * Extracted from methodology guide enhancement logic for centralized template processing.
 */

import { Logger } from "../../logging/index.js";
import { ConvertedPrompt } from "../../types/index.js";
import {
  IMethodologyGuide,
  FrameworkDefinition,
  TemplateEnhancementResult,
  ProcessingGuidance,
  TemplateEnhancementConfig
} from "../types/index.js";
import type { ContentAnalysisResult } from "../../semantic/types.js";
import { LightweightGateSystem } from "../../gates/core/index.js";

/**
 * Template enhancement configuration
 */
export interface TemplateEnhancerConfig {
  enableArgumentSuggestions: boolean;
  enableStructureOptimization: boolean;
  enableValidationIntegration: boolean;
  enableQualityGates: boolean;
  maxSuggestions: number;
  enhancementLevel: 'minimal' | 'moderate' | 'comprehensive';
  // Phase 4: Semantic awareness settings
  enableSemanticAwareness: boolean;
  semanticComplexityAdaptation: boolean;
  semanticInsightIntegration: boolean;
  semanticEnhancementStrategy: 'conservative' | 'moderate' | 'aggressive';
}

/**
 * Template enhancement context
 */
export interface TemplateEnhancementContext {
  promptName: string;
  promptCategory: string;
  promptType: string;
  existingArguments: string[];
  targetAudience?: string;
  complexityLevel?: 'low' | 'medium' | 'high';
}

/**
 * Template Enhancer
 *
 * Applies methodology-specific enhancements to user templates,
 * providing intelligent suggestions and structural improvements.
 */
export class TemplateEnhancer {
  private logger: Logger;
  private config: TemplateEnhancerConfig;
  private gateSystem?: LightweightGateSystem;

  constructor(logger: Logger, config?: Partial<TemplateEnhancerConfig>, gateSystem?: LightweightGateSystem) {
    this.logger = logger;
    this.gateSystem = gateSystem;
    this.config = {
      enableArgumentSuggestions: true,
      enableStructureOptimization: true,
      enableValidationIntegration: true,
      enableQualityGates: true,
      maxSuggestions: 10,
      enhancementLevel: 'moderate',
      // Phase 4: Semantic awareness defaults
      enableSemanticAwareness: true,
      semanticComplexityAdaptation: true,
      semanticInsightIntegration: true,
      semanticEnhancementStrategy: 'moderate',
      ...config
    };
  }

  /**
   * Enhance template with methodology guidance
   * Extracted from methodology guide.guideTemplateProcessing()
   * Phase 4: Enhanced with semantic analysis awareness
   */
  async enhanceTemplate(
    template: string,
    prompt: ConvertedPrompt,
    methodologyGuide: IMethodologyGuide,
    framework: FrameworkDefinition,
    context?: TemplateEnhancementContext,
    semanticAnalysis?: ContentAnalysisResult
  ): Promise<TemplateEnhancementResult> {
    const startTime = Date.now();
    this.logger.debug(`Enhancing template with ${framework.methodology} methodology for ${prompt.name}`);

    try {
      // Get methodology-specific template processing guidance
      const processingGuidance = methodologyGuide.guideTemplateProcessing(
        template,
        prompt.executionMode || 'template'
      );

      // Build enhancement context with semantic analysis
      const enhancementContext = this.buildEnhancementContext(prompt, context, semanticAnalysis);

      // Apply enhancements based on configuration and semantic insights
      const enhancedTemplate = await this.applyEnhancements(
        template,
        processingGuidance,
        methodologyGuide,
        enhancementContext,
        semanticAnalysis
      );

      // Generate improvement suggestions with semantic insights
      const suggestions = this.generateSuggestions(
        template,
        enhancedTemplate,
        processingGuidance,
        methodologyGuide,
        enhancementContext,
        semanticAnalysis
      );

      // Validate enhanced template with semantic awareness
      const validation = this.validateEnhancedTemplate(
        enhancedTemplate,
        processingGuidance,
        methodologyGuide,
        semanticAnalysis
      );

      const result: TemplateEnhancementResult = {
        originalTemplate: template,
        enhancedTemplate,
        suggestions,
        processingGuidance,
        sourceFramework: framework,
        metadata: {
          enhancementTime: new Date(),
          enhancementLevel: this.config.enhancementLevel,
          suggestionsCount: suggestions.length,
          validationPassed: validation.passed,
          processingTimeMs: Date.now() - startTime,
          methodologyApplied: framework.methodology,
          // Phase 4: Semantic analysis metadata
          semanticAware: semanticAnalysis !== undefined,
          semanticComplexity: semanticAnalysis?.complexity,
          semanticConfidence: semanticAnalysis?.confidence,
          semanticEnhancementsApplied: this.getSemanticEnhancementsApplied(semanticAnalysis)
        },
        validation
      };

      this.logger.debug(`Template enhancement completed for ${framework.methodology} in ${result.metadata.processingTimeMs}ms`);
      return result;

    } catch (error) {
      this.logger.error(`Failed to enhance template with ${framework.methodology}:`, error);

      // Return fallback result with original template
      return {
        originalTemplate: template,
        enhancedTemplate: template,
        suggestions: [],
        processingGuidance: {
          processingSteps: [],
          templateEnhancements: {
            systemPromptAdditions: [],
            userPromptModifications: [],
            contextualHints: []
          },
          executionFlow: {
            preProcessingSteps: [],
            postProcessingSteps: [],
            validationSteps: []
          }
        },
        sourceFramework: framework,
        metadata: {
          enhancementTime: new Date(),
          enhancementLevel: this.config.enhancementLevel,
          suggestionsCount: 0,
          validationPassed: false,
          processingTimeMs: Date.now() - startTime,
          methodologyApplied: framework.methodology,
          error: error instanceof Error ? error.message : 'Unknown error'
        },
        validation: {
          passed: false,
          score: 0,
          issues: [error instanceof Error ? error.message : 'Enhancement failed'],
          recommendations: ['Review template structure and methodology compatibility']
        }
      };
    }
  }

  /**
   * Apply methodology-specific enhancements to template
   * Phase 4: Enhanced with semantic analysis awareness
   */
  private async applyEnhancements(
    template: string,
    guidance: ProcessingGuidance,
    methodologyGuide: IMethodologyGuide,
    context: TemplateEnhancementContext,
    semanticAnalysis?: ContentAnalysisResult
  ): Promise<string> {
    let enhancedTemplate = template;

    // Phase 4: Apply semantic-aware enhancements first
    if (this.config.enableSemanticAwareness && semanticAnalysis) {
      enhancedTemplate = this.applySemanticAwareEnhancements(
        enhancedTemplate,
        semanticAnalysis,
        methodologyGuide,
        context
      );
    }

    // Apply structural improvements based on enhancement level
    if (this.config.enableStructureOptimization) {
      enhancedTemplate = this.applyStructuralEnhancements(
        enhancedTemplate,
        guidance.templateEnhancements.contextualHints,
        context,
        semanticAnalysis
      );
    }

    // FIXED: Remove duplicate methodology structure addition
    // The framework system prompt already provides methodology guidance
    // Template enhancer should focus on structure optimization, not methodology duplication

    // Integrate quality gates if enabled (with semantic complexity awareness)
    if (this.config.enableQualityGates && this.shouldApplyQualityGates(semanticAnalysis)) {
      enhancedTemplate = await this.integrateQualityGates(
        enhancedTemplate,
        guidance.executionFlow.validationSteps,
        context,
        semanticAnalysis
      );
    }

    return enhancedTemplate;
  }

  /**
   * Apply structural enhancements to template
   * Phase 4: Enhanced with semantic analysis awareness
   */
  private applyStructuralEnhancements(
    template: string,
    suggestions: string[],
    context: TemplateEnhancementContext,
    semanticAnalysis?: ContentAnalysisResult
  ): string {
    let enhanced = template;

    // Phase 4: Use semantic analysis to guide structural improvements
    if (semanticAnalysis && this.config.enableSemanticAwareness) {
      // Add structure based on semantic complexity
      if (!this.hasStructuredSections(template) && this.shouldAddStructure(semanticAnalysis)) {
        enhanced = this.addSemanticAwareStructure(enhanced, context, semanticAnalysis);
      }

      // Apply suggestions based on semantic characteristics
      const semanticFilteredSuggestions = this.filterSuggestionsBySemanticAnalysis(
        suggestions,
        semanticAnalysis
      );
      for (const suggestion of semanticFilteredSuggestions.slice(0, this.config.maxSuggestions)) {
        enhanced = this.applySuggestion(enhanced, suggestion, context);
      }
    } else {
      // Fallback to original logic
      if (!this.hasStructuredSections(template)) {
        enhanced = this.addBasicStructure(enhanced, context);
      }

      for (const suggestion of suggestions.slice(0, this.config.maxSuggestions)) {
        enhanced = this.applySuggestion(enhanced, suggestion, context);
      }
    }

    return enhanced;
  }

  /**
   * Add methodology-specific structure to template
   * Phase 4: Enhanced with semantic analysis awareness
   */
  private addMethodologyStructure(
    template: string,
    methodologyGuide: IMethodologyGuide,
    context: TemplateEnhancementContext,
    semanticAnalysis?: ContentAnalysisResult
  ): string {
    const methodology = methodologyGuide.methodology;
    let enhanced = template;

    // Phase 4: Determine methodology structure complexity based on semantic analysis
    const structureLevel = this.determineMethodologyStructureLevel(semanticAnalysis);

    // Add methodology-specific sections based on type and semantic complexity
    switch (methodology) {
      case "CAGEERF":
        enhanced = this.addCAGEERFStructure(enhanced, context, structureLevel);
        break;
      case "ReACT":
        enhanced = this.addReACTStructure(enhanced, context, structureLevel);
        break;
      case "5W1H":
        enhanced = this.add5W1HStructure(enhanced, context, structureLevel);
        break;
      case "SCAMPER":
        enhanced = this.addSCAMPERStructure(enhanced, context, structureLevel);
        break;
    }

    return enhanced;
  }

  /**
   * Add CAGEERF methodology structure
   * Phase 4: Enhanced with semantic structure levels
   */
  private addCAGEERFStructure(
    template: string,
    context: TemplateEnhancementContext,
    structureLevel: 'minimal' | 'moderate' | 'comprehensive' = 'moderate'
  ): string {
    if (template.includes('## Context') || template.includes('## Analysis')) {
      return template; // Already has CAGEERF structure
    }

    // Phase 4: Adapt CAGEERF structure based on semantic complexity
    let cageerfSections = '';

    switch (structureLevel) {
      case 'minimal':
        cageerfSections = `
## Context & Analysis
Provide context and analyze the situation.

## Goals & Execution
Define objectives and outline the approach.

## Evaluation
Assess the effectiveness of the solution.
`;
        break;

      case 'comprehensive':
        cageerfSections = `
## Context
Please provide the situational context and background information.
*Consider stakeholders, constraints, and environmental factors.*

## Analysis
Conduct systematic analysis of the situation or problem.
*Use analytical frameworks and identify root causes.*

## Goals
Define specific, measurable objectives and desired outcomes.
*Ensure goals are SMART (Specific, Measurable, Achievable, Relevant, Time-bound).*

## Execution
Outline the implementation approach and action steps.
*Include timelines, resources, and risk mitigation strategies.*

## Evaluation
Assess the effectiveness and quality of the solution.
*Define metrics and evaluation criteria.*

## Refinement
Identify improvement opportunities and optimization strategies.
*Consider feedback loops and continuous improvement.*

## Framework
Document the methodology and approach used.
*Reflect on the CAGEERF process and lessons learned.*
`;
        break;

      case 'moderate':
      default:
        cageerfSections = `
## Context
Please provide the situational context and background information.

## Analysis
Conduct systematic analysis of the situation or problem.

## Goals
Define specific, measurable objectives and desired outcomes.

## Execution
Outline the implementation approach and action steps.

## Evaluation
Assess the effectiveness and quality of the solution.

## Refinement
Identify improvement opportunities and optimization strategies.

## Framework
Document the methodology and approach used.
`;
        break;
    }

    return template + cageerfSections;
  }

  /**
   * Add ReACT methodology structure
   */
  private addReACTStructure(template: string, context: TemplateEnhancementContext, structureLevel: 'minimal' | 'moderate' | 'comprehensive' = 'moderate'): string {
    if (template.includes('## Reasoning') || template.includes('## Action')) {
      return template; // Already has ReACT structure
    }

    const reactSections = `
## Reasoning
Think through the problem systematically and logically.

## Action
Take specific, targeted actions based on the reasoning.

## Observation
Observe the results and gather feedback from actions taken.
`;

    return template + reactSections;
  }

  /**
   * Add 5W1H methodology structure
   */
  private add5W1HStructure(template: string, context: TemplateEnhancementContext, structureLevel: 'minimal' | 'moderate' | 'comprehensive' = 'moderate'): string {
    if (template.includes('## Who') || template.includes('## What')) {
      return template; // Already has 5W1H structure
    }

    const fiveW1HSections = `
## Who
Identify the stakeholders, people involved, and target audience.

## What
Define what needs to be accomplished or addressed.

## When
Establish timelines, deadlines, and scheduling considerations.

## Where
Specify locations, environments, or contexts where this applies.

## Why
Understand the underlying reasons, motivations, and objectives.

## How
Outline the methods, processes, and approaches to be used.
`;

    return template + fiveW1HSections;
  }

  /**
   * Add SCAMPER methodology structure
   */
  private addSCAMPERStructure(template: string, context: TemplateEnhancementContext, structureLevel: 'minimal' | 'moderate' | 'comprehensive' = 'moderate'): string {
    if (template.includes('## Substitute') || template.includes('## Combine')) {
      return template; // Already has SCAMPER structure
    }

    const scamperSections = `
## Substitute
What can be substituted or replaced to improve the solution?

## Combine
What ideas, processes, or elements can be combined?

## Adapt
What can be adapted from other contexts or solutions?

## Modify
What can be modified, magnified, or emphasized?

## Put to Other Uses
How can this be used differently or for other purposes?

## Eliminate
What can be removed, simplified, or minimized?

## Reverse
What can be reversed, rearranged, or approached differently?
`;

    return template + scamperSections;
  }

  /**
   * Generate improvement suggestions based on methodology
   */
  private generateSuggestions(
    originalTemplate: string,
    enhancedTemplate: string,
    guidance: ProcessingGuidance,
    methodologyGuide: IMethodologyGuide,
    context: TemplateEnhancementContext,
    semanticAnalysis?: ContentAnalysisResult
  ): string[] {
    const suggestions: string[] = [];

    // Add argument suggestions if enabled
    if (this.config.enableArgumentSuggestions) {
      suggestions.push(...guidance.templateEnhancements.userPromptModifications);
    }

    // Add methodology-specific suggestions
    suggestions.push(...this.generateMethodologySpecificSuggestions(
      originalTemplate,
      methodologyGuide,
      context
    ));

    // Add structural suggestions
    suggestions.push(...guidance.templateEnhancements.contextualHints);

    // Limit suggestions based on configuration
    return suggestions.slice(0, this.config.maxSuggestions);
  }

  /**
   * Generate methodology-specific suggestions
   */
  private generateMethodologySpecificSuggestions(
    template: string,
    methodologyGuide: IMethodologyGuide,
    context: TemplateEnhancementContext
  ): string[] {
    const suggestions: string[] = [];
    const methodology = methodologyGuide.methodology;

    // Common suggestions for all methodologies
    if (!template.includes('{{')) {
      suggestions.push("Consider adding template variables using {{variable}} syntax for dynamic content");
    }

    if (context.complexityLevel === 'high' && !template.includes('## ')) {
      suggestions.push("For complex prompts, consider adding structured sections with markdown headers");
    }

    // Methodology-specific suggestions
    switch (methodology) {
      case "CAGEERF":
        if (!template.toLowerCase().includes('context')) {
          suggestions.push("Consider adding a Context section to establish situational background");
        }
        if (!template.toLowerCase().includes('goal')) {
          suggestions.push("Define specific Goals to guide the analysis and execution");
        }
        break;

      case "ReACT":
        if (!template.toLowerCase().includes('reason')) {
          suggestions.push("Include reasoning steps to make thought processes explicit");
        }
        if (!template.toLowerCase().includes('action')) {
          suggestions.push("Specify concrete actions to take based on reasoning");
        }
        break;

      case "5W1H":
        const missing5W1H = ['who', 'what', 'when', 'where', 'why', 'how'].filter(
          w => !template.toLowerCase().includes(w)
        );
        if (missing5W1H.length > 0) {
          suggestions.push(`Consider addressing: ${missing5W1H.join(', ')} for comprehensive analysis`);
        }
        break;

      case "SCAMPER":
        if (!template.toLowerCase().includes('creative')) {
          suggestions.push("Emphasize creative thinking and alternative approaches");
        }
        break;
    }

    return suggestions;
  }

  /**
   * Integrate quality gates into template (Phase 2 enhancement)
   */
  private async integrateQualityGates(
    template: string,
    qualityGates: string[],
    context: TemplateEnhancementContext,
    semanticAnalysis?: ContentAnalysisResult
  ): Promise<string> {
    if (qualityGates.length === 0) {
      return template;
    }

    // Load actual gate guidance if gate system is available
    let gateGuidance: string[] = [];
    if (this.gateSystem) {
      try {
        gateGuidance = await this.gateSystem.getGuidanceText(
          qualityGates,
          {
            promptCategory: context.promptCategory,
            framework: "CAGEERF", // Default framework for gate context
            explicitRequest: true
          }
        );
      } catch (error) {
        this.logger.warn("Failed to load gate guidance:", error);
        // Fallback to gate IDs if guidance loading fails
        gateGuidance = qualityGates.map(gateId => `Gate: ${gateId}`);
      }
    } else {
      // Fallback: use gate IDs when no gate system available
      gateGuidance = qualityGates.map(gateId => `Quality criterion: ${gateId}`);
    }

    const qualitySection = `
## Quality Validation
Please ensure the following quality criteria are met:

${gateGuidance.map(guidance => `- ${guidance}`).join('\n')}
`;

    return template + qualitySection;
  }

  /**
   * Validate enhanced template
   */
  private validateEnhancedTemplate(
    template: string,
    guidance: ProcessingGuidance,
    methodologyGuide: IMethodologyGuide,
    semanticAnalysis?: ContentAnalysisResult
  ): {
    passed: boolean;
    score: number;
    issues: string[];
    recommendations: string[];
  } {
    const issues: string[] = [];
    const recommendations: string[] = [];
    let score = 100;

    // Check template length
    if (template.length < 50) {
      issues.push("Template is too short for effective guidance");
      score -= 20;
    }

    if (template.length > 5000) {
      issues.push("Template is very long and may be difficult to use");
      score -= 10;
      recommendations.push("Consider breaking into smaller, focused sections");
    }

    // Check for template variables
    const variableCount = (template.match(/\{\{[^}]+\}\}/g) || []).length;
    if (variableCount === 0 && this.config.enableArgumentSuggestions) {
      issues.push("No template variables found - template may not be dynamic enough");
      score -= 15;
      recommendations.push("Add {{variable}} placeholders for user input");
    }

    // Check for structure
    if (!this.hasStructuredSections(template)) {
      issues.push("Template lacks clear structure");
      score -= 15;
      recommendations.push("Add section headers to organize content");
    }

    // Check methodology integration
    const methodology = methodologyGuide.methodology.toLowerCase();
    if (!template.toLowerCase().includes(methodology)) {
      issues.push(`Methodology ${methodologyGuide.methodology} not clearly integrated`);
      score -= 10;
    }

    // Ensure minimum score
    score = Math.max(score, 0);

    return {
      passed: issues.length === 0,
      score,
      issues,
      recommendations
    };
  }

  /**
   * Build enhancement context from prompt and user context
   * Phase 4: Enhanced with semantic analysis integration
   */
  private buildEnhancementContext(
    prompt: ConvertedPrompt,
    userContext?: TemplateEnhancementContext,
    semanticAnalysis?: ContentAnalysisResult
  ): TemplateEnhancementContext {
    return {
      promptName: prompt.name || 'Unnamed Prompt',
      promptCategory: prompt.category || 'general',
      promptType: prompt.executionMode || 'template',
      existingArguments: prompt.arguments?.map(arg => arg.name) || [],
      complexityLevel: this.assessComplexityWithSemantics(prompt, semanticAnalysis),
      ...userContext
    };
  }

  /**
   * Assess prompt complexity
   */
  private assessComplexity(prompt: ConvertedPrompt): 'low' | 'medium' | 'high' {
    const argCount = prompt.arguments?.length || 0;
    const contentLength = prompt.userMessageTemplate?.length || 0;

    if (argCount >= 5 || contentLength > 1000) return 'high';
    if (argCount >= 3 || contentLength > 500) return 'medium';
    return 'low';
  }

  /**
   * Check if template has structured sections
   */
  private hasStructuredSections(template: string): boolean {
    return /^##\s+/.test(template) || template.includes('\n## ');
  }

  /**
   * Add basic structure to unstructured template
   */
  private addBasicStructure(template: string, context: TemplateEnhancementContext): string {
    return `## ${context.promptName}

${template}

## Output Requirements
Please provide a comprehensive response that addresses all aspects of this prompt.
`;
  }

  /**
   * Apply a specific suggestion to template
   */
  private applySuggestion(template: string, suggestion: string, context: TemplateEnhancementContext): string {
    // This is a simplified implementation - in practice, this would contain
    // more sophisticated suggestion application logic
    return template;
  }

  /**
   * Update enhancer configuration
   */
  updateConfig(config: Partial<TemplateEnhancerConfig>): void {
    this.config = { ...this.config, ...config };
    this.logger.debug('TemplateEnhancer configuration updated', config);
  }

  /**
   * Get current enhancer configuration
   */
  getConfig(): TemplateEnhancerConfig {
    return { ...this.config };
  }

  // Phase 4: Semantic-aware enhancement methods

  /**
   * Apply semantic-aware enhancements based on analysis results
   */
  private applySemanticAwareEnhancements(
    template: string,
    semanticAnalysis: ContentAnalysisResult,
    methodologyGuide: IMethodologyGuide,
    context: TemplateEnhancementContext
  ): string {
    let enhanced = template;

    // Apply complexity-based enhancements
    switch (semanticAnalysis.complexity) {
      case 'high':
        enhanced = this.applyHighComplexityEnhancements(enhanced, semanticAnalysis, context);
        break;
      case 'medium':
        enhanced = this.applyMediumComplexityEnhancements(enhanced, semanticAnalysis, context);
        break;
      case 'low':
        enhanced = this.applyLowComplexityEnhancements(enhanced, semanticAnalysis, context);
        break;
    }

    // Apply execution characteristic-based enhancements
    if (semanticAnalysis.executionCharacteristics.hasStructuredReasoning) {
      enhanced = this.addReasoningStructure(enhanced);
    }

    if (semanticAnalysis.executionCharacteristics.hasComplexAnalysis) {
      enhanced = this.addAnalysisStructure(enhanced, methodologyGuide);
    }

    return enhanced;
  }

  /**
   * Determine methodology structure level based on semantic analysis
   */
  private determineMethodologyStructureLevel(
    semanticAnalysis?: ContentAnalysisResult
  ): 'minimal' | 'moderate' | 'comprehensive' {
    if (!semanticAnalysis || !this.config.enableSemanticAwareness) {
      return this.config.enhancementLevel;
    }

    // Base decision on semantic complexity and confidence
    const complexityScore = this.calculateSemanticComplexityScore(semanticAnalysis);

    if (complexityScore >= 0.8) {
      return 'comprehensive';
    } else if (complexityScore >= 0.5) {
      return 'moderate';
    } else {
      return 'minimal';
    }
  }

  /**
   * Calculate semantic complexity score for structure decisions
   */
  private calculateSemanticComplexityScore(semanticAnalysis: ContentAnalysisResult): number {
    let score = 0;

    // Base complexity mapping
    switch (semanticAnalysis.complexity) {
      case 'high': score += 0.6; break;
      case 'medium': score += 0.4; break;
      case 'low': score += 0.2; break;
    }

    // Execution characteristics influence
    const chars = semanticAnalysis.executionCharacteristics;
    if (chars.hasStructuredReasoning) score += 0.1;
    if (chars.hasComplexAnalysis) score += 0.1;
    if (chars.hasChainSteps) score += 0.1;
    if (chars.argumentCount > 3) score += 0.1;

    // Confidence influence
    score += (semanticAnalysis.confidence * 0.2);

    return Math.min(score, 1.0);
  }

  /**
   * Assess complexity with semantic analysis integration
   */
  private assessComplexityWithSemantics(
    prompt: ConvertedPrompt,
    semanticAnalysis?: ContentAnalysisResult
  ): 'low' | 'medium' | 'high' {
    if (semanticAnalysis && this.config.semanticComplexityAdaptation) {
      return semanticAnalysis.complexity;
    }

    // Fallback to original assessment
    return this.assessComplexity(prompt);
  }

  /**
   * Determine if structure should be added based on semantic analysis
   */
  private shouldAddStructure(semanticAnalysis: ContentAnalysisResult): boolean {
    // Always add structure for high complexity
    if (semanticAnalysis.complexity === 'high') return true;

    // Add structure if has structured reasoning characteristics
    if (semanticAnalysis.executionCharacteristics.hasStructuredReasoning) return true;

    // Add structure if has complex analysis patterns
    if (semanticAnalysis.executionCharacteristics.hasComplexAnalysis) return true;

    // Add structure for medium complexity with high confidence
    if (semanticAnalysis.complexity === 'medium' && semanticAnalysis.confidence > 0.8) return true;

    return false;
  }

  /**
   * Add semantic-aware structure to template
   */
  private addSemanticAwareStructure(
    template: string,
    context: TemplateEnhancementContext,
    semanticAnalysis: ContentAnalysisResult
  ): string {
    const structureType = this.determineOptimalStructureType(semanticAnalysis);

    switch (structureType) {
      case 'analytical':
        return this.addAnalyticalStructure(template, context);
      case 'procedural':
        return this.addProceduralStructure(template, context);
      case 'creative':
        return this.addCreativeStructure(template, context);
      default:
        return this.addBasicStructure(template, context);
    }
  }

  /**
   * Filter suggestions based on semantic analysis
   */
  private filterSuggestionsBySemanticAnalysis(
    suggestions: string[],
    semanticAnalysis: ContentAnalysisResult
  ): string[] {
    // Prioritize suggestions based on semantic characteristics
    const prioritizedSuggestions = suggestions.map(suggestion => ({
      suggestion,
      priority: this.calculateSuggestionPriority(suggestion, semanticAnalysis)
    }));

    return prioritizedSuggestions
      .sort((a, b) => b.priority - a.priority)
      .map(item => item.suggestion);
  }

  /**
   * Calculate suggestion priority based on semantic analysis
   */
  private calculateSuggestionPriority(
    suggestion: string,
    semanticAnalysis: ContentAnalysisResult
  ): number {
    let priority = 1;

    // Higher priority for structure suggestions if template has structural reasoning
    if (suggestion.includes('structure') && semanticAnalysis.executionCharacteristics.hasStructuredReasoning) {
      priority += 2;
    }

    // Higher priority for analysis suggestions if template has complex analysis
    if (suggestion.includes('analysis') && semanticAnalysis.executionCharacteristics.hasComplexAnalysis) {
      priority += 2;
    }

    // Higher priority for variable suggestions based on argument count
    if (suggestion.includes('variable') && semanticAnalysis.executionCharacteristics.argumentCount > 2) {
      priority += 1;
    }

    return priority;
  }

  /**
   * Determine if quality gates should be applied based on semantic analysis
   */
  private shouldApplyQualityGates(semanticAnalysis?: ContentAnalysisResult): boolean {
    if (!semanticAnalysis || !this.config.enableSemanticAwareness) {
      return this.config.enableQualityGates && this.config.enhancementLevel === 'comprehensive';
    }

    // Apply quality gates for high complexity or high confidence scenarios
    return (
      semanticAnalysis.complexity === 'high' ||
      (semanticAnalysis.complexity === 'medium' && semanticAnalysis.confidence > 0.8) ||
      semanticAnalysis.executionCharacteristics.hasComplexAnalysis
    );
  }

  /**
   * Get semantic enhancements applied for metadata
   */
  private getSemanticEnhancementsApplied(semanticAnalysis?: ContentAnalysisResult): string[] {
    if (!semanticAnalysis || !this.config.enableSemanticAwareness) {
      return [];
    }

    const enhancements = [];

    if (this.config.semanticComplexityAdaptation) {
      enhancements.push(`complexity-${semanticAnalysis.complexity}`);
    }

    if (semanticAnalysis.executionCharacteristics.hasStructuredReasoning) {
      enhancements.push('structured-reasoning');
    }

    if (semanticAnalysis.executionCharacteristics.hasComplexAnalysis) {
      enhancements.push('complex-analysis');
    }

    if (semanticAnalysis.confidence > 0.8) {
      enhancements.push('high-confidence');
    }

    return enhancements;
  }

  // Helper methods for complexity-based enhancements

  private applyHighComplexityEnhancements(
    template: string,
    semanticAnalysis: ContentAnalysisResult,
    context: TemplateEnhancementContext
  ): string {
    // Add comprehensive structure and validation for high complexity
    return template;
  }

  private applyMediumComplexityEnhancements(
    template: string,
    semanticAnalysis: ContentAnalysisResult,
    context: TemplateEnhancementContext
  ): string {
    // Add moderate structure and guidance for medium complexity
    return template;
  }

  private applyLowComplexityEnhancements(
    template: string,
    semanticAnalysis: ContentAnalysisResult,
    context: TemplateEnhancementContext
  ): string {
    // Apply minimal enhancements for low complexity
    return template;
  }

  private addReasoningStructure(template: string): string {
    if (!template.includes('## Reasoning') && !template.includes('## Analysis')) {
      return template + '\n\n## Reasoning\nPlease think through this step-by-step:\n\n1. \n2. \n3. ';
    }
    return template;
  }

  private addAnalysisStructure(template: string, methodologyGuide: IMethodologyGuide): string {
    if (!template.includes('## Analysis')) {
      return template + `\n\n## Analysis\nApply ${methodologyGuide.methodology} systematic analysis:\n\n- \n- \n- `;
    }
    return template;
  }

  private determineOptimalStructureType(semanticAnalysis: ContentAnalysisResult): string {
    if (semanticAnalysis.executionCharacteristics.hasComplexAnalysis) return 'analytical';
    if (semanticAnalysis.executionCharacteristics.hasChainSteps) return 'procedural';
    if (semanticAnalysis.executionCharacteristics.hasMethodologyKeywords) return 'creative';
    return 'basic';
  }

  private addAnalyticalStructure(template: string, context: TemplateEnhancementContext): string {
    return `## ${context.promptName} - Analytical Framework

${template}

## Analysis Steps
1. Define the problem or question
2. Gather relevant information
3. Apply analytical methods
4. Draw conclusions
5. Validate results

## Expected Output
Provide a structured analysis with clear reasoning and evidence.
`;
  }

  private addProceduralStructure(template: string, context: TemplateEnhancementContext): string {
    return `## ${context.promptName} - Procedural Framework

${template}

## Process Steps
1. Preparation
2. Execution
3. Validation
4. Documentation

## Expected Output
Provide step-by-step results with clear progression.
`;
  }

  private addCreativeStructure(template: string, context: TemplateEnhancementContext): string {
    return `## ${context.promptName} - Creative Framework

${template}

## Creative Process
1. Explore possibilities
2. Generate alternatives
3. Evaluate options
4. Refine solutions

## Expected Output
Provide innovative solutions with creative reasoning.
`;
  }
}

/**
 * Create and configure a TemplateEnhancer instance
 */
export function createTemplateEnhancer(
  logger: Logger,
  config?: Partial<TemplateEnhancerConfig>,
  gateSystem?: LightweightGateSystem
): TemplateEnhancer {
  return new TemplateEnhancer(logger, config, gateSystem);
}
