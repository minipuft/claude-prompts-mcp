/**
 * CAGEERF Template Repository
 * Comprehensive collection of pre-built CAGEERF-compliant template patterns
 * Organized by domain, complexity, and framework emphasis
 */

import { TemplatePattern, TemplateCategory, TemplatePlaceholder } from "./template-generator.js";

/**
 * Comprehensive Template Repository with CAGEERF-optimized patterns
 */
export class TemplateRepositoryBuilder {
  
  /**
   * Build comprehensive template repository
   */
  static buildRepository(): { templates: TemplatePattern[]; categories: TemplateCategory[] } {
    return {
      templates: [
        ...this.getAnalysisTemplates(),
        ...this.getExecutionTemplates(),
        ...this.getFrameworkTemplates(),
        ...this.getCreativeTemplates(),
        ...this.getTechnicalTemplates(),
        ...this.getBusinessTemplates(),
        ...this.getEducationalTemplates(),
        ...this.getResearchTemplates()
      ],
      categories: this.getCategories()
    };
  }

  /**
   * Analysis & Assessment Templates
   */
  private static getAnalysisTemplates(): TemplatePattern[] {
    return [
      {
        id: 'comprehensive_analysis',
        name: 'Comprehensive Analysis Framework',
        description: 'Advanced systematic analysis with full CAGEERF methodology',
        category: 'analysis',
        complexity: 'expert',
        cageerfComponents: ['context', 'analysis', 'goals', 'evaluation', 'refinement', 'framework'],
        baseTemplate: `# {{analysis_title}} - Comprehensive Analysis

## 🎯 Context & Environment
**Situational Context**: {{context_description}}
**Stakeholder Ecosystem**: {{stakeholders}}
**Environmental Constraints**: {{constraints}}
**Success Factors**: {{success_factors}}

## 🔍 Analysis Framework
**Primary Analysis Target**: {{analysis_target}}
**Methodology**: {{analysis_methodology}}
**Critical Success Factors**: {{critical_factors}}
**Evaluation Criteria**: {{evaluation_criteria}}

## 📋 Goals & Objectives
**Strategic Objective**: {{primary_objective}}
**Key Performance Indicators**: {{kpi_metrics}}
**Expected Deliverables**: {{deliverables}}
**Success Validation**: {{validation_criteria}}

## ⚙️ Execution Strategy
**Phase 1 - Discovery**: {{discovery_steps}}
**Phase 2 - Analysis**: {{analysis_steps}}
**Phase 3 - Synthesis**: {{synthesis_steps}}
**Phase 4 - Validation**: {{validation_steps}}

## 📊 Evaluation & Quality Assurance
**Quality Standards**: {{quality_standards}}
**Testing Protocols**: {{testing_protocols}}
**Review Criteria**: {{review_criteria}}
**Performance Metrics**: {{performance_metrics}}

## 🔄 Refinement & Optimization
**Feedback Integration**: {{feedback_process}}
**Iterative Improvements**: {{improvement_cycle}}
**Optimization Opportunities**: {{optimization_areas}}
**Continuous Enhancement**: {{enhancement_strategy}}

## 📐 Framework Compliance
**Methodology Standards**: {{methodology_standards}}
**Best Practices**: {{best_practices}}
**Compliance Requirements**: {{compliance_requirements}}
**Quality Governance**: {{governance_protocols}}`,
        systemMessageTemplate: 'You are an expert analyst following the CAGEERF methodology. Provide comprehensive, systematic analysis with evidence-based reasoning, structured methodology, and actionable insights. Ensure all analysis components are thoroughly addressed with professional rigor.',
        placeholders: [
          {
            name: 'analysis_title',
            description: 'Title and scope of the comprehensive analysis',
            required: true,
            cageerfComponent: 'context'
          },
          {
            name: 'context_description',
            description: 'Detailed environmental and situational context',
            required: true,
            cageerfComponent: 'context'
          },
          {
            name: 'analysis_target',
            description: 'Primary subject or focus of analysis',
            required: true,
            cageerfComponent: 'analysis'
          },
          {
            name: 'primary_objective',
            description: 'Main strategic objective of the analysis',
            required: true,
            cageerfComponent: 'goals'
          },
          {
            name: 'analysis_methodology',
            description: 'Systematic methodology and approach for analysis',
            required: true,
            cageerfComponent: 'framework'
          }
        ],
        useCases: ['business analysis', 'strategic planning', 'research analysis', 'risk assessment', 'performance evaluation']
      },
      {
        id: 'rapid_assessment',
        name: 'Rapid Assessment Template',
        description: 'Quick but structured assessment following CAGEERF principles',
        category: 'analysis',
        complexity: 'intermediate',
        cageerfComponents: ['context', 'analysis', 'goals', 'evaluation'],
        baseTemplate: `# {{assessment_title}}

## Context
{{context_overview}}

## Assessment Focus
**Target**: {{assessment_target}}
**Criteria**: {{assessment_criteria}}
**Timeline**: {{timeline}}

## Analysis Approach
{{analysis_method}}

## Expected Outcomes
{{expected_results}}

## Quality Check
{{validation_approach}}`,
        systemMessageTemplate: 'Provide rapid but thorough assessment using structured CAGEERF principles. Focus on efficiency while maintaining analytical rigor.',
        placeholders: [
          {
            name: 'assessment_title',
            description: 'Title of the rapid assessment',
            required: true,
            cageerfComponent: 'context'
          },
          {
            name: 'assessment_target',
            description: 'Primary subject of assessment',
            required: true,
            cageerfComponent: 'analysis'
          },
          {
            name: 'assessment_criteria',
            description: 'Key criteria for evaluation',
            required: true,
            cageerfComponent: 'evaluation'
          }
        ],
        useCases: ['quick evaluation', 'preliminary assessment', 'triage analysis', 'initial review']
      }
    ];
  }

