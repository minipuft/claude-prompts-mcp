/**
 * 5W1H Methodology Guide
 * Provides guidance for applying 5W1H (Who, What, When, Where, Why, How) methodology to prompt creation,
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
  ProcessingStep,
  ExecutionStep,
  QualityGate,
  TemplateEnhancement,
  MethodologyToolDescriptions
} from "../interfaces.js";

/**
 * 5W1H Methodology Guide Implementation
 * Guides the application of 5W1H systematic questioning without replacing semantic analysis
 */
export class FiveW1HMethodologyGuide extends BaseMethodologyGuide {
  readonly frameworkId = "5w1h";
  readonly frameworkName = "5W1H Framework";
  readonly methodology = "5W1H";
  readonly version = "1.0.0";

  /**
   * Guide prompt creation using 5W1H structure
   * Helps users create prompts that follow 5W1H methodology
   */
  guidePromptCreation(intent: string, context?: Record<string, any>): PromptCreationGuidance {
    return {
      structureGuidance: {
        systemPromptSuggestions: [
          "Identify all stakeholders and actors involved",
          "Define exactly what needs to be accomplished",
          "Establish timing and sequence requirements",
          "Determine location and context constraints",
          "Understand underlying purposes and motivations",
          "Plan specific methods and implementation approaches"
        ],
        userTemplateSuggestions: [
          "Structure request using 5W1H systematic questioning",
          "Identify who is involved or affected",
          "Define what exactly needs to be done",
          "Specify when this should happen",
          "Clarify where this takes place",
          "Explain why this is important",
          "Detail how this should be accomplished"
        ],
        argumentSuggestions: [
          {
            name: "stakeholders",
            type: "array",
            description: "People, roles, or entities involved or affected",
            methodologyReason: "5W1H 'Who' question requires comprehensive stakeholder identification",
            examples: ["users", "developers", "managers", "customers"]
          },
          {
            name: "objectives",
            type: "string",
            description: "Specific goals and deliverables to accomplish",
            methodologyReason: "5W1H 'What' question needs clear objective definition",
            examples: ["improve user experience", "reduce processing time", "increase sales"]
          },
          {
            name: "timeline",
            type: "string",
            description: "When this should be completed or timing requirements",
            methodologyReason: "5W1H 'When' question establishes timing and urgency",
            examples: ["by end of quarter", "within 2 weeks", "before product launch"]
          },
          {
            name: "context",
            type: "string",
            description: "Where this takes place or contextual constraints",
            methodologyReason: "5W1H 'Where' question identifies location and context factors",
            examples: ["web application", "mobile platform", "enterprise environment"]
          },
          {
            name: "purpose",
            type: "string",
            description: "Why this is important and underlying motivations",
            methodologyReason: "5W1H 'Why' question uncovers fundamental motivations",
            examples: ["improve customer satisfaction", "reduce operational costs", "meet compliance"]
          }
        ]
      },
      
      methodologyElements: {
        requiredSections: ["Who", "What", "When", "Where", "Why", "How"],
        optionalSections: ["Validation", "Dependencies"],
        sectionDescriptions: {
          "Who": "Identify stakeholders, actors, and people involved or affected",
          "What": "Define exactly what needs to be accomplished and deliverables",
          "When": "Establish timing, deadlines, and sequence requirements",
          "Where": "Determine location, context, and environmental constraints",
          "Why": "Understand underlying purposes, motivations, and importance",
          "How": "Plan specific methods, approaches, and implementation strategies"
        }
      },
      
      qualityGuidance: {
        clarityEnhancements: [
          "Make stakeholder roles and responsibilities explicit",
          "Define specific, measurable objectives and deliverables",
          "Provide concrete timelines and deadlines"
        ],
        completenessChecks: [
          "Ensure all 6 questions (Who, What, When, Where, Why, How) are addressed",
          "Verify stakeholder identification is comprehensive",
          "Confirm objectives are specific and measurable"
        ],
        specificityImprovements: [
          "Replace generic stakeholder references with specific roles",
          "Add quantifiable success criteria and metrics",
          "Include specific implementation steps and methods"
        ]
      }
    };
  }

