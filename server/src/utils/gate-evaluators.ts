/**
 * Gate Evaluators - Phase 2 Implementation
 * Comprehensive evaluators for all gate types including new content quality, structure, and security gates
 */

import { Logger } from "../logging/index.js";
import {
  ExtendedGateType,
  ExtendedGateRequirement,
  GateEvaluationContext,
  EnhancedGateEvaluationResult,
  GateEvaluator,
  HintGenerator,
  ImprovementSuggestion,
} from "./gate-registry.js";

// ===== Content Quality Evaluators =====

export class ReadabilityScoreEvaluator implements GateEvaluator {
  async evaluate(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext
  ): Promise<EnhancedGateEvaluationResult> {
    const { content } = context;
    const { readabilityTarget, fleschKincaidMin, fleschKincaidMax } = requirement.criteria;
    
    // Calculate Flesch-Kincaid Reading Ease score
    const readabilityScore = this.calculateFleschKincaidScore(content);
    
    // Determine target range based on readability target
    const targetRange = this.getTargetRange(readabilityTarget);
    const minScore = fleschKincaidMin ?? targetRange.min;
    const maxScore = fleschKincaidMax ?? targetRange.max;
    
    const passed = readabilityScore >= minScore && readabilityScore <= maxScore;
    const normalizedScore = this.normalizeScore(readabilityScore, minScore, maxScore);
    
    return {
      requirementId: 'readability_score',
      passed,
      score: normalizedScore,
      message: `Readability score: ${readabilityScore.toFixed(1)} (target: ${minScore}-${maxScore})`,
      details: {
        readabilityScore,
        targetRange: { min: minScore, max: maxScore },
        readabilityLevel: this.getReadabilityLevel(readabilityScore),
      },
    };
  }

  private calculateFleschKincaidScore(text: string): number {
    // Remove extra whitespace and count sentences, words, and syllables
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
    const words = text.split(/\s+/).filter(w => w.trim().length > 0).length;
    const syllables = this.countSyllables(text);
    
    if (sentences === 0 || words === 0) return 0;
    
    // Flesch Reading Ease formula
    const score = 206.835 - (1.015 * (words / sentences)) - (84.6 * (syllables / words));
    return Math.max(0, Math.min(100, score));
  }

  private countSyllables(text: string): number {
    // Simple syllable counting algorithm
    return text.toLowerCase()
      .replace(/[^a-z]/g, '')
      .replace(/[aeiou]{2,}/g, 'a') // Replace multiple vowels with single
      .replace(/[^aeiou]/g, '') // Keep only vowels
      .length || 1;
  }

  private getTargetRange(target?: string): { min: number; max: number } {
    switch (target) {
      case 'beginner': return { min: 90, max: 100 };
      case 'intermediate': return { min: 70, max: 89 };
      case 'advanced': return { min: 50, max: 69 };
      case 'expert': return { min: 30, max: 49 };
      default: return { min: 60, max: 80 }; // Standard range
    }
  }

  private getReadabilityLevel(score: number): string {
    if (score >= 90) return 'Very Easy';
    if (score >= 80) return 'Easy';
    if (score >= 70) return 'Fairly Easy';
    if (score >= 60) return 'Standard';
    if (score >= 50) return 'Fairly Difficult';
    if (score >= 30) return 'Difficult';
    return 'Very Difficult';
  }

  private normalizeScore(score: number, min: number, max: number): number {
    if (score < min) return 0;
    if (score > max) return Math.max(0, 1 - ((score - max) / (100 - max)));
    return 1;
  }
}

export class GrammarQualityEvaluator implements GateEvaluator {
  async evaluate(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext
  ): Promise<EnhancedGateEvaluationResult> {
    const { content } = context;
    const { grammarStrength, allowedErrors } = requirement.criteria;
    
    // Basic grammar validation (in production, this would use a proper grammar checker)
    const grammarIssues = this.analyzeGrammar(content, grammarStrength);
    const errorCount = grammarIssues.length;
    const maxErrors = allowedErrors ?? this.getMaxErrorsForStrength(grammarStrength);
    
    const passed = errorCount <= maxErrors;
    const score = Math.max(0, 1 - (errorCount / Math.max(1, maxErrors * 2)));
    
    return {
      requirementId: 'grammar_quality',
      passed,
      score,
      message: `Grammar check: ${errorCount} issues found (max allowed: ${maxErrors})`,
      details: {
        errorCount,
        maxErrors,
        grammarStrength,
        issues: grammarIssues.slice(0, 5), // Show first 5 issues
      },
    };
  }

