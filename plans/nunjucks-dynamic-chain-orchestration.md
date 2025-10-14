# Nunjucks Dynamic Chain Orchestration - Comprehensive Implementation Plan

**Created**: 2025-10-05
**Status**: Planning
**Priority**: High - Strategic Architecture Enhancement
**Impact**: Enables result-based adaptive prompts, quality-driven chains, dynamic execution flows

## Executive Summary

**Critical Discovery**: Nunjucks templates render on EACH chain step with access to previous step results. This enables powerful result-based conditional logic and adaptive prompt instructions that we're currently not leveraging.

**Core Opportunity**: Transform static chain steps into intelligent, adaptive prompts that modify their behavior based on:
- Previous step quality scores
- Validation results from earlier steps
- Accumulated complexity metrics
- Error conditions and recovery needs
- Content characteristics discovered during execution

**Strategic Goal**: Build a sophisticated chain orchestration system where prompts intelligently adapt their instructions, depth, and approach based on runtime results.

---

## Table of Contents

1. [Current State Analysis](#current-state-analysis)
2. [Nunjucks Capabilities in Chains](#nunjucks-capabilities-in-chains)
3. [Result-Based Conditional Patterns](#result-based-conditional-patterns)
4. [Quality-Driven Adaptive Prompts](#quality-driven-adaptive-prompts)
5. [Implementation Strategy](#implementation-strategy)
6. [Example Transformations](#example-transformations)
7. [Best Practices & Patterns](#best-practices--patterns)
8. [Performance Considerations](#performance-considerations)
9. [Future Enhancements](#future-enhancements)

---

## Current State Analysis

### What We Have Now

**Chain Execution Flow (Actual)**:
```
Step 1: analysis_step
  → Load template "analysis_step.md"
  → Render with Nunjucks (variables: {input: "user data"})
  → Execute with LLM
  → Output: {analysis: "detailed analysis", confidence: 0.85}

Step 2: validation_step
  → Load template "validation_step.md"
  → Render with Nunjucks (variables: {
      analysis: "detailed analysis",
      confidence: 0.85,
      quality_threshold: 0.8
    })
  → Execute with LLM
  → Output: {validation_score: 0.6, issues: ["accuracy", "citations"]}

Step 3: refinement_step
  → Load template "refinement_step.md"
  → Render with Nunjucks (variables: {
      analysis: "detailed analysis",
      validation_score: 0.6,
      issues: ["accuracy", "citations"]
    })
  → Execute with LLM
  → Output: {refined_analysis: "improved analysis"}
```

**Key Insight**: Each step receives ALL previous step outputs as variables!

### What We're NOT Using

**Current Prompt Pattern** (Passive):
```markdown
# Refinement Step

Refine this analysis: {{analysis}}

Previous validation score: {{validation_score}}
Issues identified: {{issues}}

Please improve the analysis addressing the identified issues.
```

**What Nunjucks Enables** (Active):
```markdown
# Refinement Step

Refine this analysis: {{analysis}}

{% if validation_score < 0.7 %}
## ⚠️ CRITICAL QUALITY ISSUES DETECTED

Validation Score: {{validation_score}} (Target: ≥0.80)

### Priority Issues Requiring Immediate Attention:
{% for issue in issues %}
- **{{issue}}**: Apply comprehensive remediation
{% endfor %}

### Enhanced Refinement Protocol:
1. **Evidence Strengthening**: Add authoritative citations for all claims
2. **Accuracy Verification**: Cross-reference facts against reliable sources
3. **Clarity Enhancement**: Restructure unclear sections with examples
4. **Completeness Check**: Address all gaps identified in validation
5. **Quality Validation**: Self-assess against original standards

**Target Outcome**: Achieve validation score ≥0.80 with zero critical issues.

{% elif validation_score < 0.9 %}
## Moderate Improvement Required

Validation Score: {{validation_score}} (Good, targeting excellence)

### Issues to Address:
{% for issue in issues %}
- {{issue}}
{% endfor %}

Apply targeted refinements:
- Enhance clarity where needed
- Add supporting examples for complex concepts
- Strengthen key arguments with additional evidence

{% else %}
## Excellent Quality - Final Polish

Validation Score: {{validation_score}} (Excellent!)

Apply publication-ready polish:
- Fine-tune language for professional tone
- Ensure consistent terminology
- Add visual formatting enhancements
- Optimize for reader comprehension

{% endif %}

---

**Original Analysis:**
{{analysis}}

**Refinement Instructions**: Focus your improvements based on the quality level indicated above.
```

**The Difference**:
- **Passive**: LLM sees data, decides what to do
- **Active**: Template provides specific, quality-appropriate instructions

---

## Nunjucks Capabilities in Chains

### 1. Result-Based Conditionals

**Access Previous Step Outputs**:
```nunjucks
{% if previous_step_output.contains("error") %}
  {# Error handling instructions #}
{% elif previous_step_output.quality_score < threshold %}
  {# Quality improvement instructions #}
{% else %}
  {# Standard processing instructions #}
{% endif %}
```

**Available in Step Context**:
- All outputs from previous steps (mapped by outputMapping)
- Original input variables
- Chain configuration parameters
- Step execution metadata

### 2. Complexity-Driven Adaptation

**Calculate from Accumulated State**:
```nunjucks
{% set total_items = sources|length + topics|length + constraints|length %}
{% set complexity_level = "low" %}
{% if total_items > 20 %}
  {% set complexity_level = "maximum" %}
{% elif total_items > 10 %}
  {% set complexity_level = "high" %}
{% elif total_items > 5 %}
  {% set complexity_level = "standard" %}
{% endif %}

{% if complexity_level == "maximum" %}
## 🔥 MAXIMUM COMPLEXITY ANALYSIS REQUIRED

With {{total_items}} factors to consider, apply systematic framework:

### Phase 1: Categorization
- Group sources by type and relevance
- Map topic relationships and dependencies
- Prioritize constraints by impact

### Phase 2: Deep Analysis
[Detailed complex analysis instructions...]

### Phase 3: Synthesis
[Complex synthesis instructions...]

{% elif complexity_level == "high" %}
## ⚡ HIGH COMPLEXITY ANALYSIS

{{total_items}} factors identified. Apply structured analysis:
[Moderate complexity instructions...]

{% else %}
## 📊 STANDARD ANALYSIS

Focus on core insights from {{total_items}} key factors:
[Simple analysis instructions...]

{% endif %}
```

### 3. Quality-Based Instruction Customization

**Adapt Depth Based on Previous Quality**:
```nunjucks
{% if step2_quality_score > 0.9 %}
  {# High quality - proceed with advanced analysis #}
  Apply sophisticated analytical frameworks and advanced methodologies...

{% elif step2_quality_score > 0.7 %}
  {# Moderate quality - provide structured guidance #}
  Follow this systematic approach to build upon the foundation...

{% else %}
  {# Low quality - provide detailed step-by-step instructions #}
  Use this detailed framework with explicit examples at each step...

{% endif %}
```

### 4. Error Recovery and Adaptive Routing

**Handle Validation Failures**:
```nunjucks
{% if validation_result.passed == false %}

## 🚨 VALIDATION FAILURE - RECOVERY MODE ACTIVATED

**Failed Checks**:
{% for check in validation_result.failed_checks %}
- {{check.name}}: {{check.reason}}
{% endfor %}

### Recovery Protocol:

{% if "accuracy" in validation_result.failed_checks|map(attribute='name') %}
**Accuracy Issues Detected**
1. Verify all factual claims against authoritative sources
2. Remove or qualify uncertain statements
3. Add citations for key claims
{% endif %}

{% if "completeness" in validation_result.failed_checks|map(attribute='name') %}
**Completeness Issues Detected**
1. Review requirements checklist: {{validation_result.requirements}}
2. Identify and address gaps
3. Ensure comprehensive coverage
{% endif %}

[Additional recovery instructions based on specific failures...]

{% else %}
  {# Validation passed - proceed normally #}
{% endif %}
```

### 5. Accumulated State Tracking

**Use History from Multiple Steps**:
```nunjucks
{# Step 5 has access to outputs from Steps 1-4 #}

{% if step1_analysis.insights|length > 10 and step3_validation.score > 0.8 %}
  {# High quality, rich content - apply advanced synthesis #}
{% elif step2_research.sources|length < 3 %}
  {# Limited sources - acknowledge and adapt #}
  Note: Analysis based on {{step2_research.sources|length}} sources.
  Apply appropriate confidence qualifiers...
{% endif %}
```

---

## Result-Based Conditional Patterns

### Pattern 1: Quality Score Adaptation

**Use Case**: Adjust refinement depth based on validation results

**Chain Definition**:
```json
{
  "steps": [
    {
      "promptId": "initial_analysis",
      "outputMapping": {"analysis": "initial_output"}
    },
    {
      "promptId": "quality_validation",
      "inputMapping": {"content": "initial_output"},
      "outputMapping": {"score": "quality_score", "issues": "quality_issues"}
    },
    {
      "promptId": "adaptive_refinement",
      "inputMapping": {
        "original": "initial_output",
        "score": "quality_score",
        "issues": "quality_issues"
      }
    }
  ]
}
```

**Prompt Template** (`adaptive_refinement.md`):
```nunjucks
# Adaptive Refinement

Original Content: {{original}}
Quality Score: {{score}}

{% if score < 0.6 %}
## 🔴 COMPREHENSIVE REBUILD REQUIRED

Score: {{score}}/1.0 - Below acceptable threshold

### Critical Issues:
{% for issue in issues %}
- {{issue.category}}: {{issue.description}}
  **Action Required**: {{issue.remedy}}
{% endfor %}

### Rebuild Protocol:
1. Restart analysis from first principles
2. Apply rigorous methodology for each issue category
3. Implement all recommended remedies
4. Self-validate before submission

Expected Outcome: Achieve minimum score of 0.75

{% elif score < 0.8 %}
## 🟡 TARGETED IMPROVEMENTS NEEDED

Score: {{score}}/1.0 - Good foundation, needs enhancement

### Focus Areas:
{% for issue in issues %}
- {{issue.category}}: {{issue.description}}
{% endfor %}

### Improvement Strategy:
1. Address each issue systematically
2. Enhance clarity and supporting evidence
3. Strengthen weak areas identified above

Target Score: ≥0.85

{% else %}
## 🟢 MINOR REFINEMENTS

Score: {{score}}/1.0 - Excellent quality

Polish for publication:
- Fine-tune language precision
- Enhance readability and flow
- Add final professional touches

{% endif %}
```

### Pattern 2: Error-Driven Recovery

**Use Case**: Adapt to errors in previous steps

**Template Pattern**:
```nunjucks
{% if previous_error %}

## Error Recovery Mode

Error Type: {{previous_error.type}}
Error Message: {{previous_error.message}}

{% if previous_error.type == "missing_data" %}
### Data Recovery Strategy:
1. Identify alternative data sources
2. Proceed with available information
3. Clearly document limitations
4. Provide qualified conclusions

{% elif previous_error.type == "validation_failure" %}
### Validation Recovery:
1. Review failed validation criteria: {{previous_error.failed_criteria}}
2. Address each criterion systematically
3. Re-validate after corrections

{% elif previous_error.type == "timeout" %}
### Timeout Recovery:
Previous step timed out. Simplify approach:
1. Reduce scope to essential elements
2. Apply streamlined methodology
3. Focus on high-priority outputs

{% endif %}

{% else %}
  {# No error - proceed normally #}
  [Standard instructions]
{% endif %}
```

### Pattern 3: Complexity Escalation

**Use Case**: Increase analysis depth if initial attempt is insufficient

**Multi-Step Chain**:
```json
{
  "steps": [
    {"promptId": "quick_analysis", "outputMapping": {"result": "quick_result", "complexity": "detected_complexity"}},
    {"promptId": "assessment", "outputMapping": {"adequate": "is_sufficient"}},
    {"promptId": "deep_analysis_conditional", "inputMapping": {
      "quick_result": "quick_result",
      "adequate": "is_sufficient",
      "complexity": "detected_complexity"
    }}
  ]
}
```

**Template** (`deep_analysis_conditional.md`):
```nunjucks
{% if adequate == false or detected_complexity > 7 %}

## Deep Analysis Required

Initial analysis: {{quick_result}}
Complexity Level: {{detected_complexity}}/10
Assessment: Insufficient depth

### Enhanced Analysis Framework:

{% if detected_complexity > 8 %}
**MAXIMUM DEPTH ANALYSIS**
1. Multi-dimensional examination
2. Cross-referencing from multiple perspectives
3. Advanced pattern recognition
4. Predictive implications analysis

{% else %}
**STANDARD DEEP ANALYSIS**
1. Comprehensive examination
2. Relationship mapping
3. Implication analysis

{% endif %}

{% else %}

## Quick Analysis Sufficient

Initial result meets requirements:
{{quick_result}}

Apply minor enhancements only.

{% endif %}
```

### Pattern 4: Format Adaptation

**Use Case**: Change output format based on content characteristics

**Template**:
```nunjucks
{% set content_type = "unknown" %}
{% if "code" in step1_output or "function" in step1_output %}
  {% set content_type = "technical" %}
{% elif "story" in step1_output or "narrative" in step1_output %}
  {% set content_type = "narrative" %}
{% elif "data" in step1_output or "metric" in step1_output %}
  {% set content_type = "analytical" %}
{% endif %}

{% if content_type == "technical" %}
## Technical Documentation Format

Content: {{step1_output}}

Structure as:
- Code examples with syntax highlighting
- API reference format
- Technical specifications table

{% elif content_type == "narrative" %}
## Narrative Format

Content: {{step1_output}}

Structure as:
- Story-driven presentation
- Chronological flow
- Engaging narrative elements

{% elif content_type == "analytical" %}
## Analytical Report Format

Content: {{step1_output}}

Structure as:
- Executive summary
- Data visualizations
- Statistical analysis
- Recommendations

{% endif %}
```

---

## Quality-Driven Adaptive Prompts

### Architecture

**Quality Assessment → Adaptive Instructions → Validated Output**

```
┌─────────────────┐
│  Input Data     │
└────────┬────────┘
         ↓
┌─────────────────┐
│  Step 1:        │
│  Initial Work   │
└────────┬────────┘
         ↓
┌─────────────────┐
│  Step 2:        │
│  Quality Check  │
│  (outputs score)│
└────────┬────────┘
         ↓
┌─────────────────┐
│  Step 3:        │
│  Adaptive Work  │ ← Nunjucks adapts based on score!
│  {% if score %}│
└────────┬────────┘
         ↓
┌─────────────────┐
│  Final Output   │
└─────────────────┘
```

### Quality Metrics to Leverage

**Step Outputs Can Include**:
```json
{
  "content": "...",
  "quality_metrics": {
    "accuracy_score": 0.85,
    "completeness_score": 0.90,
    "clarity_score": 0.75,
    "overall_score": 0.83
  },
  "issues": [
    {"category": "accuracy", "severity": "medium", "location": "paragraph 3"},
    {"category": "clarity", "severity": "low", "location": "section 2"}
  ],
  "recommendations": ["add citations", "clarify terminology"]
}
```

**Template Uses Metrics**:
```nunjucks
{% if quality_metrics.accuracy_score < 0.8 %}
  Focus on accuracy: {{quality_metrics.accuracy_score}} below threshold
  Issues: {{issues|selectattr("category", "equalto", "accuracy")|list}}
{% endif %}

{% if quality_metrics.clarity_score < 0.8 %}
  Enhance clarity in: {{issues|selectattr("category", "equalto", "clarity")|map(attribute="location")|join(", ")}}
{% endif %}
```

### Adaptive Depth Control

**Example: Research Depth Based on Initial Findings**

```nunjucks
# Research Step

{% set initial_source_count = step1_output.sources|length %}
{% set initial_quality = step1_output.confidence %}

{% if initial_source_count < 3 or initial_quality < 0.7 %}

## 🔍 EXPANDED RESEARCH REQUIRED

Initial findings insufficient:
- Sources: {{initial_source_count}} (target: ≥5)
- Confidence: {{initial_quality}} (target: ≥0.80)

### Deep Research Protocol:
1. Expand source search to at least 5 authoritative references
2. Diversify source types (academic, industry, expert opinion)
3. Cross-validate findings across sources
4. Build comprehensive evidence base

{% else %}

## ✓ Standard Research Process

Initial findings provide solid foundation:
- Sources: {{initial_source_count}}
- Confidence: {{initial_quality}}

### Research Tasks:
1. Supplement existing findings
2. Fill identified gaps
3. Strengthen key conclusions

{% endif %}

Previous Findings: {{step1_output.summary}}

[Continue with research based on depth level indicated above]
```

---

## Implementation Strategy

### Phase 1: Identify High-Value Chains (Week 1)

**Audit Current Chains**:
1. Review existing chain prompts
2. Identify steps that could benefit from adaptation
3. Map current variable passing patterns
4. Document quality metrics already available

**Priority Candidates**:
- `noteIntegration.md` - 7 steps, quality-sensitive
- `create_docs_chain.md` - 5 steps, depth-variable
- `video_notes_enhanced.md` - 6 steps, content-adaptive

### Phase 2: Design Adaptive Patterns (Week 1-2)

**Create Pattern Library**:
1. **Quality-Based Adaptation**
   - Templates for score-driven instructions
   - Severity-based error handling
   - Validation-driven refinement

2. **Complexity-Based Adaptation**
   - Dynamic depth control
   - Resource allocation based on complexity
   - Methodology selection by difficulty

3. **Content-Based Adaptation**
   - Format selection based on content type
   - Structure adaptation to material
   - Example density based on technicality

### Phase 3: Implement Example Chains (Week 2-3)

**Transform Existing Chains**:

**Example 1: Note Integration Chain**

Current `obsidian_metadata_optimizer.md`:
```nunjucks
{{note_content}}
{{vault_structure}}
```

Enhanced with quality adaptation:
```nunjucks
{{note_content}}
{{vault_structure}}

{% if step3_refinement.quality_score %}
Quality from previous step: {{step3_refinement.quality_score}}

{% if step3_refinement.quality_score < 0.8 %}
**Enhanced Metadata Required**
Apply comprehensive metadata framework with:
- Extended tag hierarchy (minimum 10 tags)
- Full plugin integration metadata
- Detailed connection network (≥5 related notes)
- Advanced search keywords (≥15 terms)

{% else %}
**Standard Metadata**
Apply professional metadata standards.
{% endif %}

{% endif %}
```

**Example 2: Documentation Chain**

Transform `docs-review-refinement.md`:
```nunjucks
{% if step3_content.technical_depth %}

{% if step3_content.technical_depth == "advanced" and audience == "beginners" %}

## ⚠️ TECHNICAL DEPTH MISMATCH DETECTED

Content Complexity: Advanced
Target Audience: Beginners

### Adaptation Strategy:
1. Add explanatory sections for complex concepts
2. Include step-by-step walkthroughs
3. Provide glossary of technical terms
4. Add beginner-friendly examples
5. Create progressive disclosure sections (basic → advanced)

{% elif step3_content.technical_depth == "basic" and audience == "experts" %}

## ⚡ DEPTH ENHANCEMENT REQUIRED

Content Complexity: Basic
Target Audience: Experts

### Enhancement Strategy:
1. Add advanced implementation details
2. Include edge case discussions
3. Provide performance optimization guidance
4. Add architectural considerations
5. Include expert-level best practices

{% endif %}

{% endif %}
```

### Phase 4: Add Quality Metrics to Steps (Week 3-4)

**Enhance Validation Steps**:

Currently, validation steps might output:
```json
{"validated": true, "content": "..."}
```

Enhance to output:
```json
{
  "validated": true,
  "content": "...",
  "quality_score": 0.87,
  "accuracy_score": 0.90,
  "completeness_score": 0.85,
  "clarity_score": 0.85,
  "issues": [
    {"type": "clarity", "severity": "low", "description": "Section 3 could be clearer"}
  ],
  "recommendations": ["add example in section 3"],
  "metadata": {
    "word_count": 1500,
    "complexity_level": 7,
    "technical_terms": 45
  }
}
```

**Update Validation Prompts**:
Add structured output requirements to validation steps:
```markdown
Provide validation results in this structure:
- quality_score: Overall score 0-1
- accuracy_score: Factual accuracy 0-1
- completeness_score: Coverage completeness 0-1
- clarity_score: Clarity and readability 0-1
- issues: Array of specific issues with severity
- recommendations: Array of improvement suggestions
```

### Phase 5: Create Template Helpers (Week 4)

**Nunjucks Custom Filters**:

Add custom filters to `jsonUtils.ts` nunjucksEnv:
```typescript
nunjucksEnv.addFilter('quality_level', (score: number) => {
  if (score >= 0.9) return 'excellent';
  if (score >= 0.8) return 'good';
  if (score >= 0.7) return 'acceptable';
  return 'needs_improvement';
});

nunjucksEnv.addFilter('severity_icon', (severity: string) => {
  const icons = {
    'critical': '🔴',
    'high': '🟠',
    'medium': '🟡',
    'low': '🟢'
  };
  return icons[severity] || '⚪';
});

nunjucksEnv.addFilter('complexity_emoji', (level: number) => {
  if (level > 8) return '🔥';
  if (level > 5) return '⚡';
  return '📊';
});
```

**Usage in Templates**:
```nunjucks
Quality: {{quality_score|quality_level}}
Severity: {{issue.severity|severity_icon}} {{issue.description}}
Complexity: {{complexity_level|complexity_emoji}} Level {{complexity_level}}
```

### Phase 6: Testing & Refinement (Week 4-5)

**Test Matrix**:
```
Chain: noteIntegration
  Scenario 1: High quality input (score > 0.9)
    Expected: Standard processing
    Actual: [test result]

  Scenario 2: Medium quality (score 0.7-0.9)
    Expected: Targeted improvements
    Actual: [test result]

  Scenario 3: Low quality (score < 0.7)
    Expected: Comprehensive rebuild
    Actual: [test result]
```

**Validation**:
- Execute chains with varying quality inputs
- Verify conditional branches trigger correctly
- Ensure template variables accessible
- Confirm output meets quality targets

---

## Example Transformations

### Example 1: Simple → Adaptive Refinement

**Before** (`refinement_step.md`):
```markdown
# Refinement Step

Refine this analysis: {{analysis}}

Please improve the analysis based on validation feedback: {{validation_issues}}
```

**After**:
```nunjucks
# Adaptive Refinement Step

{% if validation_score < 0.6 %}
## 🔴 CRITICAL - COMPREHENSIVE REBUILD

Validation Score: {{validation_score}} (Critical)

### Failed Criteria:
{% for issue in validation_issues %}
- {{issue.criterion}}: {{issue.reason}}
  **Required Action**: {{issue.remedy}}
{% endfor %}

### Rebuild Protocol:
1. **Foundation Reset**: Restart analysis from core principles
2. **Systematic Remediation**: Address each failed criterion thoroughly
3. **Evidence Strengthening**: Add authoritative sources and citations
4. **Quality Verification**: Self-validate against all criteria before completion

**Success Target**: Achieve validation score ≥ 0.75 with zero critical issues

{% elif validation_score < 0.8 %}
## 🟡 MODERATE IMPROVEMENTS NEEDED

Validation Score: {{validation_score}} (Needs Enhancement)

### Issues to Address:
{% for issue in validation_issues %}
- **{{issue.criterion}}**: {{issue.reason}}
{% endfor %}

### Targeted Improvement Strategy:
1. Address each issue systematically
2. Enhance supporting evidence and examples
3. Clarify ambiguous sections
4. Strengthen logical flow and argumentation

**Target**: Validation score ≥ 0.85

{% else %}
## 🟢 EXCELLENT - FINAL POLISH

Validation Score: {{validation_score}} (Excellent!)

{% if validation_issues|length > 0 %}
Minor refinements needed:
{% for issue in validation_issues %}
- {{issue.criterion}}: {{issue.reason}}
{% endfor %}
{% else %}
No issues identified - apply publication polish only.
{% endif %}

### Final Polish Checklist:
- ✨ Optimize language precision and clarity
- 📝 Ensure consistent terminology throughout
- 🎨 Enhance visual formatting and readability
- 🔍 Final proofreading pass

{% endif %}

---

**Original Analysis:**
{{analysis}}

**Instructions**: Apply refinements appropriate to the quality level indicated above. Focus on achieving target validation score with efficient, focused improvements.
```

**Impact**:
- ✅ Appropriate effort based on quality
- ✅ Specific, actionable instructions
- ✅ Clear success criteria
- ✅ Efficient resource utilization

### Example 2: Static → Content-Adaptive Format

**Before** (`final_output.md`):
```markdown
# Final Output

Create final documentation from: {{content}}

Target audience: {{audience}}
```

**After**:
```nunjucks
# Content-Adaptive Final Output

{% set content_characteristics = {
  'has_code': 'def ' in content or 'function ' in content or 'class ' in content,
  'has_data': 'metric' in content or 'statistics' in content or 'data' in content,
  'has_narrative': 'story' in content or 'experience' in content or 'journey' in content,
  'technical_level': step2_analysis.technical_level or 'medium'
} %}

## Format Selection

Content Type:
{% if content_characteristics.has_code %}**Technical/Code-Heavy**{% endif %}
{% if content_characteristics.has_data %}**Data/Analytical**{% endif %}
{% if content_characteristics.has_narrative %}**Narrative/Story-Driven**{% endif %}

Technical Level: {{content_characteristics.technical_level}}
Target Audience: {{audience}}

---

{% if content_characteristics.has_code and audience == 'developers' %}

## Technical Documentation Format

Structure the final output as:

### Code Reference Documentation
```
[Language] [Function/Class Name]

**Purpose**: [Clear description]

**Parameters**:
- param1 (type): description
- param2 (type): description

**Returns**: type and description

**Example Usage**:
```[language]
[working code example]
```

**Notes**: Implementation details, edge cases, performance considerations
```

Apply this structure to all code elements in: {{content}}

{% elif content_characteristics.has_data and audience in ['analysts', 'executives'] %}

## Analytical Report Format

Structure as:

### Executive Summary
[2-3 sentence overview of key findings]

### Key Metrics
| Metric | Value | Trend | Implication |
|--------|-------|-------|-------------|
[tabular data presentation]

### Detailed Analysis
[Section for each major finding with supporting data]

### Recommendations
[Actionable insights prioritized by impact]

{% elif content_characteristics.has_narrative or audience == 'general' %}

## Narrative Format

Structure with:

### Introduction
[Engaging opening that sets context]

### Story Arc
[Progressive narrative with clear flow]
- Context setting
- Challenge/opportunity
- Actions taken
- Results and outcomes
- Lessons learned

### Conclusion
[Memorable takeaway]

{% else %}

## Standard Documentation Format

### Overview
[High-level summary]

### Main Content
{{content}}

### Conclusion
[Key takeaways]

{% endif %}

---

**Source Content:** {{content}}

**Instructions**: Apply the format structure indicated above, adapting the content appropriately for the target audience and content type.
```

**Benefits**:
- ✅ Automatic format selection
- ✅ Audience-appropriate structure
- ✅ Content-type optimization
- ✅ Consistent quality across types

---

## Best Practices & Patterns

### 1. Progressive Instruction Clarity

**Pattern**: Increase instruction specificity as quality decreases

```nunjucks
{% if quality_score > 0.9 %}
  {# High quality: minimal, high-level guidance #}
  Polish to perfection.

{% elif quality_score > 0.7 %}
  {# Good quality: structured guidance #}
  1. Address these specific issues: {{issues}}
  2. Enhance clarity in sections X, Y
  3. Validate completion

{% else %}
  {# Low quality: detailed step-by-step #}
  Follow this detailed protocol:

  Step 1: Foundation Analysis
    1.1. Review core requirements: {{requirements}}
    1.2. Identify gaps in current version
    1.3. Document specific deficiencies

  Step 2: Systematic Remediation
    2.1. For each deficiency:
        a) Root cause analysis
        b) Evidence-based solution
        c) Implementation
        d) Validation

  Step 3: Quality Verification
    [Detailed verification checklist]
{% endif %}
```

### 2. Error Context Preservation

**Pattern**: Carry error context through recovery steps

```nunjucks
{% if previous_error %}

  ## Error Recovery Context

  **Original Error**: {{previous_error.message}}
  **Failed Step**: {{previous_error.step_name}}
  **Attempt Number**: {{previous_error.attempt_count}}

  {% if previous_error.attempt_count > 2 %}
    **ALERT**: Multiple failures detected. Applying simplified approach.
    {# Provide more guided, conservative instructions #}
  {% else %}
    **Retry Strategy**: Address specific error cause
    {# Standard recovery #}
  {% endif %}

{% endif %}
```

### 3. Metric-Driven Branching

**Pattern**: Use multiple metrics for nuanced decisions

```nunjucks
{% set needs_accuracy_work = accuracy_score < 0.8 %}
{% set needs_clarity_work = clarity_score < 0.8 %}
{% set needs_completeness_work = completeness_score < 0.8 %}

{% if needs_accuracy_work and needs_clarity_work and needs_completeness_work %}
  ## Comprehensive Improvement Required (All Areas)
  [Instructions covering all three dimensions]

{% elif needs_accuracy_work %}
  ## Focus: Accuracy Enhancement
  [Accuracy-specific instructions]

{% elif needs_clarity_work %}
  ## Focus: Clarity Improvement
  [Clarity-specific instructions]

{% elif needs_completeness_work %}
  ## Focus: Completeness
  [Completeness-specific instructions]

{% else %}
  ## Minor Polish Only
  [Light refinement instructions]
{% endif %}
```

### 4. Accumulated State Patterns

**Pattern**: Use state from multiple previous steps

```nunjucks
{# Step 4 references Steps 1, 2, and 3 #}

{% set initial_complexity = step1_analysis.complexity_level %}
{% set research_depth = step2_research.source_count %}
{% set validation_passed = step3_validation.passed %}

{% if initial_complexity > 7 and research_depth < 5 %}

  ## ⚠️ Complexity-Research Mismatch

  Analysis Complexity: {{initial_complexity}}/10 (High)
  Research Depth: {{research_depth}} sources (Insufficient)

  **Action Required**: Expand research to match complexity
  - Target: Minimum {{initial_complexity}} authoritative sources
  - Diversify: Include academic, industry, and expert perspectives

{% elif not validation_passed and research_depth > 10 %}

  ## ⚠️ Quality Issue Despite Deep Research

  Research Sources: {{research_depth}} (Extensive)
  Validation: FAILED

  **Analysis**: Issue not lack of sources but synthesis quality
  **Action**: Focus on integration and analysis, not more research

{% endif %}
```

### 5. Self-Documenting Conditionals

**Pattern**: Make template logic self-explanatory

```nunjucks
{# DECISION POINT: Determine refinement approach based on validation #}
{% set quality_threshold_critical = 0.6 %}
{% set quality_threshold_target = 0.8 %}
{% set requires_rebuild = validation_score < quality_threshold_critical %}
{% set requires_enhancement = validation_score < quality_threshold_target and not requires_rebuild %}

{# BRANCH 1: Critical quality - rebuild from scratch #}
{% if requires_rebuild %}
  ## Critical Quality Issues (Score: {{validation_score}})
  [Rebuild instructions]

{# BRANCH 2: Moderate quality - targeted improvements #}
{% elif requires_enhancement %}
  ## Enhancement Required (Score: {{validation_score}})
  [Enhancement instructions]

{# BRANCH 3: Good quality - polish only #}
{% else %}
  ## Excellent Quality (Score: {{validation_score}})
  [Polish instructions]
{% endif %}
```

---

## Performance Considerations

### Template Rendering Performance

**Nunjucks Rendering Cost**:
- Variable substitution: ~1ms per 100 variables
- Simple conditionals: ~0.5ms per condition
- Loops: ~0.1ms per iteration
- Complex filters: ~1-5ms depending on operation

**Optimization Strategies**:

1. **Cache Template Objects**:
```typescript
// Already configured in jsonUtils.ts
const nunjucksEnv = nunjucks.configure(promptTemplatesPath, {
  noCache: process.env.NODE_ENV === "development", // Cache in production
});
```

2. **Minimize Loop Complexity**:
```nunjucks
{# AVOID: Nested loops with complex operations #}
{% for item in large_list %}
  {% for subitem in item.subitems %}
    {{ subitem|complex_filter|another_filter }}
  {% endfor %}
{% endfor %}

{# PREFER: Pre-process in JavaScript, simple loops #}
{% for processed_item in preprocessed_list %}
  {{ processed_item }}
{% endfor %}
```

3. **Conditional Short-Circuiting**:
```nunjucks
{# AVOID: Multiple expensive checks #}
{% if expensive_check_1() and expensive_check_2() and expensive_check_3() %}

{# PREFER: Check cheapest/most likely to fail first #}
{% if simple_check and moderate_check and expensive_check %}
```

4. **Variable Pre-Processing**:
```typescript
// In chain executor, before template rendering:
const templateVars = {
  ...stepOutputs,
  // Pre-calculate expensive derived values
  total_complexity: calculateComplexity(stepOutputs),
  quality_level: determineQualityLevel(stepOutputs.validation_score),
};
```

### Memory Considerations

**Template Variable Memory**:
- Each step can accumulate outputs from all previous steps
- Long chains (>10 steps) can grow context significantly
- Monitor memory usage in long-running chains

**Mitigation**:
```typescript
// Prune unnecessary data before passing to next step
const prunedOutputs = {
  // Keep only what next step needs
  summary: stepOutput.summary,
  quality_score: stepOutput.quality_score,
  issues: stepOutput.issues,
  // Omit large content that won't be used
  // detailed_content: stepOutput.detailed_content, // Skip if not needed
};
```

---

## Future Enhancements

### Phase 2: Dynamic Step Selection (Execution Engine)

**Beyond Nunjucks Capability** - Requires execution engine changes:

```json
{
  "steps": [
    {"id": "step1", "promptId": "analysis"},
    {
      "id": "step2_conditional",
      "conditionalBranch": {
        "condition": "step1.quality_score < 0.7",
        "ifTrue": {"promptId": "deep_analysis"},
        "ifFalse": {"promptId": "standard_refinement"}
      }
    }
  ]
}
```

### Phase 3: Recursive Step Execution

**Loop Until Quality Threshold**:

```json
{
  "steps": [
    {"id": "initial", "promptId": "draft"},
    {
      "id": "refine_loop",
      "promptId": "refinement",
      "loopCondition": {
        "maxIterations": 3,
        "exitWhen": "output.quality_score >= 0.8"
      }
    }
  ]
}
```

### Phase 4: LLM-Driven Chain Orchestration

**AI Decides Next Step**:

```typescript
// Execution engine asks LLM what to do next
const nextStepDecision = await llm.decide({
  prompt: "Based on these results, should we: A) Proceed to synthesis, B) Gather more research, C) Refine current analysis?",
  context: currentStepOutputs,
  options: ["synthesis", "research", "refinement"]
});
```

### Phase 5: Quality Gate Integration

**Automatic Quality Enforcement**:

```json
{
  "steps": [
    {"id": "step1", "promptId": "analysis"},
    {
      "id": "quality_gate",
      "type": "validation",
      "requirements": {
        "minimum_quality_score": 0.8,
        "required_fields": ["citations", "evidence"],
        "failureAction": "retry_previous_step"
      }
    }
  ]
}
```

---

## Implementation Checklist

### Week 1: Foundation
- [ ] Audit all existing chains
- [ ] Document current variable passing patterns
- [ ] Identify top 3 chains for enhancement
- [ ] Design adaptive pattern library
- [ ] Create Nunjucks filter helpers

### Week 2: Core Implementation
- [ ] Enhance quality validation steps with detailed metrics
- [ ] Transform 3 priority chains with adaptive templates
- [ ] Add quality-driven conditionals
- [ ] Implement complexity-based branching

### Week 3: Advanced Patterns
- [ ] Add error recovery patterns
- [ ] Implement content-type adaptation
- [ ] Create accumulated state patterns
- [ ] Build format selection logic

### Week 4: Testing & Documentation
- [ ] Test all adaptive chains with various inputs
- [ ] Validate conditional branches
- [ ] Document template patterns
- [ ] Create developer guide for adaptive prompts

### Week 5: Optimization
- [ ] Performance profiling
- [ ] Memory optimization
- [ ] Template caching validation
- [ ] Production readiness review

---

## Success Metrics

### Quantitative
- ✅ 5+ chains enhanced with adaptive templates
- ✅ 30%+ reduction in low-quality outputs requiring manual intervention
- ✅ Quality score improvement: average increase from 0.75 → 0.85+
- ✅ Template rendering performance: <50ms per step
- ✅ Zero template rendering errors in production

### Qualitative
- ✅ Chains intelligently adapt to quality levels
- ✅ Error recovery is automatic and effective
- ✅ Resource utilization is efficient (effort matches need)
- ✅ Developer understanding of adaptive patterns is high
- ✅ Template maintenance is straightforward

---

## Conclusion

**Key Insight**: Nunjucks templates in chain steps have access to all previous step results, enabling sophisticated result-based conditional logic and adaptive prompt instructions.

**Strategic Value**:
- **Intelligent Adaptation**: Prompts adjust behavior based on quality, complexity, and errors
- **Resource Efficiency**: Apply appropriate effort based on actual needs
- **Quality Assurance**: Automatic escalation when quality thresholds not met
- **Error Resilience**: Graceful recovery from validation failures

**Path Forward**:
1. Enhance validation steps to output detailed quality metrics
2. Transform existing chains with adaptive templates
3. Build pattern library for common adaptation scenarios
4. Extend to dynamic step selection in execution engine

**Ultimate Goal**: Self-optimizing chain orchestration where each step intelligently adapts based on runtime results, maximizing quality while minimizing unnecessary computation.

---

**Next Steps**: Begin Week 1 implementation with chain audit and pattern library design.

**Document Maintainer**: Architecture Team
**Last Updated**: 2025-10-05
**Review Frequency**: Bi-weekly during implementation, monthly thereafter
