/**
 * SCAMPER Methodology Guide
 * Provides guidance for applying SCAMPER (Substitute, Combine, Adapt, Modify, Put to other uses, Eliminate, Reverse)
 * methodology to prompt creation, processing, and execution without hijacking semantic analysis functionality
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
 * SCAMPER Methodology Guide Implementation
 * Guides the application of SCAMPER creative problem-solving techniques without replacing semantic analysis
 */
export class SCAMPERMethodologyGuide extends BaseMethodologyGuide {
  readonly frameworkId = "scamper";
  readonly frameworkName = "SCAMPER Framework";
  readonly methodology = "SCAMPER";
  readonly version = "1.0.0";

  /**
   * Guide prompt creation using SCAMPER structure
   * Helps users create prompts that follow SCAMPER methodology
   */
  guidePromptCreation(intent: string, context?: Record<string, any>): PromptCreationGuidance {
    return {
      structureGuidance: {
        systemPromptSuggestions: [
          "Consider substitution opportunities and alternatives",
          "Explore combination and merger possibilities",
          "Adapt solutions from other domains and contexts",
          "Modify and enhance existing approaches",
          "Find alternative applications and uses",
          "Eliminate unnecessary complexity and components",
          "Reverse or rearrange elements for new perspectives"
        ],
        userTemplateSuggestions: [
          "Structure request using SCAMPER creative techniques",
          "Ask what can be substituted or replaced",
          "Consider what can be combined or merged",
          "Explore adaptation from other domains",
          "Think about modifications and enhancements",
          "Find alternative uses and applications",
          "Identify what can be eliminated or simplified",
          "Consider reversal and rearrangement options"
        ],
        argumentSuggestions: [
          {
            name: "current_solution",
            type: "string",
            description: "Existing solution or approach to be enhanced",
            methodologyReason: "SCAMPER requires a baseline solution to apply creative techniques",
            examples: ["current process", "existing design", "traditional method"]
          },
          {
            name: "creative_constraints",
            type: "array",
            description: "Limitations or constraints for creative exploration",
            methodologyReason: "SCAMPER creativity works within defined boundaries",
            examples: ["budget limits", "time constraints", "technical restrictions"]
          },
          {
            name: "reference_domains",
            type: "array",
            description: "Other domains or fields to draw inspiration from",
            methodologyReason: "SCAMPER Adapt technique requires external reference points",
            examples: ["nature", "other industries", "different technologies"]
          }
        ]
      },
      
      methodologyElements: {
        requiredSections: ["Substitute", "Combine", "Adapt", "Modify", "Put to other uses", "Eliminate", "Reverse"],
        optionalSections: ["Creative Synthesis", "Innovation Potential"],
        sectionDescriptions: {
          "Substitute": "What can be substituted, replaced, or swapped with alternatives?",
          "Combine": "What can be combined, merged, or integrated together?",
          "Adapt": "What can be adapted, borrowed, or learned from other contexts?",
          "Modify": "What can be modified, enhanced, or emphasized differently?",
          "Put to other uses": "How else can this be used or applied in different contexts?",
          "Eliminate": "What can be removed, simplified, or made unnecessary?",
          "Reverse": "What can be rearranged, reversed, or approached from opposite direction?"
        }
      },
      
      qualityGuidance: {
        clarityEnhancements: [
          "Make creative alternatives specific and actionable",
          "Provide concrete examples for each SCAMPER technique",
          "Explain reasoning behind creative suggestions"
        ],
        completenessChecks: [
          "Ensure all 7 SCAMPER techniques are explored",
          "Verify creative alternatives are realistic and feasible",
          "Confirm innovation potential is assessed"
        ],
        specificityImprovements: [
          "Replace vague creative ideas with specific implementation details",
          "Add measurable benefits for each creative alternative",
          "Include risk assessment for innovative approaches"
        ]
      }
    };
  }

