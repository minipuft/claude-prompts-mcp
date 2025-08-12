/**
 * CAGEERF Template Generator
 * Systematic and creative prompt template generation following C.A.G.E.E.R.F methodology
 * Provides intelligent template creation, enhancement, and validation capabilities
 */

import { ConvertedPrompt, PromptData } from "../types/index.js";
import { CAGEERFAnalyzer, CAGEERFAnalysis, TemplateEnhancement } from "./cageerf-analyzer.js";
import { TemplateRepositoryBuilder } from "./template-repository.js";

export interface TemplateGenerationRequest {
  useCase: string;
  domain: string;
  complexity: 'simple' | 'intermediate' | 'advanced' | 'expert';
  frameworkEmphasis: {
    context: boolean;
    analysis: boolean;
    goals: boolean;
    execution: boolean;
    evaluation: boolean;
    refinement: boolean;
    framework: boolean;
  };
  templateStyle: 'structured' | 'conversational' | 'academic' | 'professional' | 'creative';
  includePlaceholders: boolean;
  includeChainSteps?: boolean;
  customRequirements?: string[];
}

export interface GeneratedTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  systemMessage?: string;
  userMessageTemplate: string;
  arguments: Array<{
    name: string;
    description?: string;
    required: boolean;
    cageerfComponent?: keyof TemplateGenerationRequest['frameworkEmphasis'];
  }>;
  cageerfCompliance: CAGEERFAnalysis;
  qualityScore: number;
  enhancementSuggestions: TemplateEnhancement[];
  variations?: TemplateVariation[];
}

export interface TemplateVariation {
  name: string;
  description: string;
  modifications: string[];
  userMessageTemplate: string;
  systemMessage?: string;
}

export interface TemplateRepository {
  templates: TemplatePattern[];
  categories: TemplateCategory[];
}

export interface TemplatePattern {
  id: string;
  name: string;
  description: string;
  category: string;
  complexity: TemplateGenerationRequest['complexity'];
  cageerfComponents: (keyof TemplateGenerationRequest['frameworkEmphasis'])[];
  baseTemplate: string;
  systemMessageTemplate?: string;
  placeholders: TemplatePlaceholder[];
  useCases: string[];
}

export interface TemplatePlaceholder {
  name: string;
  description: string;
  required: boolean;
  cageerfComponent: keyof TemplateGenerationRequest['frameworkEmphasis'];
  defaultValue?: string;
  examples?: string[];
}

export interface TemplateCategory {
  id: string;
  name: string;
  description: string;
  cageerfFocus: (keyof TemplateGenerationRequest['frameworkEmphasis'])[];
  commonUseCases: string[];
}

/**
 * Advanced Template Generator with CAGEERF framework integration
 */
export class TemplateGenerator {
  private cageerfAnalyzer: CAGEERFAnalyzer;
  private repository: TemplateRepository;

  constructor() {
    this.cageerfAnalyzer = new CAGEERFAnalyzer();
    this.repository = TemplateRepositoryBuilder.buildRepository();
  }

  /**
   * Generate a new prompt template based on CAGEERF methodology
   */
  async generateTemplate(request: TemplateGenerationRequest): Promise<GeneratedTemplate> {
    // Find best matching template pattern
    const basePattern = this.findBestTemplatePattern(request);
    
    // Generate template content
    const templateContent = this.buildTemplateContent(request, basePattern);
    
    // Create template structure
    const generatedTemplate: Omit<GeneratedTemplate, 'cageerfCompliance' | 'qualityScore' | 'enhancementSuggestions' | 'variations'> = {
      id: this.generateTemplateId(request),
      name: this.generateTemplateName(request),
      description: this.generateTemplateDescription(request),
      category: this.determineCategory(request),
      systemMessage: templateContent.systemMessage,
      userMessageTemplate: templateContent.userMessageTemplate,
      arguments: templateContent.arguments
    };

    // Create temporary ConvertedPrompt for analysis
    const tempPrompt: ConvertedPrompt = {
      id: generatedTemplate.id,
      name: generatedTemplate.name,
      description: generatedTemplate.description,
      category: generatedTemplate.category,
      systemMessage: generatedTemplate.systemMessage,
      userMessageTemplate: generatedTemplate.userMessageTemplate,
      arguments: generatedTemplate.arguments.map(arg => ({
        name: arg.name,
        description: arg.description,
        required: arg.required
      })),
      isChain: false,
      chainSteps: []
    };

    // Analyze CAGEERF compliance
    const cageerfCompliance = this.cageerfAnalyzer.analyzePrompt(tempPrompt);
    
    // Calculate quality score
    const qualityScore = this.calculateQualityScore(cageerfCompliance, request);
    
    // Generate enhancement suggestions
    const enhancementSuggestions = cageerfCompliance.templateSuggestions;
    
    // Generate variations
    const variations = this.generateTemplateVariations(generatedTemplate, request);

    return {
      ...generatedTemplate,
      cageerfCompliance,
      qualityScore,
      enhancementSuggestions,
      variations
    };
  }

