{% set route = exit or 'interview' -%}
{% set stance = position or 'converging' -%}

# Interview — {{decision}}

## Context

**About to be built or decided**: {{decision}}

**Trigger**: `{{trigger}}` — {% if trigger == 'taste-word-becomes-mechanism' %}a taste or metaphor word is about to become a mechanism, and the word names a character the mechanism may not have.{% elif trigger == 'second-character-complaint' %}a second complaint about the same surface's character: the first fix tuned a dial, and the grade says the law is wrong.{% elif trigger == 'ambiguous-reference' %}a reference was named ambiguously, and different readings would build different things.{% elif trigger == 'open-fork' %}a muse or technique pass ended on a fork whose answer would change the build.{% elif trigger == 'self-authored-bound' %}a bound the planner wrote itself is about to be judged against the owner's grade.{% else %}a situation outside the five named triggers. State it in one line before the round.{% endif %}

**Operator position**: {{stance}}{% if not position %} (assumed, since none was stated){% endif %} — {% if stance == 'exploring' %}offer candidate rulings to react to rather than questions to answer. Every question put to an exploring operator is a hard stop.{% elif stance == 'committed' %}ask nothing. Record the rulings the stated position already implies, and flag any architecture or contract question it leaves unsettled.{% else %}ask the frontier.{% endif %}

**Exit**: `{{route}}`
{% if frontier %}

**Frontier already known** (complete it, do not discard it):

{{frontier}}
{% endif %}

## Analysis

1. Map the open decisions under "{{decision}}" as a design tree: every decision and the decisions that hang off it.
2. Split facts from decisions. A fact (repo, filesystem, docs, a measurement) becomes a probe the planner runs. List it under **Probes**, never in the round.
3. Compute the frontier: the decisions whose prerequisites are settled now. Any question that depends on an answer still open waits for a later round.
4. Classify each frontier question as architecture (priority 1), contract (2), scope (3) or taste (4).

## Goals

- The operator can rule on everything in one message, without opening a file.
- Every guess this decision rests on is surfaced before anything is built on it.
- The output is pasteable: a `rulings` block the planner copies into the plan's implementation notes{% if route != 'interview' %}, or the next prompt's arguments{% endif %}.

## Execution

{% if route == 'interview' %}

{% if stance == 'committed' %}Produce no questions. Go straight to the rulings block, deriving each ruling from the operator's stated position, and list any priority 1–2 decision the position does not settle under **Unsettled**.{% else %}Produce the round:

```
### Round <n>

1. <title> — class: <architecture|contract|scope|taste> · priority <1-4>
   <body: the concrete options where they are real>
   ➡ <recommended answer> — <why>
2. ...
```

{% if stance == 'exploring' %}Phrase every item as a **candidate ruling** ("D<n> would be: …"). The operator reacts to the list instead of answering questions one at a time.{% else %}Priority 1–2 items make up the round and need an explicit answer. Priority 3–4 items go under **Open** with a default and a flip condition, and silence accepts them.{% endif %}{% endif %}

Close with:

```
rulings:
  - D1 · <decision> · <answer> · <YYYY-MM-DD>
open:
  - <question> · Default: <answer> · flips when: <observation>
probes:
  - <fact the planner measures before the next round>
```

{% else %}

Ask no questions. This stop routes to `>>{{route}}`. Emit, in order:

1. **Why this exit**: one line on why an interview round would not settle this, and what `>>{{route}}` gives that a question cannot.
2. **Arguments** for the hand-off:
   {% if route == 'research_chain' %}
   - `topic`: the question the research must answer, drawn from "{{decision}}"
   - `purpose`: the ruling this research feeds, and which decision it unblocks
   - `constraints`: the envelope (codebase limits, sources in or out of scope, time)
     {% elif route == 'design_muse' %}
   - `challenge`: the surface and the experience sought, drawn from "{{decision}}"
   - `constraints`: the hard feasibility envelope the directions must stay inside
   - `mode`: `brainstorm`, so the result is throwaway cells to react to rather than a pick
     {% elif route == 'tech_recommendation' %}
   - `subject`: the technique or approach in question, drawn from "{{decision}}"
   - `context`: the project context plus the questions the recommendation must answer
     {% endif %}
3. **The ready command**: the full `>>{{route}} ...` invocation with the arguments filled in.
4. **Returns to**: which open decision the hand-off's result settles, so the next interview round can rule on it.
   {% endif %}

## Evaluation

- Does every numbered question carry ➡ a recommended answer and a class?
- Does any question in the round depend on another question in the same round? If so, move it to a later round.
- Was a fact put to the operator? If so, move it to **Probes**.
- Is every decision that needs a human stated in full here rather than referenced by id?

## Refinement

After the operator answers, settled decisions push the frontier outward. Recompute it and run the next round. Stop when the frontier is empty. Do not build on the rulings until the operator confirms shared understanding.
