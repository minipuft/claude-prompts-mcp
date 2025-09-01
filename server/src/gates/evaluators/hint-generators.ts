/**
 * Centralized Hint Generators
 * Provides intelligent hints and improvement suggestions for all gate evaluation strategies
 */

import { Logger } from "../../logging/index.js";
import type {
  ExtendedGateType,
  ExtendedGateRequirement,
  GateEvaluationContext,
  EnhancedGateEvaluationResult,
  HintGenerator,
  ImprovementSuggestion,
} from "../registry/gate-registry.js";

// ===== Base Hint Generator =====

abstract class BaseHintGenerator implements HintGenerator {
  protected logger?: Logger;

  constructor(logger?: Logger) {
    this.logger = logger;
  }

  abstract generateHints(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext,
    evaluationResult: EnhancedGateEvaluationResult
  ): Promise<string[]>;

  abstract generateImprovementSuggestions(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext,
    evaluationResult: EnhancedGateEvaluationResult
  ): Promise<ImprovementSuggestion[]>;

  protected getCommonHints(evaluationResult: EnhancedGateEvaluationResult): string[] {
    const hints: string[] = [];
    
    if (evaluationResult.score !== undefined && evaluationResult.score < 0.5) {
      hints.push('Consider reviewing the content structure and organization');
      hints.push('Focus on addressing the most critical issues first');
    }
    
    if (evaluationResult.details?.issues && Array.isArray(evaluationResult.details.issues)) {
      hints.push('Review specific issues mentioned in the evaluation details');
    }
    
    return hints;
  }

  protected createSuggestion(
    type: ImprovementSuggestion['type'],
    priority: ImprovementSuggestion['priority'],
    message: string,
    example?: string,
    autoFixable: boolean = false
  ): ImprovementSuggestion {
    return {
      type,
      priority,
      message,
      example,
      autoFixable,
    };
  }
}

// ===== Content Analysis Hint Generators =====

export class ContentLengthHintGenerator extends BaseHintGenerator {
  async generateHints(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext,
    evaluationResult: EnhancedGateEvaluationResult
  ): Promise<string[]> {
    const hints: string[] = [];
    const { length, min, max } = evaluationResult.details || {};
    
    if (min !== undefined && length < min) {
      const needed = min - length;
      hints.push(`Add approximately ${needed} more characters to meet minimum length`);
      hints.push('Consider expanding with more details, examples, or explanations');
      hints.push('Break down complex concepts into more detailed explanations');
    }
    
    if (max !== undefined && length > max) {
      const excess = length - max;
      hints.push(`Remove approximately ${excess} characters to meet maximum length`);
      hints.push('Condense information by removing redundant content');
      hints.push('Focus on the most essential points and remove supporting details');
    }
    
    return hints;
  }

  async generateImprovementSuggestions(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext,
    evaluationResult: EnhancedGateEvaluationResult
  ): Promise<ImprovementSuggestion[]> {
    const suggestions: ImprovementSuggestion[] = [];
    const { length, min, max } = evaluationResult.details || {};
    
    if (min !== undefined && length < min) {
      suggestions.push(this.createSuggestion(
        'content',
        'medium',
        `Expand content by ${min - length} characters`,
        'Add more detailed explanations, examples, or background information'
      ));
    }
    
    if (max !== undefined && length > max) {
      suggestions.push(this.createSuggestion(
        'content',
        'medium',
        `Reduce content by ${length - max} characters`,
        'Remove redundant phrases, combine similar points, or use more concise language'
      ));
    }
    
    return suggestions;
  }
}

export class ReadabilityHintGenerator extends BaseHintGenerator {
  async generateHints(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext,
    evaluationResult: EnhancedGateEvaluationResult
  ): Promise<string[]> {
    const hints: string[] = [];
    const { readabilityScore, targetRange } = evaluationResult.details || {};
    
    if (readabilityScore < (targetRange?.min || 0)) {
      hints.push('Text is too complex for the target audience');
      hints.push('Use shorter sentences (aim for 15-20 words per sentence)');
      hints.push('Replace complex vocabulary with simpler alternatives');
      hints.push('Break long sentences into multiple shorter ones');
      hints.push('Use active voice instead of passive voice where possible');
    } else if (readabilityScore > (targetRange?.max || 100)) {
      hints.push('Text may be too simple for the target audience');
      hints.push('Add more detailed technical explanations where appropriate');
      hints.push('Use more precise and specific vocabulary');
      hints.push('Include more comprehensive examples and analysis');
    }
    
    return hints;
  }