  /**
   * Enhance an existing template with CAGEERF compliance
   */
  async enhanceTemplate(prompt: ConvertedPrompt, targetCompliance?: Partial<TemplateGenerationRequest['frameworkEmphasis']>): Promise<GeneratedTemplate> {
    // Analyze current compliance
    const currentAnalysis = this.cageerfAnalyzer.analyzePrompt(prompt);
    
    // Determine enhancement areas
    const enhancementAreas = this.identifyEnhancementAreas(currentAnalysis, targetCompliance);
    
    // Apply enhancements
    const enhancedTemplate = this.applyEnhancements(prompt, enhancementAreas, currentAnalysis);
    
    return enhancedTemplate;
  }

  /**
   * Generate creative template variations
   */
  generateTemplateVariations(baseTemplate: Omit<GeneratedTemplate, 'cageerfCompliance' | 'qualityScore' | 'enhancementSuggestions' | 'variations'>, request: TemplateGenerationRequest): TemplateVariation[] {
    const variations: TemplateVariation[] = [];

    // Style variations
    const styles: TemplateGenerationRequest['templateStyle'][] = ['structured', 'conversational', 'academic', 'professional', 'creative'];
    
    styles.forEach(style => {
      if (style !== request.templateStyle) {
        const variation = this.createStyleVariation(baseTemplate, style, request);
        if (variation) {
          variations.push(variation);
        }
      }
    });

    // Complexity variations
    const complexities: TemplateGenerationRequest['complexity'][] = ['simple', 'intermediate', 'advanced', 'expert'];
    
    complexities.forEach(complexity => {
      if (complexity !== request.complexity) {
        const variation = this.createComplexityVariation(baseTemplate, complexity, request);
        if (variation) {
          variations.push(variation);
        }
      }
    });

    // Framework emphasis variations
    const focusVariations = this.createFrameworkFocusVariations(baseTemplate, request);
    variations.push(...focusVariations);

    return variations.slice(0, 5); // Limit to top 5 variations
  }

  /**
   * Find the best matching template pattern for the request
   */
  private findBestTemplatePattern(request: TemplateGenerationRequest): TemplatePattern {
    const patterns = this.repository.templates;
    
    // Score patterns based on request criteria
    const scoredPatterns = patterns.map(pattern => ({
      pattern,
      score: this.scorePatternMatch(pattern, request)
    }));

    // Sort by score and return best match
    scoredPatterns.sort((a, b) => b.score - a.score);
    
    return scoredPatterns[0]?.pattern || this.getDefaultPattern(request);
  }

  /**
   * Score how well a pattern matches the request
   */
  private scorePatternMatch(pattern: TemplatePattern, request: TemplateGenerationRequest): number {
    let score = 0;

    // Complexity match
    if (pattern.complexity === request.complexity) {
      score += 30;
    } else {
      const complexityOrder = ['simple', 'intermediate', 'advanced', 'expert'];
      const patternIndex = complexityOrder.indexOf(pattern.complexity);
      const requestIndex = complexityOrder.indexOf(request.complexity);
      score += Math.max(0, 20 - Math.abs(patternIndex - requestIndex) * 5);
    }

    // CAGEERF component alignment
    const requestComponents = Object.entries(request.frameworkEmphasis)
      .filter(([_, enabled]) => enabled)
      .map(([component, _]) => component as keyof TemplateGenerationRequest['frameworkEmphasis']);
    
    const matchingComponents = pattern.cageerfComponents.filter(comp => 
      requestComponents.includes(comp)
    );
    
    score += matchingComponents.length * 10;

    // Use case relevance
    const useCaseMatch = pattern.useCases.some(useCase => 
      request.useCase.toLowerCase().includes(useCase.toLowerCase()) ||
      useCase.toLowerCase().includes(request.useCase.toLowerCase())
    );
    
    if (useCaseMatch) {
      score += 25;
    }

    // Domain relevance
    if (pattern.description.toLowerCase().includes(request.domain.toLowerCase())) {
      score += 15;
    }

    return score;
  }

