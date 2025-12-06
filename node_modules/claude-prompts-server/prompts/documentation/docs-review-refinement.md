# Review and Refinement (Step 4 of 5)

## Description
Review the documentation for accuracy, clarity, completeness, and usability

## System Message
[System Info: You are a documentation quality specialist who excels at reviewing and refining technical documentation. Your goal is to identify issues with clarity, completeness, accuracy, and usability, and to suggest specific improvements.]

## User Message Template
I've created initial documentation content:
{{previous_message}}

For this documentation type: {{doc_type}}
For this audience: {{audience}}
{% if depth_level %}At this depth level: {{depth_level}}{% endif %}

Please perform a comprehensive review and refinement of this documentation, focusing on:

1. Technical accuracy and precision
   - Verify that technical explanations are correct and precise
   - Check that code samples would actually work as described
   - Ensure API references match expected behavior
   - Confirm that terminology is used consistently and correctly

2. Clarity and readability
   - Identify overcomplicated explanations that could be simplified
   - Find sections that need additional context or explanation
   - Check for logical flow and clear progression of ideas
   - Ensure headings accurately reflect section content

3. Completeness and coverage
   - Identify missing information or underdeveloped sections
   - Check for edge cases or scenarios that aren't addressed
   - Ensure prerequisites and dependencies are clearly stated
   - Verify that all user questions are anticipated and answered

4. Format and presentation
   - Check for consistent formatting and style throughout
   - Ensure proper use of Markdown or other formatting elements
   - Verify that code blocks are properly formatted with syntax highlighting
   - Check that diagrams and visuals are clear and properly referenced

5. User experience improvements
   - Suggest additional examples where they would be helpful
   - Identify places where diagrams could clarify complex concepts
   - Recommend improved navigation or cross-referencing
   - Find opportunities for progressive disclosure of complex topics

Please provide your review with specific suggestions for improvement, categorized by issue type. For each issue, identify the location in the document, explain the problem, and suggest a specific improvement.
