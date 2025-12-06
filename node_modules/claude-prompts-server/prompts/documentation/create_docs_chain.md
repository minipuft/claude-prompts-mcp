# Documentation Generation Chain

## Description
A comprehensive chain for creating high-quality technical documentation with proper structure, formatting, and best practices

## System Message
[System Info: You are a documentation expert who guides users through the process of creating comprehensive, high-quality technical documentation. Your goal is to help them understand what goes into excellent documentation and to facilitate the creation of documentation that follows best practices.]

## User Message Template
I need to create documentation for: {{project_info}}

Documentation type required: {{doc_type}}
Target audience: {{audience}}
{% if depth_level %}Desired depth level: {{depth_level}}{% else %}Desired depth level: intermediate{% endif %}

Please guide me through your systematic documentation generation process. I would like you to:

1. Analyze my project to determine what needs to be documented and how
2. Create a detailed content plan with a logical structure
3. Generate the actual documentation content
4. Review and refine the documentation for clarity, accuracy, and completeness
5. Assemble the final documentation in a polished, production-ready format

At each step, please show your thinking and explain your recommendations. The final documentation should follow these technical documentation best practices:

- Well-structured with clear navigation
- Appropriate detail level for the target audience
- Consistent terminology and formatting
- Comprehensive code examples where relevant
- Clear explanations of complex concepts
- Proper Markdown formatting for readability

Please execute this documentation creation process step by step, ensuring each phase builds upon the previous one to create cohesive, high-quality documentation.

## Chain Steps

1. promptId: docs-project-analysis
   stepName: Project Analysis (Step 1 of 5)
   inputMapping:
     project_info: project_info
     doc_type: doc_type
     audience: audience
     depth_level: depth_level
   outputMapping:

2. promptId: docs-content-planning
   stepName: Content Planning (Step 2 of 5)
   inputMapping:
     previous_message: output:Project Analysis
     doc_type: doc_type
     audience: audience
   outputMapping:

3. promptId: docs-content-creation
   stepName: Content Creation (Step 3 of 5)
   inputMapping:
     previous_message: output:Content Planning
     doc_type: doc_type
     project_info: project_info
     audience: audience
   outputMapping:

4. promptId: docs-review-refinement
   stepName: Review and Refinement (Step 4 of 5)
   inputMapping:
     previous_message: output:Content Creation
     doc_type: doc_type
     audience: audience
     depth_level: depth_level
   outputMapping:

5. promptId: docs-final-assembly
   stepName: Final Assembly (Step 5 of 5)
   inputMapping:
     previous_message: output:Review and Refinement
     doc_type: doc_type
     audience: audience
     depth_level: depth_level
   outputMapping:

## Output Format

After completing all 5 steps in the chain, you will have a final output that:

1. Is well-organized and clearly structured
2. Represents the culmination of the entire chain process

The final output will be the result of the last step in the chain.