  /**
   * Build template content based on request and base pattern
   */
  private buildTemplateContent(request: TemplateGenerationRequest, basePattern: TemplatePattern): {
    systemMessage?: string;
    userMessageTemplate: string;
    arguments: GeneratedTemplate['arguments'];
  } {
    let userMessageTemplate = basePattern.baseTemplate;
    let systemMessage = basePattern.systemMessageTemplate;
    const templateArguments: GeneratedTemplate['arguments'] = [];

    // Apply CAGEERF components
    const cageerfSections = this.buildCageerfSections(request);
    
    // Integrate CAGEERF sections into template
    userMessageTemplate = this.integrateCageerfSections(userMessageTemplate, cageerfSections, request);
    
    // Apply style transformations
    userMessageTemplate = this.applyStyleTransformation(userMessageTemplate, request.templateStyle);
    systemMessage = systemMessage ? this.applyStyleTransformation(systemMessage, request.templateStyle) : undefined;
    
    // Generate arguments based on placeholders and CAGEERF components
    basePattern.placeholders.forEach(placeholder => {
      templateArguments.push({
        name: placeholder.name,
        description: placeholder.description,
        required: placeholder.required,
        cageerfComponent: placeholder.cageerfComponent
      });
    });

    // Add CAGEERF-specific arguments
    Object.entries(request.frameworkEmphasis).forEach(([component, enabled]) => {
      if (enabled) {
        const cageerfArg = this.generateCageerfArgument(component as keyof TemplateGenerationRequest['frameworkEmphasis']);
        if (cageerfArg && !templateArguments.some(arg => arg.name === cageerfArg.name)) {
          templateArguments.push(cageerfArg);
        }
      }
    });

    return {
      systemMessage,
      userMessageTemplate,
      arguments: templateArguments
    };
  }

  /**
   * Build CAGEERF framework sections
   */
  private buildCageerfSections(request: TemplateGenerationRequest): Record<string, string> {
    const sections: Record<string, string> = {};

    if (request.frameworkEmphasis.context) {
      sections.context = this.buildContextSection(request);
    }

    if (request.frameworkEmphasis.analysis) {
      sections.analysis = this.buildAnalysisSection(request);
    }

    if (request.frameworkEmphasis.goals) {
      sections.goals = this.buildGoalsSection(request);
    }

    if (request.frameworkEmphasis.execution) {
      sections.execution = this.buildExecutionSection(request);
    }

    if (request.frameworkEmphasis.evaluation) {
      sections.evaluation = this.buildEvaluationSection(request);
    }

    if (request.frameworkEmphasis.refinement) {
      sections.refinement = this.buildRefinementSection(request);
    }

    if (request.frameworkEmphasis.framework) {
      sections.framework = this.buildFrameworkSection(request);
    }

    return sections;
  }

  /**
   * Build Context section for CAGEERF
   */
  private buildContextSection(request: TemplateGenerationRequest): string {
    const contextTemplates = {
      simple: `## Context\nConsider the following context: {{context_description}}`,
      intermediate: `## Context & Environment\n**Situation**: {{context_description}}\n**Stakeholders**: {{stakeholders}}\n**Constraints**: {{constraints}}`,
      advanced: `## Contextual Framework\n**Environmental Context**: {{context_description}}\n**Stakeholder Analysis**: {{stakeholders}}\n**Operational Constraints**: {{constraints}}\n**Success Factors**: {{success_factors}}`,
      expert: `## Comprehensive Context Analysis\n**Environmental Landscape**: {{context_description}}\n**Stakeholder Ecosystem**: {{stakeholders}}\n**Strategic Constraints**: {{constraints}}\n**Success Criteria & KPIs**: {{success_factors}}\n**Risk Considerations**: {{risk_factors}}`
    };

    return contextTemplates[request.complexity];
  }

