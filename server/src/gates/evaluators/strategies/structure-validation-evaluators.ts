/**
 * Structure Validation Gate Evaluators
 * Handles structure and format validation including hierarchy, code quality, format validation, and section validation
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

// ===== Format Validation Evaluator (Legacy -> Enhanced) =====

export class FormatValidationEvaluator implements GateEvaluator {
  async evaluate(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext
  ): Promise<EnhancedGateEvaluationResult> {
    const { content } = context;
    const { format } = requirement.criteria;
    
    let result: EnhancedGateEvaluationResult;
    
    switch (format) {
      case 'markdown':
        result = this.validateMarkdownFormat(content);
        break;
      
      case 'json':
        result = this.validateJsonFormat(content);
        break;
      
      case 'yaml':
        result = this.validateYamlFormat(content);
        break;
      
      default:
        result = {
          requirementId: 'format_validation',
          passed: false,
          score: 0,
          message: `Unknown format: ${format}`,
          details: { format },
          hints: [`Supported formats: markdown, json, yaml`],
          improvementSuggestions: [{
            type: 'format',
            priority: 'high',
            message: `Specify a valid format type`,
            autoFixable: false,
          }],
        };
    }
    
    return result;
  }

  private validateMarkdownFormat(content: string): EnhancedGateEvaluationResult {
    const hasHeaders = /^#+\s+/m.test(content);
    const hasProperStructure = content.includes('\n\n');
    
    const passed = hasHeaders && hasProperStructure;
    const score = passed ? 1.0 : (hasHeaders || hasProperStructure ? 0.5 : 0);
    
    const hints: string[] = [];
    const suggestions = [];
    
    if (!hasHeaders) {
      hints.push('Add markdown headers (# ## ###) to structure your content');
      suggestions.push({
        type: 'structure' as const,
        priority: 'medium' as const,
        message: 'Add markdown headers for better structure',
        autoFixable: false,
      });
    }
    
    if (!hasProperStructure) {
      hints.push('Use double line breaks to separate paragraphs');
      suggestions.push({
        type: 'format' as const,
        priority: 'low' as const,
        message: 'Improve paragraph separation with double line breaks',
        autoFixable: true,
      });
    }
    
    return {
      requirementId: 'format_validation',
      passed,
      score,
      message: passed 
        ? 'Valid markdown format detected'
        : 'Content lacks proper markdown structure',
      details: { hasHeaders, hasProperStructure, format: 'markdown' },
      hints,
      improvementSuggestions: suggestions,
    };
  }

  private validateJsonFormat(content: string): EnhancedGateEvaluationResult {
    try {
      JSON.parse(content);
      return {
        requirementId: 'format_validation',
        passed: true,
        score: 1.0,
        message: 'Valid JSON format',
        details: { format: 'json', valid: true },
        hints: [],
        improvementSuggestions: [],
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      return {
        requirementId: 'format_validation',
        passed: false,
        score: 0.0,
        message: `Invalid JSON: ${errorMessage}`,
        details: { format: 'json', valid: false, error: errorMessage },
        hints: [
          'Check for missing quotes around strings',
          'Ensure all brackets and braces are properly closed',
          'Remove trailing commas',
          'Escape special characters in strings'
        ],
        improvementSuggestions: [{
          type: 'format',
          priority: 'high',
          message: 'Fix JSON syntax errors',
          example: 'Use online JSON validator to identify specific issues',
          autoFixable: false,
        }],
      };
    }
  }

  private validateYamlFormat(content: string): EnhancedGateEvaluationResult {
    const hasYamlStructure = /^[\w-]+:\s*/m.test(content);
    
    return {
      requirementId: 'format_validation',
      passed: hasYamlStructure,
      score: hasYamlStructure ? 1.0 : 0.0,
      message: hasYamlStructure 
        ? 'Basic YAML structure detected'
        : 'Content does not appear to be YAML format',
      details: { format: 'yaml', hasYamlStructure },
      hints: hasYamlStructure ? [] : [
        'YAML requires key-value pairs with colons',
        'Use consistent indentation (spaces, not tabs)',
        'Ensure proper nesting structure'
      ],
      improvementSuggestions: hasYamlStructure ? [] : [{
        type: 'format',
        priority: 'high',
        message: 'Add YAML key-value structure',
        example: 'key: value\nother_key: other_value',
        autoFixable: false,
      }],
    };
  }
}

// ===== Section Validation Evaluator (Legacy -> Enhanced) =====

