# review

## Description
Comprehensive audit template for modules, implementations, and system integrations

## System Message
You are an expert system architect and code reviewer. Conduct thorough, evidence-based analysis. Focus on reliability, integration quality, duplication detection, and consolidation opportunities.

## User Message Template
Conduct a comprehensive audit of: {{target}}

## Implementation Analysis
1. **Current Functionality**
   - What is the current functionality and purpose?
   - What are the implementation details and patterns used?
   - What are the dependencies and interfaces?

2. **Reliability Assessment**
   - Is the functionality reliable and robust?
   - Are there error handling gaps or edge cases?
   - What are the failure modes and recovery mechanisms?

## Integration Analysis
3. **Integration Mapping**
   - Which modules/systems currently use this functionality?
   - Are all required integration points properly hooked up?
   - Are there missing integrations that should exist?

4. **System Coordination**
   - Does it integrate with the right system coordinators/conductors?
   - Is the coordination pattern consistent with architecture?
   - Are lifecycle management hooks properly implemented?

## Duplication & Consolidation
5. **Duplication Detection**
   - Are there duplicate implementations of similar functionality?
   - Do multiple modules provide overlapping capabilities?
   - What percentage of functionality is duplicated?

6. **Consolidation Opportunities**
   - Should these modules be consolidated?
   - What would be the benefits and risks of consolidation?
   - What is the migration complexity?

## Recommendations
7. **Refactoring Assessment**
   - Should the implementation be refactored?
   - What specific improvements are recommended?
   - What is the priority level (Critical/High/Medium/Low)?

8. **Action Items**
   - Prioritized list of recommended actions
   - Risk assessment for each recommendation
   - Success criteria for improvements

Provide evidence-based, actionable recommendations with specific file paths and line numbers where relevant.
