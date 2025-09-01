/**
 * Pattern Matching Gate Evaluators
 * Handles pattern-based validation including keyword presence and regex matching
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

// ===== Keyword Presence Evaluator (Legacy -> Enhanced) =====

export class KeywordPresenceEvaluator implements GateEvaluator {
  async evaluate(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext
  ): Promise<EnhancedGateEvaluationResult> {
    const { content } = context;
    const { keywords = [], caseSensitive = false, minMatches } = requirement.criteria;
    const contentToCheck = caseSensitive ? content : content.toLowerCase();
    
    const foundKeywords: string[] = [];
    const missingKeywords: string[] = [];
    const keywordCounts: Record<string, number> = {};
    
    for (const keyword of keywords) {
      const keywordToCheck = caseSensitive ? keyword : keyword.toLowerCase();
      const matches = this.countKeywordMatches(contentToCheck, keywordToCheck);
      
      keywordCounts[keyword] = matches;
      
      if (matches > 0) {
        foundKeywords.push(keyword);
      } else {
        missingKeywords.push(keyword);
      }
    }
    
    const totalMatches = Object.values(keywordCounts).reduce((sum, count) => sum + count, 0);
    const requiredMatches = minMatches ?? keywords.length;
    
    const passed = missingKeywords.length === 0 && totalMatches >= requiredMatches;
    const score = foundKeywords.length / keywords.length;
    
    const hints = this.generateKeywordHints(missingKeywords, totalMatches, requiredMatches);
    const suggestions = this.generateKeywordSuggestions(missingKeywords, foundKeywords);
    
    return {
      requirementId: 'keyword_presence',
      passed,
      score,
      message: passed 
        ? `All required keywords found: ${foundKeywords.join(', ')}`
        : `Missing keywords: ${missingKeywords.join(', ')}`,
      details: { 
        foundKeywords, 
        missingKeywords, 
        keywordCounts,
        totalMatches,
        requiredMatches,
        total: keywords.length,
        caseSensitive 
      },
      hints,
      improvementSuggestions: suggestions,
    };
  }

  private countKeywordMatches(content: string, keyword: string): number {
    const regex = new RegExp(this.escapeRegExp(keyword), 'g');
    const matches = content.match(regex);
    return matches ? matches.length : 0;
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private generateKeywordHints(missing: string[], totalMatches: number, requiredMatches: number): string[] {
    const hints: string[] = [];
    
    if (missing.length > 0) {
      hints.push(`Include the following keywords in your content: ${missing.join(', ')}`);
      hints.push('Consider using synonyms or related terms if exact matches are difficult');
    }
    
    if (totalMatches < requiredMatches) {
      hints.push(`Content needs ${requiredMatches - totalMatches} more keyword matches`);
      hints.push('Repeat important keywords naturally throughout the content');
    }
    
    return hints;
  }

  private generateKeywordSuggestions(missing: string[], found: string[]) {
    const suggestions = [];
    
    if (missing.length > 0) {
      suggestions.push({
        type: 'content' as const,
        priority: 'medium' as const,
        message: `Add missing keywords: ${missing.join(', ')}`,
        example: `Include phrases containing: ${missing.slice(0, 3).join(', ')}`,
        autoFixable: false,
      });
    }
    
    if (found.length < missing.length) {
      suggestions.push({
        type: 'content' as const,
        priority: 'low' as const,
        message: 'Consider expanding content to include more relevant keywords',
        autoFixable: false,
      });
    }
    
    return suggestions;
  }
}

// ===== Pattern Matching Evaluator (Extension) =====

export class PatternMatchingEvaluator implements GateEvaluator {
  async evaluate(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext
  ): Promise<EnhancedGateEvaluationResult> {
    const { content } = context;
    const { 
      allowedPatterns = [], 
      blockedPatterns = [],
      caseSensitive = false 
    } = requirement.criteria;
    
    const flags = caseSensitive ? 'g' : 'gi';
    const issues: string[] = [];
    const matchedPatterns: string[] = [];
    const blockedMatches: string[] = [];
    
    // Check allowed patterns
    for (const pattern of allowedPatterns) {
      try {
        const regex = new RegExp(pattern, flags);
        if (regex.test(content)) {
          matchedPatterns.push(pattern);
        }
      } catch (error) {
        issues.push(`Invalid allowed pattern: ${pattern}`);
      }
    }
    
    // Check blocked patterns
    for (const pattern of blockedPatterns) {
      try {
        const regex = new RegExp(pattern, flags);
        if (regex.test(content)) {
          blockedMatches.push(pattern);
          issues.push(`Content contains blocked pattern: ${pattern}`);
        }
      } catch (error) {
        issues.push(`Invalid blocked pattern: ${pattern}`);
      }
    }
    
    const hasAllowedPatterns = allowedPatterns.length === 0 || matchedPatterns.length === allowedPatterns.length;
    const hasNoBlockedPatterns = blockedMatches.length === 0;
    
    const passed = hasAllowedPatterns && hasNoBlockedPatterns && issues.length === 0;
    const score = this.calculatePatternScore(allowedPatterns, matchedPatterns, blockedMatches, issues);
    
    const hints = this.generatePatternHints(allowedPatterns, matchedPatterns, blockedMatches, issues);
    const suggestions = this.generatePatternSuggestions(allowedPatterns, matchedPatterns, blockedMatches);
    
    return {
      requirementId: 'pattern_matching',
      passed,
      score,
      message: this.generatePatternMessage(passed, matchedPatterns, blockedMatches, issues),
      details: {
        allowedPatterns,
        blockedPatterns,
        matchedPatterns,
        blockedMatches,
        issues,
        caseSensitive,
      },
      hints,
      improvementSuggestions: suggestions,
    };
  }

  private calculatePatternScore(
    allowed: string[], 
    matched: string[], 
    blocked: string[], 
    issues: string[]
  ): number {
    if (issues.length > 0) return 0;
    
    const allowedScore = allowed.length > 0 ? matched.length / allowed.length : 1;
    const blockedPenalty = blocked.length > 0 ? 0.5 : 1;
    
    return Math.max(0, allowedScore * blockedPenalty);
  }

  private generatePatternMessage(
    passed: boolean, 
    matched: string[], 
    blocked: string[], 
    issues: string[]
  ): string {
    if (issues.length > 0) {
      return `Pattern validation errors: ${issues.join(', ')}`;
    }
    
    if (!passed) {
      const parts = [];
      if (blocked.length > 0) {
        parts.push(`blocked patterns found: ${blocked.length}`);
      }
      if (matched.length === 0) {
        parts.push('no allowed patterns matched');
      }
      return `Pattern validation failed: ${parts.join(', ')}`;
    }
    
    return `Pattern validation passed: ${matched.length} patterns matched`;
  }

  private generatePatternHints(
    allowed: string[], 
    matched: string[], 
    blocked: string[], 
    issues: string[]
  ): string[] {
    const hints: string[] = [];
    
    if (issues.length > 0) {
      hints.push('Fix invalid regex patterns in configuration');
    }
    
    if (allowed.length > matched.length) {
      const missing = allowed.filter(pattern => !matched.includes(pattern));
      hints.push(`Content should match these patterns: ${missing.join(', ')}`);
    }
    
    if (blocked.length > 0) {
      hints.push(`Remove content matching blocked patterns: ${blocked.join(', ')}`);
      hints.push('Review content for prohibited terms or structures');
    }
    
    return hints;
  }

  private generatePatternSuggestions(allowed: string[], matched: string[], blocked: string[]) {
    const suggestions = [];
    
    if (blocked.length > 0) {
      suggestions.push({
        type: 'content' as const,
        priority: 'high' as const,
        message: `Remove blocked content patterns: ${blocked.join(', ')}`,
        autoFixable: false,
      });
    }
    
    if (allowed.length > matched.length) {
      suggestions.push({
        type: 'content' as const,
        priority: 'medium' as const,
        message: 'Add content matching required patterns',
        autoFixable: false,
      });
    }
    
    return suggestions;
  }
}

// ===== URL/Link Validation Evaluator =====

export class LinkValidationEvaluator implements GateEvaluator {
  async evaluate(
    requirement: ExtendedGateRequirement,
    context: GateEvaluationContext
  ): Promise<EnhancedGateEvaluationResult> {
    const { content } = context;
    const { 
      validateExternal = true, 
      validateInternal = true, 
      brokenLinkTolerance = 0 
    } = requirement.criteria;
    
    const links = this.extractLinks(content);
    const issues: string[] = [];
    const validLinks: string[] = [];
    const invalidLinks: string[] = [];
    
    for (const link of links) {
      const isValid = this.validateLink(link, validateExternal, validateInternal);
      
      if (isValid) {
        validLinks.push(link);
      } else {
        invalidLinks.push(link);
        issues.push(`Invalid link format: ${link}`);
      }
    }
    
    const brokenLinkCount = invalidLinks.length;
    const passed = brokenLinkCount <= brokenLinkTolerance;
    const score = links.length > 0 ? validLinks.length / links.length : 1;
    
    const hints = this.generateLinkHints(invalidLinks, brokenLinkCount, brokenLinkTolerance);
    const suggestions = this.generateLinkSuggestions(invalidLinks);
    
    return {
      requirementId: 'link_validation',
      passed,
      score,
      message: passed 
        ? `Link validation passed: ${validLinks.length}/${links.length} valid links`
        : `Link validation failed: ${brokenLinkCount} invalid links (tolerance: ${brokenLinkTolerance})`,
      details: {
        totalLinks: links.length,
        validLinks: validLinks.length,
        invalidLinks: brokenLinkCount,
        brokenLinkTolerance,
        validateExternal,
        validateInternal,
        issues: issues.slice(0, 10),
      },
      hints,
      improvementSuggestions: suggestions,
    };
  }

  private extractLinks(content: string): string[] {
    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
    const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/gi;
    const htmlLinkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
    
    const links: string[] = [];
    
    // Extract URLs
    let match;
    while ((match = urlRegex.exec(content)) !== null) {
      links.push(match[0]);
    }
    
    // Extract markdown links
    while ((match = markdownLinkRegex.exec(content)) !== null) {
      links.push(match[2]);
    }
    
    // Extract HTML links
    while ((match = htmlLinkRegex.exec(content)) !== null) {
      links.push(match[1]);
    }
    
    return Array.from(new Set(links)); // Remove duplicates
  }

  private validateLink(link: string, validateExternal: boolean, validateInternal: boolean): boolean {
    try {
      if (link.startsWith('#') || link.startsWith('/')) {
        return validateInternal;
      }
      
      if (link.startsWith('http://') || link.startsWith('https://')) {
        if (!validateExternal) return true;
        
        // Basic URL format validation
        const url = new URL(link);
        return url.protocol === 'http:' || url.protocol === 'https:';
      }
      
      return false;
    } catch (error) {
      return false;
    }
  }

  private generateLinkHints(invalid: string[], count: number, tolerance: number): string[] {
    const hints: string[] = [];
    
    if (count > tolerance) {
      hints.push(`Fix ${count - tolerance} invalid links to meet tolerance level`);
      hints.push('Check for broken URLs, missing protocols, or malformed link syntax');
    }
    
    if (invalid.length > 0) {
      hints.push('Common link issues: missing http/https, broken markdown syntax, invalid characters');
      hints.push('Test links manually to ensure they work correctly');
    }
    
    return hints;
  }

  private generateLinkSuggestions(invalid: string[]) {
    if (invalid.length === 0) return [];
    
    return [{
      type: 'format' as const,
      priority: 'medium' as const,
      message: `Fix ${invalid.length} invalid links`,
      example: 'Ensure URLs start with http:// or https://',
      autoFixable: false,
    }];
  }
}

// ===== Pattern Matching Strategy Factory =====

export class PatternMatchingEvaluatorFactory {
  private static evaluators: Map<ExtendedGateType, GateEvaluator> = new Map();

  static {
    this.evaluators.set('keyword_presence', new KeywordPresenceEvaluator());
    this.evaluators.set('pattern_matching', new PatternMatchingEvaluator());
    this.evaluators.set('link_validation', new LinkValidationEvaluator());
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