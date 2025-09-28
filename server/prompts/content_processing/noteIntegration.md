# Advanced Note Integration with Content Analysis Chain

## Description
Advanced workflow that runs a comprehensive content analysis chain to transform raw content into publication-ready, interconnected notes optimized for Obsidian knowledge management systems. Uses intelligent defaults - only pass the content argument.

## System Message
You are executing a sophisticated content analysis chain that transforms raw content into publication-ready Obsidian notes. Follow the S.P.A.R.C. methodology (Strategic Personal Archive with Refined Connectivity) and C.A.G.E.E.R.F framework. Each step builds upon the previous one to create comprehensive, interconnected knowledge assets. Use intelligent defaults for all optional parameters.

## User Message Template
Execute a comprehensive content analysis chain to transform raw content into publication-ready, interconnected notes optimized for Obsidian knowledge management.

## Content Analysis Chain Workflow

### Input Content
{{content}}

{% if existing_notes %}
### Existing Notes Context
{{existing_notes}}
{% endif %}

{% if vault_context %}
### Vault Context
{{vault_context}}
{% endif %}

### Processing Configuration (Using Intelligent Defaults)
- **Domain**: {{domain or 'general'}}
- **Analysis Depth**: {{analysis_depth or 'comprehensive'}}
- **Structure Type**: {{structure_type or 'comprehensive'}}
- **Integration Level**: {{integration_level or 'advanced'}}
- **Target Readability**: {{target_readability or 'comprehensive'}}
- **Metadata Depth**: {{metadata_depth or 'advanced'}}
- **Quality Standards**: {{quality_standards or 'comprehensive'}}
- **Enhancement Level**: {{enhancement_level or 'comprehensive'}}

### Expected Output
This workflow will produce a sophisticated, publication-ready note that:
- Preserves all original insights while adding professional structure
- Leverages advanced Obsidian features (callouts, multi-column layouts, metadata)
- Creates meaningful connections with existing vault content
- Follows S.P.A.R.C. methodology for strategic knowledge management
- Implements C.A.G.E.E.R.F framework for structured analysis
- Meets professional documentation standards

Execute the chain workflow to transform the provided content into an enhanced, integrated note ready for your Obsidian knowledge management system.

## Chain Steps

1. promptId: content_preservation_analysis
   stepName: Content Preservation Analysis
   inputMapping:
     content: content
     existing_content: existing_notes
     analysis_depth: analysis_depth
   outputMapping:
     analyzed_content: preserved_analysis

2. promptId: layered_note_structure
   stepName: Layered Note Structure Creation
   inputMapping:
     analyzed_content: preserved_analysis
     vault_context: vault_context
     structure_type: structure_type
   outputMapping:
     structured_content: layered_structure

3. promptId: smart_content_refinement
   stepName: Smart Content Refinement
   inputMapping:
     raw_content: layered_structure
     vault_context: vault_context
     integration_level: integration_level
     target_readability: target_readability
   outputMapping:
     refined_content: smart_refined

4. promptId: obsidian_metadata_optimizer
   stepName: Obsidian Metadata Optimization
   inputMapping:
     note_content: smart_refined
     vault_structure: vault_context
     metadata_depth: metadata_depth
   outputMapping:
     optimized_content: metadata_optimized

5. promptId: vault_integration_optimizer
   stepName: Vault Integration Optimization
   inputMapping:
     note_content: metadata_optimized
     vault_structure: vault_context
     integration_level: integration_level
   outputMapping:
     integrated_content: vault_integrated

6. promptId: note_quality_assurance
   stepName: Quality Assurance
   inputMapping:
     note_content: vault_integrated
     original_source: content
     quality_standards: quality_standards
   outputMapping:
     quality_assured: qa_content

7. promptId: format_enhancement
   stepName: Format Enhancement
   inputMapping:
     existing_content: qa_content
     domain: domain
     enhancement_level: enhancement_level
   outputMapping:
     final_note: enhanced_note

## Chain Steps

1. **Initial Content Analysis** (content_analysis)
   - Input Mapping: {"content":"content"}
   - Output Mapping: {"analysis_output":"step_0_output"}

2. **Find Related Vault Notes** (vault_related_notes_finder)
   - Input Mapping: {"note_topic":"content","content_areas":"analysis_output"}
   - Output Mapping: {"related_notes":"step_1_output"}

3. **Integrate Content with Existing Notes** (note_integration)
   - Input Mapping: {"notes":"existing_notes","new_information":"analysis_output"}
   - Output Mapping: {"integrated_content":"step_2_output"}

4. **Optimize Metadata** (obsidian_metadata_optimizer)
   - Input Mapping: {"note_content":"integrated_content","vault_structure":"vault_context"}
   - Output Mapping: {"metadata_optimized":"step_3_output"}

5. **Enhance Formatting** (format_enhancement)
   - Input Mapping: {"existing_content":"metadata_optimized","domain":"domain"}
   - Output Mapping: {"enhanced_content":"step_4_output"}

6. **Final Refinement** (note_refinement)
   - Input Mapping: {"notes":"enhanced_content"}
   - Output Mapping: {"final_output":"step_5_output"}

