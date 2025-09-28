# Project Analysis for Neural Workbench

## Description
Analyzes project directory to detect type, sophistication level, and characteristics for neural workbench initialization

## System Message
You are an expert assistant providing structured, systematic analysis. Apply appropriate methodology and reasoning frameworks to deliver comprehensive responses.

## User Message Template
# Project Analysis for Neural Workbench Initialization

## Objective
Analyze the project at `{{ project_path }}` to determine its characteristics for comprehensive neural workbench initialization.

## Analysis Requirements

### 1. Project Type Detection
Examine the project directory and determine the project type based on these indicators:

**Spicetify Theme Detection (Highest Priority):**
- Check for `manifest.json` with spicetify/spotify references
- Look for `package.json` with spicetify dependencies
- Result: "spicetify-theme"

**Node.js Projects:**
- `package.json` present
- Check dependencies for framework identification:
  - React: "react" or "@types/react" → "react-app"  
  - Vue: "vue" or "@vue/" → "vue-app"
  - Angular: "@angular/" or "angular" → "angular-app"
  - Next.js: "next" or "@next/" → "nextjs-app"
  - Backend: "express", "fastify", "koa" → "nodejs-backend"
  - Default: "nodejs-frontend"

**Other Languages:**
- `Cargo.toml` → "rust-project"
- `go.mod` → "go-project"  
- `pyproject.toml`, `requirements.txt`, `setup.py` → "python-project"
- `pom.xml` → "java-project"
- `Gemfile` → "ruby-project"
- Default: "generic-project"

### 2. Architecture Sophistication Analysis
Analyze codebase complexity (1-10 scale):

**Sophistication Indicators:**
- Advanced patterns usage
- Modular architecture
- Reactive systems
- Dynamic architecture
- Sophisticated abstractions
- Enterprise patterns

**Scoring:**
- Basic project: 1-3
- Standard project: 4-6  
- Advanced project: 7-10

### 3. Project Characteristics
Identify:
- Project name (from directory or package.json)
- Main languages/frameworks
- Build system
- Testing setup
- Documentation quality

## Expected Output Format

```json
{
  "detected_type": "project_type_here",
  "detected_name": "project_name_here", 
  "sophistication": 5,
  "characteristics": {
    "main_language": "language",
    "framework": "framework_name",
    "build_system": "build_tool",
    "has_tests": true,
    "has_docs": true
  },
  "analysis_notes": "Brief description of key findings"
}
```

## Instructions
1. Use Read tool to examine the project directory structure
2. Check key configuration files (package.json, Cargo.toml, etc.)
3. Analyze code patterns and architecture
4. Apply override if `force_project_type` is provided
5. Return the analysis in the expected JSON format

Begin analysis of: `{{ project_path }}`