  /**
   * Guide template processing with SCAMPER methodology
   */
  guideTemplateProcessing(template: string, executionType: string): ProcessingGuidance {
    const scamperSteps: ProcessingStep[] = [
      {
        id: "substitution_exploration",
        name: "Substitution Exploration",
        description: "Explore what can be substituted, replaced, or swapped with alternatives",
        methodologyBasis: "SCAMPER Substitute technique",
        order: 1,
        required: true
      },
      {
        id: "combination_analysis",
        name: "Combination Analysis",
        description: "Analyze what can be combined, merged, or integrated together",
        methodologyBasis: "SCAMPER Combine technique",
        order: 2,
        required: true
      },
      {
        id: "adaptation_research",
        name: "Adaptation Research",
        description: "Research what can be adapted from other domains and contexts",
        methodologyBasis: "SCAMPER Adapt technique",
        order: 3,
        required: true
      },
      {
        id: "modification_planning",
        name: "Modification Planning",
        description: "Plan modifications, enhancements, and emphasis changes",
        methodologyBasis: "SCAMPER Modify technique",
        order: 4,
        required: true
      },
      {
        id: "alternative_use_exploration",
        name: "Alternative Use Exploration",
        description: "Explore alternative applications and different use cases",
        methodologyBasis: "SCAMPER Put to other uses technique",
        order: 5,
        required: true
      },
      {
        id: "elimination_simplification",
        name: "Elimination & Simplification",
        description: "Identify what can be eliminated, removed, or simplified",
        methodologyBasis: "SCAMPER Eliminate technique",
        order: 6,
        required: true
      },
      {
        id: "reversal_rearrangement",
        name: "Reversal & Rearrangement",
        description: "Consider reversal, rearrangement, and opposite approaches",
        methodologyBasis: "SCAMPER Reverse technique",
        order: 7,
        required: true
      }
    ];

    return {
      processingSteps: scamperSteps,
      
      templateEnhancements: {
        systemPromptAdditions: [
          "Apply SCAMPER creative problem-solving methodology",
          "Use systematic creative techniques: Substitute, Combine, Adapt, Modify, Put to other uses, Eliminate, Reverse",
          "Generate innovative alternatives through structured creativity",
          "Explore unconventional approaches and solutions"
        ],
        userPromptModifications: [
          "Structure response using SCAMPER creative techniques",
          "Provide innovative alternatives for each SCAMPER element",
          "Include creative synthesis and implementation potential"
        ],
        contextualHints: [
          "Focus on creative problem-solving and innovation",
          "Encourage unconventional thinking and approaches",
          "Apply systematic creativity to generate alternatives"
        ]
      },
      
      executionFlow: {
        preProcessingSteps: [
          "Validate baseline solution or current approach clarity",
          "Confirm creative constraints and boundaries",
          "Verify reference domains for adaptation are identified"
        ],
        postProcessingSteps: [
          "Review SCAMPER technique coverage completeness",
          "Assess creative alternative feasibility and innovation",
          "Evaluate implementation potential of creative solutions"
        ],
        validationSteps: [
          "Substitute technique application check",
          "Combine technique exploration verification",
          "Adapt technique research validation",
          "Modify technique enhancement assessment",
          "Alternative use exploration completeness",
          "Eliminate technique simplification review",
          "Reverse technique rearrangement evaluation"
        ]
      }
    };
  }

