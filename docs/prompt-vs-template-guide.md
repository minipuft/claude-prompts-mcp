# Quick Start: Execution Modes

## Overview

The Claude Prompts MCP Server provides **three execution modes** optimized for different use cases. This guide helps you quickly choose the right mode for your needs.

> 📖 **For comprehensive details**, see the [Execution Architecture Guide](./execution-architecture-guide.md)

## Three Execution Modes

- **Prompt**: Basic variable substitution (fastest, ~10-50ms)
- **Template**: Framework-aware processing (balanced, ~100-500ms)  
- **Chain**: LLM-driven sequential workflows (most capable, variable timing)

**Intelligent Detection**: The ConsolidatedPromptEngine automatically detects the optimal execution mode based on your prompt's complexity.

## Quick Decision Guide

### 🚀 Use **Prompts** When:
- Speed is critical (sub-100ms execution)
- Simple variable substitution needed
- Development/testing scenarios
- Basic text formatting or generation

### 🧠 Use **Templates** When:
- Complex reasoning or analysis required
- Framework methodology benefits (CAGEERF, ReACT, 5W1H, SCAMPER)
- Professional-quality outputs needed
- Some quality assurance desired

### 🔗 Use **Chains** When:
- Multi-step processes with dependencies
- Building complex outputs progressively  
- Context needs to flow between steps
- Mission-critical workflows requiring validation

## Basic Usage

### Execution Commands

All execution modes use the same unified interface:

```bash
# Automatic mode detection (recommended)
>>my_prompt input="analyze this data"

# Force specific execution mode if needed
>>my_prompt input="data" --execution-type=prompt     # Force basic mode
>>my_prompt input="data" --execution-type=template   # Force framework mode  
>>my_prompt input="data" --execution-type=chain      # Force chain mode
```

### Framework Integration

Templates automatically use the active framework:

```bash
# Check current framework
>>system_control action=status

# Switch framework for template enhancement
>>system_control action=switch_framework framework=CAGEERF
>>system_control action=switch_framework framework=ReACT
```

## Performance Quick Reference

| Execution Mode | Speed | Memory | Best Use Case |
|---------------|-------|---------|---------------|
| **Prompt** | ⚡ ~10-50ms | Low | Variable substitution, formatting |
| **Template** | 🚀 ~100-500ms | Medium | Analysis, reasoning, quality output |
| **Chain** | 🔄 Variable | Medium | Multi-step workflows, complex processes |

## Examples

### Prompt Example
```bash
>>simple_formatter content="raw text" format="markdown"
# Fast variable substitution, no framework enhancement
```

### Template Example  
```bash
>>code_analyzer code="function validate()" language="JavaScript"
# Framework-enhanced analysis with methodology guidance
```

### Chain Example
```bash
>>research_workflow topic="AI Ethics" steps=3
# Multi-step process: research → analyze → synthesize
```

## Common Patterns

### Speed-Critical Operations
```bash
# Use prompts for rapid iteration
>>format_code code="{{raw}}" style="prettier"
>>generate_title content="{{article}}"
```

### Analysis Tasks
```bash
# Templates provide framework enhancement
>>security_review code="{{codebase}}"  # Uses CAGEERF methodology
>>market_analysis data="{{market_data}}"  # Structured analysis approach
```

### Complex Workflows
```bash
# Chains handle multi-step processes
>>content_creation_pipeline topic="{{subject}}" length="comprehensive"
# Step 1: Research → Step 2: Outline → Step 3: Write → Step 4: Review
```

## Troubleshooting

### Mode Detection Issues
```bash
# Check what execution mode was detected
>>system_control action=analytics

# Force specific mode if detection is wrong
>>my_prompt input="data" --execution-type=template
```

### Performance Optimization
- Use **prompts** for maximum speed
- Use **templates** for balanced performance + quality
- Use **chains** when workflow complexity is needed

### Quality Issues
- **Prompts**: Manual validation required
- **Templates**: Automatic framework enhancement + optional gates
- **Chains**: Step-by-step validation with quality checkpoints

## Migration Guide

### From Simple to Complex
1. Start with **prompts** for development
2. Upgrade to **templates** when quality matters
3. Convert to **chains** for multi-step processes

### Framework Benefits
Templates get automatic methodology enhancement:
- **CAGEERF**: Structured analysis approach
- **ReACT**: Reasoning and acting systematic method
- **5W1H**: Comprehensive questioning framework
- **SCAMPER**: Creative problem-solving approach

## Next Steps

- **Detailed Architecture**: See [Execution Architecture Guide](./execution-architecture-guide.md)
- **Framework Details**: Learn about methodology integration
- **Chain Development**: Advanced workflow creation
- **Performance Tuning**: Optimization strategies

---

**Quick Summary**: Start with automatic mode detection, use prompts for speed, templates for quality, and chains for complex workflows. The system intelligently routes to the best execution strategy based on your prompt's characteristics.