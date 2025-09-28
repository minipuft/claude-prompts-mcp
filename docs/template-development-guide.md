# Template Development Guide

## Overview

This guide covers creating **framework-aware templates** that leverage the Claude Prompts MCP Server's methodology system for enhanced, systematic prompt execution. Templates represent the middle tier of our three-tier execution model, providing structured guidance and quality assurance.

## Related Documentation

- **[Three-Tier Execution System](execution-architecture-guide.md)** - Understanding template execution in the broader system
- **[Prompt Format Guide](prompt-format-guide.md)** - Basic prompt formatting (foundation for templates)
- **[Chain System Analysis](chain-system-analysis.md)** - Using templates within chain workflows
- **[Enhanced Gate System](enhanced-gate-system.md)** - Quality validation for templates
- **[MCP Tools Reference](mcp-tools-reference.md)** - Using tools with template execution

## What Are Framework-Aware Templates?

Framework-aware templates are enhanced prompts that:
- **Integrate with methodology guides** (CAGEERF, ReACT, 5W1H, SCAMPER)
- **Include system prompt injection** for structured thinking
- **Apply quality gates** for validation and consistency
- **Provide structured guidance** to LLMs for better outcomes

## Template Structure

### Basic Template Format

```markdown
# Template Name

**🔄 TEMPLATE EXECUTION**: Framework-aware processing with {{framework}} methodology

## System Message
You are an expert {{role}} who follows systematic approaches to {{task_type}}.
Use the active framework methodology to ensure comprehensive analysis.

## User Message Template
{{user_content_with_variables}}

## Arguments
- role: The expert role for this template
- task_type: Type of task being performed
- user_content_with_variables: Main template content
```

### Template Markers

Templates are identified by specific markers:

#### Execution Type Markers
```markdown
**🔄 TEMPLATE EXECUTION**: Framework-aware processing
**⚡ EXECUTION REQUIRED**: Uses template execution for framework integration
```

#### Framework Integration Markers
```markdown
**📋 FRAMEWORK**: Uses active methodology ({{framework}}) for systematic approach
**🎯 METHODOLOGY**: Applies {{framework}} principles throughout execution
```

## Framework Integration

### Available Frameworks

#### CAGEERF Framework
**Use for**: Comprehensive structured analysis
- **Context**: Understand the situation
- **Analysis**: Break down the problem  
- **Goals**: Define clear objectives
- **Execution**: Implement systematic approach
- **Evaluation**: Assess results
- **Refinement**: Improve based on feedback
- **Framework**: Apply methodology consistently

```markdown
# CAGEERF Analysis Template
**🔄 TEMPLATE EXECUTION**: Uses CAGEERF methodology for systematic analysis

## System Message
You are an expert analyst who follows the CAGEERF methodology for comprehensive evaluation.
Apply each phase systematically: Context → Analysis → Goals → Execution → Evaluation → Refinement → Framework consistency.

## User Message Template
Analyze the following using CAGEERF methodology:
{{content}}

Focus areas: {{focus_areas}}
```

#### ReACT Framework
**Use for**: Reasoning and action-oriented tasks
- **Reasoning**: Think through the problem systematically
- **Acting**: Take concrete steps based on reasoning

```markdown
# ReACT Problem Solving Template
**🔄 TEMPLATE EXECUTION**: Uses ReACT methodology for reasoning and action

## System Message  
You are an expert problem solver who uses ReACT (Reasoning and Acting) methodology.
For each step: 1) Reason about the situation, 2) Act based on that reasoning.

## User Message Template
Apply ReACT methodology to solve:
{{problem_statement}}

Available actions: {{available_actions}}
```

#### 5W1H Framework
**Use for**: Comprehensive information gathering
- **Who**: Key stakeholders and people involved
- **What**: Core facts and details
- **When**: Timing and sequence
- **Where**: Location and context
- **Why**: Motivations and reasons
- **How**: Methods and processes

```markdown
# 5W1H Analysis Template
**🔄 TEMPLATE EXECUTION**: Uses 5W1H methodology for comprehensive analysis

## System Message
You are an expert investigator who uses the 5W1H framework for thorough analysis.
Address each question systematically: Who, What, When, Where, Why, and How.

## User Message Template
Analyze using 5W1H framework:
{{subject}}

Priority questions: {{priority_questions}}
```

#### SCAMPER Framework  
**Use for**: Creative problem-solving and innovation
- **Substitute**: What can be substituted?
- **Combine**: What can be combined?
- **Adapt**: What can be adapted?
- **Modify**: What can be modified?
- **Put to other uses**: How else can this be used?
- **Eliminate**: What can be eliminated?
- **Reverse**: What can be reversed?

```markdown
# SCAMPER Innovation Template
**🔄 TEMPLATE EXECUTION**: Uses SCAMPER methodology for creative problem-solving

## System Message
You are an innovation expert who applies SCAMPER methodology for creative solutions.
Systematically explore: Substitute, Combine, Adapt, Modify, Put to other uses, Eliminate, Reverse.

## User Message Template
Apply SCAMPER methodology to innovate on:
{{concept}}

Focus areas: {{focus_areas}}
```

