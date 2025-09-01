/**
 * Content Analysis Gate Evaluators
 * Handles content-focused validation including readability, grammar, tone, and length analysis
 */

import { Logger } from "../../../logging/index.js";
import {
  GateRequirement,
  GateEvaluationResult,
} from "../../../types/index.js";
import type {
  ExtendedGateType,
  ExtendedGateRequirement,
  GateEvaluationContext,
  EnhancedGateEvaluationResult,
  GateEvaluator,
} from "../../registry/gate-registry.js";

// ===== Content Length Evaluator (Legacy -> Enhanced) =====

export class ContentLengthEvaluator implements GateEvaluator {
  async evaluate(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext
  ): Promise<EnhancedGateEvaluationResult> {
    const { content } = context;
    const { min, max } = requirement.criteria;
    const length = content.length;
    
    let passed = true;
    let message = `Content length: ${length} characters`;
    
    if (min && length < min) {
      passed = false;
      message += ` (minimum: ${min})`;
    }
    
    if (max && length > max) {
      passed = false;
      message += ` (maximum: ${max})`;
    }

    const score = passed ? 1.0 : Math.max(0, 1 - Math.abs(length - (min || max || length)) / Math.max(min || length, max || length));

    return {
      requirementId: 'content_length',
      passed,
      score,
      message,
      details: { length, min, max },
      hints: passed ? [] : this.generateLengthHints(length, min, max),
      improvementSuggestions: passed ? [] : [{
        type: 'content',
        priority: 'medium',
        message: length < (min || 0) ? 'Content is too short' : 'Content is too long',
        autoFixable: false,
      }],
    };
  }

  private generateLengthHints(length: number, min?: number, max?: number): string[] {
    const hints: string[] = [];
    
    if (min && length < min) {
      hints.push(`Add ${min - length} more characters to meet minimum length requirement`);
      hints.push('Consider adding more detail, examples, or explanations');
    }
    
    if (max && length > max) {
      hints.push(`Remove ${length - max} characters to meet maximum length requirement`);
      hints.push('Consider condensing content or removing redundant information');
    }
    
    return hints;
  }
}

// ===== Readability Score Evaluator =====

export class ReadabilityScoreEvaluator implements GateEvaluator {
  async evaluate(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext
  ): Promise<EnhancedGateEvaluationResult> {
    const { content } = context;
    const { readabilityTarget, fleschKincaidMin, fleschKincaidMax } = requirement.criteria;
    
    const readabilityScore = this.calculateFleschKincaidScore(content);
    
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
      hints: passed ? [] : this.generateReadabilityHints(readabilityScore, minScore, maxScore),
      improvementSuggestions: passed ? [] : this.generateReadabilityImprovements(readabilityScore, minScore, maxScore),
    };
  }

  private calculateFleschKincaidScore(text: string): number {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
    const words = text.split(/\s+/).filter(w => w.trim().length > 0).length;
    const syllables = this.countSyllables(text);
    
    if (sentences === 0 || words === 0) return 0;
    
    const score = 206.835 - (1.015 * (words / sentences)) - (84.6 * (syllables / words));
    return Math.max(0, Math.min(100, score));
  }

  private countSyllables(text: string): number {
    return text.toLowerCase()
      .replace(/[^a-z]/g, '')
      .replace(/[aeiou]{2,}/g, 'a')
      .replace(/[^aeiou]/g, '')
      .length || 1;
  }

  private getTargetRange(target?: string): { min: number; max: number } {
    switch (target) {
      case 'beginner': return { min: 90, max: 100 };
      case 'intermediate': return { min: 70, max: 89 };
      case 'advanced': return { min: 50, max: 69 };
      case 'expert': return { min: 30, max: 49 };
      default: return { min: 60, max: 80 };
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
    if (score < min) return Math.max(0, 1 - ((min - score) / min));
    if (score > max) return Math.max(0, 1 - ((score - max) / (100 - max)));
    return 1;
  }

  private generateReadabilityHints(score: number, min: number, max: number): string[] {
    const hints: string[] = [];
    
    if (score < min) {
      hints.push('Text is too complex. Consider using shorter sentences and simpler words.');
      hints.push('Break long sentences into multiple shorter ones.');
      hints.push('Replace complex vocabulary with more common alternatives.');
    } else if (score > max) {
      hints.push('Text may be too simple. Consider adding more detailed explanations.');
      hints.push('Use more precise technical vocabulary where appropriate.');
    }
    
    return hints;
  }

  private generateReadabilityImprovements(score: number, min: number, max: number) {
    if (score < min) {
      return [{
        type: 'content' as const,
        priority: 'medium' as const,
        message: 'Simplify complex sentences',
        example: 'Instead of "The implementation utilizes sophisticated algorithms", use "The system uses advanced methods"',
        autoFixable: false,
      }];
    }
    return [];
  }
}