  /**
   * Build Analysis section for CAGEERF
   */
  private buildAnalysisSection(request: TemplateGenerationRequest): string {
    const analysisTemplates = {
      simple: `## Analysis\nAnalyze the following: {{analysis_target}}`,
      intermediate: `## Systematic Analysis\n**Primary Analysis**: {{analysis_target}}\n**Key Factors**: {{key_factors}}\n**Methodology**: {{analysis_method}}`,
      advanced: `## Comprehensive Analysis Framework\n**Analysis Target**: {{analysis_target}}\n**Critical Success Factors**: {{key_factors}}\n**Analytical Methodology**: {{analysis_method}}\n**Evaluation Criteria**: {{evaluation_criteria}}`,
      expert: `## Multi-Dimensional Analysis\n**Primary Analysis Focus**: {{analysis_target}}\n**Critical Success Factors**: {{key_factors}}\n**Analytical Methodology & Framework**: {{analysis_method}}\n**Evaluation Criteria & Metrics**: {{evaluation_criteria}}\n**Comparative Analysis**: {{comparative_elements}}\n**Risk & Opportunity Assessment**: {{risk_opportunity_factors}}`
    };

    return analysisTemplates[request.complexity];
  }

  /**
   * Build Goals section for CAGEERF
   */
  private buildGoalsSection(request: TemplateGenerationRequest): string {
    const goalsTemplates = {
      simple: `## Goals\n**Objective**: {{primary_goal}}`,
      intermediate: `## Goals & Objectives\n**Primary Goal**: {{primary_goal}}\n**Success Metrics**: {{success_metrics}}\n**Expected Outcomes**: {{expected_outcomes}}`,
      advanced: `## Strategic Goals Framework\n**Primary Objective**: {{primary_goal}}\n**Success Metrics & KPIs**: {{success_metrics}}\n**Expected Outcomes**: {{expected_outcomes}}\n**Secondary Goals**: {{secondary_goals}}\n**Milestone Targets**: {{milestone_targets}}`,
      expert: `## Comprehensive Goals Architecture\n**Strategic Objective**: {{primary_goal}}\n**Key Performance Indicators**: {{success_metrics}}\n**Expected Outcomes & Deliverables**: {{expected_outcomes}}\n**Secondary & Supporting Goals**: {{secondary_goals}}\n**Milestone Targets & Timelines**: {{milestone_targets}}\n**Success Validation Criteria**: {{validation_criteria}}\n**ROI & Value Metrics**: {{roi_metrics}}`
    };

    return goalsTemplates[request.complexity];
  }

  /**
   * Build Execution section for CAGEERF
   */
  private buildExecutionSection(request: TemplateGenerationRequest): string {
    const executionTemplates = {
      simple: `## Execution Steps\n1. {{step_1}}\n2. {{step_2}}\n3. {{step_3}}`,
      intermediate: `## Implementation Strategy\n**Phase 1**: {{phase_1_description}}\n   - {{phase_1_steps}}\n**Phase 2**: {{phase_2_description}}\n   - {{phase_2_steps}}\n**Phase 3**: {{phase_3_description}}\n   - {{phase_3_steps}}`,
      advanced: `## Strategic Execution Framework\n**Implementation Phases**:\n1. **Preparation Phase**: {{prep_phase}}\n   - {{prep_steps}}\n2. **Execution Phase**: {{exec_phase}}\n   - {{exec_steps}}\n3. **Validation Phase**: {{validation_phase}}\n   - {{validation_steps}}\n**Resource Requirements**: {{resources}}\n**Timeline & Dependencies**: {{timeline}}`,
      expert: `## Comprehensive Execution Architecture\n**Strategic Implementation Framework**:\n1. **Discovery & Preparation Phase**: {{prep_phase}}\n   - {{prep_steps}}\n   - {{prep_deliverables}}\n2. **Core Execution Phase**: {{exec_phase}}\n   - {{exec_steps}}\n   - {{exec_deliverables}}\n3. **Validation & Optimization Phase**: {{validation_phase}}\n   - {{validation_steps}}\n   - {{validation_deliverables}}\n**Resource Allocation**: {{resources}}\n**Timeline & Critical Path**: {{timeline}}\n**Risk Mitigation Strategies**: {{risk_mitigation}}\n**Quality Assurance Protocols**: {{qa_protocols}}`
    };

    return executionTemplates[request.complexity];
  }