  /**
   * Execution & Implementation Templates
   */
  private static getExecutionTemplates(): TemplatePattern[] {
    return [
      {
        id: 'strategic_implementation',
        name: 'Strategic Implementation Framework',
        description: 'Comprehensive implementation plan with CAGEERF methodology',
        category: 'execution',
        complexity: 'expert',
        cageerfComponents: ['context', 'goals', 'execution', 'evaluation', 'refinement', 'framework'],
        baseTemplate: `# {{project_title}} - Strategic Implementation

## 🌍 Implementation Context
**Project Environment**: {{project_context}}
**Stakeholder Alignment**: {{stakeholder_alignment}}
**Resource Constraints**: {{resource_constraints}}
**Success Factors**: {{critical_success_factors}}

## 🎯 Strategic Goals
**Primary Objective**: {{primary_goal}}
**Key Results (KPIs)**: {{key_results}}
**Success Metrics**: {{success_metrics}}
**Value Proposition**: {{value_proposition}}

## ⚙️ Implementation Strategy
### Phase 1: Foundation & Setup
{{phase_1_activities}}

### Phase 2: Core Implementation
{{phase_2_activities}}

### Phase 3: Integration & Testing
{{phase_3_activities}}

### Phase 4: Deployment & Launch
{{phase_4_activities}}

## 📊 Monitoring & Evaluation
**Performance Dashboard**: {{monitoring_metrics}}
**Quality Gates**: {{quality_checkpoints}}
**Risk Mitigation**: {{risk_management}}
**Success Validation**: {{validation_protocols}}

## 🔄 Continuous Improvement
**Feedback Loops**: {{feedback_mechanisms}}
**Optimization Cycles**: {{optimization_schedule}}
**Adaptation Strategy**: {{adaptation_approach}}
**Lessons Learned**: {{learning_capture}}

## 📐 Governance Framework
**Project Methodology**: {{project_methodology}}
**Quality Standards**: {{quality_framework}}
**Compliance Requirements**: {{compliance_standards}}
**Best Practices**: {{implementation_best_practices}}`,
        systemMessageTemplate: 'You are a strategic implementation expert using CAGEERF methodology. Provide detailed, actionable implementation guidance with clear phases, metrics, and governance. Ensure systematic approach with built-in quality controls.',
        placeholders: [
          {
            name: 'project_title',
            description: 'Strategic project or initiative title',
            required: true,
            cageerfComponent: 'context'
          },
          {
            name: 'primary_goal',
            description: 'Main strategic objective',
            required: true,
            cageerfComponent: 'goals'
          },
          {
            name: 'phase_1_activities',
            description: 'Foundation phase activities and deliverables',
            required: true,
            cageerfComponent: 'execution'
          }
        ],
        useCases: ['project management', 'strategic initiatives', 'organizational change', 'system implementation']
      },
      {
        id: 'agile_execution',
        name: 'Agile Execution Template',
        description: 'Iterative execution approach with CAGEERF integration',
        category: 'execution',
        complexity: 'advanced',
        cageerfComponents: ['goals', 'execution', 'evaluation', 'refinement'],
        baseTemplate: `# {{sprint_goal}} - Agile Execution

## Sprint Context
{{sprint_context}}

## Sprint Goals
**Primary Objective**: {{sprint_objective}}
**Success Criteria**: {{success_criteria}}
**Deliverables**: {{sprint_deliverables}}

## Execution Plan
### Sprint Activities
{{sprint_activities}}

### Quality Gates
{{quality_checkpoints}}

## Evaluation & Review
**Sprint Review**: {{review_criteria}}
**Retrospective**: {{retrospective_focus}}

## Continuous Improvement
**Action Items**: {{improvement_actions}}
**Next Sprint Planning**: {{next_sprint_prep}}`,
        systemMessageTemplate: 'Guide agile execution using CAGEERF principles. Focus on iterative delivery with continuous improvement and systematic evaluation.',
        placeholders: [
          {
            name: 'sprint_goal',
            description: 'Primary goal for this sprint/iteration',
            required: true,
            cageerfComponent: 'goals'
          },
          {
            name: 'sprint_activities',
            description: 'Key activities and tasks for execution',
            required: true,
            cageerfComponent: 'execution'
          }
        ],
        useCases: ['agile development', 'iterative projects', 'sprint planning', 'continuous delivery']
      }
    ];
  }

