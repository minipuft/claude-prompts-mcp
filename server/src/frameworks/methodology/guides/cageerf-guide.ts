/**
 * CAGEERF Methodology Guide
 * Provides guidance for applying C.A.G.E.E.R.F methodology to prompt creation,
 * processing, and execution without hijacking semantic analysis functionality
 */

import type { ConvertedPrompt } from "../../../types/index.js";
import { ContentAnalysisResult } from "../../../semantic/configurable-semantic-analyzer.js";
import {
  IMethodologyGuide,
  BaseMethodologyGuide,
  PromptCreationGuidance,
  ProcessingGuidance,
  StepGuidance,
  MethodologyEnhancement,
  MethodologyValidation,
  MethodologyToolDescriptions,
  ProcessingStep,
  ExecutionStep,
  QualityGate,
  TemplateEnhancement
} from "../interfaces.js";

/**
 * CAGEERF Methodology Guide Implementation
 * Guides the application of C.A.G.E.E.R.F principles without replacing semantic analysis
 */
export class CAGEERFMethodologyGuide extends BaseMethodologyGuide {
  readonly frameworkId = "cageerf";
  readonly frameworkName = "C.A.G.E.E.R.F Framework";
  readonly methodology = "CAGEERF";
  readonly version = "2.0.0";

  /**
   * Guide prompt creation using CAGEERF structure
   * Helps users create prompts that follow CAGEERF methodology
   */
  guidePromptCreation(intent: string, context?: Record<string, any>): PromptCreationGuidance {
    return {
      structureGuidance: {
        systemPromptSuggestions: [
          "Begin with clear contextual framework setting",
          "Define analytical approach and methodology",
          "Establish specific, measurable goals",
          "Outline execution parameters and constraints",
          "Specify evaluation criteria and success metrics",
          "Include refinement and iteration guidelines"
        ],
        userTemplateSuggestions: [
          "Structure request using CAGEERF phases",
          "Provide clear context and background information",
          "Define what analysis is needed",
          "State specific goals and desired outcomes",
          "Outline execution requirements",
          "Specify how success will be evaluated"
        ],
        argumentSuggestions: [
          {
            name: "context",
            type: "string",
            description: "Situational context and background information",
            methodologyReason: "CAGEERF Context phase requires clear situational awareness",
            examples: ["business context", "technical environment", "user scenario"]
          },
          {
            name: "analysis_focus", 
            type: "string",
            description: "Specific analytical focus areas",
            methodologyReason: "CAGEERF Analysis phase needs defined scope",
            examples: ["performance analysis", "risk assessment", "opportunity identification"]
          },
          {
            name: "goals",
            type: "array",
            description: "Specific, measurable objectives",
            methodologyReason: "CAGEERF Goals phase requires clear, actionable targets",
            examples: ["increase efficiency by 20%", "reduce errors", "improve user satisfaction"]
          }
        ]
      },
      
      methodologyElements: {
        requiredSections: ["Context", "Analysis", "Goals", "Execution"],
        optionalSections: ["Evaluation", "Refinement", "Framework"],
        sectionDescriptions: {
          "Context": "Establish situational awareness and environmental factors",
          "Analysis": "Systematic examination of the problem or opportunity",
          "Goals": "Clear, specific, measurable objectives",
          "Execution": "Actionable steps and implementation approach",
          "Evaluation": "Success criteria and measurement methods",
          "Refinement": "Iteration and improvement processes",
          "Framework": "Overarching methodology and principles"
        }
      },
      
      qualityGuidance: {
        clarityEnhancements: [
          "Use specific, concrete language rather than abstract concepts",
          "Define technical terms and domain-specific vocabulary",
          "Provide examples to illustrate complex concepts"
        ],
        completenessChecks: [
          "Ensure all CAGEERF phases are addressed",
          "Verify context provides sufficient background",
          "Confirm goals are specific and measurable"
        ],
        specificityImprovements: [
          "Replace general terms with specific metrics",
          "Add quantifiable success criteria",
          "Include timeline and resource constraints"
        ]
      }
    };
  }