// ===== Grammar Quality Evaluator =====

export class GrammarQualityEvaluator implements GateEvaluator {
  async evaluate(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext
  ): Promise<EnhancedGateEvaluationResult> {
    const { content } = context;
    const { grammarStrength, allowedErrors } = requirement.criteria;
    
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
        issues: grammarIssues.slice(0, 5),
      },
      hints: this.generateGrammarHints(grammarIssues),
      improvementSuggestions: grammarIssues.map(issue => ({
        type: 'format' as const,
        priority: 'medium' as const,
        message: issue,
        autoFixable: true,
      })),
    };
  }

  private analyzeGrammar(text: string, strength?: string): string[] {
    const issues: string[] = [];
    
    if (strength === 'strict' || strength === 'standard') {
      if (text.includes(' i ') || text.startsWith('i ')) {
        issues.push('Lowercase "i" should be capitalized');
      }
      
      if (text.includes('  ')) {
        issues.push('Multiple consecutive spaces found');
      }
      
      if (!/[.!?]$/.test(text.trim())) {
        issues.push('Text should end with proper punctuation');
      }
      
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

  private generateGrammarHints(issues: string[]): string[] {
    const hints: string[] = [];
    
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
}

// ===== Tone Analysis Evaluator =====

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
      hints: this.generateToneHints(expectedTone, detectedTone, toneMatches),
      improvementSuggestions: toneMatches ? [] : [{
        type: 'style' as const,
        priority: 'medium' as const,
        message: `Adjust tone from ${detectedTone} to ${expectedTone}`,
        autoFixable: false,
      }],
    };
  }

  private analyzeTone(text: string): { tone: string; confidence: number; indicators: string[] } {
    const indicators: string[] = [];
    let tone = 'neutral';
    let confidence = 0.5;
    
    const lowerText = text.toLowerCase();
    
    if (lowerText.includes('please') || lowerText.includes('thank you') || 
        lowerText.includes('sincerely') || lowerText.includes('respectfully')) {
      tone = 'professional';
      confidence = 0.8;
      indicators.push('formal phrases');
    }
    
    if (lowerText.includes('algorithm') || lowerText.includes('implementation') ||
        lowerText.includes('configuration') || lowerText.includes('specification')) {
      tone = 'technical';
      confidence = 0.9;
      indicators.push('technical terminology');
    }
    
    if (lowerText.includes('hey') || lowerText.includes('awesome') ||
        lowerText.includes("it's") || lowerText.includes("we'll")) {
      tone = 'casual';
      confidence = 0.7;
      indicators.push('informal language');
    }
    
    if (lowerText.includes('welcome') || lowerText.includes('happy') ||
        lowerText.includes('excited') || lowerText.includes('glad')) {
      tone = 'friendly';
      confidence = 0.8;
      indicators.push('positive language');
    }
    
    return { tone, confidence, indicators };
  }

  private generateToneHints(expected?: string, detected?: string, matches?: boolean): string[] {
    if (matches) return [];
    
    const hints: string[] = [];
    
    if (expected === 'professional' && detected !== 'professional') {
      hints.push('Use more formal language and professional terminology');
      hints.push('Avoid contractions and casual expressions');
    }
    
    if (expected === 'casual' && detected !== 'casual') {
      hints.push('Use more conversational language and contractions');
      hints.push('Include friendly, approachable phrases');
    }
    
    if (expected === 'technical' && detected !== 'technical') {
      hints.push('Include more technical terminology and precise language');
      hints.push('Use industry-specific vocabulary and concepts');
    }
    
    return hints;
  }
}

// ===== Content Analysis Strategy Factory =====

export class ContentAnalysisEvaluatorFactory {
  private static evaluators: Map<ExtendedGateType, GateEvaluator> = new Map();

  static {
    this.evaluators.set('content_length', new ContentLengthEvaluator());
    this.evaluators.set('readability_score', new ReadabilityScoreEvaluator());
    this.evaluators.set('grammar_quality', new GrammarQualityEvaluator());
    this.evaluators.set('tone_analysis', new ToneAnalysisEvaluator());
  }

  static getEvaluator(type: ExtendedGateType): GateEvaluator | undefined {
    return this.evaluators.get(type);
  }

  static getAllEvaluators(): Map<ExtendedGateType, GateEvaluator> {
    return new Map(this.evaluators);
  }

  static getSupportedTypes(): ExtendedGateType[] {
    return Array.from(this.evaluators.keys());
  }
}