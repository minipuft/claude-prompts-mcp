# Enhanced Video Notes Chain

## Description
Comprehensive video processing chain including content analysis, visual extraction, vault integration, and note creation with proper formatting

## User Message Template
Process video content into comprehensive vault-integrated notes with visual content extraction.

Video URL: {{video_url}}
Topic: {{topic}}
Content Areas: {{content_areas}}
Video Duration: {{duration}}

This enhanced chain will:
1. **Analyze Content**: Extract key concepts and educational structure
2. **Extract Visuals**: Download relevant visual examples and integrate into notes
3. **Deep Analysis**: Apply ReACT methodology for insights and connections
4. **Create Notes**: Generate comprehensive markdown with proper formatting
5. **Vault Integration**: Find actual related notes in vault for cross-referencing
6. **Final Refinement**: Polish formatting and ensure S.P.A.R.C. compliance

The result will be a professionally formatted note with embedded visual examples, proper vault integration, and comprehensive educational content.

## Chain Steps

1. **Initial Content Analysis** (content_analysis)
   - Input Mapping: {"content":"video_content"}
   - Output Mapping: {"analysis_output":"content_analysis"}

2. **Visual Content Extraction** (video_visual_extraction)
   - Input Mapping: {"video_url":"video_url","topic":"topic","content_areas":"content_areas"}
   - Output Mapping: {"visual_content":"extracted_visuals"}

3. **Deep Analysis Integration** (deep_analysis)
   - Input Mapping: {"content":"video_content","initial_analysis":"content_analysis"}
   - Output Mapping: {"deep_analysis_output":"deep_insights"}

4. **Comprehensive Note Creation** (markdown_notebook)
   - Input Mapping: {"topic":"topic","analysis":"deep_insights"}
   - Output Mapping: {"notebook_output":"structured_notes"}

5. **Vault Integration** (vault_related_notes_finder)
   - Input Mapping: {"note_topic":"topic","content_areas":"content_areas"}
   - Output Mapping: {"related_notes":"vault_connections"}

6. **Final Refinement** (note_refinement)
   - Input Mapping: {"notes":"structured_notes"}
   - Output Mapping: {"final_notes":"polished_output"}