  /**
   * Guide template processing with CAGEERF methodology
   */
  guideTemplateProcessing(template: string, executionType: string): ProcessingGuidance {
    const cageerfSteps: ProcessingStep[] = [
      {
        id: "context_establishment",
        name: "Context Establishment",
        description: "Establish clear situational context and environmental awareness",
        methodologyBasis: "CAGEERF Context phase",
        order: 1,
        required: true
      },
      {
        id: "systematic_analysis",
        name: "Systematic Analysis",
        description: "Apply structured analytical approach to the problem",
        methodologyBasis: "CAGEERF Analysis phase",
        order: 2,
        required: true
      },
      {
        id: "goal_definition",
        name: "Goal Definition",
        description: "Establish specific, measurable objectives",
        methodologyBasis: "CAGEERF Goals phase",
        order: 3,
        required: true
      },
      {
        id: "execution_planning",
        name: "Execution Planning",
        description: "Develop actionable implementation approach",
        methodologyBasis: "CAGEERF Execution phase",
        order: 4,
        required: true
      },
      {
        id: "evaluation_setup",
        name: "Evaluation Setup",
        description: "Define success criteria and measurement methods",
        methodologyBasis: "CAGEERF Evaluation phase",
        order: 5,
        required: false
      },
      {
        id: "refinement_preparation",
        name: "Refinement Preparation",
        description: "Establish iteration and improvement processes",
        methodologyBasis: "CAGEERF Refinement phase",
        order: 6,
        required: false
      }
    ];

    return {
      processingSteps: cageerfSteps,
      
      templateEnhancements: {
        systemPromptAdditions: [
          "Apply CAGEERF methodology systematically",
          "Begin with contextual establishment",
          "Follow structured analytical approach",
          "Ensure goals are specific and measurable"
        ],
        userPromptModifications: [
          "Structure response using CAGEERF phases",
          "Provide explicit reasoning for each phase",
          "Include evaluation of approach effectiveness"
        ],
        contextualHints: [
          "Consider environmental factors and constraints",
          "Apply systematic thinking to complex problems",
          "Focus on actionable, measurable outcomes"
        ]
      },
      
      executionFlow: {
        preProcessingSteps: [
          "Validate context completeness",
          "Confirm analytical scope is defined",
          "Verify goals are specific and measurable"
        ],
        postProcessingSteps: [
          "Review CAGEERF phase coverage",
          "Assess goal achievement potential",
          "Identify refinement opportunities"
        ],
        validationSteps: [
          "Context adequacy check",
          "Analysis depth validation",
          "Goal specificity verification",
          "Execution feasibility assessment"
        ]
      }
    };
  }

  /**
   * Guide execution steps using CAGEERF methodology
   */
  guideExecutionSteps(prompt: ConvertedPrompt, semanticAnalysis: ContentAnalysisResult): StepGuidance {
    const executionSteps: ExecutionStep[] = [
      {
        id: "context_analysis",
        name: "Context Analysis",
        action: "Analyze situational context and environmental factors",
        methodologyPhase: "Context",
        dependencies: [],
        expected_output: "Comprehensive situational understanding"
      },
      {
        id: "systematic_examination",
        name: "Systematic Examination", 
        action: "Apply structured analytical approach",
        methodologyPhase: "Analysis",
        dependencies: ["context_analysis"],
        expected_output: "Detailed problem or opportunity analysis"
      },
      {
        id: "goal_establishment",
        name: "Goal Establishment",
        action: "Define specific, measurable objectives",
        methodologyPhase: "Goals",
        dependencies: ["systematic_examination"],
        expected_output: "Clear, actionable goal statements"
      },
      {
        id: "execution_design",
        name: "Execution Design",
        action: "Develop implementation approach and action plan",
        methodologyPhase: "Execution",
        dependencies: ["goal_establishment"],
        expected_output: "Detailed execution strategy"
      },
      {
        id: "evaluation_framework",
        name: "Evaluation Framework",
        action: "Establish success criteria and measurement approach",
        methodologyPhase: "Evaluation",
        dependencies: ["execution_design"],
        expected_output: "Success metrics and evaluation plan"
      },
      {
        id: "refinement_process",
        name: "Refinement Process",
        action: "Define iteration and improvement mechanisms",
        methodologyPhase: "Refinement",
        dependencies: ["evaluation_framework"],
        expected_output: "Continuous improvement framework"
      }
    ];

    // Adjust steps based on execution type from semantic analyzer
    const stepEnhancements: Record<string, string[]> = {};
    const stepValidation: Record<string, string[]> = {};

    if (semanticAnalysis.executionType === "chain" && semanticAnalysis.executionCharacteristics.advancedChainFeatures?.requiresAdvancedExecution) {
      stepEnhancements["execution_design"] = [
        "Design workflow states and transitions",
        "Define decision points and branching logic",
        "Establish error handling and recovery procedures"
      ];
      stepValidation["execution_design"] = [
        "Workflow completeness check",
        "State transition validation",
        "Error handling verification"
      ];
    } else if (semanticAnalysis.executionType === "chain") {
      stepEnhancements["execution_design"] = [
        "Define sequential step dependencies",
        "Establish data flow between steps",
        "Create checkpoint validation points"
      ];
      stepValidation["execution_design"] = [
        "Step sequence validation",
        "Data flow verification",
        "Checkpoint adequacy assessment"
      ];
    }

    return {
      stepSequence: executionSteps,
      stepEnhancements,
      stepValidation
    };
  }

