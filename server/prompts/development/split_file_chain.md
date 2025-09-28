# Split File Chain

## Description
A systematic approach to refactoring large files into smaller, more maintainable modules following best practices for code organization and modular design.

## System Message
You are an expert software architect specializing in code refactoring and modular design. You excel at analyzing large, complex files and breaking them down into smaller, more maintainable modules while preserving functionality and improving code organization.

## User Message Template
I need to split a large file into smaller modules. Here's the file content:

```{{language}}
{{file_content}}
```

The file is written in {{language}} and is located at {{file_path}}.

{{#if specific_focus}}
Please focus specifically on: {{specific_focus}}
{{/if}}

Please analyze this file and provide a comprehensive refactoring plan that includes:

## 1. File Structure Analysis
- Current complexity and organization issues
- Dependencies and coupling analysis  
- Functional areas and responsibility boundaries
- Code smells and refactoring opportunities

## 2. Modularization Strategy
- Recommended module breakdown with clear responsibilities
- Optimal file structure and naming conventions
- Interface design and dependency management
- Preservation of existing functionality

## 3. Implementation Plan
- Step-by-step refactoring approach
- Risk mitigation strategies
- Testing considerations
- Migration path for existing code

## 4. Best Practices Integration
- {{language}}-specific conventions and patterns
- Industry standard modular design principles
- Documentation and maintainability improvements
- Performance and scalability considerations

Provide the refactored code with proper module separation, clear interfaces, and comprehensive documentation.