  /**
   * Framework & Methodology Templates
   */
  private static getFrameworkTemplates(): TemplatePattern[] {
    return [
      {
        id: 'methodology_design',
        name: 'Methodology Design Framework',
        description: 'Design systematic methodologies using CAGEERF principles',
        category: 'framework',
        complexity: 'expert',
        cageerfComponents: ['context', 'analysis', 'goals', 'execution', 'evaluation', 'refinement', 'framework'],
        baseTemplate: `# {{methodology_name}} - Framework Design

## 🎯 Methodology Context
**Domain Application**: {{application_domain}}
**Target Audience**: {{target_users}}
**Use Case Scenarios**: {{use_cases}}
**Constraints & Requirements**: {{constraints}}

## 🔍 Framework Analysis
**Existing Approaches**: {{current_approaches}}
**Gap Analysis**: {{identified_gaps}}
**Innovation Opportunities**: {{innovation_areas}}
**Success Factors**: {{success_requirements}}

## 📋 Framework Goals
**Methodology Objectives**: {{framework_objectives}}
**User Outcomes**: {{user_benefits}}
**Quality Standards**: {{quality_targets}}
**Adoption Metrics**: {{adoption_goals}}

## ⚙️ Framework Structure
### Core Components
{{core_components}}

### Process Flow
{{process_workflow}}

### Implementation Guidelines
{{implementation_guide}}

### Tool & Technique Integration
{{tools_techniques}}

## 📊 Validation & Testing
**Pilot Testing**: {{pilot_approach}}
**Validation Criteria**: {{validation_metrics}}
**User Feedback**: {{feedback_collection}}
**Performance Measurement**: {{performance_indicators}}

## 🔄 Framework Evolution
**Iterative Improvement**: {{improvement_cycle}}
**User Community**: {{community_engagement}}
**Version Management**: {{version_control}}
**Knowledge Base**: {{knowledge_management}}

## 📐 Governance & Standards
**Quality Assurance**: {{qa_framework}}
**Compliance Standards**: {{compliance_requirements}}
**Best Practices**: {{best_practice_library}}
**Training & Certification**: {{training_program}}`,
        systemMessageTemplate: 'You are a methodology design expert using CAGEERF framework. Create systematic, practical frameworks with clear governance, validation, and evolution mechanisms. Ensure methodologies are both rigorous and usable.',
        placeholders: [
          {
            name: 'methodology_name',
            description: 'Name and scope of the methodology being designed',
            required: true,
            cageerfComponent: 'context'
          },
          {
            name: 'application_domain',
            description: 'Primary domain or field of application',
            required: true,
            cageerfComponent: 'context'
          },
          {
            name: 'framework_objectives',
            description: 'Primary objectives the methodology should achieve',
            required: true,
            cageerfComponent: 'goals'
          }
        ],
        useCases: ['methodology development', 'process design', 'framework creation', 'best practice development']
      }
    ];
  }

