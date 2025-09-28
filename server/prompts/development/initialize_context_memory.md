# Context Memory System Initialization

## Description
Initializes the context memory system with working, episodic, semantic, and procedural memory files, plus neural workbench integration

## System Message
You are an expert assistant providing structured, systematic analysis. Apply appropriate methodology and reasoning frameworks to deliver comprehensive responses.

## User Message Template
# Context Memory System Initialization

## Objective
Initialize the comprehensive context memory system for `{{ project_name }}` with neural workbench integration and cognitive architecture support.

## Project Context
- **Path**: `{{ project_path }}`
- **Name**: `{{ project_name }}`
- **Type**: `{{ project_type }}`
- **Architecture Level**: {{ architecture_level }}/10

## Context Memory Architecture

Based on the CoALA framework and cognitive architecture patterns, implement these memory types:

### 1. Working Memory
**Purpose**: Current tasks and immediate context (session-based)
**File**: `context-memory/working-memory.md`
**Max Size**: 10KB
**Content**: Current session info, active tasks, immediate context

### 2. Episodic Memory  
**Purpose**: Historical experiences and outcomes (long-term)
**File**: `context-memory/episodic-memory.md`
**Max Size**: 50KB
**Content**: Development sessions, decisions made, lessons learned

### 3. Semantic Memory
**Purpose**: Technical knowledge and patterns (permanent)
**File**: `context-memory/semantic-memory.md` 
**Max Size**: 100KB
**Content**: Project architecture, patterns, technical concepts

### 4. Procedural Memory
**Purpose**: Workflows and how-to guides (refined over time)
**File**: `context-memory/procedural-memory.md`
**Max Size**: 75KB
**Content**: Development workflows, best practices, procedures

## Neural Workbench Integration

### PROJECT-CONTEXT.yaml Configuration
Create comprehensive project context configuration:

```yaml
project_context:
  name: "{{ project_name }}"
  type: "{{ project_type }}"
  version: "1.0.0"
  description: "Project initialized with neural workbench and context engineering"
  last_updated: "CURRENT_DATE"
  
  global_architecture:
    reference: "/home/minipuft/.claude/context-engineering/COGNITIVE-ARCHITECTURE.yaml"
    version: "1.0.0"
  
  neural_integration:
    enabled: true
    workbench_reference: "/home/minipuft/Applications/neural-workbench/NEURAL-WORKBENCH.yaml"
    monitoring: ["build_status", "test_coverage", "performance_metrics"]
    pattern_sharing:
      enabled: true
      subscribe_to: ["architectural", "performance", "optimization"]
      
  memory_configuration:
    # Memory file configurations
    
  project_specifics:
    architecture_sophistication: {{ architecture_level }}
    auto_detected_type: "{{ project_type }}"
```

### Memory File Templates

Generate initial content for each memory type:

**Working Memory Template:**
```markdown
# Working Memory

## Current Session
**Date**: CURRENT_DATE
**Session ID**: init-TIMESTAMP  
**Action**: Project Initialization

## Current Task
### Task: Neural Workbench Setup
- **ID**: `project-initialization`
- **Description**: Setting up context memory and neural workbench integration
- **Status**: Completed

### Context
- Project type: {{ project_type }}
- Architecture sophistication: {{ architecture_level }}/10
- Neural integration: Enabled

## System Status
- Context Memory: ✅ Initialized
- Neural Integration: ✅ Enabled  
- Pattern Broadcasting: ✅ Available
```

**Episodic Memory Template:**
```markdown
# Episodic Memory

## Initialization Event
**Date**: CURRENT_DATE
**Event**: Project Initialization with Neural Workbench

### Context
- Project: {{ project_name }} ({{ project_type }})
- Architecture Level: {{ architecture_level }}/10
- Initialization Method: Enhanced prompt chain system

### Outcomes
- Context memory system established
- Neural workbench integration configured
- Enhanced CAGEERF validation checkpoints setup
```

## Implementation Instructions

1. **Directory Creation**: Create `context-memory/` directory in project
2. **PROJECT-CONTEXT.yaml**: Generate comprehensive project context configuration
3. **Memory Files**: Create and populate all 4 memory type files
4. **Neural Integration**: Configure neural workbench monitoring and pattern sharing
5. **Validation**: Verify all files are created and properly formatted

## Expected Output Structure

```
{{ project_path }}/
├── context-memory/
│   ├── PROJECT-CONTEXT.yaml
│   ├── working-memory.md
│   ├── episodic-memory.md
│   ├── semantic-memory.md
│   └── procedural-memory.md
```

## Output Format

Return a JSON object with the initialization results:

```json
{
  "memory_structure": {
    "directory_created": true,
    "files_created": [
      "PROJECT-CONTEXT.yaml",
      "working-memory.md", 
      "episodic-memory.md",
      "semantic-memory.md",
      "procedural-memory.md"
    ],
    "neural_integration": {
      "enabled": true,
      "monitoring_configured": true,
      "pattern_sharing_enabled": true
    }
  },
  "initialization_summary": "Context memory system successfully initialized with neural workbench integration"
}
```

Begin context memory initialization for: `{{ project_name }}`