### Framework Selection

#### Automatic Framework Application
Templates automatically use the **active framework** set in the system:

```bash
# Check current framework
system_control status

# Switch framework for template execution
system_control switch_framework framework=CAGEERF reason="Need comprehensive analysis"
```

#### Framework-Specific Templates
Create templates optimized for specific frameworks:

```markdown
# CAGEERF-Optimized Template
**📋 FRAMEWORK**: Optimized for CAGEERF methodology

This template works best with CAGEERF framework active.
To use: `system_control switch_framework framework=CAGEERF`
```

## Template Development Process

### Step 1: Define Template Purpose

```markdown
# Template Planning
- **Purpose**: What specific task does this template address?
- **Target Framework**: Which methodology best supports this task?
- **Complexity Level**: Simple, moderate, or complex template?
- **Quality Requirements**: What validation is needed?
```

### Step 2: Choose Template Structure

#### Simple Template (Basic framework integration)
```markdown
# Simple Analysis Template
**🔄 TEMPLATE EXECUTION**: Framework-aware analysis

Analyze: {{content}}
Focus: {{focus_area}}
```

#### Structured Template (Full framework integration)
```markdown
# Comprehensive Analysis Template  
**🔄 TEMPLATE EXECUTION**: Uses {{framework}} for systematic analysis

## System Message
You are an expert analyst following {{framework}} methodology.
[Detailed system instructions...]

## User Message Template  
[Structured template with multiple variables...]

## Arguments
- content: Content to analyze
- framework: Active methodology framework
- focus_area: Specific focus for analysis
```

#### Advanced Template (Custom framework guidance)
```markdown
# Advanced Research Template
**🔄 TEMPLATE EXECUTION**: Advanced framework integration with custom quality gates

## Framework-Specific Guidance
{{#if framework == "CAGEERF"}}
Apply CAGEERF phases systematically...
{{elif framework == "ReACT"}}
Use reasoning-action cycles...
{{else}}
Apply general systematic approach...
{{/if}}

[Rest of template...]
```

### Step 3: Implement Template Logic

#### Variable Definition
```markdown
## Arguments
- content (required): Primary content for processing
- focus_area (optional): Specific area to emphasize
- depth_level (optional, default: "moderate"): Analysis depth
- output_format (optional, default: "markdown"): Desired output format
```

#### Conditional Logic
```markdown
## User Message Template
Analyze the following content:
{{content}}

{{#if focus_area}}
Pay special attention to: {{focus_area}}
{{/if}}

{{#if depth_level == "deep"}}
Provide comprehensive analysis including edge cases and implications.
{{elif depth_level == "surface"}}
Provide high-level overview focusing on key points.
{{else}}
Provide balanced analysis covering main points and key details.
{{/if}}
```

### Step 4: Add Quality Gates

#### Template-Level Quality Requirements
```markdown
# Template with Quality Gates
**🔄 TEMPLATE EXECUTION**: Framework-aware with enhanced validation
**🛡️ QUALITY GATES**: Enabled - Content analysis, structure validation, methodology compliance

[Template content...]
```

#### Custom Quality Criteria
```markdown
## Quality Requirements
- Minimum response length: 500 words
- Must include framework methodology application
- Structured output with clear sections
- Evidence-based conclusions
```

## Advanced Template Features

### Nunjucks Template Features

#### Loops and Iteration
```markdown
## Analysis Points
{{#each analysis_points}}
### {{@index + 1}}. {{this.title}}
{{this.description}}

{{/each}}
```

#### Filters and Functions
```markdown
## Processed Content
Original length: {{content | length}} characters
Summary: {{content | truncate(200)}}
Formatted: {{content | upper | trim}}
```

#### Macros for Reusable Components
```markdown
{{#macro section_header(title, framework)}}
## {{title}}
*Using {{framework}} methodology*
{{/macro}}

{{section_header("Analysis", framework)}}
Your analysis content here...
```

### Framework Context Injection

#### Accessing Framework Information
```markdown
## Current Framework Context
- **Active Framework**: {{framework}}  
- **Methodology Guide**: {{framework_description}}
- **Quality Criteria**: {{framework_quality_gates}}

Apply {{framework}} principles throughout this analysis.
```

#### Framework-Specific Customization
```markdown
{{#if framework == "CAGEERF"}}
## CAGEERF Analysis Structure
1. **Context**: {{context_analysis}}
2. **Analysis**: {{detailed_analysis}}  
3. **Goals**: {{goal_definition}}
4. **Execution**: {{implementation_plan}}
5. **Evaluation**: {{results_assessment}}
6. **Refinement**: {{improvement_suggestions}}
7. **Framework**: {{methodology_consistency}}
{{/if}}
```

## Testing Templates

### Local Testing

```bash
# Test template execution
prompt_engine >>your_template content="test content" focus_area="key points"

# Test with specific framework
system_control switch_framework framework=CAGEERF
prompt_engine >>your_template execution_mode=template
```