  /**
   * Creative & Innovation Templates
   */
  private static getCreativeTemplates(): TemplatePattern[] {
    return [
      {
        id: 'creative_ideation',
        name: 'Creative Ideation Framework',
        description: 'Structured creativity using CAGEERF methodology',
        category: 'creative',
        complexity: 'intermediate',
        cageerfComponents: ['context', 'analysis', 'goals', 'execution', 'evaluation'],
        baseTemplate: `# {{creative_challenge}} - Innovation Framework

## 🌟 Creative Context
**Challenge Background**: {{challenge_context}}
**Innovation Constraints**: {{creative_constraints}}
**Target Audience**: {{target_audience}}
**Success Vision**: {{success_vision}}

## 🎨 Creative Analysis
**Current State**: {{current_situation}}
**Opportunity Areas**: {{opportunity_spaces}}
**Inspiration Sources**: {{inspiration_inputs}}
**Creative Techniques**: {{ideation_methods}}

## 🎯 Innovation Goals
**Primary Objective**: {{innovation_goal}}
**Creative Criteria**: {{creative_criteria}}
**Success Metrics**: {{innovation_metrics}}
**Impact Vision**: {{impact_goals}}

## ⚡ Ideation Process
### Divergent Thinking
{{divergent_activities}}

### Convergent Evaluation
{{convergent_criteria}}

### Concept Development
{{concept_development}}

## 📊 Evaluation & Selection
**Idea Assessment**: {{assessment_criteria}}
**Feasibility Analysis**: {{feasibility_check}}
**Impact Potential**: {{impact_evaluation}}
**Selection Process**: {{selection_method}}`,
        systemMessageTemplate: 'Guide creative ideation using structured CAGEERF approach. Balance creative freedom with systematic evaluation. Encourage innovative thinking while maintaining practical feasibility.',
        placeholders: [
          {
            name: 'creative_challenge',
            description: 'Creative challenge or innovation opportunity',
            required: true,
            cageerfComponent: 'context'
          },
          {
            name: 'innovation_goal',
            description: 'Primary innovation objective',
            required: true,
            cageerfComponent: 'goals'
          }
        ],
        useCases: ['innovation workshops', 'creative problem solving', 'design thinking', 'brainstorming sessions']
      }
    ];
  }