  private analyzeGrammar(text: string, strength?: string): string[] {
    const issues: string[] = [];
    
    // Basic grammar checks
    if (strength === 'strict' || strength === 'standard') {
      // Check for common grammar issues
      if (text.includes(' i ') || text.startsWith('i ')) {
        issues.push('Lowercase "i" should be capitalized');
      }
      
      if (text.includes('  ')) {
        issues.push('Multiple consecutive spaces found');
      }
      
      if (!/[.!?]$/.test(text.trim())) {
        issues.push('Text should end with proper punctuation');
      }
      
      // Check for sentence structure
      const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
      for (const sentence of sentences) {
        if (sentence.trim().length > 0 && !/^[A-Z]/.test(sentence.trim())) {
          issues.push('Sentences should start with capital letters');
        }
      }
    }
    
    return issues;
  }

  private getMaxErrorsForStrength(strength?: string): number {
    switch (strength) {
      case 'basic': return 10;
      case 'standard': return 5;
      case 'strict': return 2;
      default: return 5;
    }
  }
}

export class ToneAnalysisEvaluator implements GateEvaluator {
  async evaluate(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext
  ): Promise<EnhancedGateEvaluationResult> {
    const { content } = context;
    const { expectedTone, toneConfidence } = requirement.criteria;
    
    const toneAnalysis = this.analyzeTone(content);
    const confidence = toneAnalysis.confidence;
    const detectedTone = toneAnalysis.tone;
    
    const minConfidence = toneConfidence ?? 0.7;
    const toneMatches = expectedTone === detectedTone;
    const confidenceOk = confidence >= minConfidence;
    
    const passed = toneMatches && confidenceOk;
    const score = toneMatches ? confidence : confidence * 0.5;
    
    return {
      requirementId: 'tone_analysis',
      passed,
      score,
      message: `Tone analysis: ${detectedTone} (confidence: ${Math.round(confidence * 100)}%)`,
      details: {
        expectedTone,
        detectedTone,
        confidence,
        minConfidence,
        toneIndicators: toneAnalysis.indicators,
      },
    };
  }

  private analyzeTone(text: string): { tone: string; confidence: number; indicators: string[] } {
    const indicators: string[] = [];
    let tone = 'neutral';
    let confidence = 0.5;
    
    // Simple tone analysis based on keywords and patterns
    const lowerText = text.toLowerCase();
    
    // Professional tone indicators
    if (lowerText.includes('please') || lowerText.includes('thank you') || 
        lowerText.includes('sincerely') || lowerText.includes('respectfully')) {
      tone = 'professional';
      confidence = 0.8;
      indicators.push('formal phrases');
    }
    
    // Technical tone indicators
    if (lowerText.includes('algorithm') || lowerText.includes('implementation') ||
        lowerText.includes('configuration') || lowerText.includes('specification')) {
      tone = 'technical';
      confidence = 0.9;
      indicators.push('technical terminology');
    }
    
    // Casual tone indicators
    if (lowerText.includes('hey') || lowerText.includes('awesome') ||
        lowerText.includes("it's") || lowerText.includes("we'll")) {
      tone = 'casual';
      confidence = 0.7;
      indicators.push('informal language');
    }
    
    // Friendly tone indicators
    if (lowerText.includes('welcome') || lowerText.includes('happy') ||
        lowerText.includes('excited') || lowerText.includes('glad')) {
      tone = 'friendly';
      confidence = 0.8;
      indicators.push('positive language');
    }
    
    return { tone, confidence, indicators };
  }
}

// ===== Structure & Format Evaluators =====

export class HierarchyValidationEvaluator implements GateEvaluator {
  async evaluate(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext
  ): Promise<EnhancedGateEvaluationResult> {
    const { content } = context;
    const { maxDepth, requireH1, consecutiveHeaders } = requirement.criteria;
    
    const hierarchy = this.analyzeHierarchy(content);
    const issues: string[] = [];
    
    // Check maximum depth
    if (maxDepth && hierarchy.maxDepth > maxDepth) {
      issues.push(`Header depth exceeds maximum (${hierarchy.maxDepth} > ${maxDepth})`);
    }
    
    // Check for H1 requirement
    if (requireH1 && !hierarchy.hasH1) {
      issues.push('Document must have an H1 header');
    }
    
    // Check for consecutive headers
    if (consecutiveHeaders === false && hierarchy.hasConsecutiveHeaders) {
      issues.push('Document has consecutive headers without content');
    }
    
    const passed = issues.length === 0;
    const score = Math.max(0, 1 - (issues.length / 5));
    
    return {
      requirementId: 'hierarchy_validation',
      passed,
      score,
      message: passed ? 'Header hierarchy is valid' : `Hierarchy issues: ${issues.join(', ')}`,
      details: {
        maxDepth: hierarchy.maxDepth,
        hasH1: hierarchy.hasH1,
        hasConsecutiveHeaders: hierarchy.hasConsecutiveHeaders,
        headerCounts: hierarchy.headerCounts,
        issues,
      },
    };
  }

