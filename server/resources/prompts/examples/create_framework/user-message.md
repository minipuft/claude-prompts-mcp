# Create Framework

## System Message

You are a framework architect specializing in framework design for the Claude Prompts MCP system. Your task is to create production-quality execution frameworks that match the standards of existing frameworks like CAGEERF and ReACT.

## User Message

{% if tool_framework_builder %}
{# Auto-execute workflow: framework_input was provided and validated #}

{% if tool_framework_builder.valid %}
{% if tool_framework_builder_result %}
{# Auto-execute completed successfully #}

## ✅ Framework Created Successfully

{{ tool_framework_builder_result.text }}

**Summary:**

- **ID:** `{{ tool_framework_builder.auto_execute.params.id }}`
- **Name:** {{ tool_framework_builder.auto_execute.params.name }}
- **Phases:** {{ tool_framework_builder.summary.phases }}
- **Framework Gates:** {{ tool_framework_builder.summary.framework_gates }}
- **Processing Steps:** {{ tool_framework_builder.summary.processing_steps }}
- **Execution Steps:** {{ tool_framework_builder.summary.execution_steps }}
- **Quality Indicator Phases:** {{ tool_framework_builder.summary.quality_indicator_phases }}

{% if tool_framework_builder.warnings | length > 0 %}

### ⚠️ Warnings (non-blocking)

{% for warning in tool_framework_builder.warnings %}

- {{ warning }}
  {% endfor %}
  {% endif %}

**Next Steps:**

1. Enable the framework: `resource_manager(resource_type:"framework", action:"switch", id:"{{ tool_framework_builder.auto_execute.params.id }}")`
2. Test with a prompt: `prompt_engine(">>your_prompt @{{ tool_framework_builder.auto_execute.params.id | upper }}")`

{% else %}
{# Validation passed but auto-execute not available #}

## ✅ Framework Validated

The framework definition passed validation. Call `resource_manager` with the following parameters:

```json
{{ tool_framework_builder.auto_execute.params | dump(2) }}
```

{% if tool_framework_builder.warnings | length > 0 %}

### ⚠️ Warnings (non-blocking)

{% for warning in tool_framework_builder.warnings %}

- {{ warning }}
  {% endfor %}
  {% endif %}

{% endif %}
{% else %}
{# Validation failed #}

## ❌ Validation Failed

The framework definition has errors that need to be fixed:

{% for error in tool_framework_builder.errors %}

- {{ error }}
  {% endfor %}

{% if tool_framework_builder.tier_breakdown %}

### Tier Breakdown

| Tier                                      | Score                                                              | Max                                                              |
| ----------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| Foundation (metadata, guidance, phases)   | {{ tool_framework_builder.tier_breakdown.tier1_foundation.score }} | {{ tool_framework_builder.tier_breakdown.tier1_foundation.max }} |
| Quality (gates, include)                  | {{ tool_framework_builder.tier_breakdown.tier2_quality.score }}    | {{ tool_framework_builder.tier_breakdown.tier2_quality.max }}    |
| Authoring (elements, args, templates)     | {{ tool_framework_builder.tier_breakdown.tier3_authoring.score }}  | {{ tool_framework_builder.tier_breakdown.tier3_authoring.max }}  |
| Execution (processing, execution steps)   | {{ tool_framework_builder.tier_breakdown.tier4_execution.score }}  | {{ tool_framework_builder.tier_breakdown.tier4_execution.max }}  |
| Advanced (tools, indicators, flow, judge) | {{ tool_framework_builder.tier_breakdown.tier5_advanced.score }}   | {{ tool_framework_builder.tier_breakdown.tier5_advanced.max }}   |
| **Total**                                 | **{{ tool_framework_builder.score }}**                             | **100**                                                          |

{% endif %}

{% if tool_framework_builder.warnings | length > 0 %}

### ⚠️ Warnings

{% for warning in tool_framework_builder.warnings %}

- {{ warning }}
  {% endfor %}
  {% endif %}

**Framework creation requires 100% score.** Complete all 5 tiers to match CAGEERF standard.

Please fix the errors above and try again with corrected `framework_input`.

{% endif %}

{% else %}
{# Design workflow: no framework_input provided, guide LLM to design #}

Create a new framework with the following specifications:

**Name:** {{name}}
**Core Concept:** {{concept}}
{% if phase_count %}**Target Phases:** {{phase_count}}{% endif %}

---

## Reference: Existing Framework Examples

### Example 1: CAGEERF (Complete Reference)

**framework.yaml fields:**

```yaml
id: cageerf
name: C.A.G.E.E.R.F Framework
type: CAGEERF
version: '1.0.0'
enabled: true

systemPromptGuidance: |
  Apply the C.A.G.E.E.R.F framework systematically:

  **Context**: Establish comprehensive situational awareness and environmental factors
  **Analysis**: Apply structured, systematic examination of the problem or opportunity
  **Goals**: Define specific, measurable, actionable objectives with clear success criteria
  **Execution**: Develop practical, implementable approach with detailed action steps
  **Evaluation**: Create robust success metrics and assessment methods
  **Refinement**: Enable continuous improvement and iteration processes

gates:
  include:
    - framework-compliance

frameworkGates:
  - id: context_completeness
    name: Context Completeness
    description: Verify comprehensive situational context is established
    frameworkArea: Context
    priority: high
    validationCriteria:
      - Environmental factors identified
      - Stakeholders and constraints defined
      - Background information sufficient

  - id: analysis_depth
    name: Analysis Depth
    description: Ensure systematic and thorough analytical approach
    frameworkArea: Analysis
    priority: high
    validationCriteria:
      - Multiple perspectives considered
      - Root cause analysis performed
      - Data and evidence evaluated

templateSuggestions:
  - section: system
    type: addition
    description: Add framework guidance
    content: Apply the C.A.G.E.E.R.F framework systematically.
    frameworkJustification: Ensures systematic application of principles
    impact: high

frameworkElements:
  requiredSections:
    - Context
    - Analysis
    - Goals
    - Execution
  optionalSections:
    - Evaluation
    - Refinement
  sectionDescriptions:
    Context: Establish situational awareness and environmental factors
    Analysis: Systematic examination of the problem or opportunity
    Goals: Clear, specific, measurable objectives
    Execution: Actionable steps and implementation approach

argumentSuggestions:
  - name: context
    type: string
    description: Situational context and background information
    frameworkReason: Context phase requires clear situational awareness
    examples:
      - business context
      - technical environment
```

**phases.yaml fields:**

```yaml
phases:
  - id: context_establishment
    name: Context Establishment
    description: Establish clear situational context and environmental awareness

processingSteps:
  - id: context_establishment
    name: Context Establishment
    description: Establish clear situational context and environmental awareness
    frameworkBasis: CAGEERF Context phase
    order: 1
    required: true
    marker: '## Context'
    assertions:
      required: true
      min_length: 50
      contains_any: ['situation', 'background', 'environment', 'context', 'stakeholder']

  - id: systematic_analysis
    name: Systematic Analysis
    description: Apply structured analytical approach to the problem
    frameworkBasis: CAGEERF Analysis phase
    order: 2
    required: true
    marker: '## Analysis'
    assertions:
      required: true
      min_length: 100
      contains_any: ['analyze', 'examine', 'investigate', 'assess', 'evaluate']
      forbids: ['TODO', 'TBD', 'placeholder']

executionSteps:
  - id: context_analysis
    name: Context Analysis
    action: Analyze situational context and environmental factors
    frameworkPhase: Context
    dependencies: []
    expected_output: Comprehensive situational understanding

  - id: systematic_examination
    name: Systematic Examination
    action: Apply structured analytical approach
    frameworkPhase: Analysis
    dependencies:
      - context_analysis
    expected_output: Detailed problem or opportunity analysis

templateEnhancements:
  systemPromptAdditions:
    - Apply framework systematically
    - Begin with contextual establishment
    - Follow structured analytical approach
  userPromptModifications:
    - Structure response using framework phases
    - Provide explicit reasoning for each phase
  contextualHints:
    - Consider environmental factors and constraints
    - Apply systematic thinking to complex problems

executionFlow:
  preProcessingSteps:
    - Validate context completeness
    - Confirm analytical scope is defined
  postProcessingSteps:
    - Review phase coverage
    - Assess goal achievement potential
  validationSteps:
    - Context adequacy check
    - Analysis depth validation

qualityIndicators:
  context:
    keywords:
      - context
      - situation
      - background
      - environment
    patterns:
      - stakeholder|environment|constraint|factor
      - background|history|situation
  analysis:
    keywords:
      - analyze
      - examine
      - investigate
      - assess
    patterns:
      - systematic|structured|methodical
      - root.{0,10}cause|underlying|fundamental
```

---

## Schema Reference

### framework.yaml Fields

| Field                    | Type   | Required | Description                               |
| ------------------------ | ------ | -------- | ----------------------------------------- |
| `id`                     | string | Yes      | Lowercase-hyphenated identifier           |
| `name`                   | string | Yes      | Human-readable name                       |
| `system_prompt_guidance` | string | Yes      | Multiline guidance with **Phase**: format |
| `phases`                 | array  | Yes      | Phase definitions (min 2)                 |
| `gates`                  | object | No       | `{include: string[], exclude?: string[]}` |
| `framework_gates`        | array  | No       | Quality gates with validationCriteria     |
| `template_suggestions`   | array  | No       | Prompt enhancement hints                  |
| `framework_elements`     | object | No       | Required/optional sections                |
| `argument_suggestions`   | array  | No       | Suggested arguments                       |
| `judge_prompt`           | string | No       | Judge prompt content for %judge modifier  |

### phases.yaml Fields

| Field                   | Type   | Description                                    |
| ----------------------- | ------ | ---------------------------------------------- |
| `processing_steps`      | array  | Steps with order, required, frameworkBasis     |
| `execution_steps`       | array  | Steps with dependencies, expected_output       |
| `template_enhancements` | object | systemPromptAdditions, userPromptModifications |
| `execution_flow`        | object | pre/post processing hooks                      |
| `quality_indicators`    | object | Keywords/patterns for compliance detection     |

### Processing Step Assertion Fields (Optional)

Processing steps can include `marker` + `assertions` for deterministic output verification. When present, Stage 09b evaluates the LLM's response against these rules after execution — no LLM cost, instant feedback.

| Field        | Type   | Description                                          |
| ------------ | ------ | ---------------------------------------------------- |
| `marker`     | string | Markdown header to detect (e.g., `"## Context"`)     |
| `assertions` | object | Validation rules applied to the section under marker |

**Assertion rules** (all optional, combine as needed):

| Rule              | Type     | Description                                      |
| ----------------- | -------- | ------------------------------------------------ |
| `required`        | boolean  | Section must exist in the response               |
| `min_length`      | number   | Minimum character count for section content      |
| `max_length`      | number   | Maximum character count for section content      |
| `contains_any`    | string[] | Section must include at least one of these terms |
| `contains_all`    | string[] | Section must include all of these terms          |
| `matches_pattern` | string   | Regex pattern the section content must match     |
| `forbids`         | string[] | Terms that must NOT appear in the section        |

**Rules**: `marker` is required when `assertions` is present. `marker` without `assertions` generates a validation warning.

---

## Your Task

Based on **{{name}}** with concept "{{concept}}":

1. **Design phases** ({% if phase_count %}{{phase_count}}{% else %}5-7{% endif %} phases) forming a coherent framework
2. **Write system_prompt_guidance** with `**PhaseName**: description` format
3. **Define framework_gates** with validationCriteria for each phase
4. **Create processing_steps** with order, required, frameworkBasis, marker, and assertions
5. **Create execution_steps** with dependencies and expected_output
6. **Add assertions** to required processing steps: `marker` for section detection + `assertions` for deterministic checks (required, min_length, contains_any, forbids)

---

## How to Create the Framework

Make a **second `prompt_engine` call** to `>>create_framework` with all fields in the `options` parameter. The script tool will automatically detect the schema match and create the framework files.

**Example call:**

```text
prompt_engine(
  command: ">>create_framework",
  options: {
    "id": "your-framework-id",
    "name": "Your Framework Name",
    "system_prompt_guidance": "Apply the framework...\n\n**Phase1**: Description\n**Phase2**: Description",
    "phases": [...],
    "framework_gates": [...],
    "processing_steps": [...],
    "execution_steps": [...],
    ... other optional fields
  }
)
```

---

## 5-Tier Completeness Requirements (100% Required)

Framework creation requires 100% score. All 5 tiers must be complete.

### Tier 1: Foundation (30%)

| Field                    | Type    | Requirement                                     |
| ------------------------ | ------- | ----------------------------------------------- |
| `id`                     | string  | Lowercase-hyphenated identifier                 |
| `name`                   | string  | Human-readable name                             |
| `type`                   | string  | Framework type identifier (e.g., "MYFRAMEWORK") |
| `version`                | string  | Semantic version (e.g., "1.0.0")                |
| `enabled`                | boolean | Set to `true`                                   |
| `system_prompt_guidance` | string  | ≥100 chars with `**PhaseName**:` format         |
| `phases`                 | array   | ≥2 phases, each with `{id, name, description}`  |

### Tier 2: Quality Validation (20%)

| Field             | Type   | Requirement                                           |
| ----------------- | ------ | ----------------------------------------------------- |
| `framework_gates` | array  | ≥2 gates, each with ≥2 `validationCriteria`           |
| `gates`           | object | `{include: ["framework-compliance"]}` with ≥1 gate ID |

### Tier 3: Authoring Support (25%)

| Field                  | Type   | Requirement                                     |
| ---------------------- | ------ | ----------------------------------------------- |
| `framework_elements`   | object | `requiredSections` ≥2, `sectionDescriptions` ≥3 |
| `argument_suggestions` | array  | ≥2 args with `frameworkReason`                  |
| `template_suggestions` | array  | ≥1 with `frameworkJustification`                |

### Tier 4: Execution (15%)

| Field              | Type  | Requirement                                                          |
| ------------------ | ----- | -------------------------------------------------------------------- |
| `processing_steps` | array | ≥3 steps with `order` and `frameworkBasis`                           |
| `processing_steps` | —     | Required steps should include `marker` + `assertions` for validation |
| `execution_steps`  | array | ≥3 steps with `dependencies` and `expected_output`                   |

### Tier 5: Advanced (10%)

| Field                | Type   | Requirement                                                       |
| -------------------- | ------ | ----------------------------------------------------------------- |
| `tool_descriptions`  | object | ≥1 tool override                                                  |
| `quality_indicators` | object | ≥2 phases with `keywords` and `patterns`                          |
| `execution_flow`     | object | `preProcessingSteps`, `postProcessingSteps`, or `validationSteps` |
| `judge_prompt`       | string | Judge prompt content for `%judge` modifier                        |

---

## JSON Structure Reference

```json
{
  "id": "<lowercase-hyphenated>",
  "name": "<Human Readable Name>",
  "system_prompt_guidance": "Apply the <NAME> framework systematically:\n\n**Phase1**: Description\n**Phase2**: Description\n...",
  "phases": [
    { "id": "phase_1_snake", "name": "Phase 1 Name", "description": "What this phase accomplishes" }
  ],
  "gates": {
    "include": ["framework-compliance"]
  },
  "framework_gates": [
    {
      "id": "phase_1_quality",
      "name": "Phase 1 Quality",
      "description": "Verify phase 1 requirements are met",
      "frameworkArea": "Phase1",
      "priority": "high",
      "validationCriteria": ["Criteria 1", "Criteria 2"]
    }
  ],
  "processing_steps": [
    {
      "id": "phase_1_processing",
      "name": "Phase 1 Processing",
      "description": "Process phase 1 requirements",
      "frameworkBasis": "<NAME> Phase 1",
      "order": 1,
      "required": true,
      "marker": "## Phase 1",
      "assertions": {
        "required": true,
        "min_length": 50,
        "contains_any": ["keyword1", "keyword2"]
      }
    }
  ],
  "execution_steps": [
    {
      "id": "phase_1_execution",
      "name": "Phase 1 Execution",
      "action": "Execute phase 1 activities",
      "frameworkPhase": "Phase1",
      "dependencies": [],
      "expected_output": "Phase 1 deliverables"
    }
  ],
  "template_enhancements": {
    "systemPromptAdditions": ["Apply framework systematically"],
    "userPromptModifications": ["Structure response using phases"],
    "contextualHints": ["Consider constraints and factors"]
  },
  "execution_flow": {
    "preProcessingSteps": ["Validate prerequisites"],
    "postProcessingSteps": ["Review phase coverage"],
    "validationSteps": ["Check phase completeness"]
  },
  "quality_indicators": {
    "phase_1": {
      "keywords": ["keyword1", "keyword2"],
      "patterns": ["pattern1|pattern2"]
    }
  },
  "template_suggestions": [
    {
      "section": "system",
      "type": "addition",
      "description": "Add framework guidance to system prompt",
      "content": "Apply framework systematically",
      "frameworkJustification": "Ensures consistent application",
      "impact": "high"
    }
  ],
  "framework_elements": {
    "requiredSections": ["Phase1", "Phase2"],
    "optionalSections": ["Phase3"],
    "sectionDescriptions": {
      "Phase1": "First phase description",
      "Phase2": "Second phase description"
    }
  },
  "argument_suggestions": [
    {
      "name": "context",
      "type": "string",
      "description": "Background context",
      "frameworkReason": "Phase 1 requires clear context",
      "examples": ["business context", "technical environment"]
    }
  ],
  "execution_type_enhancements": {
    "chain": {
      "advancedChain": {
        "phase_1_execution": ["Design workflow states", "Define decision points"]
      },
      "simpleChain": {
        "phase_1_execution": ["Define sequential dependencies"]
      }
    }
  },
  "tool_descriptions": {
    "prompt_engine": {
      "description": "🚀 PROMPT ENGINE [YOUR_FRAMEWORK]: Custom description",
      "parameters": {
        "command": "Custom parameter guidance"
      }
    }
  },
  "judge_prompt": "You are evaluating compliance with YOUR_FRAMEWORK framework..."
}
```

**Requirements:**

- Phase IDs: snake_case (e.g., `context_establishment`)
- System prompt guidance: Use `**PhaseName**: description` format
- framework_gates: One per major phase with `validationCriteria` array
- processing_steps: Ordered with `frameworkBasis` linking to phase
- processing_steps: Include `marker` + `assertions` for deterministic phase verification (at least on required phases)
- execution_steps: With `dependencies` array (empty for first step)

{% endif %}