  /**
   * Technical & Development Templates
   */
  private static getTechnicalTemplates(): TemplatePattern[] {
    return [
      {
        id: 'technical_architecture',
        name: 'Technical Architecture Framework',
        description: 'Systematic technical design using CAGEERF methodology',
        category: 'technical',
        complexity: 'expert',
        cageerfComponents: ['context', 'analysis', 'goals', 'execution', 'evaluation', 'framework'],
        baseTemplate: `# {{system_name}} - Technical Architecture

## 🏗️ System Context
**Business Requirements**: {{business_context}}
**Technical Environment**: {{technical_environment}}
**Constraints & Limitations**: {{system_constraints}}
**Stakeholder Requirements**: {{stakeholder_needs}}

## 🔧 Technical Analysis
**Current Architecture**: {{current_state}}
**Requirements Analysis**: {{functional_requirements}}
**Non-Functional Requirements**: {{nfr_analysis}}
**Technology Assessment**: {{technology_evaluation}}

## 🎯 Architecture Goals
**System Objectives**: {{system_goals}}
**Quality Attributes**: {{quality_attributes}}
**Performance Targets**: {{performance_goals}}
**Success Criteria**: {{architecture_success}}

## ⚙️ Design & Implementation
### System Architecture
{{architecture_design}}

### Component Design
{{component_specification}}

### Implementation Strategy
{{implementation_approach}}

### Deployment Architecture
{{deployment_strategy}}

## 📊 Validation & Testing
**Architecture Validation**: {{validation_strategy}}
**Testing Framework**: {{testing_approach}}
**Performance Testing**: {{performance_validation}}
**Security Assessment**: {{security_validation}}

## 📐 Governance & Standards
**Architecture Principles**: {{architecture_principles}}
**Design Standards**: {{design_standards}}
**Code Quality**: {{quality_standards}}
**Documentation Standards**: {{documentation_requirements}}`,
        systemMessageTemplate: 'You are a technical architecture expert using CAGEERF methodology. Design robust, scalable systems with clear validation and governance. Ensure architectural decisions are well-reasoned and documented.',
        placeholders: [
          {
            name: 'system_name',
            description: 'Name and scope of the technical system',
            required: true,
            cageerfComponent: 'context'
          },
          {
            name: 'business_context',
            description: 'Business requirements and context',
            required: true,
            cageerfComponent: 'context'
          },
          {
            name: 'system_goals',
            description: 'Primary technical objectives',
            required: true,
            cageerfComponent: 'goals'
          }
        ],
        useCases: ['system design', 'software architecture', 'technical planning', 'infrastructure design']
      }
    ];
  }

  /**
   * Business & Strategy Templates
   */
  private static getBusinessTemplates(): TemplatePattern[] {
    return [
      {
        id: 'business_strategy',
        name: 'Business Strategy Framework',
        description: 'Strategic business planning with CAGEERF methodology',
        category: 'business',
        complexity: 'expert',
        cageerfComponents: ['context', 'analysis', 'goals', 'execution', 'evaluation', 'refinement', 'framework'],
        baseTemplate: `# {{strategy_name}} - Business Strategy

## 🌍 Market Context
**Market Environment**: {{market_context}}
**Competitive Landscape**: {{competitive_analysis}}
**Customer Segments**: {{customer_segments}}
**Market Opportunities**: {{market_opportunities}}

## 📊 Strategic Analysis
**SWOT Analysis**: {{swot_analysis}}
**Value Chain Analysis**: {{value_chain}}
**Core Competencies**: {{core_capabilities}}
**Strategic Options**: {{strategic_alternatives}}

## 🎯 Strategic Goals
**Vision & Mission**: {{vision_mission}}
**Strategic Objectives**: {{strategic_objectives}}
**Key Results (OKRs)**: {{key_results}}
**Value Proposition**: {{value_proposition}}

## ⚙️ Strategy Execution
### Strategic Initiatives
{{strategic_initiatives}}

### Resource Allocation
{{resource_strategy}}

### Implementation Roadmap
{{implementation_timeline}}

### Organizational Alignment
{{organizational_changes}}

## 📊 Performance Monitoring
**Strategic Metrics**: {{strategic_kpis}}
**Balanced Scorecard**: {{balanced_scorecard}}
**Risk Management**: {{risk_framework}}
**Market Feedback**: {{market_monitoring}}

## 🔄 Strategic Adaptation
**Strategy Review**: {{review_process}}
**Market Response**: {{adaptation_mechanisms}}
**Innovation Pipeline**: {{innovation_strategy}}
**Competitive Response**: {{competitive_adaptation}}

## 📐 Strategic Governance
**Governance Model**: {{governance_structure}}
**Decision Framework**: {{decision_processes}}
**Strategic Planning**: {{planning_cycle}}
**Performance Management**: {{performance_framework}}`,
        systemMessageTemplate: 'You are a strategic business expert using CAGEERF methodology. Develop comprehensive business strategies with clear execution plans, metrics, and adaptation mechanisms. Ensure strategic alignment and practical implementation.',
        placeholders: [
          {
            name: 'strategy_name',
            description: 'Name and scope of the business strategy',
            required: true,
            cageerfComponent: 'context'
          },
          {
            name: 'market_context',
            description: 'Market environment and context',
            required: true,
            cageerfComponent: 'context'
          },
          {
            name: 'strategic_objectives',
            description: 'Primary strategic objectives',
            required: true,
            cageerfComponent: 'goals'
          }
        ],
        useCases: ['business planning', 'strategic planning', 'market strategy', 'corporate strategy']
      }
    ];
  }