  /**
   * Guide template processing with 5W1H methodology
   */
  guideTemplateProcessing(template: string, executionType: string): ProcessingGuidance {
    const fiveW1HSteps: ProcessingStep[] = [
      {
        id: "stakeholder_identification",
        name: "Stakeholder Identification (Who)",
        description: "Identify all relevant stakeholders, actors, and people involved",
        methodologyBasis: "5W1H Who question",
        order: 1,
        required: true
      },
      {
        id: "objective_definition",
        name: "Objective Definition (What)",
        description: "Define exactly what needs to be accomplished and deliverables",
        methodologyBasis: "5W1H What question",
        order: 2,
        required: true
      },
      {
        id: "timing_establishment",
        name: "Timing Establishment (When)",
        description: "Establish timing, deadlines, and sequence requirements",
        methodologyBasis: "5W1H When question",
        order: 3,
        required: true
      },
      {
        id: "context_determination",
        name: "Context Determination (Where)",
        description: "Determine location, context, and environmental constraints",
        methodologyBasis: "5W1H Where question",
        order: 4,
        required: true
      },
      {
        id: "purpose_understanding",
        name: "Purpose Understanding (Why)",
        description: "Understand underlying purposes, motivations, and importance",
        methodologyBasis: "5W1H Why question",
        order: 5,
        required: true
      },
      {
        id: "method_planning",
        name: "Method Planning (How)",
        description: "Plan specific methods, approaches, and implementation strategies",
        methodologyBasis: "5W1H How question",
        order: 6,
        required: true
      }
    ];

    return {
      processingSteps: fiveW1HSteps,
      
      templateEnhancements: {
        systemPromptAdditions: [
          "Apply 5W1H systematic questioning methodology",
          "Address Who, What, When, Where, Why, How comprehensively",
          "Ensure complete coverage of all stakeholders and requirements",
          "Use systematic questioning to uncover hidden requirements"
        ],
        userPromptModifications: [
          "Structure response addressing all 5W1H questions",
          "Provide comprehensive stakeholder analysis",
          "Include detailed implementation planning"
        ],
        contextualHints: [
          "Focus on comprehensive requirement gathering",
          "Emphasize stakeholder perspective consideration",
          "Apply systematic analysis to ensure nothing is missed"
        ]
      },
      
      executionFlow: {
        preProcessingSteps: [
          "Validate 5W1H question completeness",
          "Confirm stakeholder identification scope",
          "Verify objective clarity and measurability"
        ],
        postProcessingSteps: [
          "Review 5W1H coverage completeness",
          "Assess stakeholder consideration adequacy",
          "Evaluate implementation plan specificity"
        ],
        validationSteps: [
          "Who question completeness check",
          "What question specificity verification", 
          "When question timing validation",
          "Where question context assessment",
          "Why question motivation analysis",
          "How question method evaluation"
        ]
      }
    };
  }

  /**
   * Guide execution steps using 5W1H methodology
   */
  guideExecutionSteps(prompt: ConvertedPrompt, semanticAnalysis: ContentAnalysisResult): StepGuidance {
    const executionSteps: ExecutionStep[] = [
      {
        id: "comprehensive_who_analysis",
        name: "Comprehensive Who Analysis",
        action: "Identify and analyze all stakeholders, actors, and affected parties",
        methodologyPhase: "Who",
        dependencies: [],
        expected_output: "Complete stakeholder map with roles and responsibilities"
      },
      {
        id: "specific_what_definition",
        name: "Specific What Definition", 
        action: "Define exactly what needs to be accomplished with measurable deliverables",
        methodologyPhase: "What",
        dependencies: ["comprehensive_who_analysis"],
        expected_output: "Clear, specific, measurable objectives and deliverables"
      },
      {
        id: "detailed_when_planning",
        name: "Detailed When Planning",
        action: "Establish comprehensive timing, deadlines, and sequence requirements",
        methodologyPhase: "When",
        dependencies: ["specific_what_definition"],
        expected_output: "Detailed timeline with milestones and dependencies"
      },
      {
        id: "contextual_where_assessment",
        name: "Contextual Where Assessment",
        action: "Determine location, context, environment, and situational constraints",
        methodologyPhase: "Where",
        dependencies: ["detailed_when_planning"],
        expected_output: "Comprehensive context analysis with constraints identified"
      },
      {
        id: "fundamental_why_exploration",
        name: "Fundamental Why Exploration",
        action: "Uncover underlying purposes, motivations, and fundamental importance",
        methodologyPhase: "Why",
        dependencies: ["contextual_where_assessment"],
        expected_output: "Deep understanding of motivations and fundamental purposes"
      },
      {
        id: "specific_how_planning",
        name: "Specific How Planning",
        action: "Develop detailed methods, approaches, and implementation strategies",
        methodologyPhase: "How",
        dependencies: ["fundamental_why_exploration"],
        expected_output: "Comprehensive implementation plan with specific methods"
      }
    ];

    // Adjust steps based on execution type from semantic analyzer
    const stepEnhancements: Record<string, string[]> = {};
    const stepValidation: Record<string, string[]> = {};

    if (semanticAnalysis.executionType === "chain") {
      stepEnhancements["specific_how_planning"] = [
        "Plan sequential implementation steps",
        "Define clear handoff points between phases",
        "Establish validation checkpoints for each step"
      ];
      stepValidation["specific_how_planning"] = [
        "Sequential step validation",
        "Handoff point verification",
        "Checkpoint adequacy assessment"
      ];
    } else if (semanticAnalysis.executionType === "template") {
      stepEnhancements["comprehensive_who_analysis"] = [
        "Create stakeholder templates and categories",
        "Develop reusable stakeholder analysis patterns",
        "Establish standard stakeholder consideration checklists"
      ];
      stepValidation["comprehensive_who_analysis"] = [
        "Template completeness validation",
        "Pattern reusability verification",
        "Checklist coverage assessment"
      ];
    }

    return {
      stepSequence: executionSteps,
      stepEnhancements,
      stepValidation
    };
  }

