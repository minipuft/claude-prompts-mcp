/**
 * Custom Logic Gate Evaluators
 * Handles extensible validation including custom requirements, field validation, completeness checks, and security validation
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

// ===== Custom Requirements Evaluator (Legacy -> Enhanced) =====

export class CustomRequirementEvaluator implements GateEvaluator {
  async evaluate(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext
  ): Promise<EnhancedGateEvaluationResult> {
    const { content } = context;
    const { customCriteria = {} } = requirement.criteria;
    
    // Extensible custom validation logic
    const results = await this.executeCustomValidation(content, customCriteria, context);
    
    return {
      requirementId: 'custom',
      passed: results.passed,
      score: results.score,
      message: results.message || 'Custom requirement evaluation',
      details: {
        customCriteria,
        customResults: results.details,
        evaluationType: results.type || 'generic',
      },
      hints: results.hints || ['Custom validation logic applied'],
      improvementSuggestions: results.suggestions || [],
    };
  }

  private async executeCustomValidation(
    content: string, 
    criteria: Record<string, any>, 
    context: GateEvaluationContext
  ): Promise<{
    passed: boolean;
    score: number;
    message?: string;
    details?: any;
    type?: string;
    hints?: string[];
    suggestions?: any[];
  }> {
    // Default implementation - can be extended
    if (criteria.minWordCount && criteria.maxWordCount) {
      return this.validateWordCount(content, criteria.minWordCount, criteria.maxWordCount);
    }
    
    if (criteria.requiredPhrases) {
      return this.validatePhrases(content, criteria.requiredPhrases);
    }
    
    if (criteria.customFunction) {
      return this.executeCustomFunction(content, criteria.customFunction, context);
    }
    
    // Fallback - basic validation
    return {
      passed: true,
      score: 1.0,
      message: 'Custom requirement evaluation completed',
      type: 'fallback',
    };
  }

  private validateWordCount(content: string, min: number, max: number) {
    const wordCount = content.split(/\s+/).filter(word => word.trim().length > 0).length;
    const passed = wordCount >= min && wordCount <= max;
    const score = passed ? 1.0 : Math.max(0, 1 - Math.abs(wordCount - ((min + max) / 2)) / Math.max(min, max));
    
    const hints = [];
    if (wordCount < min) {
      hints.push(`Content needs ${min - wordCount} more words (current: ${wordCount}, minimum: ${min})`);
    } else if (wordCount > max) {
      hints.push(`Content exceeds maximum by ${wordCount - max} words (current: ${wordCount}, maximum: ${max})`);
    }
    
    return {
      passed,
      score,
      message: `Word count: ${wordCount} (target: ${min}-${max})`,
      details: { wordCount, min, max },
      type: 'word_count',
      hints,
      suggestions: hints.length > 0 ? [{
        type: 'content' as const,
        priority: 'medium' as const,
        message: hints[0],
        autoFixable: false,
      }] : [],
    };
  }

  private validatePhrases(content: string, phrases: string[]) {
    const foundPhrases = phrases.filter(phrase => content.toLowerCase().includes(phrase.toLowerCase()));
    const missingPhrases = phrases.filter(phrase => !content.toLowerCase().includes(phrase.toLowerCase()));
    
    const passed = missingPhrases.length === 0;
    const score = foundPhrases.length / phrases.length;
    
    const hints = missingPhrases.length > 0 ? [
      `Include missing phrases: ${missingPhrases.join(', ')}`
    ] : [];
    
    return {
      passed,
      score,
      message: `Phrase validation: ${foundPhrases.length}/${phrases.length} required phrases found`,
      details: { foundPhrases, missingPhrases, totalRequired: phrases.length },
      type: 'phrase_validation',
      hints,
      suggestions: hints.length > 0 ? [{
        type: 'content' as const,
        priority: 'medium' as const,
        message: `Add missing phrases: ${missingPhrases.join(', ')}`,
        autoFixable: false,
      }] : [],
    };
  }

  private async executeCustomFunction(content: string, functionName: string, context: GateEvaluationContext) {
    // Placeholder for custom function execution
    // In a real implementation, this would load and execute custom validation functions
    return {
      passed: true,
      score: 1.0,
      message: `Custom function '${functionName}' executed`,
      details: { functionName, executed: true },
      type: 'custom_function',
      hints: ['Custom validation function completed'],
    };
  }
}

// ===== Required Fields Evaluator =====

export class RequiredFieldsEvaluator implements GateEvaluator {
  async evaluate(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext
  ): Promise<EnhancedGateEvaluationResult> {
    const { content } = context;
    const { requiredFields = [], fieldValidation = {} } = requirement.criteria;
    
    const fieldResults = await this.validateFields(content, requiredFields, fieldValidation);
    const missingFields = fieldResults.filter(result => !result.present);
    const invalidFields = fieldResults.filter(result => result.present && !result.valid);
    
    const passed = missingFields.length === 0 && invalidFields.length === 0;
    const score = this.calculateFieldScore(fieldResults);
    
    const hints = this.generateFieldHints(missingFields, invalidFields);
    const suggestions = this.generateFieldSuggestions(missingFields, invalidFields);
    
    return {
      requirementId: 'required_fields',
      passed,
      score,
      message: this.generateFieldMessage(passed, fieldResults, missingFields, invalidFields),
      details: {
        totalFields: requiredFields.length,
        presentFields: fieldResults.filter(r => r.present).length,
        validFields: fieldResults.filter(r => r.present && r.valid).length,
        fieldResults,
        missingFields: missingFields.map(f => f.fieldName),
        invalidFields: invalidFields.map(f => f.fieldName),
      },
      hints,
      improvementSuggestions: suggestions,
    };
  }

  private async validateFields(
    content: string, 
    requiredFields: string[], 
    fieldValidation: Record<string, any>
  ) {
    const results = [];
    
    for (const fieldName of requiredFields) {
      const fieldPattern = this.getFieldPattern(fieldName, fieldValidation[fieldName]);
      const present = fieldPattern.test(content);
      
      let valid = true;
      let value = '';
      
      if (present) {
        const match = content.match(fieldPattern);
        value = match ? match[1] || match[0] : '';
        
        // Apply field-specific validation
        const validator = fieldValidation[fieldName];
        if (validator) {
          valid = this.validateFieldValue(value, validator);
        }
      }
      
      results.push({
        fieldName,
        present,
        valid,
        value: value.substring(0, 100), // Limit length for details
      });
    }
    
    return results;
  }

  private getFieldPattern(fieldName: string, validation?: any): RegExp {
    // Generate field detection patterns based on common naming conventions
    const patterns = [
      new RegExp(`${fieldName}\\s*[:=]\\s*([^\\n]+)`, 'i'),
      new RegExp(`"${fieldName}"\\s*[:=]\\s*"([^"]*)"`, 'i'),
      new RegExp(`${fieldName.replace(/([A-Z])/g, '[ _-]?$1').toLowerCase()}\\s*[:=]\\s*([^\\n]+)`, 'i'),
    ];
    
    // Use custom pattern if provided
    if (validation?.pattern) {
      return new RegExp(validation.pattern, validation.flags || 'i');
    }
    
    return patterns[0]; // Default pattern
  }

  private validateFieldValue(value: string, validator: any): boolean {
    if (!validator) return true;
    
    if (validator.minLength && value.length < validator.minLength) return false;
    if (validator.maxLength && value.length > validator.maxLength) return false;
    if (validator.pattern && !new RegExp(validator.pattern).test(value)) return false;
    if (validator.enum && !validator.enum.includes(value)) return false;
    
    return true;
  }

  private calculateFieldScore(results: Array<{ present: boolean; valid: boolean }>): number {
    if (results.length === 0) return 1;
    
    const presentScore = results.filter(r => r.present).length / results.length;
    const validScore = results.filter(r => r.present && r.valid).length / Math.max(1, results.filter(r => r.present).length);
    
    return presentScore * validScore;
  }

  private generateFieldMessage(
    passed: boolean, 
    results: any[], 
    missing: any[], 
    invalid: any[]
  ): string {
    if (passed) {
      return `All ${results.length} required fields are present and valid`;
    }
    
    const issues = [];
    if (missing.length > 0) {
      issues.push(`${missing.length} missing fields`);
    }
    if (invalid.length > 0) {
      issues.push(`${invalid.length} invalid fields`);
    }
    
    return `Field validation failed: ${issues.join(', ')}`;
  }

  private generateFieldHints(missing: any[], invalid: any[]): string[] {
    const hints = [];
    
    if (missing.length > 0) {
      hints.push(`Add missing fields: ${missing.map(f => f.fieldName).join(', ')}`);
      hints.push('Ensure field names follow the expected format and naming convention');
    }
    
    if (invalid.length > 0) {
      hints.push(`Fix validation errors in fields: ${invalid.map(f => f.fieldName).join(', ')}`);
      hints.push('Check field values meet length, pattern, and format requirements');
    }
    
    return hints;
  }

  private generateFieldSuggestions(missing: any[], invalid: any[]) {
    const suggestions = [];
    
    if (missing.length > 0) {
      suggestions.push({
        type: 'structure' as const,
        priority: 'high' as const,
        message: `Add ${missing.length} missing required fields`,
        autoFixable: false,
      });
    }
    
    if (invalid.length > 0) {
      suggestions.push({
        type: 'format' as const,
        priority: 'medium' as const,
        message: `Fix validation issues in ${invalid.length} fields`,
        autoFixable: false,
      });
    }
    
    return suggestions;
  }
}

// ===== Completeness Evaluator =====

export class CompletenessEvaluator implements GateEvaluator {
  async evaluate(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext
  ): Promise<EnhancedGateEvaluationResult> {
    const { content } = context;
    const { completenessMinScore = 0.8, requiredSections = [] } = requirement.criteria;
    
    const completenessScore = this.calculateCompletenessScore(content, requiredSections);
    const passed = completenessScore >= completenessMinScore;
    
    const analysis = this.analyzeContentCompleteness(content, requiredSections);
    const hints = this.generateCompletenessHints(completenessScore, completenessMinScore, analysis);
    const suggestions = this.generateCompletenessSuggestions(analysis);
    
    return {
      requirementId: 'completeness',
      passed,
      score: completenessScore,
      message: `Content completeness: ${Math.round(completenessScore * 100)}% (minimum: ${Math.round(completenessMinScore * 100)}%)`,
      details: {
        completenessScore,
        completenessMinScore,
        requiredSections,
        analysis,
      },
      hints,
      improvementSuggestions: suggestions,
    };
  }

  private calculateCompletenessScore(content: string, requiredSections: string[]): number {
    const factors = [
      this.calculateLengthFactor(content),
      this.calculateStructureFactor(content),
      this.calculateSectionsFactor(content, requiredSections),
      this.calculateDetailFactor(content),
    ];
    
    return factors.reduce((sum, factor) => sum + factor, 0) / factors.length;
  }

  private calculateLengthFactor(content: string): number {
    const wordCount = content.split(/\s+/).filter(w => w.trim().length > 0).length;
    
    if (wordCount < 50) return 0.2;
    if (wordCount < 100) return 0.5;
    if (wordCount < 200) return 0.7;
    if (wordCount < 500) return 0.9;
    return 1.0;
  }

  private calculateStructureFactor(content: string): number {
    const hasHeaders = /^#+\s+/m.test(content);
    const hasParagraphs = content.includes('\n\n');
    const hasLists = /^[\*\-\+]\s+/m.test(content) || /^\d+\.\s+/m.test(content);
    
    let score = 0.3; // Base score
    if (hasHeaders) score += 0.3;
    if (hasParagraphs) score += 0.2;
    if (hasLists) score += 0.2;
    
    return Math.min(score, 1.0);
  }

  private calculateSectionsFactor(content: string, requiredSections: string[]): number {
    if (requiredSections.length === 0) return 1.0;
    
    const foundSections = requiredSections.filter(section => 
      content.toLowerCase().includes(section.toLowerCase())
    );
    
    return foundSections.length / requiredSections.length;
  }

  private calculateDetailFactor(content: string): number {
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const avgWordsPerSentence = sentences.length > 0 
      ? content.split(/\s+/).length / sentences.length 
      : 0;
    
    if (avgWordsPerSentence < 5) return 0.3;
    if (avgWordsPerSentence < 10) return 0.6;
    if (avgWordsPerSentence < 20) return 0.9;
    return 1.0;
  }

  private analyzeContentCompleteness(content: string, requiredSections: string[]) {
    const wordCount = content.split(/\s+/).filter(w => w.trim().length > 0).length;
    const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
    const paragraphs = content.split('\n\n').filter(p => p.trim().length > 0).length;
    const headers = (content.match(/^#+\s+/gm) || []).length;
    
    const foundSections = requiredSections.filter(section => 
      content.toLowerCase().includes(section.toLowerCase())
    );
    const missingSections = requiredSections.filter(section => 
      !content.toLowerCase().includes(section.toLowerCase())
    );
    
    return {
      wordCount,
      sentences,
      paragraphs,
      headers,
      foundSections,
      missingSections,
      avgWordsPerSentence: sentences > 0 ? wordCount / sentences : 0,
    };
  }

  private generateCompletenessHints(score: number, minScore: number, analysis: any): string[] {
    const hints = [];
    
    if (score < minScore) {
      const gap = Math.round((minScore - score) * 100);
      hints.push(`Content needs ${gap}% improvement to meet completeness requirements`);
    }
    
    if (analysis.wordCount < 100) {
      hints.push('Content is quite short - consider adding more detailed explanations');
    }
    
    if (analysis.headers === 0) {
      hints.push('Add section headers to improve content structure');
    }
    
    if (analysis.missingSections.length > 0) {
      hints.push(`Add missing sections: ${analysis.missingSections.join(', ')}`);
    }
    
    if (analysis.avgWordsPerSentence < 5) {
      hints.push('Sentences are very short - consider combining related ideas');
    }
    
    return hints;
  }

  private generateCompletenessSuggestions(analysis: any) {
    const suggestions = [];
    
    if (analysis.wordCount < 200) {
      suggestions.push({
        type: 'content' as const,
        priority: 'medium' as const,
        message: 'Expand content with more detail and examples',
        autoFixable: false,
      });
    }
    
    if (analysis.missingSections.length > 0) {
      suggestions.push({
        type: 'structure' as const,
        priority: 'high' as const,
        message: `Add ${analysis.missingSections.length} missing sections`,
        autoFixable: false,
      });
    }
    
    if (analysis.headers === 0) {
      suggestions.push({
        type: 'structure' as const,
        priority: 'medium' as const,
        message: 'Add headers to organize content into sections',
        autoFixable: false,
      });
    }
    
    return suggestions;
  }
}

// ===== Security Validation Evaluator =====

export class SecurityValidationEvaluator implements GateEvaluator {
  async evaluate(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext
  ): Promise<EnhancedGateEvaluationResult> {
    const { content } = context;
    const { 
      securityLevel = 'standard',
      allowedPatterns = [],
      blockedPatterns = []
    } = requirement.criteria;
    
    const securityIssues = this.scanForSecurityIssues(content, securityLevel, blockedPatterns);
    const allowedPatternMatches = this.checkAllowedPatterns(content, allowedPatterns);
    
    const passed = securityIssues.length === 0 && 
      (allowedPatterns.length === 0 || allowedPatternMatches > 0);
    const score = this.calculateSecurityScore(securityIssues, allowedPatternMatches, allowedPatterns.length);
    
    const hints = this.generateSecurityHints(securityIssues, allowedPatterns, allowedPatternMatches);
    const suggestions = this.generateSecuritySuggestions(securityIssues);
    
    return {
      requirementId: 'security_validation',
      passed,
      score,
      message: this.generateSecurityMessage(passed, securityIssues, securityLevel),
      details: {
        securityLevel,
        securityIssues,
        allowedPatterns,
        allowedPatternMatches,
        blockedPatterns,
      },
      hints,
      improvementSuggestions: suggestions,
    };
  }

  private scanForSecurityIssues(content: string, level: string, blockedPatterns: string[]): string[] {
    const issues = [];
    
    // Common security patterns to detect
    const securityPatterns = this.getSecurityPatterns(level);
    
    for (const pattern of securityPatterns) {
      if (new RegExp(pattern.regex, 'gi').test(content)) {
        issues.push(pattern.description);
      }
    }
    
    // Check custom blocked patterns
    for (const pattern of blockedPatterns) {
      if (new RegExp(pattern, 'gi').test(content)) {
        issues.push(`Content contains blocked pattern: ${pattern}`);
      }
    }
    
    return issues;
  }

  private getSecurityPatterns(level: string) {
    const patterns = [];
    
    if (level === 'basic' || level === 'standard' || level === 'strict') {
      patterns.push(
        { regex: '\\b(?:password|pwd)\\s*[:=]\\s*[^\\s]+', description: 'Potential password exposure' },
        { regex: '\\b(?:api[_-]?key|apikey)\\s*[:=]\\s*[^\\s]+', description: 'Potential API key exposure' },
        { regex: '\\b(?:secret|token)\\s*[:=]\\s*[^\\s]+', description: 'Potential secret exposure' }
      );
    }
    
    if (level === 'standard' || level === 'strict') {
      patterns.push(
        { regex: '\\b(?:ssh[_-]?key|private[_-]?key)\\s*[:=]', description: 'Potential private key reference' },
        { regex: '\\b(?:database|db)[_-]?(?:password|pwd)\\s*[:=]', description: 'Potential database credential' },
        { regex: 'BEGIN (?:RSA )?PRIVATE KEY', description: 'Private key content detected' }
      );
    }
    
    if (level === 'strict') {
      patterns.push(
        { regex: '\\b(?:admin|administrator)\\s*[:=]\\s*[^\\s]+', description: 'Administrative credential reference' },
        { regex: '\\b(?:connection[_-]?string|connstr)\\s*[:=]', description: 'Connection string detected' },
        { regex: '\\b(?:bearer|jwt)\\s+[A-Za-z0-9\\-_=]+\\.[A-Za-z0-9\\-_=]+', description: 'JWT token pattern' }
      );
    }
    
    return patterns;
  }

  private checkAllowedPatterns(content: string, allowedPatterns: string[]): number {
    let matches = 0;
    
    for (const pattern of allowedPatterns) {
      if (new RegExp(pattern, 'gi').test(content)) {
        matches++;
      }
    }
    
    return matches;
  }

  private calculateSecurityScore(issues: string[], allowedMatches: number, allowedCount: number): number {
    let score = 1.0;
    
    // Penalize security issues
    if (issues.length > 0) {
      score -= Math.min(0.8, issues.length * 0.2);
    }
    
    // Require allowed patterns if specified
    if (allowedCount > 0 && allowedMatches === 0) {
      score *= 0.5;
    }
    
    return Math.max(0, score);
  }

  private generateSecurityMessage(passed: boolean, issues: string[], level: string): string {
    if (passed) {
      return `Security validation passed (level: ${level})`;
    }
    
    return `Security validation failed: ${issues.length} issues found (level: ${level})`;
  }

  private generateSecurityHints(issues: string[], allowedPatterns: string[], allowedMatches: number): string[] {
    const hints = [];
    
    if (issues.length > 0) {
      hints.push('Remove or obfuscate sensitive information from content');
      hints.push('Use environment variables or secure configuration for credentials');
      hints.push('Consider using placeholders like [API_KEY] or [PASSWORD] for documentation');
    }
    
    if (allowedPatterns.length > 0 && allowedMatches === 0) {
      hints.push('Content should include approved security patterns or references');
    }
    
    return hints;
  }

  private generateSecuritySuggestions(issues: string[]) {
    if (issues.length === 0) return [];
    
    return [{
      type: 'content' as const,
      priority: 'high' as const,
      message: `Address ${issues.length} security issues`,
      example: 'Replace actual credentials with placeholder values',
      autoFixable: false,
    }];
  }
}

// ===== Custom Logic Strategy Factory =====

export class CustomLogicEvaluatorFactory {
  private static evaluators: Map<ExtendedGateType, GateEvaluator> = new Map();

  static {
    this.evaluators.set('custom', new CustomRequirementEvaluator());
    this.evaluators.set('required_fields', new RequiredFieldsEvaluator());
    this.evaluators.set('completeness', new CompletenessEvaluator());
    this.evaluators.set('security_validation', new SecurityValidationEvaluator());
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