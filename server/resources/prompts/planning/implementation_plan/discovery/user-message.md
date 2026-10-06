{% set f = ' ' + (feature|lower|replace('-',' ')|replace('/',' ')|replace(',',' ')|replace('.',' ')) + ' ' -%}
{% set is_design = design_mode == 'on' or (design_mode != 'off' and (
     'design' in f or 'visual' in f or 'shader' in f or 'animation' in f
     or 'theme' in f or 'aesthetic' in f or 'layout' in f or 'palette' in f
     or 'colour' in f or 'color' in f or 'artwork' in f or 'art direction' in f
     or ' ui ' in f or ' ux ' in f or ' css ' in f or ' art ' in f )) -%}

# Step 1: Discovery & Triage

## Feature

{{feature}}

{% if existing_systems %}

## Known Systems

{{existing_systems}}
{% endif %}

{% if tech_stack %}

## Tech Stack

{{tech_stack}}
{% endif %}

{% if research_focus %}

## Research Focus

{{research_focus}}

Research before auditing existing code:

- WebSearch for current best practices (≤3 searches)
- context7 for library documentation (≤2 lookups)
  {% endif %}

{% if is_design %}

## Design Enrichment (this is visual/creative/UI work)

This feature touches visual/creative/UI design. Alongside the codebase audit, run a creative research pass — this complements `research_focus`, it does not replace it. Keep this distinct from the architectural Design & Pre-flight step (step 2): that step designs _structure_; this enriches _visual/creative direction_.

- **Seek modern techniques & creative approaches** for the visual problem — pursue current patterns over dated defaults. Name the specific technique or aesthetic direction you are pursuing.
- **Seek libraries / docs / APIs for inspiration AND implementation**: invoke `/docs` (context7) to verify current API surfaces, and use web research to map the current technique/library landscape. Capture findings as **Decisions (chosen + rejected + why)** in `design_decisions` below — mirror the `research_decisions` shape, not a raw list of options.
- **Invoke the relevant creative skills by surface** (pick by relevance — do not run all): `/algorithmic-art`, `/frontend-design`, `/gpu-effects`, `/gsap-animation`, `/three-js`, `/react-best-practices`.
- **Evidence-based language**: prohibited 'best|optimal|faster|secure|always|never|guaranteed'; required 'may|could|typically|measured|documented'. Keep enrichment wording compliant.
  {% endif %}

## Instructions

Search the codebase for existing implementations related to this feature. Never skip discovery — sibling pattern search applies to all changes regardless of size.

{% if existing_systems %}Known systems provided above — use them as starting points, but still search for additional related code.{% else %}Start broad: search for the concept, then narrow to specific files and integration points.{% endif %}

## RESULT (Step 1 — discovery is not complete without this)

```
search_type   : [targeted | exploratory | dependency_trace]
queries_run   :
  - [tool] [query] → [what was found]
  - ...
sibling_patterns : [related implementations found | none found after searching: <queries>]
domain_ownership : [which module/service owns this area]

intent:
  work_type     : [feature | bug_fix | refactor | optimize]
  secondary     : [none | work_type]
  scope         : [specific files and modules affected]
  risk          : [low | medium | high: reason]
  external_deps : [none | lib@version list]
  problem       : [current state → desired state]
  next_phase    : [design | testing | search (if more discovery needed)]

{% if research_focus %}
research_decisions:
  | Decision | Chosen | Rejected | Why |
  |----------|--------|----------|-----|
  | ...      | ...    | ...      | ... |
{% endif %}
{% if is_design %}
design_decisions:
  | Decision | Chosen | Rejected | Why |
  |----------|--------|----------|-----|
  | [technique / library / API] | ... | ... | ... |
{% endif %}

confidence    : [high | medium | low]
uncertain     : [what's still unknown — required if not high]
```