  /**
   * Build Evaluation section for CAGEERF
   */
  private buildEvaluationSection(request: TemplateGenerationRequest): string {
    const evaluationTemplates = {
      simple: `## Evaluation\n**Success Criteria**: {{evaluation_criteria}}`,
      intermediate: `## Evaluation Framework\n**Quality Standards**: {{quality_standards}}\n**Success Metrics**: {{success_metrics}}\n**Validation Methods**: {{validation_methods}}`,
      advanced: `## Comprehensive Evaluation System\n**Quality Assurance Standards**: {{quality_standards}}\n**Performance Metrics**: {{success_metrics}}\n**Validation Methodologies**: {{validation_methods}}\n**Testing Protocols**: {{testing_protocols}}\n**Review Criteria**: {{review_criteria}}`,
      expert: `## Multi-Tier Evaluation Architecture\n**Quality Assurance Framework**: {{quality_standards}}\n**Performance Metrics & Benchmarks**: {{success_metrics}}\n**Validation Methodologies**: {{validation_methods}}\n**Comprehensive Testing Protocols**: {{testing_protocols}}\n**Review & Assessment Criteria**: {{review_criteria}}\n**Continuous Monitoring Systems**: {{monitoring_systems}}\n**Feedback Integration Mechanisms**: {{feedback_mechanisms}}\n**ROI & Value Assessment**: {{value_assessment}}`
    };

    return evaluationTemplates[request.complexity];
  }

  /**
   * Build Refinement section for CAGEERF
   */
  private buildRefinementSection(request: TemplateGenerationRequest): string {
    const refinementTemplates = {
      simple: `## Refinement\n**Improvement Areas**: {{improvement_areas}}`,
      intermediate: `## Iterative Refinement\n**Feedback Integration**: {{feedback_process}}\n**Optimization Opportunities**: {{optimization_areas}}\n**Continuous Improvement**: {{improvement_cycle}}`,
      advanced: `## Systematic Refinement Framework\n**Feedback Collection & Analysis**: {{feedback_process}}\n**Optimization Identification**: {{optimization_areas}}\n**Continuous Improvement Cycle**: {{improvement_cycle}}\n**Performance Enhancement**: {{performance_enhancement}}\n**Adaptive Modifications**: {{adaptive_modifications}}`,
      expert: `## Comprehensive Refinement Ecosystem\n**Multi-Channel Feedback Systems**: {{feedback_process}}\n**Strategic Optimization Initiatives**: {{optimization_areas}}\n**Continuous Improvement Methodology**: {{improvement_cycle}}\n**Performance Enhancement Protocols**: {{performance_enhancement}}\n**Adaptive Modification Framework**: {{adaptive_modifications}}\n**Innovation Integration Processes**: {{innovation_processes}}\n**Scalability & Evolution Planning**: {{scalability_planning}}\n**Best Practice Documentation**: {{best_practices}}`
    };

    return refinementTemplates[request.complexity];
  }

  /**
   * Build Framework section for CAGEERF
   */
  private buildFrameworkSection(request: TemplateGenerationRequest): string {
    const frameworkTemplates = {
      simple: `## Framework\nFollowing {{methodology_name}} principles`,
      intermediate: `## Methodological Framework\n**Approach**: {{methodology_name}}\n**Key Principles**: {{key_principles}}\n**Standards**: {{standards}}`,
      advanced: `## Systematic Framework Architecture\n**Methodological Approach**: {{methodology_name}}\n**Core Principles & Guidelines**: {{key_principles}}\n**Quality Standards**: {{standards}}\n**Best Practices**: {{best_practices}}\n**Compliance Requirements**: {{compliance_requirements}}`,
      expert: `## Comprehensive Framework Ecosystem\n**Strategic Methodological Approach**: {{methodology_name}}\n**Foundational Principles & Philosophy**: {{key_principles}}\n**Quality Standards & Benchmarks**: {{standards}}\n**Industry Best Practices**: {{best_practices}}\n**Regulatory Compliance Framework**: {{compliance_requirements}}\n**Governance & Oversight Protocols**: {{governance_protocols}}\n**Continuous Framework Evolution**: {{framework_evolution}}\n**Knowledge Management Systems**: {{knowledge_management}}`
    };

    return frameworkTemplates[request.complexity];
  }


  /**
   * Generate additional helper methods for template generation
   */
  private generateTemplateId(request: TemplateGenerationRequest): string {
    const sanitized = request.useCase.toLowerCase().replace(/[^a-z0-9]/g, '_');
    const timestamp = Date.now().toString(36);
    return `cageerf_${sanitized}_${timestamp}`;
  }

  private generateTemplateName(request: TemplateGenerationRequest): string {
    return `${request.useCase} - CAGEERF ${request.complexity} Template`;
  }