  /**
   * Enhance execution with CAGEERF methodology
   */
  enhanceWithMethodology(prompt: ConvertedPrompt, context: Record<string, any>): MethodologyEnhancement {
    const cageerfGates: QualityGate[] = [
      {
        id: "context_completeness",
        name: "Context Completeness",
        description: "Verify comprehensive situational context is established",
        methodologyArea: "Context",
        validationCriteria: [
          "Environmental factors identified",
          "Stakeholders and constraints defined",
          "Background information sufficient"
        ],
        priority: "high"
      },
      {
        id: "analysis_depth",
        name: "Analysis Depth",
        description: "Ensure systematic and thorough analytical approach",
        methodologyArea: "Analysis", 
        validationCriteria: [
          "Multiple perspectives considered",
          "Root cause analysis performed",
          "Data and evidence evaluated"
        ],
        priority: "high"
      },
      {
        id: "goal_specificity",
        name: "Goal Specificity",
        description: "Validate goals are specific, measurable, and actionable",
        methodologyArea: "Goals",
        validationCriteria: [
          "Goals are quantifiable",
          "Success criteria defined",
          "Timeline established"
        ],
        priority: "high"
      },
      {
        id: "execution_feasibility",
        name: "Execution Feasibility",
        description: "Assess practical implementability of proposed approach",
        methodologyArea: "Execution",
        validationCriteria: [
          "Resources and capabilities considered",
          "Risk factors identified",
          "Implementation steps detailed"
        ],
        priority: "medium"
      }
    ];

    const templateSuggestions: TemplateEnhancement[] = [
      {
        section: "system",
        type: "addition",
        description: "Add CAGEERF methodology guidance",
        content: "Apply the C.A.G.E.E.R.F methodology: establish Context, perform systematic Analysis, define clear Goals, plan Execution, create Evaluation criteria, and enable Refinement.",
        methodologyJustification: "Ensures systematic application of CAGEERF principles",
        impact: "high"
      },
      {
        section: "user",
        type: "structure",
        description: "Structure response using CAGEERF phases",
        content: "Please structure your response addressing: 1) Context establishment, 2) Systematic analysis, 3) Specific goals, 4) Execution approach, 5) Success evaluation, 6) Refinement opportunities.",
        methodologyJustification: "Guides comprehensive thinking through all CAGEERF phases",
        impact: "medium"
      }
    ];

    return {
      systemPromptGuidance: this.getSystemPromptGuidance(context),
      processingEnhancements: this.guideTemplateProcessing("", "template").processingSteps,
      methodologyGates: cageerfGates,
      templateSuggestions,
      enhancementMetadata: this.createEnhancementMetadata(
        0.9,
        "CAGEERF methodology provides systematic approach to complex problem solving"
      )
    };
  }