  /**
   * Guide execution steps using SCAMPER methodology
   */
  guideExecutionSteps(prompt: ConvertedPrompt, semanticAnalysis: ContentAnalysisResult): StepGuidance {
    const executionSteps: ExecutionStep[] = [
      {
        id: "substitute_analysis",
        name: "Substitute Analysis",
        action: "Systematically explore substitution opportunities and alternative replacements",
        methodologyPhase: "Substitute",
        dependencies: [],
        expected_output: "List of viable substitution alternatives with rationale"
      },
      {
        id: "combine_exploration",
        name: "Combine Exploration",
        action: "Explore combination and integration possibilities between elements",
        methodologyPhase: "Combine",
        dependencies: ["substitute_analysis"],
        expected_output: "Creative combination possibilities with potential benefits"
      },
      {
        id: "adapt_research",
        name: "Adapt Research",
        action: "Research adaptations from other domains, industries, and contexts",
        methodologyPhase: "Adapt",
        dependencies: ["combine_exploration"],
        expected_output: "Adaptable solutions from other contexts with implementation approaches"
      },
      {
        id: "modify_enhancement",
        name: "Modify Enhancement",
        action: "Develop modification and enhancement possibilities for existing elements",
        methodologyPhase: "Modify",
        dependencies: ["adapt_research"],
        expected_output: "Specific modifications with enhanced capabilities and benefits"
      },
      {
        id: "alternative_use_generation",
        name: "Alternative Use Generation",
        action: "Generate alternative applications and different use case possibilities",
        methodologyPhase: "Put to other uses",
        dependencies: ["modify_enhancement"],
        expected_output: "Creative alternative uses with potential markets or applications"
      },
      {
        id: "elimination_simplification",
        name: "Elimination Simplification",
        action: "Identify elimination opportunities and simplification possibilities",
        methodologyPhase: "Eliminate",
        dependencies: ["alternative_use_generation"],
        expected_output: "Simplification opportunities with complexity reduction benefits"
      },
      {
        id: "reverse_rearrangement",
        name: "Reverse Rearrangement",
        action: "Explore reversal and rearrangement possibilities for new perspectives",
        methodologyPhase: "Reverse",
        dependencies: ["elimination_simplification"],
        expected_output: "Innovative arrangements and reversed approaches with unique advantages"
      }
    ];

    // Adjust steps based on execution type from semantic analyzer
    const stepEnhancements: Record<string, string[]> = {};
    const stepValidation: Record<string, string[]> = {};

    if (semanticAnalysis.executionType === "template") {
      stepEnhancements["substitute_analysis"] = [
        "Create substitution templates and patterns",
        "Develop reusable substitution analysis frameworks",
        "Establish standard substitution evaluation criteria"
      ];
      stepValidation["substitute_analysis"] = [
        "Template applicability validation",
        "Pattern effectiveness verification",
        "Criteria completeness assessment"
      ];
    } else if (semanticAnalysis.complexity === "high") {
      stepEnhancements["adapt_research"] = [
        "Conduct deep cross-domain analysis",
        "Research complex system adaptations",
        "Explore multi-level adaptation possibilities"
      ];
      stepValidation["adapt_research"] = [
        "Cross-domain relevance validation",
        "System complexity compatibility check",
        "Multi-level adaptation feasibility assessment"
      ];
    }

    return {
      stepSequence: executionSteps,
      stepEnhancements,
      stepValidation
    };
  }

