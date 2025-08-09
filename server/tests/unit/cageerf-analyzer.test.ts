/**
 * CAGEERF Analyzer Unit Tests
 * Tests extracted from GitHub Actions inline scripts
 */

import { CAGEERFAnalyzer } from '../../dist/utils/cageerf-analyzer.js';
import { createConvertedPrompt } from '../helpers/test-helpers.js';

describe('CAGEERF Analyzer', () => {
  let analyzer: CAGEERFAnalyzer;

  beforeEach(() => {
    analyzer = new CAGEERFAnalyzer();
  });

  describe('Basic Functionality', () => {
    test('should instantiate successfully', () => {
      expect(analyzer).toBeInstanceOf(CAGEERFAnalyzer);
    });

    test('should analyze simple prompt', () => {
      const analysis = analyzer.analyzeText('Simple prompt');
      
      expect(analysis).toBeDefined();
      expect(analysis.compliance).toBeDefined();
      expect(analysis.frameworkScore).toBeDefined();
      expect(analysis.overallCompliance).toBeDefined();
      expect(typeof analysis.frameworkScore).toBe('number');
      expect(analysis.frameworkScore).toBeGreaterThanOrEqual(0);
      expect(analysis.frameworkScore).toBeLessThanOrEqual(1);
    });

    test('should analyze prompt with CAGEERF keywords', () => {
      const prompt = 'Context analysis goals execution evaluation refinement framework methodology';
      const analysis = analyzer.analyzeText(prompt);
      
      // Keywords alone don't make a strong framework, so expect reasonable but not high score
      expect(analysis.frameworkScore).toBeGreaterThan(0.1);
      expect(analysis.frameworkScore).toBeLessThan(0.8); // Simple keywords shouldn't score too high
      expect(analysis.compliance).toHaveProperty('context');
      expect(analysis.compliance).toHaveProperty('analysis');
      expect(analysis.compliance).toHaveProperty('goals');
      expect(analysis.compliance).toHaveProperty('execution');
      expect(analysis.compliance).toHaveProperty('evaluation');
      expect(analysis.compliance).toHaveProperty('refinement');
      expect(analysis.compliance).toHaveProperty('framework');
    });
  });

  describe('Edge Cases', () => {
    test('should handle empty string', () => {
      const analysis = analyzer.analyzeText('');
      
      expect(analysis).toBeDefined();
      expect(analysis.frameworkScore).toBe(0);
    });

    test('should handle very long input', () => {
      const longPrompt = 'A'.repeat(10000);
      const analysis = analyzer.analyzeText(longPrompt);
      
      expect(analysis).toBeDefined();
      expect(analysis.frameworkScore).toBeGreaterThanOrEqual(0);
      expect(analysis.frameworkScore).toBeLessThanOrEqual(1);
    });

    test('should handle special characters and emojis', () => {
      const prompt = '🚀 Analyze 📊 the data with systematic approach! 🎯';
      const analysis = analyzer.analyzeText(prompt);
      
      expect(analysis).toBeDefined();
      expect(analysis.frameworkScore).toBeGreaterThanOrEqual(0);
      expect(analysis.frameworkScore).toBeLessThanOrEqual(1);
    });

    test('should handle null/undefined gracefully', () => {
      expect(() => analyzer.analyzeText(null as any)).not.toThrow();
      expect(() => analyzer.analyzeText(undefined as any)).not.toThrow();
    });
  });

  describe('Component Analysis', () => {
    test('should identify all CAGEERF components', () => {
      const prompt = 'Establish context, perform analysis, set clear goals, execute the plan, evaluate results, refine methodology, and strengthen the framework';
      const convertedPrompt = createConvertedPrompt(prompt);
      const analysis = analyzer.analyzePrompt(convertedPrompt);
      
      const requiredComponents = ['context', 'analysis', 'goals', 'execution', 'evaluation', 'refinement', 'framework'];
      
      requiredComponents.forEach(component => {
        expect(analysis.compliance).toHaveProperty(component);
        expect(analysis.compliance[component]).toHaveProperty('confidence');
        expect(typeof analysis.compliance[component].confidence).toBe('number');
      });
    });

    test('should provide confidence scores for each component', () => {
      const prompt = 'Test context and analysis components';
      const analysis = analyzer.analyzeText(prompt);
      
      Object.values(analysis.compliance).forEach((component: any) => {
        expect(component.confidence).toBeGreaterThanOrEqual(0);
        expect(component.confidence).toBeLessThanOrEqual(1);
      });
    });
  });

  describe('analyzeText method', () => {
    test('should work with analyzeText method', () => {
      const analysis = analyzer.analyzeText('Test prompt with context and analysis');
      
      expect(analysis).toBeDefined();
      expect(analysis.frameworkScore).toBeDefined();
      expect(analysis.compliance).toBeDefined();
      expect(analysis.overallCompliance).toBeDefined();
    });

    test('should produce consistent results between analyzePrompt and analyzeText', () => {
      const prompt = 'Context analysis framework test';
      const convertedPrompt = createConvertedPrompt(prompt);
      const promptAnalysis = analyzer.analyzePrompt(convertedPrompt);
      const textAnalysis = analyzer.analyzeText(prompt);
      
      expect(promptAnalysis.frameworkScore).toEqual(textAnalysis.frameworkScore);
      expect(promptAnalysis.overallCompliance).toEqual(textAnalysis.overallCompliance);
    });
  });

  describe('Performance', () => {
    test('should complete analysis within reasonable time', () => {
      const start = Date.now();
      analyzer.analyzeText('Performance test prompt with comprehensive analysis requirements');
      const duration = Date.now() - start;
      
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
    });

    test('should handle multiple analyses efficiently', () => {
      const prompts = [
        'First test prompt',
        'Second analysis prompt with context',
        'Third framework evaluation prompt'
      ];
      
      const start = Date.now();
      prompts.forEach(prompt => analyzer.analyzeText(prompt));
      const duration = Date.now() - start;
      
      expect(duration).toBeLessThan(1000); // All three should complete within 1 second
    });
  });
});