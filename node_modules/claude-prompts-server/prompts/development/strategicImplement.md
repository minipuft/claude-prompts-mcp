# Strategic Implementation

## Description
Systematically implement a plan phase with architectural alignment, compatibility checking, and progress tracking

## User Message Template
Strategically implement the following plan phase with systematic architectural alignment:

**Plan Document**: {{plan_path}}
**Phase to Implement**: {{phase_identifier}}

## Implementation Protocol

### 1. Context Discovery & Analysis
- Read and analyze the plan document thoroughly
- Understand the phase objectives, requirements, and success criteria
- Map dependencies and integration points with existing systems
- Identify potential compatibility issues and risks

### 2. Architectural Alignment
- Review current system architecture for alignment points
- Check interface compatibility with existing systems
- Identify required changes to maintain consistency
- Plan for backwards compatibility where needed

### 3. Strategic Implementation
- Implement changes incrementally with validation at each step
- Follow established patterns and conventions from the codebase
- Maintain existing functionality while adding new capabilities
- Use appropriate design patterns (composition over inheritance, service patterns, etc.)

### 4. Validation & Testing
- Run typecheck to ensure TypeScript compliance
- Execute relevant tests to verify functionality
- Check for integration issues with dependent systems
- Validate performance impact

### 5. Progress Tracking
- Update the plan document with implementation status
- Mark completed tasks and note any deviations
- Document decisions made during implementation
- Record any blockers or issues encountered

## Expected Outputs

1. **Implementation**: Complete, tested code changes aligned with architecture
2. **Updated Plan**: Progress notes, completion status, and next steps
3. **Documentation**: Key decisions and any architectural changes
4. **Validation**: Test results and compatibility verification

Apply the following principles:
- **Understand before changing**: Analyze existing code thoroughly
- **Incremental progress**: Small, validated steps
- **Maintain compatibility**: Preserve existing interfaces
- **Follow patterns**: Use established architectural patterns
- **Track progress**: Keep plan document current