  /**
   * Enhance execution with SCAMPER methodology
   */
  enhanceWithMethodology(prompt: ConvertedPrompt, context: Record<string, any>): MethodologyEnhancement {
    const scamperGates: QualityGate[] = [
      {
        id: "substitution_creativity",
        name: "Substitution Creativity",
        description: "Verify creative and viable substitution alternatives",
        methodologyArea: "Substitute",
        validationCriteria: [
          "Substitution alternatives are creative and innovative",
          "Alternatives are viable and practical",
          "Substitution benefits are clearly articulated"
        ],
        priority: "medium"
      },
      {
        id: "combination_synergy",
        name: "Combination Synergy",
        description: "Ensure combinations create synergistic value",
        methodologyArea: "Combine",
        validationCriteria: [
          "Combinations create added value beyond individual parts",
          "Integration approaches are feasible",
          "Synergistic benefits are measurable"
        ],
        priority: "medium"
      },
      {
        id: "adaptation_relevance",
        name: "Adaptation Relevance",
        description: "Validate relevance and applicability of adapted solutions",
        methodologyArea: "Adapt",
        validationCriteria: [
          "Adapted solutions are contextually relevant",
          "Cross-domain insights are meaningful",
          "Implementation approaches are defined"
        ],
        priority: "high"
      },
      {
        id: "modification_enhancement",
        name: "Modification Enhancement",
        description: "Assess enhancement value of proposed modifications",
        methodologyArea: "Modify",
        validationCriteria: [
          "Modifications provide clear improvements",
          "Enhancements are measurable and significant",
          "Implementation complexity is justified"
        ],
        priority: "medium"
      },
      {
        id: "alternative_use_viability",
        name: "Alternative Use Viability",
        description: "Evaluate viability of alternative applications",
        methodologyArea: "Put to other uses",
        validationCriteria: [
          "Alternative uses are practical and viable",
          "New applications create value",
          "Market or user need exists for alternatives"
        ],
        priority: "low"
      },
      {
        id: "elimination_benefit",
        name: "Elimination Benefit",
        description: "Verify benefits of elimination and simplification",
        methodologyArea: "Eliminate",
        validationCriteria: [
          "Eliminations maintain essential functionality",
          "Simplifications provide clear benefits",
          "Complexity reduction is meaningful"
        ],
        priority: "medium"
      },
      {
        id: "reversal_innovation",
        name: "Reversal Innovation",
        description: "Assess innovation potential of reversal approaches",
        methodologyArea: "Reverse",
        validationCriteria: [
          "Reversals provide new perspectives",
          "Rearrangements create innovative approaches",
          "Opposite approaches offer unique advantages"
        ],
        priority: "low"
      }
    ];

    const templateSuggestions: TemplateEnhancement[] = [
      {
        section: "system",
        type: "addition",
        description: "Add SCAMPER creative methodology guidance",
        content: "Apply the SCAMPER creative problem-solving methodology: Substitute (replace elements), Combine (merge ideas), Adapt (borrow from other contexts), Modify (enhance existing), Put to other uses (find new applications), Eliminate (simplify by removing), Reverse (rearrange or opposite approach).",
        methodologyJustification: "Ensures systematic application of creative problem-solving techniques",
        impact: "high"
      },
      {
        section: "user",
        type: "structure",
        description: "Structure response using SCAMPER techniques",
        content: "Please explore creative alternatives using SCAMPER: 1) What can be substituted, 2) What can be combined, 3) What can be adapted from elsewhere, 4) What can be modified, 5) How else can this be used, 6) What can be eliminated, 7) What can be reversed or rearranged.",
        methodologyJustification: "Guides systematic creative exploration through structured techniques",
        impact: "medium"
      }
    ];

    return {
      systemPromptGuidance: this.getSystemPromptGuidance(context),
      processingEnhancements: this.guideTemplateProcessing("", "template").processingSteps,
      methodologyGates: scamperGates,
      templateSuggestions,
      enhancementMetadata: this.createEnhancementMetadata(
        0.8,
        "SCAMPER methodology provides systematic creative problem-solving techniques"
      )
    };
  }

  /**
   * Validate methodology compliance
   */
  validateMethodologyCompliance(prompt: ConvertedPrompt): MethodologyValidation {
    const combinedText = this.getCombinedText(prompt);
    const text = combinedText.toLowerCase();
    
    // Check for SCAMPER technique presence
    const techniques = {
      substitute: /substitut|replac|alternative|swap|chang/i.test(text),
      combine: /combin|merg|integrat|join|unit/i.test(text),
      adapt: /adapt|borrow|learn|inspir|transfer/i.test(text),
      modify: /modif|enhanc|improv|adjust|refin/i.test(text),
      putToOtherUses: /use|applic|purpos|function|utiliz/i.test(text),
      eliminate: /eliminat|remov|simplif|reduc|streamlin/i.test(text),
      reverse: /revers|rearrang|opposit|invert|flip/i.test(text)
    };

    const presentTechniques = Object.values(techniques).filter(Boolean).length;
    const compliance_score = presentTechniques / 7; // 7 SCAMPER techniques

    const strengths: string[] = [];
    const improvement_areas: string[] = [];
    
    if (techniques.substitute) strengths.push("Substitution and replacement consideration present");
    else improvement_areas.push("Explore substitution and replacement opportunities");
    
    if (techniques.combine) strengths.push("Combination and integration approach evident");
    else improvement_areas.push("Consider combination and merger possibilities");
    
    if (techniques.adapt) strengths.push("Adaptation from other contexts mentioned");
    else improvement_areas.push("Adapt solutions from other domains and contexts");
    
    if (techniques.modify) strengths.push("Modification and enhancement considered");
    else improvement_areas.push("Explore modification and enhancement opportunities");
    
    if (techniques.putToOtherUses) strengths.push("Alternative uses and applications present");
    else improvement_areas.push("Find alternative uses and applications");
    
    if (techniques.eliminate) strengths.push("Elimination and simplification considered");
    else improvement_areas.push("Identify elimination and simplification opportunities");
    
    if (techniques.reverse) strengths.push("Reversal and rearrangement approaches present");
    else improvement_areas.push("Explore reversal and rearrangement possibilities");

    const specific_suggestions: TemplateEnhancement[] = [];
    
    if (!techniques.substitute) {
      specific_suggestions.push({
        section: "system",
        type: "addition",
        description: "Add substitution exploration",
        content: "Consider what can be substituted, replaced, or swapped with alternatives.",
        methodologyJustification: "SCAMPER Substitute technique explores replacement opportunities",
        impact: "medium"
      });
    }

    if (!techniques.adapt) {
      specific_suggestions.push({
        section: "system",
        type: "addition",
        description: "Add adaptation from other domains",
        content: "Explore what can be adapted or borrowed from other contexts, industries, or domains.",
        methodologyJustification: "SCAMPER Adapt technique draws inspiration from external sources",
        impact: "high"
      });
    }

    return {
      compliant: compliance_score > 0.5,
      compliance_score,
      strengths,
      improvement_areas,
      specific_suggestions,
      methodology_gaps: improvement_areas
    };
  }