  async generateImprovementSuggestions(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext,
    evaluationResult: EnhancedGateEvaluationResult
  ): Promise<ImprovementSuggestion[]> {
    const suggestions: ImprovementSuggestion[] = [];
    const { readabilityScore, targetRange, readabilityLevel } = evaluationResult.details || {};
    
    if (readabilityScore < (targetRange?.min || 0)) {
      suggestions.push(this.createSuggestion(
        'content',
        'medium',
        `Simplify language complexity (current: ${readabilityLevel})`,
        'Instead of "The implementation utilizes sophisticated algorithms", use "The system uses advanced methods"'
      ));
    }
    
    return suggestions;
  }
}

export class GrammarHintGenerator extends BaseHintGenerator {
  async generateHints(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext,
    evaluationResult: EnhancedGateEvaluationResult
  ): Promise<string[]> {
    const hints: string[] = [];
    const { issues } = evaluationResult.details || {};
    
    if (Array.isArray(issues)) {
      for (const issue of issues) {
        if (issue.includes('lowercase "i"')) {
          hints.push('Always capitalize the pronoun "I" in English text');
        }
        if (issue.includes('consecutive spaces')) {
          hints.push('Use single spaces between words and after punctuation');
        }
        if (issue.includes('punctuation')) {
          hints.push('End all sentences with appropriate punctuation (. ! ?)');
        }
        if (issue.includes('capital letters')) {
          hints.push('Start all sentences with capital letters');
        }
      }
    }
    
    if (hints.length === 0 && !evaluationResult.passed) {
      hints.push('Review content for basic grammar and punctuation errors');
      hints.push('Use a grammar checker or proofreading tool for detailed analysis');
    }
    
    return hints;
  }

  async generateImprovementSuggestions(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext,
    evaluationResult: EnhancedGateEvaluationResult
  ): Promise<ImprovementSuggestion[]> {
    const suggestions: ImprovementSuggestion[] = [];
    const { issues } = evaluationResult.details || {};
    
    if (Array.isArray(issues)) {
      for (const issue of issues) {
        suggestions.push(this.createSuggestion(
          'format',
          'medium',
          issue,
          undefined,
          true // Grammar issues are often auto-fixable
        ));
      }
    }
    
    return suggestions;
  }
}

export class ToneHintGenerator extends BaseHintGenerator {
  async generateHints(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext,
    evaluationResult: EnhancedGateEvaluationResult
  ): Promise<string[]> {
    const hints: string[] = [];
    const { expectedTone, detectedTone } = evaluationResult.details || {};
    
    if (expectedTone && detectedTone && expectedTone !== detectedTone) {
      hints.push(`Adjust tone from ${detectedTone} to ${expectedTone}`);
      
      switch (expectedTone) {
        case 'professional':
          hints.push('Use formal language and avoid contractions');
          hints.push('Include professional terminology and structured presentation');
          hints.push('Maintain objective and respectful language throughout');
          break;
        case 'casual':
          hints.push('Use conversational language and contractions');
          hints.push('Include friendly, approachable phrases');
          hints.push('Write as if speaking to a colleague or friend');
          break;
        case 'technical':
          hints.push('Include more technical terminology and precise language');
          hints.push('Use industry-specific vocabulary and concepts');
          hints.push('Focus on accuracy and technical details');
          break;
        case 'friendly':
          hints.push('Use warm, welcoming language');
          hints.push('Include positive expressions and encouraging phrases');
          hints.push('Show enthusiasm and personal engagement');
          break;
      }
    }
    
    return hints;
  }

  async generateImprovementSuggestions(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext,
    evaluationResult: EnhancedGateEvaluationResult
  ): Promise<ImprovementSuggestion[]> {
    const suggestions: ImprovementSuggestion[] = [];
    const { expectedTone, detectedTone, confidence } = evaluationResult.details || {};
    
    if (expectedTone && detectedTone && expectedTone !== detectedTone) {
      suggestions.push(this.createSuggestion(
        'style',
        confidence < 0.5 ? 'high' : 'medium',
        `Adjust tone from ${detectedTone} to ${expectedTone}`,
        this.getToneExample(expectedTone, detectedTone)
      ));
    }
    
    return suggestions;
  }

