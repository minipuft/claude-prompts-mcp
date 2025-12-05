# Advanced Note Refinement (Integration Chain)

## Description
Advanced workflow that runs a comprehensive content analysis chain to transform raw content into publication-ready, interconnected notes optimized for Obsidian knowledge management systems.

## User Message Template
Execute a comprehensive content analysis and refinement chain.

Input Content:
{{content}}

{% if existing_notes %}
Existing Notes:
{{existing_notes}}
{% endif %}

{% if vault_context %}
Vault Context:
{{vault_context}}
{% endif %}

Chain Execution Plan:
1. Analyze Content: >>content_analysis(content="{{content}}")
2. Find Related Notes: >>vault_related_notes_finder(note_topic="{{content}}", content_areas="[Analysis Output]")
3. Integrate Notes: >>note_integration(notes="{{existing_notes}}", new_information="[Analysis Output]")
4. Optimize Metadata: >>obsidian_metadata_optimizer(note_content="[Integrated Content]", vault_structure="{{vault_context}}")
5. Enhance Formatting: >>format_enhancement(existing_content="[Optimized Content]", domain="{{domain}}", enhancement_level="{{enhancement_level | default('comprehensive')}}")

Format Enhancement Parameters:
- Domain: {{domain}}
- Enhancement Level: {{enhancement_level | default('comprehensive')}}

Execute these steps sequentially to produce the final refined note.