  private generateTemplateDescription(request: TemplateGenerationRequest): string {
    const emphasisAreas = Object.entries(request.frameworkEmphasis)
      .filter(([_, enabled]) => enabled)
      .map(([component, _]) => component.toUpperCase())
      .join(', ');
    
    return `${request.complexity} complexity template for ${request.useCase} in ${request.domain} domain. Emphasizes: ${emphasisAreas}`;
  }

  private determineCategory(request: TemplateGenerationRequest): string {
    // Logic to determine appropriate category based on request
    if (request.frameworkEmphasis.analysis && request.frameworkEmphasis.evaluation) {
      return 'analysis';
    } else if (request.frameworkEmphasis.execution && request.frameworkEmphasis.goals) {
      return 'execution';
    } else if (request.frameworkEmphasis.framework) {
      return 'framework';
    }
    return 'general';
  }

  private getDefaultPattern(request: TemplateGenerationRequest): TemplatePattern {
    // Return a default pattern when no good match is found
    return this.repository.templates[0];
  }

  private integrateCageerfSections(baseTemplate: string, sections: Record<string, string>, request: TemplateGenerationRequest): string {
    // Integration logic for CAGEERF sections into base template
    let integratedTemplate = baseTemplate;
    
    Object.entries(sections).forEach(([component, section]) => {
      if (!integratedTemplate.includes(`{{${component}}}`)) {
        integratedTemplate += `\n\n${section}`;
      } else {
        integratedTemplate = integratedTemplate.replace(`{{${component}}}`, section);
      }
    });

    return integratedTemplate;
  }