  private getToneExample(expected: string, detected: string): string {
    const examples: Record<string, string> = {
      professional: 'Use "We recommend" instead of "I think you should"',
      casual: 'Use "Let\'s check this out" instead of "Please review the following"',
      technical: 'Use "Implementation utilizes" instead of "The thing uses"',
      friendly: 'Use "We\'d love to help!" instead of "Assistance is available"',
    };
    
    return examples[expected] || `Adjust language style to match ${expected} tone`;
  }
}

// ===== Structure Validation Hint Generators =====

export class StructureHintGenerator extends BaseHintGenerator {
  async generateHints(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext,
    evaluationResult: EnhancedGateEvaluationResult
  ): Promise<string[]> {
    const hints: string[] = [];
    const { issues, format } = evaluationResult.details || {};
    
    if (requirement.type === 'format_validation') {
      hints.push(...this.getFormatHints(format, issues));
    } else if (requirement.type === 'hierarchy_validation') {
      hints.push(...this.getHierarchyHints(evaluationResult.details));
    } else if (requirement.type === 'section_validation') {
      hints.push(...this.getSectionHints(evaluationResult.details));
    } else if (requirement.type === 'code_quality') {
      hints.push(...this.getCodeQualityHints(evaluationResult.details));
    }
    
    return hints;
  }

  private getFormatHints(format: string, issues?: any): string[] {
    const hints: string[] = [];
    
    switch (format) {
      case 'markdown':
        hints.push('Add markdown headers (# ## ###) to structure content');
        hints.push('Use double line breaks to separate paragraphs');
        hints.push('Consider using lists, code blocks, and other markdown features');
        break;
      case 'json':
        hints.push('Check for missing quotes around strings');
        hints.push('Ensure all brackets and braces are properly matched');
        hints.push('Remove trailing commas from objects and arrays');
        break;
      case 'yaml':
        hints.push('Use consistent indentation with spaces (not tabs)');
        hints.push('Ensure key-value pairs are properly formatted with colons');
        hints.push('Check for proper nesting and alignment');
        break;
    }
    
    return hints;
  }

  private getHierarchyHints(details: any): string[] {
    const hints: string[] = [];
    
    if (details?.issues) {
      for (const issue of details.issues) {
        if (issue.includes('depth')) {
          hints.push('Reduce header nesting depth by consolidating sections');
        }
        if (issue.includes('H1')) {
          hints.push('Add a main title using H1 header (#)');
        }
        if (issue.includes('consecutive')) {
          hints.push('Add content between headers to improve structure');
        }
      }
    }
    
    return hints;
  }

  private getSectionHints(details: any): string[] {
    const hints: string[] = [];
    
    if (details?.missingSections) {
      hints.push(`Add missing sections: ${details.missingSections.join(', ')}`);
      hints.push('Ensure all required sections are clearly labeled and present');
    }
    
    return hints;
  }

  private getCodeQualityHints(details: any): string[] {
    const hints: string[] = [];
    
    if (details?.issues) {
      hints.push('Review code blocks for syntax errors and style issues');
      hints.push('Follow language-specific coding standards and conventions');
      hints.push('Consider breaking complex code into smaller, manageable functions');
    }
    
    return hints;
  }

  async generateImprovementSuggestions(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext,
    evaluationResult: EnhancedGateEvaluationResult
  ): Promise<ImprovementSuggestion[]> {
    const suggestions: ImprovementSuggestion[] = [];
    const details = evaluationResult.details || {};
    
    if (requirement.type === 'format_validation' && !evaluationResult.passed) {
      suggestions.push(this.createSuggestion(
        'format',
        'high',
        `Fix ${details.format} format issues`,
        undefined,
        details.format === 'markdown'
      ));
    }
    
    if (details.missingSections?.length > 0) {
      suggestions.push(this.createSuggestion(
        'structure',
        'medium',
        `Add ${details.missingSections.length} missing sections`,
        `Include: ${details.missingSections.slice(0, 3).join(', ')}`
      ));
    }
    
    return suggestions;
  }
}

// ===== Pattern Matching Hint Generators =====