  /**
   * Get SCAMPER-specific system prompt guidance
   */
  getSystemPromptGuidance(context: Record<string, any>): string {
    return `Apply the SCAMPER creative problem-solving methodology systematically:

**Substitute**: What can be substituted, replaced, or swapped with alternatives?
**Combine**: What can be combined, merged, or integrated together?
**Adapt**: What can be adapted, borrowed, or learned from other contexts?
**Modify**: What can be modified, enhanced, or emphasized differently?
**Put to other uses**: How else can this be used or applied in different contexts?
**Eliminate**: What can be removed, simplified, or made unnecessary?
**Reverse**: What can be rearranged, reversed, or approached from opposite direction?

Use these creative techniques to generate innovative solutions and explore unconventional approaches. Each technique should be applied systematically to maximize creative potential and discover breakthrough alternatives.`;
  }

  /**
   * Get SCAMPER-specific tool descriptions
   */
  getToolDescriptions(): MethodologyToolDescriptions {
    return {
      prompt_engine: {
        description: "🚀 PROMPT TEMPLATE ENGINE [SCAMPER-ENHANCED]: Processes prompt templates with systematic SCAMPER creative methodology for innovative problem-solving. Guides creative exploration through Substitute, Combine, Adapt, Modify, Put to other uses, Eliminate, and Reverse techniques. WARNING: You are responsible for interpreting and executing the returned content, which contains creative innovation instructions.",
        parameters: {
          execution_mode: "Override intelligent auto-detection with SCAMPER-aware selection (default: auto, creative innovation-enhanced)"
        }
      },
      prompt_manager: {
        description: "📝 INTELLIGENT PROMPT MANAGER [SCAMPER-ENHANCED]: Complete lifecycle management with systematic SCAMPER creative methodology integration. Creates innovative analysis templates that guide creative exploration through Substitution, Combination, Adaptation, Modification, alternative Uses, Elimination, and Reversal. Optimized for creative problem-solving and breakthrough innovation tasks.",
        parameters: {
          action: "Management action with SCAMPER creative approach: 'create_template' (creative innovation templates), 'analyze_type' (creative pattern analysis), 'migrate_type' (innovative conversion), etc."
        }
      },
      system_control: {
        description: "⚙️ INTELLIGENT SYSTEM CONTROL [SCAMPER-ENHANCED]: System administration with SCAMPER creative methodology for innovative system management. Guides systematic creative exploration through Substitute (alternatives), Combine (integrations), Adapt (learning), Modify (improvements), alternative Uses, Eliminate (simplification), and Reverse (rearrangement) for breakthrough system optimization.",
        parameters: {
          action: "System action with SCAMPER methodology: 'switch_framework' (creative framework selection), 'analytics' (innovative analysis), 'health' (creative system optimization), etc."
        }
      }
    };
  }
}