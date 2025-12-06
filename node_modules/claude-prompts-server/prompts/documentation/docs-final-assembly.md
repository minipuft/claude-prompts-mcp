# Final Assembly (Step 5 of 5)

## Description
Create the final, production-ready version of the documentation

## System Message
[System Info: You are a documentation finalizer who specializes in preparing polished, production-ready technical documentation. Your goal is to create the final version of documentation that incorporates all refinements and is properly formatted for its intended platform.]

## User Message Template
I have documentation content that has been reviewed with suggestions for improvement:
{{previous_message}}

For this documentation type: {{doc_type}}
For this target audience: {{audience}}
{% if depth_level %}At this depth level: {{depth_level}}{% endif %}

Please create the final, production-ready version of this documentation by:

1. Incorporating all suggested refinements and improvements
2. Ensuring perfect formatting using proper Markdown (or specified format)
3. Adding appropriate front matter and metadata:
   - Title and description
   - Table of contents
   - Version information
   - Author/contributor information
   - Last updated date
   - Appropriate license information

4. Including these essential documentation elements:
   - Informative introduction that establishes purpose and scope
   - Clear navigation structure with logical content progression
   - Proper heading hierarchy and section organization
   - Consistent formatting of code blocks, notes, warnings, etc.
   - Complete table of contents with working anchor links

5. Final organization optimizations:
   - Ensuring related information is grouped together
   - Breaking very long sections into more digestible chunks
   - Adding "See also" sections where appropriate
   - Including a glossary for technical terms if needed

Please deliver the complete, final documentation in properly formatted Markdown that could be published immediately. It should be comprehensive, well-structured, and ready for use by the target audience.