  private analyzeHierarchy(text: string): {
    maxDepth: number;
    hasH1: boolean;
    hasConsecutiveHeaders: boolean;
    headerCounts: Record<string, number>;
  } {
    const headerRegex = /^(#{1,6})\s+(.+)$/gm;
    const headers: { level: number; title: string; line: number }[] = [];
    const lines = text.split('\n');
    
    let match;
    while ((match = headerRegex.exec(text)) !== null) {
      const level = match[1].length;
      const title = match[2];
      const line = text.substring(0, match.index).split('\n').length;
      headers.push({ level, title, line });
    }
    
    const maxDepth = headers.length > 0 ? Math.max(...headers.map(h => h.level)) : 0;
    const hasH1 = headers.some(h => h.level === 1);
    
    // Check for consecutive headers
    let hasConsecutiveHeaders = false;
    for (let i = 0; i < headers.length - 1; i++) {
      const currentHeader = headers[i];
      const nextHeader = headers[i + 1];
      
      // Check if there's content between headers
      const contentBetween = lines.slice(currentHeader.line, nextHeader.line - 1)
        .join('\n').trim();
      
      if (!contentBetween) {
        hasConsecutiveHeaders = true;
        break;
      }
    }
    
    // Count headers by level
    const headerCounts = headers.reduce((counts, header) => {
      const key = `h${header.level}`;
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {} as Record<string, number>);
    
    return {
      maxDepth,
      hasH1,
      hasConsecutiveHeaders,
      headerCounts,
    };
  }
}

export class CodeQualityEvaluator implements GateEvaluator {
  async evaluate(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext
  ): Promise<EnhancedGateEvaluationResult> {
    const { content } = context;
    const { syntaxValidation, styleGuide, complexityLimit } = requirement.criteria;
    
    const codeBlocks = this.extractCodeBlocks(content);
    const issues: string[] = [];
    let totalComplexity = 0;
    
    for (const block of codeBlocks) {
      if (syntaxValidation) {
        const syntaxIssues = this.validateSyntax(block);
        issues.push(...syntaxIssues);
      }
      
      if (styleGuide) {
        const styleIssues = this.validateStyle(block, styleGuide);
        issues.push(...styleIssues);
      }
      
      if (complexityLimit) {
        const complexity = this.calculateComplexity(block);
        totalComplexity += complexity;
        if (complexity > complexityLimit) {
          issues.push(`Code block exceeds complexity limit (${complexity} > ${complexityLimit})`);
        }
      }
    }
    
    const passed = issues.length === 0;
    const score = Math.max(0, 1 - (issues.length / Math.max(1, codeBlocks.length * 3)));
    
    return {
      requirementId: 'code_quality',
      passed,
      score,
      message: passed ? 'Code quality validation passed' : `Code issues: ${issues.length}`,
      details: {
        codeBlockCount: codeBlocks.length,
        totalComplexity,
        issues: issues.slice(0, 10), // Show first 10 issues
        styleGuide,
        complexityLimit,
      },
    };
  }

  private extractCodeBlocks(text: string): string[] {
    const codeBlockRegex = /```[\s\S]*?```/g;
    const inlineCodeRegex = /`[^`\n]+`/g;
    
    const blocks: string[] = [];
    
    // Extract code blocks
    let match;
    while ((match = codeBlockRegex.exec(text)) !== null) {
      blocks.push(match[0]);
    }
    
    // Extract inline code
    while ((match = inlineCodeRegex.exec(text)) !== null) {
      blocks.push(match[0]);
    }
    
    return blocks;
  }

  private validateSyntax(codeBlock: string): string[] {
    const issues: string[] = [];
    
    // Basic syntax validation
    if (codeBlock.includes('```')) {
      // Check for proper code block structure
      const lines = codeBlock.split('\n');
      if (lines.length < 2) {
        issues.push('Code block is too short');
      }
      
      // Check for balanced brackets
      const brackets = { '(': ')', '[': ']', '{': '}' };
      const stack: string[] = [];
      
      for (const char of codeBlock) {
        if (char in brackets) {
          stack.push(char);
        } else if (Object.values(brackets).includes(char)) {
          const last = stack.pop();
          if (!last || brackets[last as keyof typeof brackets] !== char) {
            issues.push('Unbalanced brackets detected');
            break;
          }
        }
      }
      
      if (stack.length > 0) {
        issues.push('Unclosed brackets detected');
      }
    }
    
    return issues;
  }

  private validateStyle(codeBlock: string, styleGuide: string): string[] {
    const issues: string[] = [];
    
    // Basic style validation based on guide
    if (styleGuide === 'javascript') {
      if (codeBlock.includes('\t')) {
        issues.push('Use spaces instead of tabs');
      }
      
      if (codeBlock.includes('var ')) {
        issues.push('Use let/const instead of var');
      }
    }
    
    if (styleGuide === 'typescript') {
      if (codeBlock.includes(': any')) {
        issues.push('Avoid using any type');
      }
    }
    
    return issues;
  }

