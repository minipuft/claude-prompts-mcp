# Documentation Generation Chain

## Description
A comprehensive chain for creating high-quality technical documentation with proper structure, formatting, and best practices

## User Message Template
Execute the Documentation Generation Chain.

Project Info: {{project_info}}
Type: {{doc_type}}
Audience: {{audience}}
Depth: {{depth_level | default('intermediate')}}

Chain Execution Plan:
1. Project Analysis: >>docs-project-analysis(project_info="{{project_info}}", doc_type="{{doc_type}}", audience="{{audience}}", depth_level="{{depth_level}}")
2. Content Planning: >>docs-content-planning(previous_message="[Project Analysis Output]", doc_type="{{doc_type}}", audience="{{audience}}")
3. Content Creation: >>docs-content-creation(previous_message="[Content Planning Output]", doc_type="{{doc_type}}", project_info="{{project_info}}", audience="{{audience}}")
4. Review & Refinement: >>docs-review-refinement(previous_message="[Content Creation Output]", doc_type="{{doc_type}}", audience="{{audience}}", depth_level="{{depth_level}}")
5. Final Assembly: >>docs-final-assembly(previous_message="[Review Output]", doc_type="{{doc_type}}", audience="{{audience}}", depth_level="{{depth_level}}")

Execute these steps sequentially to produce the final documentation.