# Advanced Note Integration v2 with Smart Visual Timing

## Description
Enhanced master workflow that intelligently chains specialized prompts with optimized visual extraction timing - extracts images after note creation for more accurate and contextually relevant visual selection.

## User Message Template
**ENHANCED NOTE INTEGRATION WITH INTELLIGENT VISUAL TIMING**

Master workflow with optimized visual extraction sequence for maximum accuracy and relevance:

**CONTENT TO PROCESS:** {{content}}
**DOMAIN:** {{domain}} (default: creative_arts)
**ANALYSIS DEPTH:** {{analysis_depth}} (default: comprehensive)

**OPTIMIZED WORKFLOW SEQUENCE:**
1. **Vault Analysis** → Understanding existing structure
2. **Content Preservation** → Complete transcript analysis  
3. **Note Construction** → Professional content creation
4. **Smart Visual Extraction** → Content-aware image selection
5. **Content Enhancement** → Visual integration & refinement
6. **Metadata Optimization** → Professional frontmatter
7. **Vault Integration** → Strategic network connections
8. **Quality Assurance** → Final validation

**KEY IMPROVEMENT:**
Visual extraction now occurs AFTER note creation, allowing for:
- Content-aware timestamp selection based on actual analysis
- More relevant visual moments that support written content
- Intelligent frame selection based on narrative structure
- Better alignment between visuals and textual analysis

Execute this enhanced chain for superior content integration with contextually accurate visual elements.

## Chain Steps

1. promptId: vault_structure_analyzer
   stepName: Vault Context Analysis
   inputMapping:
     content_topic: domain
     vault_path: vault_context
   outputMapping:
     vault_analysis: vault_structure

2. promptId: content_preservation_analysis
   stepName: Content Analysis & Strategic Planning
   inputMapping:
     content: content
     existing_content: existing_notes
     analysis_depth: analysis_depth
   outputMapping:
     analyzed_content: content_analysis

3. promptId: layered_note_structure
   stepName: Professional Note Construction
   inputMapping:
     analyzed_content: content_analysis
     vault_context: vault_structure
     structure_type: structure_type
   outputMapping:
     structured_note: note_content

4. promptId: video_frame_extractor
   stepName: Smart Visual Integration
   inputMapping:
     video_url: content
     domain: domain
     project_name: note_content
   outputMapping:
     visual_assets: extracted_visuals

5. promptId: smart_content_refinement
   stepName: Visual Enhancement & Formatting
   inputMapping:
     raw_content: note_content
     vault_context: vault_structure
     integration_level: integration_level
     target_readability: target_readability
   outputMapping:
     refined_content: enhanced_note

6. promptId: obsidian_metadata_optimizer
   stepName: Metadata & Frontmatter Optimization
   inputMapping:
     note_content: enhanced_note
     vault_structure: vault_structure
     metadata_depth: metadata_depth
   outputMapping:
     optimized_metadata: final_metadata

7. promptId: deep_vault_integration
   stepName: Strategic Vault Integration
   inputMapping:
     content: enhanced_note
     vault_context: vault_structure
     integration_level: integration_level
     domain: domain
     quality_standards: quality_standards
   outputMapping:
     integration_results: vault_connections

8. promptId: note_quality_assurance
   stepName: Final Quality Validation
   inputMapping:
     note_content: enhanced_note
     original_source: content
     quality_standards: quality_standards
   outputMapping:
     quality_report: final_validation