  /**
   * Educational & Learning Templates
   */
  private static getEducationalTemplates(): TemplatePattern[] {
    return [
      {
        id: 'learning_design',
        name: 'Learning Experience Design',
        description: 'Educational design using CAGEERF methodology',
        category: 'education',
        complexity: 'advanced',
        cageerfComponents: ['context', 'analysis', 'goals', 'execution', 'evaluation', 'refinement'],
        baseTemplate: `# {{course_title}} - Learning Design

## 🎓 Learning Context
**Learner Profile**: {{learner_profile}}
**Learning Environment**: {{learning_environment}}
**Prerequisites**: {{prerequisites}}
**Learning Constraints**: {{constraints}}

## 📚 Learning Analysis
**Learning Needs**: {{learning_needs}}
**Gap Analysis**: {{skill_gaps}}
**Learning Preferences**: {{learning_styles}}
**Content Requirements**: {{content_scope}}

## 🎯 Learning Goals
**Learning Objectives**: {{learning_objectives}}
**Competency Targets**: {{competency_goals}}
**Assessment Criteria**: {{assessment_criteria}}
**Success Metrics**: {{learning_metrics}}

## ⚙️ Learning Experience Design
### Content Structure
{{content_organization}}

### Learning Activities
{{learning_activities}}

### Assessment Strategy
{{assessment_design}}

### Technology Integration
{{technology_tools}}

## 📊 Learning Evaluation
**Formative Assessment**: {{formative_evaluation}}
**Summative Assessment**: {{summative_evaluation}}
**Learning Analytics**: {{analytics_approach}}
**Feedback Mechanisms**: {{feedback_systems}}

## 🔄 Course Refinement
**Learner Feedback**: {{feedback_collection}}
**Content Updates**: {{content_iteration}}
**Method Improvement**: {{method_enhancement}}
**Technology Evolution**: {{technology_updates}}`,
        systemMessageTemplate: 'You are an educational design expert using CAGEERF methodology. Create effective learning experiences with clear objectives, engaging activities, and comprehensive assessment. Focus on learner success and continuous improvement.',
        placeholders: [
          {
            name: 'course_title',
            description: 'Learning experience or course title',
            required: true,
            cageerfComponent: 'context'
          },
          {
            name: 'learning_objectives',
            description: 'Primary learning objectives',
            required: true,
            cageerfComponent: 'goals'
          }
        ],
        useCases: ['course design', 'training development', 'educational planning', 'learning experience design']
      }
    ];
  }

  /**
   * Research & Investigation Templates
   */
  private static getResearchTemplates(): TemplatePattern[] {
    return [
      {
        id: 'research_methodology',
        name: 'Research Methodology Framework',
        description: 'Systematic research design using CAGEERF methodology',
        category: 'research',
        complexity: 'expert',
        cageerfComponents: ['context', 'analysis', 'goals', 'execution', 'evaluation', 'refinement', 'framework'],
        baseTemplate: `# {{research_title}} - Research Framework

## 🔬 Research Context
**Research Domain**: {{research_domain}}
**Problem Statement**: {{problem_statement}}
**Research Gap**: {{research_gap}}
**Significance**: {{research_significance}}

## 📖 Literature Analysis
**Theoretical Framework**: {{theoretical_background}}
**Previous Research**: {{literature_review}}
**Research Gaps**: {{identified_gaps}}
**Conceptual Model**: {{conceptual_framework}}

## 🎯 Research Goals
**Research Questions**: {{research_questions}}
**Hypotheses**: {{research_hypotheses}}
**Objectives**: {{research_objectives}}
**Expected Contributions**: {{expected_outcomes}}

## ⚙️ Research Design
### Methodology
{{research_methodology}}

### Data Collection
{{data_collection_strategy}}

### Analysis Plan
{{analysis_approach}}

### Validation Strategy
{{validation_methods}}

## 📊 Quality Assurance
**Reliability Measures**: {{reliability_framework}}
**Validity Checks**: {{validity_assessment}}
**Ethical Considerations**: {{ethical_framework}}
**Risk Management**: {{research_risks}}

## 🔄 Research Evolution
**Iterative Refinement**: {{refinement_process}}
**Peer Review**: {{review_process}}
**Knowledge Dissemination**: {{dissemination_strategy}}
**Future Research**: {{future_directions}}

## 📐 Research Standards
**Methodological Rigor**: {{rigor_standards}}
**Documentation Standards**: {{documentation_requirements}}
**Reproducibility**: {{reproducibility_framework}}
**Open Science**: {{open_science_practices}}`,
        systemMessageTemplate: 'You are a research methodology expert using CAGEERF framework. Design rigorous research with clear methodology, validation, and quality assurance. Ensure methodological soundness and reproducibility.',
        placeholders: [
          {
            name: 'research_title',
            description: 'Research project title and scope',
            required: true,
            cageerfComponent: 'context'
          },
          {
            name: 'research_questions',
            description: 'Primary research questions',
            required: true,
            cageerfComponent: 'goals'
          }
        ],
        useCases: ['academic research', 'scientific investigation', 'market research', 'user research']
      }
    ];
  }

