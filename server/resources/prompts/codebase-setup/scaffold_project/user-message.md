## Project Scaffold Chain

Starting interactive project scaffolding workflow.

{% if name %}**Project**: `{{name}}`{% endif %}
{% if language %}**Language**: `{{language}}`{% endif %}
{% if type %}**Type**: `{{type}}`{% endif %}
{% if features %}**Features**: `{{features}}`{% endif %}

This chain will:

1. **Gather Requirements** - Collect missing project details
2. **Generate Files** - Create all project files with LLM-friendly patterns
3. **Review & Confirm** - Summarize and get approval before implementation

Proceeding to requirements gathering...