### Quality Gate Testing

```bash
# Test with quality gates enabled
prompt_engine >>your_template gate_validation=true

# Test quality gate compliance
prompt_engine >>your_template execution_mode=template gate_validation=true
```

### Framework Integration Testing

```bash
# Test with different frameworks
system_control switch_framework framework=ReACT
prompt_engine >>your_template

system_control switch_framework framework=5W1H  
prompt_engine >>your_template

# Compare framework-specific outputs
```

## Best Practices

### Template Design

#### DO:
- **Use clear template markers** for execution type identification
- **Define all required arguments** with descriptions
- **Include framework integration markers** for methodology awareness
- **Structure templates logically** with clear sections
- **Test across different frameworks** to ensure compatibility

#### DON'T:
- **Hard-code framework references** - use {{framework}} variables
- **Create overly complex templates** - prefer clarity over cleverness
- **Ignore quality gate requirements** - design for validation
- **Mix execution tiers** - keep templates focused on their tier

### Performance Optimization

#### Template Efficiency
- **Minimize complex conditional logic**
- **Use efficient Nunjucks operations**
- **Cache reusable template components**
- **Optimize variable substitution**

#### Framework Integration
- **Leverage active framework selection** rather than switching
- **Use framework-appropriate templates** for best performance
- **Cache framework context** when possible

### Quality Assurance

#### Template Validation
- **Test all argument combinations**
- **Verify framework integration works correctly**
- **Validate output structure and format**
- **Check quality gate compliance**

#### Documentation
- **Document template purpose clearly**
- **Provide usage examples**
- **List framework compatibility**
- **Include troubleshooting guidance**

## Migration from Basic Prompts

### Converting Existing Prompts

#### Step 1: Add Template Markers
```markdown
# Before (basic prompt)
Analyze this content: {{content}}

# After (template)  
**🔄 TEMPLATE EXECUTION**: Framework-aware analysis

Analyze this content using systematic methodology: {{content}}
```

#### Step 2: Add Framework Integration
```markdown
# Enhanced template
**🔄 TEMPLATE EXECUTION**: Uses {{framework}} methodology

## System Message
You are an expert analyst applying {{framework}} methodology for systematic analysis.

## User Message Template
Apply {{framework}} principles to analyze: {{content}}
```

#### Step 3: Add Quality Requirements
```markdown
# Final template with quality gates
**🔄 TEMPLATE EXECUTION**: Framework-aware with quality validation
**🛡️ QUALITY GATES**: Content analysis, methodology compliance

[Template content with framework integration]
```

## Troubleshooting

### Common Issues

#### Template Not Using Framework
**Problem**: Template executes as basic prompt instead of framework-aware template
**Solution**: Add proper template execution markers and check framework is active

#### Quality Gate Failures  
**Problem**: Template fails validation
**Solution**: Review quality gate requirements and adjust template structure

#### Variable Substitution Issues
**Problem**: Variables not being replaced correctly
**Solution**: Check variable names match argument definitions exactly

### Debug Information

Enable verbose logging to debug template execution:
```bash
npm run start:verbose
```

This shows:
- Template execution tier detection
- Framework integration process
- Quality gate evaluation results
- Variable substitution details

## Examples Library

### Content Analysis Template
```markdown
# Content Analysis Template
**🔄 TEMPLATE EXECUTION**: Framework-aware content analysis

## System Message
You are an expert content analyst who uses systematic methodology for comprehensive analysis.
Apply the active framework to ensure thorough and structured evaluation.

## User Message Template
Analyze the following content using {{framework}} methodology:

**Content:**
{{content}}

**Analysis Focus:**
{{#if focus_areas}}
Pay special attention to: {{focus_areas}}
{{else}}
Provide comprehensive analysis across all relevant dimensions.
{{/if}}

**Output Requirements:**
- Use {{framework}} structured approach
- Provide evidence-based insights
- Include actionable recommendations
- Maintain systematic methodology throughout

## Arguments
- content: Content to analyze (required)
- focus_areas: Specific areas to emphasize (optional)
```

### Problem-Solving Template
```markdown
# Systematic Problem Solving Template
**🔄 TEMPLATE EXECUTION**: Framework-driven problem solving

## System Message
You are an expert problem solver who applies systematic methodology to address complex challenges.
Use the active framework to ensure comprehensive problem analysis and solution development.

## User Message Template
Apply {{framework}} methodology to solve this problem:

**Problem Statement:**
{{problem}}

**Constraints:**
{{constraints}}

**Available Resources:**
{{resources}}

**Success Criteria:**
{{success_criteria}}

Follow {{framework}} principles to:
1. Analyze the problem systematically
2. Develop structured solutions
3. Evaluate options methodically
4. Provide implementation guidance

## Arguments
- problem: Problem description (required)
- constraints: Known limitations (required)
- resources: Available resources (optional)
- success_criteria: Definition of success (required)
```

This guide provides the foundation for creating powerful, framework-aware templates that leverage the full capabilities of the Claude Prompts MCP Server's methodology system.