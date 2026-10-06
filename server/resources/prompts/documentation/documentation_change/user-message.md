Apply the documentation change workflow to {{ target | default("the requested documentation") }}. Classify the reader need and destination before drafting. Preserve documented product boundaries, use reader language, and report the validation evidence required for the target.

Request: {{ request }}
Document type: {{ doc_type | default("readme") }}
Target: {{ target | default("README.md") }}
Audience: {{ audience | default("technical readers") }}
Reader goal: {{ reader_goal | default("understand and use the project") }}

Existing content or notes:
{{ content | default("Use the target document and project documentation as source material.") }}

Relevant policy or release context:
{{ context | default("Use the repository's canonical documentation charter.") }}