  /**
   * Validate methodology compliance with enhanced quality gates
   */
  validateMethodologyCompliance(prompt: ConvertedPrompt): MethodologyValidation {
    const combinedText = this.getCombinedText(prompt);
    const text = combinedText.toLowerCase();
    
    // Enhanced CAGEERF phase detection with quality thresholds
    const phases = {
      context: {
        present: /context|situation|background|environment|circumstance|setting/i.test(text),
        quality: this.assessContextQuality(text)
      },
      analysis: {
        present: /analy|examine|investigate|assess|evaluat|study|research/i.test(text),
        quality: this.assessAnalysisQuality(text)
      },
      goals: {
        present: /goal|objective|target|outcome|aim|purpose|result/i.test(text),
        quality: this.assessGoalsQuality(text)
      },
      execution: {
        present: /execute|implement|action|step|process|approach|method|strategy/i.test(text),
        quality: this.assessExecutionQuality(text)
      },
      evaluation: {
        present: /evaluate|measure|assess|criteria|success|metric|validation/i.test(text),
        quality: this.assessEvaluationQuality(text)
      },
      refinement: {
        present: /refine|improve|iterate|enhance|optimize|adjust|feedback/i.test(text),
        quality: this.assessRefinementQuality(text)
      },
      framework: {
        present: /framework|methodology|systematic|structured|comprehensive/i.test(text),
        quality: this.assessFrameworkQuality(text)
      }
    };

    const presentPhases = Object.values(phases).filter(p => p.present).length;
    const qualitySum = Object.values(phases).reduce((sum, p) => sum + (p.present ? p.quality : 0), 0);
    const compliance_score = (presentPhases * 0.7 + qualitySum * 0.3) / 7; // 7 CAGEERF+Framework phases

    const strengths: string[] = [];
    const improvement_areas: string[] = [];
    const specific_suggestions: TemplateEnhancement[] = [];
    
    // Enhanced validation with quality assessment
    if (phases.context.present) {
      if (phases.context.quality > 0.7) strengths.push("Strong contextual awareness and environmental understanding");
      else if (phases.context.quality > 0.4) strengths.push("Basic context awareness present - could be enhanced");
      else improvement_areas.push("Context present but lacks depth - need comprehensive situational analysis");
    } else {
      improvement_areas.push("Missing situational context and environmental factors");
      specific_suggestions.push({
        section: "system",
        type: "addition", 
        description: "Add comprehensive contextual framework",
        content: "Begin by establishing clear situational context: current environment, stakeholders, constraints, and environmental factors that influence the approach.",
        methodologyJustification: "CAGEERF Context phase requires comprehensive situational understanding as foundation",
        impact: "high"
      });
    }
    
    if (phases.analysis.present) {
      if (phases.analysis.quality > 0.7) strengths.push("Systematic analytical approach with multiple perspectives");
      else if (phases.analysis.quality > 0.4) strengths.push("Analytical thinking evident - could be more systematic");
      else improvement_areas.push("Analysis present but lacks systematic depth");
    } else {
      improvement_areas.push("Missing systematic analysis methodology");
      specific_suggestions.push({
        section: "user",
        type: "structure",
        description: "Add systematic analysis framework", 
        content: "Apply structured analysis: examine from multiple perspectives, identify root causes, evaluate evidence and data, consider stakeholder viewpoints.",
        methodologyJustification: "CAGEERF Analysis phase requires systematic examination",
        impact: "high"
      });
    }
    
    if (phases.goals.present) {
      if (phases.goals.quality > 0.7) strengths.push("Well-defined, specific and measurable objectives");
      else strengths.push("Goals mentioned - ensure they are specific and measurable");
    } else {
      improvement_areas.push("Missing clear, specific, measurable goals");
      specific_suggestions.push({
        section: "system",
        type: "addition",
        description: "Require specific goal definition",
        content: "Define specific, measurable, actionable goals with clear success criteria and timelines.",
        methodologyJustification: "CAGEERF Goals phase requires specific measurable objectives",
        impact: "high"
      });
    }
    
    if (phases.execution.present) {
      if (phases.execution.quality > 0.7) strengths.push("Comprehensive implementation approach with practical steps");
      else strengths.push("Execution approach mentioned - could be more detailed");
    } else {
      improvement_areas.push("Missing practical implementation approach");
    }

    if (phases.evaluation.present) {
      if (phases.evaluation.quality > 0.7) strengths.push("Robust evaluation criteria and success metrics");
      else strengths.push("Evaluation mentioned - strengthen success criteria");
    } else {
      improvement_areas.push("Missing evaluation criteria and success metrics");
    }

    if (phases.refinement.present) {
      if (phases.refinement.quality > 0.7) strengths.push("Strong continuous improvement and iteration process");
      else strengths.push("Refinement mentioned - enhance feedback loops");
    } else {
      improvement_areas.push("Missing refinement and continuous improvement process");
    }

    if (phases.framework.present) {
      if (phases.framework.quality > 0.7) strengths.push("Strong systematic framework application");
      else strengths.push("Framework awareness present - strengthen systematic application");
    } else {
      improvement_areas.push("Missing systematic framework methodology");
    }

    return {
      compliant: compliance_score > 0.6, // Higher threshold for enhanced validation
      compliance_score,
      strengths,
      improvement_areas,
      specific_suggestions,
      methodology_gaps: improvement_areas.filter(area => !strengths.some(s => s.includes(area.split(' ')[1])))
    };
  }

  /**
   * Enhanced quality assessment methods for each CAGEERF phase
   */
  private assessContextQuality(text: string): number {
    const indicators = [
      /stakeholder|environment|constraint|factor/i,
      /background|history|situation/i,
      /current.{0,20}state|status.{0,20}quo/i,
      /challenge|opportunity|problem.{0,20}space/i
    ];
    return indicators.filter(pattern => pattern.test(text)).length / indicators.length;
  }

  private assessAnalysisQuality(text: string): number {
    const indicators = [
      /systematic|structured|methodical/i,
      /perspective|viewpoint|angle|lens/i,
      /root.{0,10}cause|underlying|fundamental/i,
      /evidence|data|information|research/i,
      /examine|investigate|explore|study/i
    ];
    return indicators.filter(pattern => pattern.test(text)).length / indicators.length;
  }

