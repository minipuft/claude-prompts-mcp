/**
 * Template Generator Unit Tests
 * Tests extracted from GitHub Actions inline scripts
 */

import { TemplateGenerator } from '../../dist/utils/template-generator.js';

describe('Template Generator', () => {
  let generator: TemplateGenerator;

  beforeEach(() => {
    generator = new TemplateGenerator();
  });

  describe('Basic Functionality', () => {
    test('should instantiate successfully', () => {
      expect(generator).toBeInstanceOf(TemplateGenerator);
    });

    test('should generate simple template', async () => {
      const request = {
        useCase: 'Test',
        domain: 'Testing',
        complexity: 'simple' as const,
        frameworkEmphasis: {
          context: true,
          analysis: true,
          goals: true,
          execution: true,
          evaluation: true,
          refinement: true,
          framework: true
        },
        templateStyle: 'structured' as const
      };

      const template = await generator.generateTemplate(request);

      expect(template).toBeDefined();
      expect(template.userMessageTemplate).toBeDefined();
      expect(typeof template.userMessageTemplate).toBe('string');
      expect(template.userMessageTemplate.length).toBeGreaterThan(0);
      expect(template.qualityScore).toBeDefined();
      expect(typeof template.qualityScore).toBe('number');
      expect(template.qualityScore).toBeGreaterThanOrEqual(0);
      expect(template.qualityScore).toBeLessThanOrEqual(1);
    });
  });

  describe('Template Variations', () => {
    const complexities = ['simple', 'intermediate', 'advanced'] as const;
    const styles = ['structured', 'conversational', 'professional'] as const;

    test.each(complexities)('should generate template with %s complexity', async (complexity) => {
      const request = {
        useCase: `Test ${complexity}`,
        domain: 'Testing',
        complexity,
        frameworkEmphasis: {
          context: true,
          analysis: true,
          goals: true,
          execution: true,
          evaluation: true,
          refinement: true,
          framework: true
        },
        templateStyle: 'structured' as const
      };

      const template = await generator.generateTemplate(request);

      expect(template.userMessageTemplate).toBeDefined();
      expect(template.qualityScore).toBeGreaterThan(0);
    });

    test.each(styles)('should generate template with %s style', async (style) => {
      const request = {
        useCase: `Test ${style}`,
        domain: 'Testing',
        complexity: 'intermediate' as const,
        frameworkEmphasis: {
          context: true,
          analysis: true,
          goals: true,
          execution: true,
          evaluation: true,
          refinement: true,
          framework: true
        },
        templateStyle: style
      };

      const template = await generator.generateTemplate(request);

      expect(template.userMessageTemplate).toBeDefined();
      expect(template.qualityScore).toBeGreaterThan(0);
    });
  });

  describe('CAGEERF Integration', () => {
    test('should include CAGEERF components in generated template', async () => {
      const request = {
        useCase: 'CAGEERF Test',
        domain: 'Framework Testing',
        complexity: 'advanced' as const,
        frameworkEmphasis: {
          context: true,
          analysis: true,
          goals: true,
          execution: true,
          evaluation: true,
          refinement: true,
          framework: true
        },
        templateStyle: 'structured' as const
      };

      const template = await generator.generateTemplate(request);

      expect(template.cageerfCompliance).toBeDefined();
      expect(template.cageerfCompliance.frameworkScore).toBeDefined();
      expect(template.cageerfCompliance.frameworkScore).toBeGreaterThanOrEqual(0);
      expect(template.cageerfCompliance.frameworkScore).toBeLessThanOrEqual(1);

      // Check for CAGEERF keywords in template
      const contentLower = template.userMessageTemplate.toLowerCase();
      const cageerfKeywords = ['context', 'analysis', 'goals', 'execution', 'evaluation', 'refinement'];
      let foundComponents = 0;

      cageerfKeywords.forEach(keyword => {
        if (contentLower.includes(keyword)) {
          foundComponents++;
        }
      });

      expect(foundComponents).toBeGreaterThanOrEqual(4); // Should find at least 4 components
    });

    test('should respect framework emphasis settings', async () => {
      const request = {
        useCase: 'Selective Emphasis Test',
        domain: 'Testing',
        complexity: 'intermediate' as const,
        frameworkEmphasis: {
          context: true,
          analysis: true,
          goals: false,
          execution: false,
          evaluation: false,
          refinement: false,
          framework: false
        },
        templateStyle: 'structured' as const
      };

      const template = await generator.generateTemplate(request);

      expect(template.userMessageTemplate).toBeDefined();
      expect(template.qualityScore).toBeGreaterThan(0);
      
      // Should emphasize selected components more
      const contentLower = template.userMessageTemplate.toLowerCase();
      expect(contentLower).toContain('context');
      expect(contentLower).toContain('analysis');
    });
  });

  describe('Template Quality', () => {
    test('should generate high-quality templates for complex requests', async () => {
      const request = {
        useCase: 'Complex Business Analysis Framework',
        domain: 'Business Intelligence',
        complexity: 'advanced' as const,
        frameworkEmphasis: {
          context: true,
          analysis: true,
          goals: true,
          execution: true,
          evaluation: true,
          refinement: true,
          framework: true
        },
        templateStyle: 'professional' as const
      };

      const template = await generator.generateTemplate(request);

      expect(template.qualityScore).toBeGreaterThan(0.7); // High quality threshold
      expect(template.userMessageTemplate.length).toBeGreaterThan(100); // Substantial content
    });

    test('should maintain quality across different configurations', async () => {
      const configurations = [
        {
          useCase: 'Data Analysis',
          domain: 'Analytics',
          complexity: 'simple' as const,
          templateStyle: 'conversational' as const
        },
        {
          useCase: 'Strategic Planning',
          domain: 'Management',
          complexity: 'advanced' as const,
          templateStyle: 'professional' as const
        },
        {
          useCase: 'Code Review',
          domain: 'Software Development',
          complexity: 'intermediate' as const,
          templateStyle: 'structured' as const
        }
      ];

      for (const config of configurations) {
        const request = {
          ...config,
          frameworkEmphasis: {
            context: true,
            analysis: true,
            goals: true,
            execution: true,
            evaluation: true,
            refinement: true,
            framework: true
          }
        };

        const template = await generator.generateTemplate(request);

        expect(template.qualityScore).toBeGreaterThan(0.5);
        expect(template.userMessageTemplate).toBeTruthy();
      }
    });
  });

  describe('Performance', () => {
    test('should generate template within reasonable time', async () => {
      const request = {
        useCase: 'Performance Test',
        domain: 'Testing',
        complexity: 'intermediate' as const,
        frameworkEmphasis: {
          context: true,
          analysis: true,
          goals: true,
          execution: true,
          evaluation: true,
          refinement: true,
          framework: true
        },
        templateStyle: 'structured' as const
      };

      const start = Date.now();
      await generator.generateTemplate(request);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(2000); // Should complete within 2 seconds
    });

    test('should handle multiple concurrent generations', async () => {
      const requests = Array(5).fill(null).map((_, i) => ({
        useCase: `Concurrent Test ${i}`,
        domain: 'Testing',
        complexity: 'simple' as const,
        frameworkEmphasis: {
          context: true,
          analysis: true,
          goals: true,
          execution: true,
          evaluation: true,
          refinement: true,
          framework: true
        },
        templateStyle: 'structured' as const
      }));

      const start = Date.now();
      const templates = await Promise.all(
        requests.map(request => generator.generateTemplate(request))
      );
      const duration = Date.now() - start;

      expect(templates).toHaveLength(5);
      templates.forEach(template => {
        expect(template.userMessageTemplate).toBeTruthy();
        expect(template.qualityScore).toBeGreaterThan(0);
      });
      expect(duration).toBeLessThan(5000); // All should complete within 5 seconds
    });
  });

  describe('Error Handling', () => {
    test('should handle invalid complexity gracefully', async () => {
      const request = {
        useCase: 'Invalid Test',
        domain: 'Testing',
        complexity: 'invalid' as any,
        frameworkEmphasis: {
          context: true,
          analysis: true,
          goals: true,
          execution: true,
          evaluation: true,
          refinement: true,
          framework: true
        },
        templateStyle: 'structured' as const
      };

      // Should handle gracefully and return a valid template
      const template = await generator.generateTemplate(request);
      expect(template).toBeDefined();
      expect(template.userMessageTemplate).toBeDefined();
      expect(typeof template.userMessageTemplate).toBe('string');
      expect(template.userMessageTemplate.length).toBeGreaterThan(0);
    });

    test('should handle empty useCase', async () => {
      const request = {
        useCase: '',
        domain: 'Testing',
        complexity: 'simple' as const,
        frameworkEmphasis: {
          context: true,
          analysis: true,
          goals: true,
          execution: true,
          evaluation: true,
          refinement: true,
          framework: true
        },
        templateStyle: 'structured' as const
      };

      // Should handle gracefully and return a valid template
      const template = await generator.generateTemplate(request);
      expect(template).toBeDefined();
      expect(template.userMessageTemplate).toBeDefined();
      expect(typeof template.userMessageTemplate).toBe('string');
      expect(template.userMessageTemplate.length).toBeGreaterThan(0);
    });
  });
});