  private applyStyleTransformation(template: string, style: TemplateGenerationRequest['templateStyle']): string {
    // Apply style-specific transformations
    switch (style) {
      case 'conversational':
        return template.replace(/##/g, '**').replace(/\*\*/g, '');
      case 'academic':
        return template.replace(/##/g, '### ').replace(/\*/g, '');
      case 'professional':
        return template.replace(/##/g, '**').replace(/\n\n/g, '\n\n---\n\n');
      case 'creative':
        return template.replace(/##/g, '🎯 ').replace(/\*\*/g, '✨ ');
      default:
        return template;
    }
  }

  private generateCageerfArgument(component: keyof TemplateGenerationRequest['frameworkEmphasis']): GeneratedTemplate['arguments'][0] | null {
    const argumentMap = {
      context: {
        name: 'context_factors',
        description: 'Environmental context and situational factors',
        required: true,
        cageerfComponent: 'context' as keyof TemplateGenerationRequest['frameworkEmphasis']
      },
      analysis: {
        name: 'analysis_methodology',
        description: 'Systematic analysis approach and methodology',
        required: true,
        cageerfComponent: 'analysis' as keyof TemplateGenerationRequest['frameworkEmphasis']
      },
      goals: {
        name: 'objectives',
        description: 'Clear goals and expected outcomes',
        required: true,
        cageerfComponent: 'goals' as keyof TemplateGenerationRequest['frameworkEmphasis']
      },
      execution: {
        name: 'implementation_steps',
        description: 'Step-by-step execution methodology',
        required: true,
        cageerfComponent: 'execution' as keyof TemplateGenerationRequest['frameworkEmphasis']
      },
      evaluation: {
        name: 'success_criteria',
        description: 'Evaluation criteria and validation methods',
        required: false,
        cageerfComponent: 'evaluation' as keyof TemplateGenerationRequest['frameworkEmphasis']
      },
      refinement: {
        name: 'improvement_process',
        description: 'Iterative refinement and improvement methodology',
        required: false,
        cageerfComponent: 'refinement' as keyof TemplateGenerationRequest['frameworkEmphasis']
      },
      framework: {
        name: 'methodology_framework',
        description: 'Structured framework and systematic approach',
        required: false,
        cageerfComponent: 'framework' as keyof TemplateGenerationRequest['frameworkEmphasis']
      }
    };

    return argumentMap[component] || null;
  }

  private calculateQualityScore(analysis: CAGEERFAnalysis, request: TemplateGenerationRequest): number {
    let score = analysis.frameworkScore * 0.6; // Base framework compliance (60%)
    
    // Add bonus for complexity alignment
    const complexityBonus = request.complexity === 'expert' ? 0.15 : request.complexity === 'advanced' ? 0.10 : 0.05;
    score += complexityBonus;
    
    // Add bonus for comprehensive CAGEERF coverage
    const emphasizedComponents = Object.values(request.frameworkEmphasis).filter(Boolean).length;
    score += (emphasizedComponents / 7) * 0.25; // Up to 25% bonus for full coverage
    
    return Math.min(1.0, score);
  }

  private createStyleVariation(baseTemplate: Omit<GeneratedTemplate, 'cageerfCompliance' | 'qualityScore' | 'enhancementSuggestions' | 'variations'>, style: TemplateGenerationRequest['templateStyle'], request: TemplateGenerationRequest): TemplateVariation | null {
    if (style === request.templateStyle) return null;
    
    return {
      name: `${style.charAt(0).toUpperCase() + style.slice(1)} Style`,
      description: `${baseTemplate.name} adapted for ${style} communication style`,
      modifications: [`Adapted template style to ${style}`, `Adjusted language and formatting for ${style} approach`],
      userMessageTemplate: this.applyStyleTransformation(baseTemplate.userMessageTemplate, style),
      systemMessage: baseTemplate.systemMessage ? this.applyStyleTransformation(baseTemplate.systemMessage, style) : undefined
    };
  }

  private createComplexityVariation(baseTemplate: Omit<GeneratedTemplate, 'cageerfCompliance' | 'qualityScore' | 'enhancementSuggestions' | 'variations'>, complexity: TemplateGenerationRequest['complexity'], request: TemplateGenerationRequest): TemplateVariation | null {
    if (complexity === request.complexity) return null;
    
    return {
      name: `${complexity.charAt(0).toUpperCase() + complexity.slice(1)} Complexity`,
      description: `${baseTemplate.name} adjusted for ${complexity} complexity level`,
      modifications: [`Adjusted complexity level to ${complexity}`, `Modified detail level and structure for ${complexity} users`],
      userMessageTemplate: baseTemplate.userMessageTemplate, // Simplified implementation
      systemMessage: baseTemplate.systemMessage
    };
  }

  private createFrameworkFocusVariations(baseTemplate: Omit<GeneratedTemplate, 'cageerfCompliance' | 'qualityScore' | 'enhancementSuggestions' | 'variations'>, request: TemplateGenerationRequest): TemplateVariation[] {
    const variations: TemplateVariation[] = [];
    
    // Create variation focused on execution
    if (!request.frameworkEmphasis.execution) {
      variations.push({
        name: 'Execution-Focused',
        description: 'Enhanced emphasis on step-by-step execution methodology',
        modifications: ['Added execution framework', 'Enhanced implementation guidance'],
        userMessageTemplate: baseTemplate.userMessageTemplate + '\n\n' + this.buildExecutionSection(request),
        systemMessage: baseTemplate.systemMessage
      });
    }
    
    // Create variation focused on evaluation
    if (!request.frameworkEmphasis.evaluation) {
      variations.push({
        name: 'Evaluation-Enhanced',
        description: 'Strengthened evaluation and validation components',
        modifications: ['Added evaluation framework', 'Enhanced validation criteria'],
        userMessageTemplate: baseTemplate.userMessageTemplate + '\n\n' + this.buildEvaluationSection(request),
        systemMessage: baseTemplate.systemMessage
      });
    }
    
    return variations;
  }

  private identifyEnhancementAreas(analysis: CAGEERFAnalysis, targetCompliance?: Partial<TemplateGenerationRequest['frameworkEmphasis']>): string[] {
    const areas: string[] = [];
    
    Object.entries(analysis.compliance).forEach(([component, data]) => {
      if (data.confidence < 0.5) {
        areas.push(component);
      }
    });
    
    return areas;
  }

  private applyEnhancements(prompt: ConvertedPrompt, enhancementAreas: string[], analysis: CAGEERFAnalysis): GeneratedTemplate {
    // Simplified implementation - would apply specific enhancements based on areas
    return {
      id: prompt.id,
      name: prompt.name + ' (Enhanced)',
      description: prompt.description + ' - Enhanced with CAGEERF compliance',
      category: prompt.category,
      systemMessage: prompt.systemMessage,
      userMessageTemplate: prompt.userMessageTemplate,
      arguments: prompt.arguments.map(arg => ({
        name: arg.name,
        description: arg.description,
        required: arg.required
      })),
      cageerfCompliance: analysis,
      qualityScore: 85, // Placeholder
      enhancementSuggestions: analysis.templateSuggestions,
      variations: []
    };
  }
}