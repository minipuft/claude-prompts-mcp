# Execution Modes Guide - Prompt vs Template vs Chain

## Overview

The Claude Prompts MCP Server provides **three intelligent execution modes** optimized for different use cases. All execution happens through the consolidated `prompt_engine` MCP tool with automatic mode detection and framework integration.

> 📖 **For comprehensive details**, see the [Execution Architecture Guide](./execution-architecture-guide.md)

## Three Execution Modes

- **Prompt**: Basic variable substitution (fastest, ~10-50ms)
- **Template**: Framework-aware processing with methodology guidance (balanced, ~100-500ms) 
- **Chain**: LLM-driven iterative execution with instructions (most capable, variable timing)

**Intelligent Detection**: The `prompt_engine` automatically detects the optimal execution mode based on your prompt's complexity and structure.

## Quick Decision Guide

### 🚀 Use **Prompt Mode** When:

- Speed is critical (sub-100ms execution)
- Simple variable substitution needed
- Development/testing scenarios
- Basic text formatting or generation
- No framework methodology needed

### 🧠 Use **Template Mode** When:

- Complex reasoning or analysis required
- Framework methodology benefits (CAGEERF, ReACT, 5W1H, SCAMPER)
- Professional-quality outputs needed
- Quality gates and validation desired
- System prompt enhancement helpful

### 🔗 Use **Chain Mode** When:

- Multi-step processes requiring iterative execution
- Building complex outputs progressively through LLM guidance
- Context needs to flow between steps
- Mission-critical processes requiring step-by-step validation
- LLM should control execution flow and decision-making

## MCP Tool Usage

All execution uses the consolidated `prompt_engine` MCP tool:

### Basic Execution

```bash
# Automatic mode detection (recommended)
prompt_engine >>my_prompt input="analyze this data"

# Explicit mode specification
prompt_engine >>my_prompt input="data" execution_mode="prompt"     # Force basic mode
prompt_engine >>my_prompt input="data" execution_mode="template"   # Force framework mode  
prompt_engine >>my_prompt input="data" execution_mode="chain"      # Force chain mode
```

### JSON Command Format

```bash
# Alternative JSON syntax for complex arguments
prompt_engine command='{"command": ">>analysis_prompt", "args": {"data": "complex data", "focus": "security"}}'
```

### Framework Integration

Templates automatically use the active framework methodology:

```bash
# Check current framework and system status
system_control status

# Switch framework for enhanced template processing
system_control switch_framework framework="CAGEERF" reason="Need comprehensive analysis"
system_control switch_framework framework="ReACT" reason="Problem-solving focus"
```

## Execution Mode Details

### Prompt Mode (`execution_mode="prompt"`)

**Purpose**: Lightning-fast variable substitution without framework overhead

**Features**:
- Simple Nunjucks template processing
- Direct variable substitution
- No system prompt enhancement
- Minimal processing overhead
- Optional quality gates

**Output Format**: `⚡ **Basic Prompt Execution** | 🚀 Fast variable substitution`

**Example**:
```bash
prompt_engine >>format_code code="function test() {}" style="prettier" execution_mode="prompt"
```

### Template Mode (`execution_mode="template"`)

**Purpose**: Framework-enhanced execution with methodology guidance

**Features**:
- Full framework processing with active methodology
- System prompt injection from framework guides
- Quality gates integration (when enabled)
- Framework-specific enhancement and validation
- Professional-quality outputs

**Output Format**: `🧠 **Framework Template Execution** | 🎯 [Active Framework] | ✅ Quality gates applied`

**Example**:
```bash
prompt_engine >>security_analysis code="{{codebase}}" execution_mode="template" gate_validation=true
```

### Chain Mode (`execution_mode="chain"`)

**Purpose**: LLM-driven iterative execution with step-by-step guidance

**Revolutionary Architecture**: Instead of server-side orchestration, chains return **structured instructions** that guide the LLM through iterative execution.

**How Chain Mode Works**:
1. Chain mode analyzes the chain definition and current state
2. Returns **LLM instruction template** for the next step to execute
3. LLM executes the step by calling `prompt_engine` again with step-specific arguments
4. Server tracks progress and provides instructions for subsequent steps
5. Process continues until chain completion

**Features**:
- LLM controls execution flow and decision-making
- Natural conversation flow preservation
- Automatic step progression with state tracking
- Quality gates enabled by default (`gate_validation=true`)
- Error recovery and retry capabilities
- Context preservation between steps

**Output Format**: `🔗 **Chain Execution**: [Chain Name] | Step [N/Total] | [Next Instructions]`

**Example**:
```bash
# Execute complete chain with automatic progression
prompt_engine >>research_pipeline topic="AI Ethics" llm_driven_execution=true

# Manual step-by-step execution
prompt_engine >>research_pipeline topic="AI Ethics" execution_mode="chain"
# Returns instructions for Step 1, then call again based on instructions
```