export class PatternHintGenerator extends BaseHintGenerator {
  async generateHints(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext,
    evaluationResult: EnhancedGateEvaluationResult
  ): Promise<string[]> {
    const hints: string[] = [];
    const details = evaluationResult.details || {};
    
    if (requirement.type === 'keyword_presence') {
      hints.push(...this.getKeywordHints(details));
    } else if (requirement.type === 'pattern_matching') {
      hints.push(...this.getPatternMatchingHints(details));
    } else if (requirement.type === 'link_validation') {
      hints.push(...this.getLinkValidationHints(details));
    }
    
    return hints;
  }

  private getKeywordHints(details: any): string[] {
    const hints: string[] = [];
    
    if (details.missingKeywords?.length > 0) {
      hints.push(`Include these keywords: ${details.missingKeywords.join(', ')}`);
      hints.push('Use keywords naturally within the context of your content');
      hints.push('Consider using related terms or synonyms if exact matches are difficult');
    }
    
    if (details.totalMatches < (details.requiredMatches || 0)) {
      hints.push('Increase keyword density by repeating important terms appropriately');
    }
    
    return hints;
  }

  private getPatternMatchingHints(details: any): string[] {
    const hints: string[] = [];
    
    if (details.blockedMatches?.length > 0) {
      hints.push(`Remove content matching blocked patterns: ${details.blockedMatches.join(', ')}`);
    }
    
    if (details.allowedPatterns?.length > (details.matchedPatterns?.length || 0)) {
      hints.push('Add content that matches the required patterns');
    }
    
    return hints;
  }

  private getLinkValidationHints(details: any): string[] {
    const hints: string[] = [];
    
    if (details.invalidLinks > 0) {
      hints.push(`Fix ${details.invalidLinks} invalid links`);
      hints.push('Ensure URLs include proper protocols (http:// or https://)');
      hints.push('Check for broken markdown link syntax [text](url)');
    }
    
    return hints;
  }

  async generateImprovementSuggestions(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext,
    evaluationResult: EnhancedGateEvaluationResult
  ): Promise<ImprovementSuggestion[]> {
    const suggestions: ImprovementSuggestion[] = [];
    const details = evaluationResult.details || {};
    
    if (details.missingKeywords?.length > 0) {
      suggestions.push(this.createSuggestion(
        'content',
        'medium',
        `Add ${details.missingKeywords.length} missing keywords`,
        `Include: ${details.missingKeywords.slice(0, 3).join(', ')}`
      ));
    }
    
    if (details.invalidLinks > 0) {
      suggestions.push(this.createSuggestion(
        'format',
        'medium',
        `Fix ${details.invalidLinks} invalid links`,
        'Ensure proper URL format and syntax'
      ));
    }
    
    return suggestions;
  }
}

// ===== Custom Logic Hint Generators =====

export class CustomLogicHintGenerator extends BaseHintGenerator {
  async generateHints(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext,
    evaluationResult: EnhancedGateEvaluationResult
  ): Promise<string[]> {
    const hints: string[] = [];
    const details = evaluationResult.details || {};
    
    if (requirement.type === 'completeness') {
      hints.push(...this.getCompletenessHints(details));
    } else if (requirement.type === 'security_validation') {
      hints.push(...this.getSecurityHints(details));
    } else if (requirement.type === 'required_fields') {
      hints.push(...this.getFieldValidationHints(details));
    }
    
    return hints;
  }

  private getCompletenessHints(details: any): string[] {
    const hints: string[] = [];
    
    if (details.analysis) {
      const analysis = details.analysis;
      
      if (analysis.wordCount < 200) {
        hints.push('Expand content with more detailed explanations and examples');
      }
      
      if (analysis.headers === 0) {
        hints.push('Add section headers to organize content structure');
      }
      
      if (analysis.missingSections?.length > 0) {
        hints.push(`Include missing sections: ${analysis.missingSections.join(', ')}`);
      }
      
      if (analysis.avgWordsPerSentence < 10) {
        hints.push('Combine related ideas into more detailed sentences');
      }
    }
    
    return hints;
  }

  private getSecurityHints(details: any): string[] {
    const hints: string[] = [];
    
    if (details.securityIssues?.length > 0) {
      hints.push('Remove or obfuscate sensitive information');
      hints.push('Use environment variables or secure configuration for credentials');
      hints.push('Replace actual values with placeholders like [API_KEY] or [PASSWORD]');
    }
    
    return hints;
  }

