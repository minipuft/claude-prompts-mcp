# Project Commands Detection

## Description

Intelligently detects and configures project validation commands (lint, test, build) for different project types

## System Message

You are an expert assistant providing structured, systematic analysis. Apply appropriate methodology and reasoning frameworks to deliver comprehensive responses.

## User Message Template

# Project Commands Detection for

## Objective

Analyze the project at `{{ project_path }}` (type: `{{ project_type }}`) to detect and configure validation commands for validation checkpoint system.

## Command Detection Strategy

### Node.js/Frontend Projects

**Analysis Steps:**

1. Read `package.json` to extract scripts section
2. Check for TypeScript configuration (`tsconfig.json`)
3. Detect testing framework and linting tools
4. Map to standard command patterns

**Expected Commands:**

- `quick_validation`: Fast syntax/lint check
- `lint`: Code linting with configuration
- `typecheck`: TypeScript type checking (if applicable)
- `unit_test`: Unit test execution
- `build`: Production build
- `full_test`: Complete test suite
- `e2e_test`: End-to-end tests (if available)

### Rust Projects

**Standard Commands:**

- `quick_validation`: "cargo check --quiet"
- `lint`: "cargo clippy -- -D warnings"
- `typecheck`: "" (built into Rust)
- `unit_test`: "cargo test"
- `build`: "cargo build"
- `full_test`: "cargo test"

### Python Projects

**Detection Logic:**

1. Check for `mypy.ini`, `pyproject.toml` with mypy config
2. Detect `ruff`, `flake8`, or `pylint` availability
3. Look for `pytest`, `unittest` setup

### Go Projects

**Standard Commands:**

- `quick_validation`: "go vet ./..."
- `lint`: "golangci-lint run" or "go fmt ./... && go vet ./..."
- `unit_test`: "go test ./..."
- `build`: "go build ./..."

### Enhanced CAGEERF Validation Checkpoints

Configure these checkpoint commands:

**CHECKPOINT 1: Context Validation**

- Syntax validation
- Basic linting
- Type checking

**CHECKPOINT 2: Progressive Edit Validation**

- Incremental build validation
- Modified file linting
- Related test execution

**CHECKPOINT 3: Integration Validation**

- Full build process
- Integration test suite
- Dependency validation

**CHECKPOINT 4: Completion Validation**

- Full test suite
- Performance validation
- Final build verification

## Analysis Instructions

1. **Project Examination**: Use Read and Glob tools to examine project structure
2. **Configuration Analysis**: Read relevant config files (package.json, Cargo.toml, etc.)
3. **Command Mapping**: Map detected tools to standardized command interface
4. **Validation Setup**: Configure CAGEERF checkpoint commands
5. **Fallback Strategy**: Provide sensible defaults for undetected tools

## Expected Output Format

```json
{
  "project_type": "{{ project_type }}",
  "commands": {
    "quick_validation": "command_here",
    "lint": "command_here",
    "typecheck": "command_here_or_empty",
    "unit_test": "command_here",
    "build": "command_here",
    "full_test": "command_here",
    "e2e_test": "command_here_or_empty"
  },
  "cageerf_checkpoints": {
    "checkpoint_1_context": ["quick_validation", "lint"],
    "checkpoint_2_progressive": ["lint", "unit_test"],
    "checkpoint_3_integration": ["build", "full_test"],
    "checkpoint_4_completion": ["full_test", "build"]
  },
  "validation_config": {
    "has_typescript": false,
    "has_testing": true,
    "has_linting": true,
    "detected_tools": ["tool1", "tool2"]
  }
}
```
