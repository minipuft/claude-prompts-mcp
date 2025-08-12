/**
 * MCP Tools for Gate Management - Phase 2 Implementation
 * Provides comprehensive gate management capabilities through the MCP interface
 */

import { Logger } from "../logging/index.js";
import { ToolResponse } from "../types/index.js";
import { EnhancedGateEvaluator } from "../utils/enhanced-gate-evaluator.js";
import {
  GateRegistry,
  ExtendedGateDefinition,
  ExtendedGateType,
  GateEvaluationContext,
  RegisteredGate,
} from "../utils/gate-registry.js";

/**
 * Gate Management Tools for MCP
 */
export class GateManagementTools {
  private logger: Logger;
  private gateEvaluator: EnhancedGateEvaluator;
  private gateRegistry: GateRegistry;

  constructor(logger: Logger, gateEvaluator: EnhancedGateEvaluator) {
    this.logger = logger;
    this.gateEvaluator = gateEvaluator;
    this.gateRegistry = gateEvaluator.getGateRegistry();
  }

  /**
   * List all registered gates
   */
  async listGates(): Promise<ToolResponse> {
    try {
      const gates = this.gateRegistry.getRegisteredGates();
      const gateList: any[] = [];

      for (const [id, gate] of gates) {
        gateList.push({
          id,
          name: gate.definition.name,
          type: gate.definition.type,
          requirements: gate.definition.requirements.length,
          registeredAt: gate.registeredAt,
          usageCount: gate.usageCount,
          performanceStats: gate.performanceStats,
        });
      }

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            data: {
              gates: gateList,
              totalCount: gateList.length,
              summary: {
                totalGates: gateList.length,
                totalUsage: gateList.reduce((sum, g) => sum + g.usageCount, 0),
                avgSuccessRate: gateList.length > 0 
                  ? gateList.reduce((sum, g) => sum + g.performanceStats.successRate, 0) / gateList.length
                  : 0,
              },
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      this.logger.error("Failed to list gates", error);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          }, null, 2),
        }],
        isError: true,
      };
    }
  }

  /**
   * Register a new gate
   */
  async registerGate(gateDefinition: string): Promise<ToolResponse> {
    try {
      const definition: ExtendedGateDefinition = JSON.parse(gateDefinition);
      const gateId = await this.gateRegistry.registerGate(definition);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            data: {
              gateId,
              message: `Gate '${definition.name}' registered successfully`,
              definition: {
                id: gateId,
                name: definition.name,
                type: definition.type,
                requirementCount: definition.requirements.length,
              },
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      this.logger.error("Failed to register gate", error);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          }, null, 2),
        }],
        isError: true,
      };
    }
  }

  /**
   * Evaluate content against a specific gate
   */
  async evaluateGate(
    gateId: string,
    content: string,
    context?: string
  ): Promise<ToolResponse> {
    try {
      const evaluationContext: GateEvaluationContext = {
        content,
        metadata: context ? JSON.parse(context) : {},
      };

      const result = await this.gateRegistry.evaluateGate(gateId, evaluationContext);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            data: {
              gateId,
              passed: result.passed,
              score: result.score,
              message: result.message,
              hints: result.hints,
              nextActions: result.nextActions,
              improvementSuggestions: result.improvementSuggestions,
              evaluationTime: result.evaluationTime,
              details: result.details,
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      this.logger.error("Failed to evaluate gate", error);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          }, null, 2),
        }],
        isError: true,
      };
    }
  }

  /**
   * Get gate statistics and performance metrics
   */
  async getGateStats(gateId: string): Promise<ToolResponse> {
    try {
      const gate = this.gateRegistry.getGate(gateId);
      if (!gate) {
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              success: false,
              error: `Gate not found: ${gateId}`,
            }, null, 2),
          }],
          isError: true,
        };
      }

      const stats = this.gateRegistry.getGateStatistics(gateId);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            data: {
              gateId,
              gateName: gate.definition.name,
              registeredAt: gate.registeredAt,
              lastUsed: gate.lastUsed,
              usageCount: gate.usageCount,
              performanceStats: stats,
              definition: {
                type: gate.definition.type,
                requirementCount: gate.definition.requirements.length,
                runtimeTargets: gate.definition.runtimeTargets,
                configVersion: gate.definition.configVersion,
              },
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      this.logger.error("Failed to get gate stats", error);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          }, null, 2),
        }],
        isError: true,
      };
    }
  }

  /**
   * Create a gate from template
   */
  async createGateFromTemplate(
    gateType: ExtendedGateType,
    gateName: string,
    requirements?: string
  ): Promise<ToolResponse> {
    try {
      const template = this.getGateTemplate(gateType);
      const parsedRequirements = requirements ? JSON.parse(requirements) : {};
      
      const gateDefinition: ExtendedGateDefinition = {
        id: `${gateName.toLowerCase().replace(/\s+/g, '-')}-gate`,
        name: gateName,
        type: 'validation',
        requirements: [{
          type: gateType,
          criteria: {
            ...template.defaultCriteria,
            ...parsedRequirements,
          },
          weight: 1.0,
          required: true,
        }],
        failureAction: 'retry',
        retryPolicy: {
          maxRetries: 2,
          retryDelay: 1000,
        },
        configVersion: '1.0.0',
      };

      const gateId = await this.gateRegistry.registerGate(gateDefinition);

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            data: {
              gateId,
              message: `Gate '${gateName}' created from template`,
              template: template.name,
              definition: gateDefinition,
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      this.logger.error("Failed to create gate from template", error);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          }, null, 2),
        }],
        isError: true,
      };
    }
  }

  /**
   * Test gate with sample content
   */
  async testGate(
    gateId: string,
    sampleContent: string,
    expectedResult?: boolean
  ): Promise<ToolResponse> {
    try {
      const evaluationContext: GateEvaluationContext = {
        content: sampleContent,
        metadata: {
          testMode: true,
          expectedResult,
        },
      };

      const result = await this.gateRegistry.evaluateGate(gateId, evaluationContext);
      
      const testPassed = expectedResult === undefined || result.passed === expectedResult;

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            data: {
              gateId,
              testPassed,
              actualResult: result.passed,
              expectedResult,
              score: result.score,
              message: result.message,
              hints: result.hints,
              improvementSuggestions: result.improvementSuggestions,
              evaluationTime: result.evaluationTime,
              testSummary: {
                status: testPassed ? 'PASSED' : 'FAILED',
                reason: testPassed 
                  ? 'Gate behaved as expected'
                  : `Expected ${expectedResult}, got ${result.passed}`,
              },
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      this.logger.error("Failed to test gate", error);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          }, null, 2),
        }],
        isError: true,
      };
    }
  }

  /**
   * Get available gate types and their templates
   */
  async getGateTypes(): Promise<ToolResponse> {
    try {
      const gateTypes: ExtendedGateType[] = [
        'content_length',
        'keyword_presence',
        'format_validation',
        'section_validation',
        'custom',
        'readability_score',
        'grammar_quality',
        'tone_analysis',
        'hierarchy_validation',
        'link_validation',
        'code_quality',
        'required_fields',
        'completeness_score',
        'citation_validation',
        'security_scan',
        'privacy_compliance',
        'content_policy',
        'dependency_validation',
        'context_consistency',
        'resource_availability',
      ];

      const typeDetails = gateTypes.map(type => {
        const template = this.getGateTemplate(type);
        return {
          type,
          name: template.name,
          description: template.description,
          category: template.category,
          defaultCriteria: template.defaultCriteria,
          exampleUsage: template.exampleUsage,
        };
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            data: {
              gateTypes: typeDetails,
              totalTypes: typeDetails.length,
              categories: {
                'Content Quality': typeDetails.filter(t => t.category === 'Content Quality').length,
                'Structure & Format': typeDetails.filter(t => t.category === 'Structure & Format').length,
                'Completeness': typeDetails.filter(t => t.category === 'Completeness').length,
                'Security': typeDetails.filter(t => t.category === 'Security').length,
                'Workflow': typeDetails.filter(t => t.category === 'Workflow').length,
                'Legacy': typeDetails.filter(t => t.category === 'Legacy').length,
              },
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      this.logger.error("Failed to get gate types", error);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          }, null, 2),
        }],
        isError: true,
      };
    }
  }

  /**
   * Get gate template information
   */
  private getGateTemplate(gateType: ExtendedGateType): {
    name: string;
    description: string;
    category: string;
    defaultCriteria: any;
    exampleUsage: string;
  } {
    const templates: Record<ExtendedGateType, {
      name: string;
      description: string;
      category: string;
      defaultCriteria: any;
      exampleUsage: string;
    }> = {
      // Legacy gates
      'content_length': {
        name: 'Content Length Validation',
        description: 'Validates content length within specified bounds',
        category: 'Legacy',
        defaultCriteria: { min: 100, max: 5000 },
        exampleUsage: 'Ensure content is between 100-5000 characters',
      },
      'keyword_presence': {
        name: 'Keyword Presence Check',
        description: 'Validates presence of required keywords',
        category: 'Legacy',
        defaultCriteria: { keywords: [], caseSensitive: false },
        exampleUsage: 'Check for specific terms or phrases',
      },
      'format_validation': {
        name: 'Format Validation',
        description: 'Validates content format (markdown, JSON, YAML)',
        category: 'Legacy',
        defaultCriteria: { format: 'markdown' },
        exampleUsage: 'Ensure content is in proper format',
      },
      'section_validation': {
        name: 'Section Validation',
        description: 'Validates required sections are present',
        category: 'Legacy',
        defaultCriteria: { sections: [], allowExtra: true },
        exampleUsage: 'Check for required document sections',
      },
      'custom': {
        name: 'Custom Validation',
        description: 'Custom validation logic',
        category: 'Legacy',
        defaultCriteria: {},
        exampleUsage: 'Implement custom validation rules',
      },
      // Content quality gates
      'readability_score': {
        name: 'Readability Analysis',
        description: 'Evaluates text readability using Flesch-Kincaid score',
        category: 'Content Quality',
        defaultCriteria: { readabilityTarget: 'intermediate' },
        exampleUsage: 'Ensure content is appropriate for target audience',
      },
      'grammar_quality': {
        name: 'Grammar Quality Check',
        description: 'Validates grammar and language quality',
        category: 'Content Quality',
        defaultCriteria: { grammarStrength: 'standard', allowedErrors: 3 },
        exampleUsage: 'Check for grammar mistakes and language issues',
      },
      'tone_analysis': {
        name: 'Tone Analysis',
        description: 'Analyzes and validates content tone',
        category: 'Content Quality',
        defaultCriteria: { expectedTone: 'professional', toneConfidence: 0.7 },
        exampleUsage: 'Ensure content matches expected tone',
      },
      // Structure & format gates
      'hierarchy_validation': {
        name: 'Content Hierarchy Check',
        description: 'Validates document structure and heading hierarchy',
        category: 'Structure & Format',
        defaultCriteria: { maxDepth: 6, requireH1: true },
        exampleUsage: 'Ensure proper document structure',
      },
      'link_validation': {
        name: 'Link Validation',
        description: 'Validates URLs and references',
        category: 'Structure & Format',
        defaultCriteria: { validateExternal: true, validateInternal: true },
        exampleUsage: 'Check for broken links and references',
      },
      'code_quality': {
        name: 'Code Quality Analysis',
        description: 'Validates code blocks for quality and syntax',
        category: 'Structure & Format',
        defaultCriteria: { syntaxValidation: true, complexityLimit: 10 },
        exampleUsage: 'Check code blocks for syntax and complexity',
      },
      // Completeness gates
      'required_fields': {
        name: 'Required Fields Check',
        description: 'Validates required fields are present',
        category: 'Completeness',
        defaultCriteria: { requiredFields: [] },
        exampleUsage: 'Ensure all required fields are filled',
      },
      'completeness_score': {
        name: 'Completeness Analysis',
        description: 'Evaluates content completeness',
        category: 'Completeness',
        defaultCriteria: { completenessMinScore: 0.8 },
        exampleUsage: 'Ensure content is comprehensive',
      },
      'citation_validation': {
        name: 'Citation Validation',
        description: 'Validates citations and references',
        category: 'Completeness',
        defaultCriteria: { requireCitations: true },
        exampleUsage: 'Check for proper citations and sources',
      },
      // Security gates
      'security_scan': {
        name: 'Security Scan',
        description: 'Scans for security vulnerabilities',
        category: 'Security',
        defaultCriteria: { securityLevel: 'standard' },
        exampleUsage: 'Check for security issues',
      },
      'privacy_compliance': {
        name: 'Privacy Compliance',
        description: 'Checks for privacy compliance and PII',
        category: 'Security',
        defaultCriteria: { detectPII: true },
        exampleUsage: 'Ensure privacy compliance',
      },
      'content_policy': {
        name: 'Content Policy Check',
        description: 'Validates against content policies',
        category: 'Security',
        defaultCriteria: { policyLevel: 'standard' },
        exampleUsage: 'Check content against policies',
      },
      // Workflow gates
      'dependency_validation': {
        name: 'Dependency Validation',
        description: 'Validates workflow dependencies',
        category: 'Workflow',
        defaultCriteria: { checkDependencies: true },
        exampleUsage: 'Ensure workflow dependencies are met',
      },
      'context_consistency': {
        name: 'Context Consistency Check',
        description: 'Validates context consistency across steps',
        category: 'Workflow',
        defaultCriteria: { consistencyThreshold: 0.8 },
        exampleUsage: 'Ensure consistent context across workflow',
      },
      'resource_availability': {
        name: 'Resource Availability Check',
        description: 'Validates required resources are available',
        category: 'Workflow',
        defaultCriteria: { checkResources: true },
        exampleUsage: 'Ensure required resources are available',
      },
    };

    return templates[gateType] || {
      name: gateType.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      description: `${gateType} validation`,
      category: 'Other',
      defaultCriteria: {},
      exampleUsage: `Validate using ${gateType}`,
    };
  }
}

/**
 * Create gate management tools
 */
export function createGateManagementTools(
  logger: Logger,
  gateEvaluator: EnhancedGateEvaluator
): GateManagementTools {
  return new GateManagementTools(logger, gateEvaluator);
}