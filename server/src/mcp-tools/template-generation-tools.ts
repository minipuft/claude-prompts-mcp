/**
 * CAGEERF Template Generation MCP Tools
 * Provides creative and systematic prompt template generation capabilities
 */

import { z } from "zod";
import { Logger } from "../logging/index.js";
import { TemplateGenerator, TemplateGenerationRequest, GeneratedTemplate } from "../utils/template-generator.js";
import { handleError } from "../utils/errorHandling.js";

/**
 * Template Generation Tools for MCP integration
 */
export class TemplateGenerationTools {
  private logger: Logger;
  private mcpServer: any;
  private templateGenerator: TemplateGenerator;

  constructor(logger: Logger, mcpServer: any) {
    this.logger = logger;
    this.mcpServer = mcpServer;
    this.templateGenerator = new TemplateGenerator();
  }

  /**
   * Register all template generation tools
   */
  registerAllTools(): void {
    this.registerGenerateTemplate();
    this.registerEnhanceTemplate();
    this.registerGetTemplateCategories();
    this.registerGetTemplatePatterns();
    this.logger.info("Template generation tools registered successfully");
  }

  /**
   * Register generate_template tool
   */
  private registerGenerateTemplate(): void {
    this.mcpServer.tool(
      "generate_template",
      "🎨 CAGEERF Template Generator: Create systematic, framework-compliant prompt templates with creative variations and quality scoring",
      {
        useCase: z
          .string()
          .describe("Primary use case or purpose for the template (e.g., 'business analysis', 'strategic planning', 'technical review')"),
        domain: z
          .string()
          .describe("Domain or field of application (e.g., 'business', 'technology', 'education', 'research')"),
        complexity: z
          .enum(["simple", "intermediate", "advanced", "expert"])
          .describe("Template complexity level: simple (basic structure), intermediate (moderate detail), advanced (comprehensive), expert (full methodology)"),
        frameworkEmphasis: z
          .object({
            context: z.boolean().optional().describe("Emphasize contextual awareness and environmental factors"),
            analysis: z.boolean().optional().describe("Emphasize systematic analysis and examination"),
            goals: z.boolean().optional().describe("Emphasize clear objectives and expected outcomes"),
            execution: z.boolean().optional().describe("Emphasize step-by-step implementation"),
            evaluation: z.boolean().optional().describe("Emphasize assessment and validation criteria"),
            refinement: z.boolean().optional().describe("Emphasize iterative improvement processes"),
            framework: z.boolean().optional().describe("Emphasize structured methodology and governance")
          })
          .describe("CAGEERF framework components to emphasize in the template"),
        templateStyle: z
          .enum(["structured", "conversational", "academic", "professional", "creative"])
          .optional()
          .describe("Communication style for the template (defaults to 'professional')"),
        includePlaceholders: z
          .boolean()
          .optional()
          .describe("Include template placeholders for dynamic content (defaults to true)"),
        includeChainSteps: z
          .boolean()
          .optional()
          .describe("Generate template as a chain of steps (defaults to false)"),
        customRequirements: z
          .array(z.string())
          .optional()
          .describe("Additional custom requirements or specifications")
      },
      async (args: {
        useCase: string;
        domain: string;
        complexity: "simple" | "intermediate" | "advanced" | "expert";
        frameworkEmphasis: {
          context?: boolean;
          analysis?: boolean;
          goals?: boolean;
          execution?: boolean;
          evaluation?: boolean;
          refinement?: boolean;
          framework?: boolean;
        };
        templateStyle?: "structured" | "conversational" | "academic" | "professional" | "creative";
        includePlaceholders?: boolean;
        includeChainSteps?: boolean;
        customRequirements?: string[];
      }) => {
        try {
          this.logger.info(`Generating CAGEERF template for: ${args.useCase} (${args.complexity})`);

          // Build template generation request
          const request: TemplateGenerationRequest = {
            useCase: args.useCase,
            domain: args.domain,
            complexity: args.complexity,
            frameworkEmphasis: {
              context: args.frameworkEmphasis.context || false,
              analysis: args.frameworkEmphasis.analysis || false,
              goals: args.frameworkEmphasis.goals || false,
              execution: args.frameworkEmphasis.execution || false,
              evaluation: args.frameworkEmphasis.evaluation || false,
              refinement: args.frameworkEmphasis.refinement || false,
              framework: args.frameworkEmphasis.framework || false
            },
            templateStyle: args.templateStyle || 'professional',
            includePlaceholders: args.includePlaceholders !== false,
            includeChainSteps: args.includeChainSteps || false,
            customRequirements: args.customRequirements
          };

          // Generate template
          const generatedTemplate = await this.templateGenerator.generateTemplate(request);

          // Format response
          const response = this.formatTemplateResponse(generatedTemplate);

          return {
            content: [
              {
                type: "text" as const,
                text: response
              }
            ]
          };

        } catch (error) {
          this.logger.error("Error in generate_template:", error);
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to generate template: ${
                  error instanceof Error ? error.message : String(error)
                }`
              }
            ],
            isError: true
          };
        }
      }
    );
  }

  /**
   * Register enhance_template tool
   */
  private registerEnhanceTemplate(): void {
    this.mcpServer.tool(
      "enhance_template",
      "🚀 CAGEERF Template Enhancer: Improve existing prompts with CAGEERF framework compliance and systematic structure",
      {
        promptId: z
          .string()
          .describe("ID of the existing prompt to enhance"),
        targetCompliance: z
          .object({
            context: z.boolean().optional().describe("Target improvement in contextual awareness"),
            analysis: z.boolean().optional().describe("Target improvement in systematic analysis"),
            goals: z.boolean().optional().describe("Target improvement in goal clarity"),
            execution: z.boolean().optional().describe("Target improvement in execution methodology"),
            evaluation: z.boolean().optional().describe("Target improvement in evaluation criteria"),
            refinement: z.boolean().optional().describe("Target improvement in refinement processes"),
            framework: z.boolean().optional().describe("Target improvement in framework structure")
          })
          .optional()
          .describe("Specific CAGEERF components to improve (defaults to all weak areas)")
      },
      async (args: {
        promptId: string;
        targetCompliance?: {
          context?: boolean;
          analysis?: boolean;
          goals?: boolean;
          execution?: boolean;
          evaluation?: boolean;
          refinement?: boolean;
          framework?: boolean;
        };
      }) => {
        try {
          this.logger.info(`Enhancing prompt with CAGEERF compliance: ${args.promptId}`);

          // TODO: Implement prompt lookup and enhancement
          // For now, return placeholder response
          const response = `🚀 **CAGEERF Template Enhancement**

📋 **Prompt ID**: ${args.promptId}
🎯 **Enhancement Focus**: ${args.targetCompliance ? 
            Object.entries(args.targetCompliance)
              .filter(([_, enabled]) => enabled)
              .map(([component, _]) => component.toUpperCase())
              .join(', ') || 'All weak areas' 
            : 'All weak areas'}

⚠️ **Note**: Template enhancement feature is ready for integration with prompt lookup system.
🔧 **Next Step**: Connect with PromptData lookup to enable full enhancement capabilities.`;

          return {
            content: [
              {
                type: "text" as const,
                text: response
              }
            ]
          };

        } catch (error) {
          this.logger.error("Error in enhance_template:", error);
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to enhance template: ${
                  error instanceof Error ? error.message : String(error)
                }`
              }
            ],
            isError: true
          };
        }
      }
    );
  }

  /**
   * Register get_template_categories tool
   */
  private registerGetTemplateCategories(): void {
    this.mcpServer.tool(
      "get_template_categories",
      "📚 Template Categories: Explore available CAGEERF template categories and their framework focus areas",
      {},
      async () => {
        try {
          this.logger.debug("Retrieving template categories");

          const categories = [
            {
              id: 'analysis',
              name: 'Analysis & Assessment',
              description: 'Templates for systematic analysis, evaluation, and assessment using CAGEERF methodology',
              cageerfFocus: ['Context', 'Analysis', 'Evaluation'],
              commonUseCases: ['business analysis', 'strategic assessment', 'performance evaluation', 'risk analysis', 'quality assessment']
            },
            {
              id: 'execution',
              name: 'Implementation & Execution',
              description: 'Templates for strategic implementation, project execution, and systematic delivery',
              cageerfFocus: ['Goals', 'Execution', 'Evaluation', 'Refinement'],
              commonUseCases: ['project management', 'strategic implementation', 'process execution', 'change management', 'delivery planning']
            },
            {
              id: 'framework',
              name: 'Framework & Methodology',
              description: 'Templates for developing systematic frameworks, methodologies, and structured approaches',
              cageerfFocus: ['Framework', 'Context', 'Execution', 'Evaluation'],
              commonUseCases: ['methodology development', 'framework design', 'process creation', 'best practice development', 'systematic approaches']
            },
            {
              id: 'creative',
              name: 'Creative & Innovation',
              description: 'Templates for structured creativity, innovation processes, and design thinking',
              cageerfFocus: ['Context', 'Analysis', 'Goals', 'Evaluation'],
              commonUseCases: ['innovation workshops', 'creative problem solving', 'design thinking', 'ideation sessions', 'concept development']
            },
            {
              id: 'technical',
              name: 'Technical & Development',
              description: 'Templates for technical architecture, system design, and development planning',
              cageerfFocus: ['Analysis', 'Goals', 'Execution', 'Evaluation', 'Framework'],
              commonUseCases: ['system architecture', 'technical design', 'software development', 'infrastructure planning', 'technology strategy']
            },
            {
              id: 'business',
              name: 'Business & Strategy',
              description: 'Templates for business strategy, market planning, and organizational development',
              cageerfFocus: ['Context', 'Analysis', 'Goals', 'Execution', 'Evaluation', 'Refinement'],
              commonUseCases: ['business strategy', 'market planning', 'organizational development', 'competitive analysis', 'business model design']
            },
            {
              id: 'education',
              name: 'Education & Learning',
              description: 'Templates for educational design, training development, and learning experience creation',
              cageerfFocus: ['Context', 'Goals', 'Execution', 'Evaluation', 'Refinement'],
              commonUseCases: ['course design', 'training development', 'educational planning', 'learning assessment', 'curriculum development']
            },
            {
              id: 'research',
              name: 'Research & Investigation',
              description: 'Templates for research methodology, scientific investigation, and systematic inquiry',
              cageerfFocus: ['Context', 'Analysis', 'Goals', 'Execution', 'Evaluation', 'Framework'],
              commonUseCases: ['academic research', 'market research', 'user research', 'scientific investigation', 'data analysis']
            }
          ];

          let response = `📚 **CAGEERF Template Categories**\n\n`;
          
          categories.forEach((category, index) => {
            response += `## ${index + 1}. ${category.name} (${category.id})\n`;
            response += `**Description**: ${category.description}\n`;
            response += `**CAGEERF Focus**: ${category.cageerfFocus.join(', ')}\n`;
            response += `**Common Use Cases**: ${category.commonUseCases.join(', ')}\n\n`;
          });

          response += `💡 **Usage Tip**: Use these categories to guide your template generation by specifying the domain that best matches your use case.\n`;
          response += `🎯 **Framework Integration**: Each category emphasizes specific CAGEERF components for optimal methodology compliance.`;

          return {
            content: [
              {
                type: "text" as const,
                text: response
              }
            ]
          };

        } catch (error) {
          this.logger.error("Error in get_template_categories:", error);
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to retrieve template categories: ${
                  error instanceof Error ? error.message : String(error)
                }`
              }
            ],
            isError: true
          };
        }
      }
    );
  }

  /**
   * Register get_template_patterns tool
   */
  private registerGetTemplatePatterns(): void {
    this.mcpServer.tool(
      "get_template_patterns",
      "🎨 Template Patterns: Browse pre-built CAGEERF template patterns by category and complexity",
      {
        category: z
          .string()
          .optional()
          .describe("Filter by category (analysis, execution, framework, creative, technical, business, education, research)"),
        complexity: z
          .enum(["simple", "intermediate", "advanced", "expert"])
          .optional()
          .describe("Filter by complexity level")
      },
      async (args: {
        category?: string;
        complexity?: "simple" | "intermediate" | "advanced" | "expert";
      }) => {
        try {
          this.logger.debug(`Retrieving template patterns - category: ${args.category}, complexity: ${args.complexity}`);

          const patterns = [
            {
              name: 'Comprehensive Analysis Framework',
              category: 'analysis',
              complexity: 'expert',
              cageerfComponents: ['Context', 'Analysis', 'Goals', 'Evaluation', 'Refinement', 'Framework'],
              description: 'Advanced systematic analysis with full CAGEERF methodology',
              useCases: ['business analysis', 'strategic planning', 'research analysis', 'risk assessment', 'performance evaluation']
            },
            {
              name: 'Rapid Assessment Template',
              category: 'analysis',
              complexity: 'intermediate',
              cageerfComponents: ['Context', 'Analysis', 'Goals', 'Evaluation'],
              description: 'Quick but structured assessment following CAGEERF principles',
              useCases: ['quick evaluation', 'preliminary assessment', 'triage analysis', 'initial review']
            },
            {
              name: 'Strategic Implementation Framework',
              category: 'execution',
              complexity: 'expert',
              cageerfComponents: ['Context', 'Goals', 'Execution', 'Evaluation', 'Refinement', 'Framework'],
              description: 'Comprehensive implementation plan with CAGEERF methodology',
              useCases: ['project management', 'strategic initiatives', 'organizational change', 'system implementation']
            },
            {
              name: 'Agile Execution Template',
              category: 'execution',
              complexity: 'advanced',
              cageerfComponents: ['Goals', 'Execution', 'Evaluation', 'Refinement'],
              description: 'Iterative execution approach with CAGEERF integration',
              useCases: ['agile development', 'iterative projects', 'sprint planning', 'continuous delivery']
            },
            {
              name: 'Methodology Design Framework',
              category: 'framework',
              complexity: 'expert',
              cageerfComponents: ['Context', 'Analysis', 'Goals', 'Execution', 'Evaluation', 'Refinement', 'Framework'],
              description: 'Design systematic methodologies using CAGEERF principles',
              useCases: ['methodology development', 'process design', 'framework creation', 'best practice development']
            },
            {
              name: 'Creative Ideation Framework',
              category: 'creative',
              complexity: 'intermediate',
              cageerfComponents: ['Context', 'Analysis', 'Goals', 'Execution', 'Evaluation'],
              description: 'Structured creativity using CAGEERF methodology',
              useCases: ['innovation workshops', 'creative problem solving', 'design thinking', 'brainstorming sessions']
            }
          ];

          // Filter patterns based on criteria
          let filteredPatterns = patterns;
          
          if (args.category) {
            filteredPatterns = filteredPatterns.filter(p => p.category === args.category);
          }
          
          if (args.complexity) {
            filteredPatterns = filteredPatterns.filter(p => p.complexity === args.complexity);
          }

          let response = `🎨 **CAGEERF Template Patterns**\n`;
          
          if (args.category || args.complexity) {
            response += `**Filters**: ${args.category ? `Category: ${args.category}` : ''}${args.category && args.complexity ? ', ' : ''}${args.complexity ? `Complexity: ${args.complexity}` : ''}\n`;
          }
          
          response += `**Found ${filteredPatterns.length} patterns**\n\n`;

          filteredPatterns.forEach((pattern, index) => {
            response += `## ${index + 1}. ${pattern.name}\n`;
            response += `**Category**: ${pattern.category} | **Complexity**: ${pattern.complexity}\n`;
            response += `**Description**: ${pattern.description}\n`;
            response += `**CAGEERF Components**: ${pattern.cageerfComponents.join(', ')}\n`;
            response += `**Use Cases**: ${pattern.useCases.join(', ')}\n\n`;
          });

          if (filteredPatterns.length === 0) {
            response += `❌ No patterns found matching the specified criteria.\n`;
            response += `💡 Try adjusting your filters or browse all patterns without filters.`;
          } else {
            response += `💡 **Usage**: Use generate_template with your specific use case to create customized templates based on these patterns.`;
          }

          return {
            content: [
              {
                type: "text" as const,
                text: response
              }
            ]
          };

        } catch (error) {
          this.logger.error("Error in get_template_patterns:", error);
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to retrieve template patterns: ${
                  error instanceof Error ? error.message : String(error)
                }`
              }
            ],
            isError: true
          };
        }
      }
    );
  }

  /**
   * Format template generation response
   */
  private formatTemplateResponse(template: GeneratedTemplate): string {
    const qualityScore = Math.round(template.qualityScore);
    const complianceScore = Math.round(template.cageerfCompliance.overallCompliance * 100);
    const methodologyScore = Math.round(template.cageerfCompliance.frameworkScore * 100);

    let response = `🎨 **CAGEERF Template Generated Successfully**\n\n`;
    
    response += `## 📋 Template Details\n`;
    response += `**Name**: ${template.name}\n`;
    response += `**ID**: ${template.id}\n`;
    response += `**Category**: ${template.category}\n`;
    response += `**Description**: ${template.description}\n\n`;

    response += `## 📊 Quality Metrics\n`;
    response += `**Overall Quality Score**: ${qualityScore}%\n`;
    response += `**CAGEERF Compliance**: ${complianceScore}%\n`;
    response += `**Methodology Score**: ${methodologyScore}%\n\n`;

    response += `## 🎯 CAGEERF Framework Analysis\n`;
    Object.entries(template.cageerfCompliance.compliance).forEach(([component, data]) => {
      const score = Math.round(data.confidence * 100);
      const status = data.present ? '✅' : '❌';
      response += `${status} **${component.toUpperCase()}**: ${score}%\n`;
    });
    response += `\n`;

    if (template.cageerfCompliance.strengthAreas.length > 0) {
      response += `## 💪 Strengths\n`;
      template.cageerfCompliance.strengthAreas.forEach(strength => {
        response += `• ${strength}\n`;
      });
      response += `\n`;
    }

    if (template.cageerfCompliance.recommendedImprovements.length > 0) {
      response += `## 🚀 Improvement Recommendations\n`;
      template.cageerfCompliance.recommendedImprovements.slice(0, 5).forEach((rec, index) => {
        response += `${index + 1}. ${rec}\n`;
      });
      response += `\n`;
    }

    response += `## 📝 Generated Template\n\n`;
    if (template.systemMessage) {
      response += `### System Message\n${template.systemMessage}\n\n`;
    }
    response += `### User Message Template\n${template.userMessageTemplate}\n\n`;

    response += `## ⚙️ Template Arguments\n`;
    template.arguments.forEach((arg, index) => {
      response += `${index + 1}. **${arg.name}** ${arg.required ? '(required)' : '(optional)'}\n`;
      if (arg.description) {
        response += `   ${arg.description}\n`;
      }
      if (arg.cageerfComponent) {
        response += `   *CAGEERF Component: ${arg.cageerfComponent.toUpperCase()}*\n`;
      }
    });

    if (template.variations && template.variations.length > 0) {
      response += `\n## 🎨 Creative Variations (${template.variations.length} available)\n`;
      template.variations.slice(0, 3).forEach((variation, index) => {
        response += `${index + 1}. **${variation.name}**: ${variation.description}\n`;
      });
    }

    response += `\n💡 **Next Step**: Use the update_prompt tool to save this template as a new prompt in your system.`;

    return response;
  }
}