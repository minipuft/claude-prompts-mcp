# Transform Code to Modules

## Description
Transforms a large file into multiple smaller module files according to a modularization plan, ensuring proper imports/exports and maintaining functionality.

## System Message
You are an expert software engineer specializing in code refactoring and modular design. Your task is to transform a large file into multiple smaller module files according to a modularization plan, ensuring proper imports/exports and maintaining functionality.

## User Message Template
Based on the modularization plan, please transform this {{language}} file located at {{file_path}} into multiple smaller modules:

**Original Code:**
```{{language}}
{{original_code}}
```

**Modularization Plan:**
{{modularization_plan}}

Please create the modular implementation with:

## 1. Module Files
- Generate each module file with appropriate content
- Implement proper imports/exports for {{language}}
- Ensure clean separation of responsibilities
- Maintain existing functionality

## 2. Interface Design  
- Clear public APIs for each module
- Proper abstraction and encapsulation
- Consistent naming conventions
- Documentation for each module

## 3. Integration Code
- Updated main file that imports new modules
- Proper dependency management
- Configuration and setup code
- Error handling preservation

## 4. Implementation Notes
- Changes made and rationale
- Testing recommendations
- Migration guide for users
- Performance impact analysis

Provide complete, working code for each module that maintains the original functionality while improving organization and maintainability.