  private getFieldValidationHints(details: any): string[] {
    const hints: string[] = [];
    
    if (details.missingFields?.length > 0) {
      hints.push(`Add missing required fields: ${details.missingFields.join(', ')}`);
    }
    
    if (details.invalidFields?.length > 0) {
      hints.push(`Fix validation errors in: ${details.invalidFields.join(', ')}`);
    }
    
    return hints;
  }

  async generateImprovementSuggestions(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext,
    evaluationResult: EnhancedGateEvaluationResult
  ): Promise<ImprovementSuggestion[]> {
    const suggestions: ImprovementSuggestion[] = [];
    const details = evaluationResult.details || {};
    
    if (details.securityIssues?.length > 0) {
      suggestions.push(this.createSuggestion(
        'content',
        'high',
        `Address ${details.securityIssues.length} security issues`,
        'Replace sensitive data with placeholders'
      ));
    }
    
    if (details.missingFields?.length > 0) {
      suggestions.push(this.createSuggestion(
        'structure',
        'high',
        `Add ${details.missingFields.length} required fields`,
        `Include: ${details.missingFields.slice(0, 3).join(', ')}`
      ));
    }
    
    return suggestions;
  }
}

// ===== Hint Generator Factory =====

export class HintGeneratorFactory {
  private static generators: Map<ExtendedGateType, HintGenerator> = new Map();

  static {
    // Content Analysis generators
    this.generators.set('content_length', new ContentLengthHintGenerator());
    this.generators.set('readability_score', new ReadabilityHintGenerator());
    this.generators.set('grammar_quality', new GrammarHintGenerator());
    this.generators.set('tone_analysis', new ToneHintGenerator());
    
    // Structure Validation generators
    this.generators.set('format_validation', new StructureHintGenerator());
    this.generators.set('section_validation', new StructureHintGenerator());
    this.generators.set('hierarchy_validation', new StructureHintGenerator());
    this.generators.set('code_quality', new StructureHintGenerator());
    
    // Pattern Matching generators
    this.generators.set('keyword_presence', new PatternHintGenerator());
    this.generators.set('pattern_matching', new PatternHintGenerator());
    this.generators.set('link_validation', new PatternHintGenerator());
    
    // Custom Logic generators
    this.generators.set('custom', new CustomLogicHintGenerator());
    this.generators.set('completeness', new CustomLogicHintGenerator());
    this.generators.set('security_validation', new CustomLogicHintGenerator());
    this.generators.set('required_fields', new CustomLogicHintGenerator());
  }

  static getHintGenerator(type: ExtendedGateType): HintGenerator | undefined {
    return this.generators.get(type);
  }

  static getAllHintGenerators(): Map<ExtendedGateType, HintGenerator> {
    return new Map(this.generators);
  }

  static getSupportedTypes(): ExtendedGateType[] {
    return Array.from(this.generators.keys());
  }
}

/**
 * Universal hint generator that can handle any gate type
 */
export class UniversalHintGenerator implements HintGenerator {
  private logger?: Logger;

  constructor(logger?: Logger) {
    this.logger = logger;
  }

  async generateHints(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext,
    evaluationResult: EnhancedGateEvaluationResult
  ): Promise<string[]> {
    const generator = HintGeneratorFactory.getHintGenerator(requirement.type);
    
    if (generator) {
      return await generator.generateHints(requirement, context, evaluationResult);
    }
    
    // Fallback hints for unknown types
    const fallbackHints: string[] = [];
    
    if (!evaluationResult.passed) {
      fallbackHints.push('Review content to address evaluation criteria');
      
      if (evaluationResult.score !== undefined && evaluationResult.score < 0.5) {
        fallbackHints.push('Significant improvements needed to meet requirements');
      }
      
      if (evaluationResult.details?.issues) {
        fallbackHints.push('Check evaluation details for specific issues to address');
      }
    }
    
    return fallbackHints;
  }

  async generateImprovementSuggestions(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext,
    evaluationResult: EnhancedGateEvaluationResult
  ): Promise<ImprovementSuggestion[]> {
    const generator = HintGeneratorFactory.getHintGenerator(requirement.type);
    
    if (generator) {
      return await generator.generateImprovementSuggestions(requirement, context, evaluationResult);
    }
    
    // Fallback suggestions
    if (!evaluationResult.passed) {
      return [{
        type: 'content',
        priority: 'medium',
        message: `Address ${requirement.type} validation issues`,
        autoFixable: false,
      }];
    }
    
    return [];
  }
}