export class SectionValidationEvaluator implements GateEvaluator {
  async evaluate(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext
  ): Promise<EnhancedGateEvaluationResult> {
    const { content } = context;
    const { sections = [], allowExtra = true } = requirement.criteria;
    
    const foundSections: string[] = [];
    const missingSections: string[] = [];
    
    for (const section of sections) {
      if (content.includes(section)) {
        foundSections.push(section);
      } else {
        missingSections.push(section);
      }
    }
    
    const passed = missingSections.length === 0;
    const score = foundSections.length / sections.length;
    
    const hints = missingSections.map(section => 
      `Add missing section: "${section}"`
    );
    
    const suggestions = missingSections.map(section => ({
      type: 'structure' as const,
      priority: 'medium' as const,
      message: `Add required section: ${section}`,
      autoFixable: false,
    }));
    
    return {
      requirementId: 'section_validation',
      passed,
      score,
      message: passed
        ? `All required sections found: ${foundSections.join(', ')}`
        : `Missing sections: ${missingSections.join(', ')}`,
      details: { foundSections, missingSections, total: sections.length, allowExtra },
      hints,
      improvementSuggestions: suggestions,
    };
  }
}

// ===== Hierarchy Validation Evaluator =====

export class HierarchyValidationEvaluator implements GateEvaluator {
  async evaluate(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext
  ): Promise<EnhancedGateEvaluationResult> {
    const { content } = context;
    const { maxDepth, requireH1, consecutiveHeaders } = requirement.criteria;
    
    const hierarchy = this.analyzeHierarchy(content);
    const issues: string[] = [];
    
    if (maxDepth && hierarchy.maxDepth > maxDepth) {
      issues.push(`Header depth exceeds maximum (${hierarchy.maxDepth} > ${maxDepth})`);
    }
    
    if (requireH1 && !hierarchy.hasH1) {
      issues.push('Document must have an H1 header');
    }
    
    if (consecutiveHeaders === false && hierarchy.hasConsecutiveHeaders) {
      issues.push('Document has consecutive headers without content');
    }
    
    const passed = issues.length === 0;
    const score = Math.max(0, 1 - (issues.length / 5));
    
    const hints = issues.map(issue => issue.replace(/Document/, 'Content'));
    const suggestions = issues.map(issue => ({
      type: 'structure' as const,
      priority: 'medium' as const,
      message: issue,
      autoFixable: false,
    }));
    
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
      hints,
      improvementSuggestions: suggestions,
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
    
    let hasConsecutiveHeaders = false;
    for (let i = 0; i < headers.length - 1; i++) {
      const currentHeader = headers[i];
      const nextHeader = headers[i + 1];
      
      const contentBetween = lines.slice(currentHeader.line, nextHeader.line - 1)
        .join('\n').trim();
      
      if (!contentBetween) {
        hasConsecutiveHeaders = true;
        break;
      }
    }
    
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

// ===== Code Quality Evaluator =====

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
    
    const hints = issues.length > 0 ? [
      'Review code blocks for syntax and style issues',
      'Consider breaking complex code into smaller functions',
      'Follow established coding standards and conventions'
    ] : [];
    
    const suggestions = issues.slice(0, 5).map(issue => ({
      type: 'format' as const,
      priority: 'medium' as const,
      message: issue,
      autoFixable: issue.includes('spaces') || issue.includes('var '),
    }));
    
    return {
      requirementId: 'code_quality',
      passed,
      score,
      message: passed ? 'Code quality validation passed' : `Code issues: ${issues.length}`,
      details: {
        codeBlockCount: codeBlocks.length,
        totalComplexity,
        issues: issues.slice(0, 10),
        styleGuide,
        complexityLimit,
      },
      hints,
      improvementSuggestions: suggestions,
    };
  }

  private extractCodeBlocks(text: string): string[] {
    const codeBlockRegex = /```[\s\S]*?```/g;
    const inlineCodeRegex = /`[^`\n]+`/g;
    
    const blocks: string[] = [];
    
    let match;
    while ((match = codeBlockRegex.exec(text)) !== null) {
      blocks.push(match[0]);
    }
    
    while ((match = inlineCodeRegex.exec(text)) !== null) {
      blocks.push(match[0]);
    }
    
    return blocks;
  }

  private validateSyntax(codeBlock: string): string[] {
    const issues: string[] = [];
    
    if (codeBlock.includes('```')) {
      const lines = codeBlock.split('\n');
      if (lines.length < 2) {
        issues.push('Code block is too short');
      }
      
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
    const complexityKeywords = [
      'if', 'else', 'for', 'while', 'switch', 'case', 'catch', 'try', '&&', '||', '?'
    ];
    
    let complexity = 1;
    
    for (const keyword of complexityKeywords) {
      const matches = codeBlock.match(new RegExp(keyword, 'g'));
      if (matches) {
        complexity += matches.length;
      }
    }
    
    return complexity;
  }
}

// ===== Structure Validation Strategy Factory =====

export class StructureValidationEvaluatorFactory {
  private static evaluators: Map<ExtendedGateType, GateEvaluator> = new Map();

  static {
    this.evaluators.set('format_validation', new FormatValidationEvaluator());
    this.evaluators.set('section_validation', new SectionValidationEvaluator());
    this.evaluators.set('hierarchy_validation', new HierarchyValidationEvaluator());
    this.evaluators.set('code_quality', new CodeQualityEvaluator());
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