## Performance Characteristics

| Execution Mode | Speed         | Memory | CPU | Framework | Quality Gates | Best Use Case |
|----------------|---------------|--------|-----|-----------|---------------|---------------|
| **Prompt**     | ⚡ ~10-50ms   | Low    | Low | None      | Optional      | Variable substitution, formatting |
| **Template**   | 🚀 ~100-500ms | Medium | Med | Active    | Optional      | Analysis, reasoning, quality output |
| **Chain**      | 🔄 Variable   | Medium | Med | Active    | Default On    | Multi-step processes, complex orchestration |

## Advanced Features

### Automatic Mode Detection

When `execution_mode="auto"` (default):

1. **Semantic Analysis**: Analyzes prompt structure and complexity
2. **Chain Detection**: Automatically detects chains based on presence of `chainSteps`
3. **Template Detection**: Complex arguments, template variables, or analysis requirements
4. **Prompt Fallback**: Simple variable substitution (default)

**Detection Logic**:
```typescript
if (prompt.chainSteps?.length) return "chain"
if (hasComplexArguments || requiresFramework) return "template"  
return "prompt"  // Default for simple cases
```

### Framework System Integration

**Active Framework Impact**:
- **Prompt Mode**: No framework enhancement
- **Template Mode**: Full framework processing with methodology guidance
- **Chain Mode**: Framework-aware step instructions and validation

**Available Methodologies**:
- **CAGEERF**: Comprehensive structured analysis (Context, Analysis, Goals, Execution, Evaluation, Refinement, Framework)
- **ReACT**: Reasoning and Acting systematic problem-solving approach  
- **5W1H**: Who, What, When, Where, Why, How systematic analysis framework
- **SCAMPER**: Creative problem-solving (Substitute, Combine, Adapt, Modify, Put to other uses, Eliminate, Reverse)

### Quality Gates Integration

**Gate Validation Levels**:
- **Prompts**: Optional gates (`gate_validation=false` by default)
- **Templates**: Optional gates (`gate_validation=true` recommended)
- **Chains**: Automatic gates (`gate_validation=true` by default)

**Gate Types Available**:
- Content analysis (length, readability, tone, grammar)
- Structure validation (format, sections, hierarchy)
- Pattern matching (keywords, patterns, links)
- Custom logic (required fields, completeness, security)

## Common Usage Patterns

### Speed-Critical Operations

```bash
# Use prompt mode for rapid iteration and simple tasks
prompt_engine >>format_json data="{{raw_data}}" execution_mode="prompt"
prompt_engine >>generate_title content="{{article}}" execution_mode="prompt"
```

### Analysis and Reasoning Tasks

```bash
# Templates provide framework methodology enhancement
prompt_engine >>code_review code="{{source}}" execution_mode="template"
prompt_engine >>market_analysis data="{{research}}" execution_mode="template" gate_validation=true
```

### Complex Multi-Step Processes

```bash
# Chains handle iterative LLM-driven execution
prompt_engine >>content_creation_workflow topic="{{subject}}" length="comprehensive" llm_driven_execution=true
prompt_engine >>research_and_analysis_pipeline query="{{research_question}}" depth="thorough"
```

### Framework-Specific Execution

```bash
# Switch framework and execute with methodology guidance
system_control switch_framework framework="CAGEERF" reason="Comprehensive analysis needed"
prompt_engine >>strategic_analysis situation="{{business_context}}" execution_mode="template"

# Different methodology for creative tasks  
system_control switch_framework framework="SCAMPER" reason="Creative problem solving"
prompt_engine >>innovation_workshop challenge="{{problem}}" execution_mode="template"
```

## Troubleshooting

### Mode Detection Issues

```bash
# Check what execution mode was detected and why
system_control analytics

# View detailed execution history and mode usage
system_control status

# Force specific mode if auto-detection is incorrect
prompt_engine >>my_prompt input="data" execution_mode="template"
```

### Performance Optimization

**Speed Priority**:
- Use `execution_mode="prompt"` for maximum speed
- Disable quality gates: `gate_validation=false`
- Use simple variable names and minimal template logic

**Quality Priority**:
- Use `execution_mode="template"` with appropriate framework
- Enable quality gates: `gate_validation=true`  
- Switch to methodology that matches your task type

**Complex Workflow Priority**:
- Use `execution_mode="chain"` for multi-step processes
- Enable `llm_driven_execution=true` for LLM-driven coordination
- Let LLM control flow - don't force manual step control

### Chain Execution Issues

**Chain Not Progressing**:
```bash
# Check chain state and progress
system_control status

# Reset chain state if stuck
prompt_engine >>your_chain_name execution_mode="chain"  # Restarts from current step
```

