# Enhanced Video Notes Chain

## Description
Comprehensive video processing chain including content analysis, deep insights, and vault integration.

## User Message Template
Process video content into comprehensive vault-integrated notes.

Input Data:
- Video URL: {{video_url}}
- Topic: {{topic}}
- Content Areas: {{content_areas}}
- Duration: {{duration}}

Transcript/Content:
{{content}}

Chain Execution Plan:
1. Analyze Content: >>content_analysis(content="{{content}}")
2. Deep Analysis: >>deep_analysis
3. Create Notebook: >>markdown_notebook(topic="{{topic}}", analysis="[Deep Analysis Output]")
4. Find Related Notes: >>vault_related_notes_finder(note_topic="{{topic}}", content_areas="{{content_areas}}")
5. Refine & Integrate: >>note_refinement(notes="[Notebook Output]", content="{{content}}", vault_context="[Related Notes]")

Execute these steps sequentially to produce the final vault-ready note.