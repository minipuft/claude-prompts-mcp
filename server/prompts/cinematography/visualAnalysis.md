# Visual Analysis Master Chain

## Description
Master chain workflow for comprehensive visual analysis of animation and cinematography content, including intelligent frame extraction and multi-layered analysis.

## User Message Template
# Visual Analysis Master Workflow

## Content Source
**URL**: {{content_url}}
**Analysis Type**: {{analysis_type}} (animation_case_study, cinematography_analysis, color_theory_study, technique_breakdown, comparative_analysis)
**Focus Domain**: {{focus_domain}} (animation, cinematography, mixed_media, experimental)
**Analysis Depth**: {{analysis_depth}} (overview, detailed, comprehensive, academic)
**Educational Level**: {{educational_level}} (beginner, intermediate, advanced, professional)

## Workflow Parameters
- **Visual Focus**: {{visual_focus}} (composition, color_theory, animation_techniques, cinematography, visual_storytelling)
- **Frame Selection Strategy**: {{frame_strategy}} (automatic, manual_timestamps, content_driven, comparative_moments)
- **Output Format**: {{output_format}} (case_study, technique_reference, educational_guide, comparative_analysis)
- **Vault Integration**: {{vault_integration}} (full_integration, minimal_integration, standalone)

## Master Chain Execution

This workflow intelligently processes visual content through specialized analysis phases:

### Phase 1: Content Intelligence & Planning
- Comprehensive content analysis and domain identification
- Vault structure analysis for optimal integration
- Strategic visual moment identification
- Frame extraction planning based on content analysis

### Phase 2: Visual Asset Creation
- High-quality frame extraction using intelligent timestamp selection
- Visual asset organization and optimization
- Frame sequence planning for comparative analysis

### Phase 3: Specialized Visual Analysis
- Deep visual content analysis using cinematography principles
- Animation technique breakdown (if applicable)
- Color theory and composition analysis
- Technical and artistic assessment

### Phase 4: Educational Integration
- Professional note structure creation
- Strategic cross-referencing with existing vault content
- MOC integration and relationship mapping
- Quality assurance and publication readiness

Execute comprehensive visual analysis workflow for: {{content_url}}

## Chain Steps

1. promptId: content_preservation_analysis
   stepName: content_analysis_and_planning
   inputMapping:
     content_url: content_url
     analysis_depth: analysis_depth
     domain_focus: focus_domain
     processing_mode: content_driven
   outputMapping:
     content_summary: analyzed_content
     domain_classification: content_domain
     key_moments: timestamp_suggestions

2. promptId: vault_structure_analyzer
   stepName: vault_context_analysis
   inputMapping:
     content_type: focus_domain
     analysis_depth: analysis_depth
     integration_level: vault_integration
   outputMapping:
     vault_structure: vault_context
     moc_connections: moc_integration_plan
     file_organization: organization_strategy

3. promptId: video_frame_extractor
   stepName: intelligent_frame_extraction
   inputMapping:
     video_url: content_url
     domain: focus_domain
     timestamps: timestamp_suggestions
     analysis_focus: visual_focus
   outputMapping:
     extracted_frames: visual_assets
     frame_metadata: frame_information

4. promptId: visual_content_analyzer
   stepName: visual_content_analysis
   inputMapping:
     source_url: content_url
     content_title: analyzed_content.title
     analysis_type: analysis_type
     analysis_focus: visual_focus
     analysis_depth: analysis_depth
   outputMapping:
     visual_analysis: frame_analysis_results
     technical_assessment: visual_technical_data

5. promptId: animation_technique_analyzer
   stepName: specialized_domain_analysis
   inputMapping:
     source_url: content_url
     animation_title: analyzed_content.title
     animation_type: content_domain
     analysis_focus: analysis_type
     educational_level: educational_level
   outputMapping:
     animation_analysis: technique_breakdown
     educational_insights: learning_applications

6. promptId: cinematography_analysis
   stepName: cinematography_assessment
   inputMapping:
     source_url: content_url
     content_title: analyzed_content.title
     format: content_domain
     analysis_type: analysis_type
     focus_area: visual_focus
     technical_level: educational_level
   outputMapping:
     cinematography_data: cinematic_analysis
     technical_breakdown: cinematic_techniques

7. promptId: layered_note_structure
   stepName: comprehensive_note_creation
   inputMapping:
     content_analysis: analyzed_content
     visual_analysis: frame_analysis_results
     technical_data: technique_breakdown
     cinematography_analysis: cinematic_analysis
     structure_type: output_format
   outputMapping:
     structured_content: final_note_content
     metadata: note_metadata

8. promptId: vault_integration_optimizer
   stepName: vault_integration_and_optimization
   inputMapping:
     note_content: final_note_content
     vault_context: vault_context
     moc_plan: moc_integration_plan
     integration_level: vault_integration
   outputMapping:
     integrated_content: vault_ready_content
     cross_references: relationship_network