  private assessGoalsQuality(text: string): number {
    const indicators = [
      /specific|measurable|quantifiable/i,
      /success.{0,20}criteria|metric|indicator/i,
      /timeline|deadline|timeframe/i,
      /actionable|achievable|realistic/i
    ];
    return indicators.filter(pattern => pattern.test(text)).length / indicators.length;
  }

  private assessExecutionQuality(text: string): number {
    const indicators = [
      /step|phase|stage|milestone/i,
      /resource|capability|skill|tool/i,
      /risk|mitigation|contingency/i,
      /practical|feasible|implementable/i
    ];
    return indicators.filter(pattern => pattern.test(text)).length / indicators.length;
  }

  private assessEvaluationQuality(text: string): number {
    const indicators = [
      /measure|metric|indicator|kpi/i,
      /success|criteria|threshold|benchmark/i,
      /assess|evaluate|validate|verify/i,
      /feedback|monitoring|tracking/i
    ];
    return indicators.filter(pattern => pattern.test(text)).length / indicators.length;
  }

  private assessRefinementQuality(text: string): number {
    const indicators = [
      /iterate|continuous|ongoing/i,
      /improve|enhance|optimize|refine/i,
      /feedback|learn|adapt|adjust/i,
      /version|evolution|development/i
    ];
    return indicators.filter(pattern => pattern.test(text)).length / indicators.length;
  }

  private assessFrameworkQuality(text: string): number {
    const indicators = [
      /framework|methodology|systematic/i,
      /structured|organized|comprehensive/i,
      /consistent|coherent|integrated/i,
      /cageerf|phases|holistic/i
    ];
    return indicators.filter(pattern => pattern.test(text)).length / indicators.length;
  }

  /**
   * Get CAGEERF-specific system prompt guidance
   */
  getSystemPromptGuidance(context: Record<string, any>): string {
    return `Apply the C.A.G.E.E.R.F methodology systematically:

**Context**: Establish comprehensive situational awareness and environmental factors
**Analysis**: Apply structured, systematic examination of the problem or opportunity  
**Goals**: Define specific, measurable, actionable objectives with clear success criteria
**Execution**: Develop practical, implementable approach with detailed action steps
**Evaluation**: Create robust success metrics and assessment methods
**Refinement**: Enable continuous improvement and iteration processes

Ensure each phase builds logically on the previous phases while maintaining focus on practical, actionable outcomes. Consider stakeholder perspectives, resource constraints, and environmental factors throughout the methodology application.`;
  }

  /**
   * Get CAGEERF-specific tool descriptions
   */
  getToolDescriptions(): MethodologyToolDescriptions {
    return {
      prompt_engine: {
        description: "🚀 PROMPT TEMPLATE ENGINE [CAGEERF-ENHANCED]: Processes prompt templates with systematic C.A.G.E.E.R.F methodology injection for comprehensive structured analysis. Context → Analysis → Goals → Execution → Evaluation → Refinement → Framework approach ensures systematic problem-solving and decision-making. WARNING: You are responsible for interpreting and executing the returned content, which contains structured analytical instructions.",
        parameters: {
          execution_mode: "Override intelligent auto-detection with CAGEERF-aware selection (default: auto, systematic analysis-enhanced)"
        }
      },
      prompt_manager: {
        description: "📝 INTELLIGENT PROMPT MANAGER [CAGEERF-ENHANCED]: Complete lifecycle management with systematic C.A.G.E.E.R.F methodology integration. Creates comprehensive analysis templates that guide structured thinking through Context establishment, Analysis phases, Goal definition, Execution planning, Evaluation criteria, and Refinement processes. Optimized for complex analytical and strategic thinking tasks.",
        parameters: {
          action: "Management action: 'create_template' creates CAGEERF-enhanced templates for systematic analysis, strategic planning, and comprehensive problem-solving"
        }
      },
      system_control: {
        description: "⚙️ INTELLIGENT SYSTEM CONTROL [CAGEERF-ACTIVE]: Framework management with C.A.G.E.E.R.F methodology active for systematic, comprehensive analytical approach. Supports switching between methodologies, with CAGEERF optimized for complex analysis, strategic thinking, and multi-phase problem solving requiring structured evaluation.",
        parameters: {
          action: "System action: Active CAGEERF methodology provides systematic Context → Analysis → Goals → Execution → Evaluation → Refinement → Framework approach for comprehensive problem-solving"
        }
      }
    };
  }
}