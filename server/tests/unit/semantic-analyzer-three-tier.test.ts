/**
 * Semantic Analyzer Three-Tier Model Unit Tests
 * Tests the enhanced semantic analyzer for prompt/template/chain/workflow classification
 */

import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { SemanticAnalyzer } from '../../dist/analysis/semantic-analyzer.js';
import { Logger } from '../../dist/logging/index.js';
import { ConvertedPrompt } from '../../dist/types/index.js';

// Mock logger for testing
const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as Logger;

describe('Semantic Analyzer Three-Tier Model', () => {
  let analyzer: SemanticAnalyzer;

  beforeEach(() => {
    analyzer = new SemanticAnalyzer(mockLogger, {
      enableCaching: false // Disable caching for consistent testing
    });
  });

  describe('Basic Prompt Classification', () => {
    test('should classify simple variable substitution as "prompt"', async () => {
      const prompt: ConvertedPrompt = {
        id: 'test_simple',
        name: 'Simple Test',
        description: 'Simple variable substitution',
        category: 'test',
        userMessageTemplate: 'Hello {{name}}, how are you?',
        arguments: [{ name: 'name', required: true, description: 'User name' }]
      };

      const analysis = await analyzer.analyzePrompt(prompt);
      
      expect(analysis.executionType).toBe('prompt');
      expect(analysis.requiresFramework).toBe(false);
      expect(analysis.confidence).toBeGreaterThan(0.5);
      expect(analysis.frameworkRecommendation.shouldUseFramework).toBe(false);
    });

    test('should classify basic prompts with minimal arguments as "prompt"', async () => {
      const prompt: ConvertedPrompt = {
        id: 'test_basic',
        name: 'Basic Greeting',
        description: 'Basic greeting template',
        category: 'test',
        userMessageTemplate: 'Welcome {{user}}! Today is {{date}}.',
        arguments: [
          { name: 'user', required: true, description: 'Username' },
          { name: 'date', required: false, description: 'Current date' }
        ]
      };

      const analysis = await analyzer.analyzePrompt(prompt);
      
      expect(analysis.executionType).toBe('prompt');
      expect(analysis.requiresFramework).toBe(false);
    });
  });

  describe('Framework-Aware Template Classification', () => {
    test('should classify structured reasoning prompts as "template"', async () => {
      const prompt: ConvertedPrompt = {
        id: 'test_analysis',
        name: 'Deep Analysis Template',
        description: 'Analyze and evaluate complex situations systematically',
        category: 'analysis',
        systemMessage: 'You are a systematic analyst using structured reasoning approaches.',
        userMessageTemplate: `
          Please analyze {{topic}} using the following structured approach:
          
          1. **Context Analysis**: Examine the background and environment
          2. **Goal Definition**: Identify key objectives and success criteria
          3. **Systematic Evaluation**: Break down the problem methodically
          4. **Refinement**: Iterate and improve your analysis
          
          Provide comprehensive reasoning for {{requirements}}.
        `,
        arguments: [
          { name: 'topic', required: true, description: 'Topic to analyze' },
          { name: 'requirements', required: true, description: 'Analysis requirements' }
        ]
      };

      const analysis = await analyzer.analyzePrompt(prompt);
      
      expect(analysis.executionType).toBe('template');
      expect(analysis.requiresFramework).toBe(true);
      expect(analysis.executionCharacteristics.hasStructuredReasoning).toBe(true);
      expect(analysis.executionCharacteristics.hasMethodologyKeywords).toBe(true);
      expect(analysis.frameworkRecommendation.shouldUseFramework).toBe(true);
      expect(analysis.frameworkRecommendation.confidence).toBeGreaterThan(0.7);
    });

    test('should classify methodology-heavy prompts as "template"', async () => {
      const prompt: ConvertedPrompt = {
        id: 'test_methodology',
        name: 'CAGEERF Methodology Template',
        description: 'Apply CAGEERF framework for systematic analysis',
        category: 'methodology',
        userMessageTemplate: `
          Apply the CAGEERF methodology to evaluate {{subject}}:
          
          **Context**: What is the relevant background and environment?
          **Analysis**: How should we approach this systematically?
          **Goals**: What are the key objectives and evaluation criteria?
          **Execution**: What steps should be taken?
          **Evaluation**: How do we assess progress and outcomes?
          **Refinement**: What improvements can be made?
          **Framework**: How does this align with our overall approach?
        `,
        arguments: [
          { name: 'subject', required: true, description: 'Subject to evaluate' }
        ]
      };

      const analysis = await analyzer.analyzePrompt(prompt);
      
      expect(analysis.executionType).toBe('template');
      expect(analysis.requiresFramework).toBe(true);
      expect(analysis.executionCharacteristics.hasMethodologyKeywords).toBe(true);
      expect(analysis.executionCharacteristics.hasComplexAnalysis).toBe(true);
    });

    test('should classify complex prompts without methodology as "template"', async () => {
      const prompt: ConvertedPrompt = {
        id: 'test_complex',
        name: 'Complex Multi-Argument Template',
        description: 'Complex template with many arguments',
        category: 'complex',
        userMessageTemplate: 'Process {{arg1}} with {{arg2}} considering {{arg3}}, {{arg4}}, and {{arg5}} while maintaining {{arg6}} standards.',
        arguments: [
          { name: 'arg1', required: true, description: 'First parameter' },
          { name: 'arg2', required: true, description: 'Second parameter' },
          { name: 'arg3', required: true, description: 'Third parameter' },
          { name: 'arg4', required: true, description: 'Fourth parameter' },
          { name: 'arg5', required: true, description: 'Fifth parameter' },
          { name: 'arg6', required: false, description: 'Quality standards' }
        ]
      };

      const analysis = await analyzer.analyzePrompt(prompt);
      
      expect(analysis.executionType).toBe('template');
      expect(analysis.frameworkRecommendation.shouldUseFramework).toBe(true);
      expect(analysis.frameworkRecommendation.confidence).toBeLessThanOrEqual(0.9); // Lower confidence due to lack of methodology keywords
    });
  });

  describe('Chain Classification', () => {
    test('should classify chain prompts as "chain"', async () => {
      const prompt: ConvertedPrompt = {
        id: 'test_chain',
        name: 'Analysis Chain',
        description: 'Multi-step analysis process',
        category: 'chain',
        userMessageTemplate: 'Execute analysis steps sequentially',
        chainSteps: [
          { promptId: 'step1', stepName: 'Initial Analysis', executionType: 'template' },
          { promptId: 'step2', stepName: 'Deep Dive', executionType: 'template' },
          { promptId: 'step3', stepName: 'Summary', executionType: 'prompt' }
        ],
        arguments: [{ name: 'input', required: true, description: 'Input data' }]
      };

      const analysis = await analyzer.analyzePrompt(prompt);
      
      expect(analysis.executionType).toBe('chain');
      expect(analysis.executionCharacteristics.hasChainSteps).toBe(true);
      expect(analysis.frameworkRecommendation.shouldUseFramework).toBe(true);
    });

    test('should detect chain-like patterns in content', async () => {
      const prompt: ConvertedPrompt = {
        id: 'test_steps',
        name: 'Step-by-Step Process',
        description: 'Sequential step process',
        category: 'process',
        userMessageTemplate: `
          Please follow these steps to analyze {{topic}}:
          Step 1: Gather context information
          Step 2: Define analysis goals  
          Step 3: Execute systematic evaluation
          Then proceed to the next action based on results.
        `,
        arguments: [{ name: 'topic', required: true, description: 'Analysis topic' }]
      };

      const analysis = await analyzer.analyzePrompt(prompt);
      
      expect(analysis.executionCharacteristics.hasChainSteps).toBe(true);
    });
  });

  describe('Workflow Classification', () => {
    test('should classify complex workflow prompts as "workflow"', async () => {
      const prompt: ConvertedPrompt = {
        id: 'test_workflow',
        name: 'Complex Workflow',
        description: 'Complex conditional workflow with loops',
        category: 'workflow',
        userMessageTemplate: `
          {% for item in items %}
            {% if item.condition %}
              Process {{item.name}} with special handling
            {% else %}
              Standard processing for {{item.name}}
            {% endif %}
          {% endfor %}
        `,
        arguments: [
          { name: 'items', required: true, description: 'Items to process' },
          { name: 'config', required: false, description: 'Configuration' },
          { name: 'options', required: false, description: 'Processing options' },
          { name: 'validation', required: false, description: 'Validation rules' },
          { name: 'output', required: false, description: 'Output format' },
          { name: 'metadata', required: false, description: 'Additional metadata' }
        ]
      };

      const analysis = await analyzer.analyzePrompt(prompt);
      
      expect(analysis.executionType).toBe('workflow');
      expect(analysis.executionCharacteristics.hasConditionals).toBe(true);
      expect(analysis.executionCharacteristics.hasLoops).toBe(true);
      expect(analysis.complexity).toBe('high');
    });
  });

  describe('Framework Recommendation Logic', () => {
    test('should recommend framework for templates but not prompts', async () => {
      const basicPrompt: ConvertedPrompt = {
        id: 'basic',
        name: 'Basic',
        description: 'Basic prompt',
        category: 'test',
        userMessageTemplate: 'Hello {{name}}',
        arguments: [{ name: 'name', required: true, description: 'Name' }]
      };

      const templatePrompt: ConvertedPrompt = {
        id: 'template',
        name: 'Analysis Template',
        description: 'Structured analysis template',
        category: 'test',
        userMessageTemplate: 'Analyze {{topic}} systematically using structured reasoning approach',
        arguments: [{ name: 'topic', required: true, description: 'Topic' }]
      };

      const basicAnalysis = await analyzer.analyzePrompt(basicPrompt);
      const templateAnalysis = await analyzer.analyzePrompt(templatePrompt);

      expect(basicAnalysis.frameworkRecommendation.shouldUseFramework).toBe(false);
      expect(templateAnalysis.frameworkRecommendation.shouldUseFramework).toBe(true);
      
      expect(basicAnalysis.frameworkRecommendation.confidence).toBeGreaterThan(0.8);
      expect(templateAnalysis.frameworkRecommendation.confidence).toBeGreaterThan(0.7);
    });
  });

  describe('Performance and Caching', () => {
    test('should handle analysis without caching enabled', async () => {
      const prompt: ConvertedPrompt = {
        id: 'perf_test',
        name: 'Performance Test',
        description: 'Test prompt for performance',
        category: 'test',
        userMessageTemplate: 'Test {{input}}',
        arguments: [{ name: 'input', required: true, description: 'Input' }]
      };

      const analysis1 = await analyzer.analyzePrompt(prompt);
      const analysis2 = await analyzer.analyzePrompt(prompt);
      
      expect(analysis1.analysisMetadata.cacheHit).toBe(false);
      expect(analysis2.analysisMetadata.cacheHit).toBe(false);
      expect(analysis1.analysisMetadata.version).toBe('2.0.0');
    });

    test('should provide performance stats', () => {
      const stats = analyzer.getPerformanceStats();
      
      expect(stats).toHaveProperty('cacheSize');
      expect(stats).toHaveProperty('cacheEnabled');
      expect(typeof stats.cacheSize).toBe('number');
      expect(typeof stats.cacheEnabled).toBe('boolean');
    });
  });

  describe('Error Handling', () => {
    test('should handle prompts with missing fields gracefully', async () => {
      const incompletePrompt: ConvertedPrompt = {
        id: 'incomplete',
        name: 'Incomplete',
        description: 'Missing template',
        category: 'test',
        userMessageTemplate: '',
        arguments: []
      };

      const analysis = await analyzer.analyzePrompt(incompletePrompt);
      
      expect(analysis).toBeDefined();
      expect(analysis.executionType).toBeDefined();
      expect(analysis.confidence).toBeGreaterThan(0);
    });
  });
});