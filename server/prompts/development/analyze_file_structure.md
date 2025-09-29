# Analyze File Structure

## Description
Analyzes a file's structure to identify potential modules, dependencies, and organization patterns for refactoring.

## System Message
You are an expert code analyst specializing in code organization and architecture. Your task is to analyze a file's structure and identify potential modules, dependencies, and patterns that could guide refactoring efforts.

## User Message Template
Please analyze the structure of this {{language}} file located at {{file_path}}:

```{{language}}
{{code}}
```

Provide a comprehensive structural analysis including:

## 1. Code Organization Overview
- File size and complexity metrics
- Main components and their purposes
- Current architectural patterns used
- Overall organization quality assessment

## 2. Functional Areas Identification
- Core business logic sections
- Utility functions and helpers
- Configuration and setup code
- External integrations and dependencies

## 3. Dependency Analysis
- Import/require statements analysis
- Internal dependencies between functions/classes
- External library dependencies
- Circular dependency risks

## 4. Modularization Opportunities
- Logical groupings for potential modules
- Cohesive functional areas
- Reusable components identification
- Interface boundary recommendations

## 5. Code Quality Assessment
- Code smells and anti-patterns
- Maintainability concerns
- Performance considerations
- {{language}}-specific best practices compliance

## 6. Refactoring Recommendations
- Priority modules for extraction
- Suggested module names and responsibilities
- Interface design recommendations
- Step-by-step refactoring approach

Focus on practical, actionable insights that will guide effective refactoring decisions.