  /**
   * Enhance execution with 5W1H methodology
   */
  enhanceWithMethodology(prompt: ConvertedPrompt, context: Record<string, any>): MethodologyEnhancement {
    const fiveW1HGates: QualityGate[] = [
      {
        id: "stakeholder_completeness",
        name: "Stakeholder Completeness",
        description: "Verify comprehensive stakeholder identification and analysis",
        methodologyArea: "Who",
        validationCriteria: [
          "All relevant stakeholders identified",
          "Roles and responsibilities defined",
          "Stakeholder interests and concerns considered"
        ],
        priority: "high"
      },
      {
        id: "objective_specificity",
        name: "Objective Specificity",
        description: "Ensure objectives are specific, measurable, and well-defined",
        methodologyArea: "What",
        validationCriteria: [
          "Objectives are specific and clear",
          "Deliverables are measurable",
          "Success criteria are defined"
        ],
        priority: "high"
      },
      {
        id: "timing_comprehensiveness",
        name: "Timing Comprehensiveness",
        description: "Validate thorough timing and scheduling consideration",
        methodologyArea: "When",
        validationCriteria: [
          "Timeline is realistic and detailed",
          "Dependencies and constraints considered",
          "Milestones and checkpoints defined"
        ],
        priority: "medium"
      },
      {
        id: "context_thoroughness",
        name: "Context Thoroughness",
        description: "Assess comprehensive context and environmental analysis",
        methodologyArea: "Where",
        validationCriteria: [
          "Environmental factors considered",
          "Contextual constraints identified",
          "Location and situational factors addressed"
        ],
        priority: "medium"
      },
      {
        id: "purpose_depth",
        name: "Purpose Depth",
        description: "Verify deep understanding of underlying motivations",
        methodologyArea: "Why",
        validationCriteria: [
          "Fundamental purposes understood",
          "Underlying motivations explored",
          "Value and importance articulated"
        ],
        priority: "high"
      },
      {
        id: "method_practicality",
        name: "Method Practicality",
        description: "Ensure methods and approaches are practical and detailed",
        methodologyArea: "How",
        validationCriteria: [
          "Methods are specific and actionable",
          "Implementation approach is practical",
          "Resources and capabilities considered"
        ],
        priority: "medium"
      }
    ];

    const templateSuggestions: TemplateEnhancement[] = [
      {
        section: "system",
        type: "addition",
        description: "Add 5W1H methodology guidance",
        content: "Apply the 5W1H methodology systematically: Who (stakeholders), What (objectives), When (timing), Where (context), Why (purpose), How (methods). Ensure comprehensive coverage of all questions for thorough analysis.",
        methodologyJustification: "Ensures systematic application of comprehensive questioning",
        impact: "high"
      },
      {
        section: "user",
        type: "structure",
        description: "Structure response using 5W1H questions",
        content: "Please structure your response addressing: 1) Who is involved or affected, 2) What needs to be accomplished, 3) When this should happen, 4) Where this takes place, 5) Why this is important, 6) How this should be done.",
        methodologyJustification: "Guides comprehensive analysis through systematic questioning",
        impact: "medium"
      }
    ];

    return {
      systemPromptGuidance: this.getSystemPromptGuidance(context),
      processingEnhancements: this.guideTemplateProcessing("", "template").processingSteps,
      methodologyGates: fiveW1HGates,
      templateSuggestions,
      enhancementMetadata: this.createEnhancementMetadata(
        0.9,
        "5W1H methodology ensures comprehensive analysis through systematic questioning"
      )
    };
  }