**Chain Step Failures**:
- Quality gates are enabled by default - check gate validation results
- LLM instructions may need clarification - review step definitions
- Framework methodology may not match chain requirements

### Framework Integration Issues

```bash
# Verify active framework
system_control status

# Check framework switching history and performance
system_control analytics include_history=true

# Switch to appropriate framework for your task
system_control switch_framework framework="ReACT" reason="Problem-solving task"
```

## Migration Guide

### From Simple to Complex Execution

**Development Phase**:
1. Start with **prompt mode** for rapid prototyping: `execution_mode="prompt"`
2. Test with various inputs and ensure variable substitution works correctly

**Quality Phase**:
3. Upgrade to **template mode** when output quality matters: `execution_mode="template"`
4. Choose appropriate framework methodology for your use case
5. Enable quality gates for validation: `gate_validation=true`

**Production Phase**:
6. Convert to **chain mode** for multi-step processes: `execution_mode="chain"`
7. Enable LLM-driven chain coordination: `llm_driven_execution=true`
8. Monitor execution analytics and optimize based on usage patterns

### Framework Selection Guide

**Choose Framework Based on Task Type**:

- **CAGEERF**: Complex analysis, strategic planning, comprehensive evaluation
- **ReACT**: Problem-solving, debugging, systematic reasoning tasks  
- **5W1H**: Research, investigation, systematic information gathering
- **SCAMPER**: Creative tasks, innovation, brainstorming, design thinking

## System Integration

### MCP Tool Coordination

```bash
# Complete workflow using all consolidated tools
system_control status                           # Check system and framework state
system_control switch_framework framework="CAGEERF"  # Set methodology
prompt_engine >>analysis_task data="{{input}}" execution_mode="template"  # Execute with framework
system_control analytics                        # Monitor performance
```

### Analytics and Monitoring

**Execution Statistics**:
- Mode usage distribution (prompt/template/chain percentages)
- Framework usage patterns and switching frequency
- Performance metrics per execution mode
- Quality gate success rates and common failures

**Access Analytics**:
```bash
# View comprehensive execution analytics
system_control analytics include_history=true

# Monitor system health including execution performance
system_control health

# Reset metrics if needed for fresh tracking
system_control reset_metrics confirm=true
```

## Best Practices

### Execution Mode Selection

- **Start Simple**: Begin with automatic mode detection, override only when necessary
- **Performance Testing**: Benchmark your specific use cases to choose optimal modes
- **Framework Alignment**: Match execution mode with framework - templates benefit most from methodology
- **Quality Requirements**: Use quality gates in template/chain modes for production workloads

### Framework Integration

- **Task-Appropriate Frameworks**: Switch frameworks based on task type, not randomly
- **Consistent Methodology**: Stick with one framework per logical workflow or project phase
- **Performance Monitoring**: Track framework effectiveness for your specific use cases
- **Strategic Switching**: Plan framework switches, don't change mid-workflow unnecessarily

### Chain Development

- **Step Design**: Design clear, discrete steps that can be executed independently
- **State Management**: Let the LLM handle state and flow - avoid over-constraining steps
- **Error Recovery**: Design steps to be retryable and recoverable from failures
- **Progress Tracking**: Monitor chain execution through system analytics

### Quality Assurance

- **Gate Strategy**: Enable gates for production, disable for development speed
- **Framework Quality**: Use appropriate methodology - each framework has quality strengths
- **Validation Testing**: Test execution modes with realistic data before production
- **Monitoring Setup**: Implement analytics monitoring for production workloads

## Advanced Topics

### Custom Chain Development

For creating sophisticated multi-step workflows:

```bash
# Define chain with clear step progression
prompt_manager create_template name="custom_analysis_chain" category="analysis" \
  content="Multi-step analysis workflow with data collection and synthesis" \
  chain_steps='[
    {"promptId": "data_collection", "stepName": "Data Collection"},
    {"promptId": "analysis_processing", "stepName": "Analysis"},
    {"promptId": "synthesis_generation", "stepName": "Synthesis"}
  ]'
```

### Performance Optimization Strategies

**For High-Throughput Scenarios**:
- Batch similar executions using prompt mode
- Cache framework contexts when possible  
- Monitor memory usage during chain execution
- Use analytics to identify bottlenecks

**For Quality-Critical Scenarios**:
- Always enable quality gates in production
- Use appropriate framework methodology consistently
- Implement comprehensive error handling and retry logic
- Monitor quality gate success rates and adjust criteria

---

**Quick Summary**: The MCP server provides three intelligent execution modes accessible through the `prompt_engine` tool. Use automatic mode detection for most cases, prompt mode for speed, template mode for quality with framework enhancement, and chain mode for complex LLM-driven iterative processes. All modes integrate seamlessly with the framework system and quality gates for professional-grade AI prompt execution.