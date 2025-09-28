# Neural Workbench Initialization

## Description
Initialize a project with neural workbench cognitive architecture and CAGEERF framework

## User Message Template
Initialize neural workbench for project at {{project_path}}

Project Type: {{force_project_type | default: "auto-detect"}}

EXECUTE THE FOLLOWING TASKS IN ORDER:

## 1. Project Analysis
Analyze the project directory to detect:
- Project type (react-app, nodejs, python, etc.)
- Framework and tech stack
- Build commands (package.json scripts, Makefile, etc.)
- Project name and characteristics

## 2. Create Directory Structure
Create the required directories:
- context-memory/
- plans/
- .cursor/ (if not exists)

## 3. Generate CLAUDE.md
Create a comprehensive project CLAUDE.md with:
- Project name, type, and detected characteristics
- All SuperClaude and Applications hub @includes
- Auto-detected development commands
- Neural workbench integration section
- Enhanced CAGEERF validation checkpoints
- Session management protocols
- Quality standards and performance budgets

## 4. Create Context Memory Files

**working-memory.md**:
```markdown
# Working Memory - [PROJECT_NAME]

> Current tasks and immediate context (session-based)
> Auto-managed by Neural Workbench | Max size: 10KB

## Current Session
**Date**: [CURRENT_DATE]
**Status**: Active
**Focus**: Initial project setup

## Active Tasks
- [ ] Complete project initialization
- [ ] Setup development environment
- [ ] Review project requirements

## Recent Discoveries
_Document insights and patterns discovered during this session_

## Next Actions
_Priority tasks for next session_

## Session Notes
_Quick notes and reminders for current work_

---
_Last Updated: [CURRENT_DATE] | Session: [SESSION_ID]_
```

**episodic-memory.md**:
```markdown
# Episodic Memory - [PROJECT_NAME]

> Historical experiences and outcomes (long-term)
> Auto-managed by Neural Workbench | Max size: 50KB

## Project Timeline

### [CURRENT_DATE] - Project Initialization
- **Event**: Project created with neural workbench framework
- **Type**: [PROJECT_TYPE]
- **Outcome**: Successfully initialized with cognitive architecture
- **Key Decisions**:
  - Adopted enhanced CAGEERF methodology
  - Integrated context-memory system
  - Setup validation checkpoints

## Significant Events
_Major milestones, breakthroughs, and turning points_

## Problem-Solution Pairs
_Challenges encountered and their resolutions_

## Performance History
_Build times, test results, optimization outcomes_

## Integration Events
_External system integrations and API changes_

## Lessons Learned
_Key insights from project experiences_

---
_Last Updated: [CURRENT_DATE] | Total Events: 1_
```

**semantic-memory.md**:
```markdown
# Semantic Memory - [PROJECT_NAME]

> Technical knowledge and patterns (permanent)
> Auto-managed by Neural Workbench | Max size: 100KB

## Core Concepts

### Project Architecture
- **Type**: [PROJECT_TYPE]
- **Framework**: [FRAMEWORK]
- **Pattern**: [ARCHITECTURE_PATTERN]
- **Key Technologies**: [TECH_STACK]

### Domain Knowledge
_Core business logic and domain-specific patterns_

### Technical Patterns

#### Code Patterns
_Reusable code structures and implementations_

#### Architecture Patterns
_System design patterns and principles_

#### Performance Patterns
_Optimization techniques and benchmarks_

## Dependencies & APIs

### Internal Dependencies
_Project modules and their relationships_

### External Dependencies
_Third-party libraries and services_

### API Contracts
_Interface definitions and data schemas_

## Best Practices

### Project-Specific Standards
_Coding conventions and quality standards_

### Performance Guidelines
_Optimization targets and techniques_

### Security Considerations
_Security patterns and requirements_

## Technical Debt Registry
_Known limitations and improvement opportunities_

---
_Last Updated: [CURRENT_DATE] | Knowledge Items: 0_
```

**procedural-memory.md**:
```markdown
# Procedural Memory - [PROJECT_NAME]

> Workflows and how-to guides (refined over time)
> Auto-managed by Neural Workbench | Max size: 75KB

## Development Workflows

### Initial Setup
```bash
# Project initialization with neural workbench
>>neural_workbench_init project_path=.

# Validate setup
>>validation_summary project_path=. generated_claude_md="complete" context_memory_setup="initialized" validation_setup="configured"
```

### Build & Test Workflow
```bash
# Development commands (auto-detected)
[BUILD_COMMAND]
[TEST_COMMAND]
[LINT_COMMAND]
```

### Session Management
1. **Start Session**: Review `plans/implementation-scratchpad.md`
2. **During Work**: Update progress in real-time
3. **End Session**: Document outcomes and next steps

## Common Tasks

### Adding New Features
_Step-by-step process for feature development_

### Debugging Issues
_Systematic approach to problem resolution_

### Performance Optimization
_Workflow for identifying and fixing bottlenecks_

### Code Review Process
_Standards and checklist for code reviews_

## Validation Checkpoints

### CHECKPOINT 1: Context Validation
- Complete Phase 1A-1F discovery
- Verify all dependencies identified
- Confirm user flow analysis

### CHECKPOINT 2: Progressive Validation
- After significant changes (>10 lines)
- Test critical interfaces
- Verify no regressions

### CHECKPOINT 3: Integration Validation
- Test component integration
- Verify external dependencies
- Check API contracts

### CHECKPOINT 4: Completion Validation
- All tests passing
- Performance targets met
- Documentation updated

## Automation Scripts
_Project-specific automation and tooling_

## Emergency Procedures
_Recovery processes for critical issues_

---
_Last Updated: [CURRENT_DATE] | Procedures: 4_
```

## 5. Create Plans Directory Files

Generate all plans files: implementation-scratchpad.md, project-status.md, agent-coordination.md, dependencies.md, architecture-decisions.md with appropriate project-specific content.

## 6. Create PROJECT-CONTEXT.yaml

Generate the neural integration configuration file with detected project settings.

## 7. Create .cursor/rules

Generate project-specific cursor rules if the file doesn't exist.

RETURN A SUMMARY WITH:
- ✅ Detected project characteristics (type, framework, commands)
- ✅ Created directory structure
- ✅ Generated files list
- ✅ Neural integration configuration
- 🎯 Next recommended steps