  /**
   * Get all template categories
   */
  private static getCategories(): TemplateCategory[] {
    return [
      {
        id: 'analysis',
        name: 'Analysis & Assessment',
        description: 'Templates for systematic analysis, evaluation, and assessment using CAGEERF methodology',
        cageerfFocus: ['context', 'analysis', 'evaluation'],
        commonUseCases: ['business analysis', 'strategic assessment', 'performance evaluation', 'risk analysis', 'quality assessment']
      },
      {
        id: 'execution',
        name: 'Implementation & Execution',
        description: 'Templates for strategic implementation, project execution, and systematic delivery',
        cageerfFocus: ['goals', 'execution', 'evaluation', 'refinement'],
        commonUseCases: ['project management', 'strategic implementation', 'process execution', 'change management', 'delivery planning']
      },
      {
        id: 'framework',
        name: 'Framework & Methodology',
        description: 'Templates for developing systematic frameworks, methodologies, and structured approaches',
        cageerfFocus: ['framework', 'context', 'execution', 'evaluation'],
        commonUseCases: ['methodology development', 'framework design', 'process creation', 'best practice development', 'systematic approaches']
      },
      {
        id: 'creative',
        name: 'Creative & Innovation',
        description: 'Templates for structured creativity, innovation processes, and design thinking',
        cageerfFocus: ['context', 'analysis', 'goals', 'evaluation'],
        commonUseCases: ['innovation workshops', 'creative problem solving', 'design thinking', 'ideation sessions', 'concept development']
      },
      {
        id: 'technical',
        name: 'Technical & Development',
        description: 'Templates for technical architecture, system design, and development planning',
        cageerfFocus: ['analysis', 'goals', 'execution', 'evaluation', 'framework'],
        commonUseCases: ['system architecture', 'technical design', 'software development', 'infrastructure planning', 'technology strategy']
      },
      {
        id: 'business',
        name: 'Business & Strategy',
        description: 'Templates for business strategy, market planning, and organizational development',
        cageerfFocus: ['context', 'analysis', 'goals', 'execution', 'evaluation', 'refinement'],
        commonUseCases: ['business strategy', 'market planning', 'organizational development', 'competitive analysis', 'business model design']
      },
      {
        id: 'education',
        name: 'Education & Learning',
        description: 'Templates for educational design, training development, and learning experience creation',
        cageerfFocus: ['context', 'goals', 'execution', 'evaluation', 'refinement'],
        commonUseCases: ['course design', 'training development', 'educational planning', 'learning assessment', 'curriculum development']
      },
      {
        id: 'research',
        name: 'Research & Investigation',
        description: 'Templates for research methodology, scientific investigation, and systematic inquiry',
        cageerfFocus: ['context', 'analysis', 'goals', 'execution', 'evaluation', 'framework'],
        commonUseCases: ['academic research', 'market research', 'user research', 'scientific investigation', 'data analysis']
      }
    ];
  }
}