  /**
   * Validate methodology compliance
   */
  validateMethodologyCompliance(prompt: ConvertedPrompt): MethodologyValidation {
    const combinedText = this.getCombinedText(prompt);
    const text = combinedText.toLowerCase();
    
    // Check for 5W1H question presence
    const questions = {
      who: /who|stakeholder|actor|people|person|role|user|team/i.test(text),
      what: /what|objective|goal|deliverable|accomplish|achieve/i.test(text),
      when: /when|timing|deadline|schedule|time|date|timeline/i.test(text),
      where: /where|location|context|environment|place|setting/i.test(text),
      why: /why|purpose|reason|motivation|importance|value|benefit/i.test(text),
      how: /how|method|approach|strategy|process|implementation/i.test(text)
    };

    const presentQuestions = Object.values(questions).filter(Boolean).length;
    const compliance_score = presentQuestions / 6; // 6 questions in 5W1H

    const strengths: string[] = [];
    const improvement_areas: string[] = [];
    
    if (questions.who) strengths.push("Stakeholder consideration present");
    else improvement_areas.push("Identify stakeholders and people involved");
    
    if (questions.what) strengths.push("Objective definition evident");
    else improvement_areas.push("Define specific objectives and deliverables");
    
    if (questions.when) strengths.push("Timing consideration included");
    else improvement_areas.push("Establish timing and scheduling requirements");
    
    if (questions.where) strengths.push("Context awareness demonstrated");
    else improvement_areas.push("Consider location and contextual factors");
    
    if (questions.why) strengths.push("Purpose and motivation addressed");
    else improvement_areas.push("Explore underlying purposes and motivations");
    
    if (questions.how) strengths.push("Implementation approach considered");
    else improvement_areas.push("Plan specific methods and implementation approaches");

    const specific_suggestions: TemplateEnhancement[] = [];
    
    if (!questions.who) {
      specific_suggestions.push({
        section: "system",
        type: "addition",
        description: "Add stakeholder identification",
        content: "Identify all stakeholders, actors, and people involved or affected by this.",
        methodologyJustification: "5W1H Who question requires comprehensive stakeholder analysis",
        impact: "high"
      });
    }

    if (!questions.why) {
      specific_suggestions.push({
        section: "system",
        type: "addition",
        description: "Add purpose exploration",
        content: "Explore the underlying purposes, motivations, and importance of this effort.",
        methodologyJustification: "5W1H Why question uncovers fundamental motivations",
        impact: "high"
      });
    }

    return {
      compliant: compliance_score > 0.7,
      compliance_score,
      strengths,
      improvement_areas,
      specific_suggestions,
      methodology_gaps: improvement_areas
    };
  }

  /**
   * Get 5W1H-specific system prompt guidance
   */
  getSystemPromptGuidance(context: Record<string, any>): string {
    return `Apply the 5W1H methodology systematically:

**Who**: Identify all stakeholders, actors, and people involved or affected
**What**: Define exactly what needs to be accomplished and deliverables
**When**: Establish timing, deadlines, and sequence requirements
**Where**: Determine location, context, and environmental constraints
**Why**: Understand underlying purposes, motivations, and fundamental importance
**How**: Plan specific methods, approaches, and implementation strategies

Use systematic questioning to ensure comprehensive coverage and uncover hidden requirements. Address each question thoroughly to build complete understanding and effective solutions.`;
  }

  /**
   * Get 5W1H-specific tool descriptions
   */
  getToolDescriptions(): MethodologyToolDescriptions {
    return {
      prompt_engine: {
        description: "🚀 PROMPT TEMPLATE ENGINE [5W1H-ENHANCED]: Processes prompt templates with systematic 5W1H questioning methodology for comprehensive analysis. Guides thorough exploration through Who (stakeholders), What (objectives), When (timing), Where (context), Why (motivation), and How (methods). WARNING: You are responsible for interpreting and executing the returned content, which contains systematic questioning instructions.",
        parameters: {
          execution_mode: "Override intelligent auto-detection with 5W1H-aware selection (default: auto, systematic questioning-enhanced)"
        }
      },
      prompt_manager: {
        description: "📝 INTELLIGENT PROMPT MANAGER [5W1H-ENHANCED]: Complete lifecycle management with systematic 5W1H questioning methodology integration. Creates comprehensive analysis templates that guide systematic exploration through Who, What, When, Where, Why, and How dimensions. Optimized for thorough requirement analysis and complete solution development.",
        parameters: {
          action: "Management action with 5W1H systematic approach: 'create_template' (comprehensive questioning templates), 'analyze_type' (stakeholder analysis), 'migrate_type' (systematic conversion), etc."
        }
      },
      system_control: {
        description: "⚙️ INTELLIGENT SYSTEM CONTROL [5W1H-ENHANCED]: System administration with 5W1H systematic questioning methodology. Guides comprehensive exploration through Who (users), What (objectives), When (timing), Where (environments), Why (purposes), and How (methods) for thorough system management and decision-making.",
        parameters: {
          action: "System action with 5W1H methodology: 'switch_framework' (systematic framework selection), 'analytics' (comprehensive questioning-based metrics), 'health' (thorough system analysis), etc."
        }
      }
    };
  }
}