  private calculateComplexity(codeBlock: string): number {
    // Simple cyclomatic complexity calculation
    const complexityKeywords = [
      'if', 'else', 'for', 'while', 'switch', 'case', 'catch', 'try', '&&', '||', '?'
    ];
    
    let complexity = 1; // Base complexity
    
    for (const keyword of complexityKeywords) {
      const matches = codeBlock.match(new RegExp(keyword, 'g'));
      if (matches) {
        complexity += matches.length;
      }
    }
    
    return complexity;
  }
}

// ===== Hint Generators =====

export class ReadabilityHintGenerator implements HintGenerator {
  async generateHints(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext,
    evaluationResult: EnhancedGateEvaluationResult
  ): Promise<string[]> {
    const hints: string[] = [];
    const { readabilityScore, targetRange } = evaluationResult.details;
    
    if (readabilityScore < targetRange.min) {
      hints.push('Text is too complex. Consider using shorter sentences and simpler words.');
      hints.push('Break long sentences into multiple shorter ones.');
      hints.push('Replace complex vocabulary with more common alternatives.');
    } else if (readabilityScore > targetRange.max) {
      hints.push('Text may be too simple. Consider adding more detailed explanations.');
      hints.push('Use more precise technical vocabulary where appropriate.');
    }
    
    return hints;
  }

  async generateImprovementSuggestions(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext,
    evaluationResult: EnhancedGateEvaluationResult
  ): Promise<ImprovementSuggestion[]> {
    const suggestions: ImprovementSuggestion[] = [];
    const { readabilityScore, targetRange } = evaluationResult.details;
    
    if (readabilityScore < targetRange.min) {
      suggestions.push({
        type: 'content',
        priority: 'medium',
        message: 'Simplify complex sentences',
        example: 'Instead of "The implementation utilizes sophisticated algorithms", use "The system uses advanced methods"',
        autoFixable: false,
      });
    }
    
    return suggestions;
  }
}

export class GrammarHintGenerator implements HintGenerator {
  async generateHints(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext,
    evaluationResult: EnhancedGateEvaluationResult
  ): Promise<string[]> {
    const hints: string[] = [];
    const { issues } = evaluationResult.details;
    
    if (issues.includes('Lowercase "i" should be capitalized')) {
      hints.push('Always capitalize the pronoun "I"');
    }
    
    if (issues.includes('Multiple consecutive spaces found')) {
      hints.push('Use single spaces between words');
    }
    
    if (issues.includes('Text should end with proper punctuation')) {
      hints.push('End sentences with periods, exclamation marks, or question marks');
    }
    
    return hints;
  }

  async generateImprovementSuggestions(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext,
    evaluationResult: EnhancedGateEvaluationResult
  ): Promise<ImprovementSuggestion[]> {
    const suggestions: ImprovementSuggestion[] = [];
    const { issues } = evaluationResult.details;
    
    for (const issue of issues) {
      suggestions.push({
        type: 'format',
        priority: 'medium',
        message: issue,
        autoFixable: true,
      });
    }
    
    return suggestions;
  }
}

// ===== Evaluator Factory =====

export class GateEvaluatorFactory {
  private static evaluators: Map<ExtendedGateType, GateEvaluator> = new Map();
  private static hintGenerators: Map<ExtendedGateType, HintGenerator> = new Map();

  static {
    // Register content quality evaluators
    this.evaluators.set('readability_score', new ReadabilityScoreEvaluator());
    this.evaluators.set('grammar_quality', new GrammarQualityEvaluator());
    this.evaluators.set('tone_analysis', new ToneAnalysisEvaluator());
    
    // Register structure evaluators
    this.evaluators.set('hierarchy_validation', new HierarchyValidationEvaluator());
    this.evaluators.set('code_quality', new CodeQualityEvaluator());
    
    // Register hint generators
    this.hintGenerators.set('readability_score', new ReadabilityHintGenerator());
    this.hintGenerators.set('grammar_quality', new GrammarHintGenerator());
  }

  static getEvaluator(type: ExtendedGateType): GateEvaluator | undefined {
    return this.evaluators.get(type);
  }

  static getHintGenerator(type: ExtendedGateType): HintGenerator | undefined {
    return this.hintGenerators.get(type);
  }

  static getAllEvaluators(): Map<ExtendedGateType, GateEvaluator> {
    return new Map(this.evaluators);
  }

  static getAllHintGenerators(): Map<ExtendedGateType, HintGenerator> {
    return new Map(this.hintGenerators);
  }
}