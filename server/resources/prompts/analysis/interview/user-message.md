{% set route = exit or 'interview' -%}
{% set stance = position or 'converging' -%}

# Interview — {{decision}}

## Context

**About to be built or decided**: {{decision}}

**Trigger**: `{{trigger}}` — {% if trigger == 'taste-word-becomes-mechanism' %}a taste or metaphor word is about to become a mechanism, and the word names a character the mechanism may not have.{% elif trigger == 'second-character-complaint' %}a second complaint about the same surface's character: the first fix tuned a dial, and the grade says the law is wrong.{% elif trigger == 'ambiguous-reference' %}a reference was named ambiguously, and different readings would build different things.{% elif trigger == 'open-fork' %}a muse or technique pass ended on a fork whose answer would change the build.{% elif trigger == 'self-authored-bound' %}a bound the planner wrote itself is about to be judged against the owner's grade.{% else %}a situation outside the five named triggers. State it in one line before the round.{% endif %}

**Operator position**: {{stance}}{% if not position %} (assumed, since none was stated){% endif %} — {% if stance == 'exploring' %}offer candidate rulings for reaction; ask focused consequential questions when needed.{% elif stance == 'committed' %}reuse explicit rulings; ask about consequential choices the position leaves unsettled.{% else %}ask only the consequential frontier left after probes and existing rulings.{% endif %}

**Exit**: `{{route}}`
{% if frontier %}

**Frontier already known** (complete it, do not discard it):

{{frontier}}
{% endif %}

## Analysis

1. Treat the signal as evidence-first analysis, not an automatic interview. Reuse explicit authorization and settled rulings under "{{decision}}".
2. Probe retrievable facts (repo, filesystem, docs, measurements) first. List remaining probes separately; a settled fact needs no human question.
3. Identify consequential choices still unresolved. One choice gets one focused question; multiple choices get a small frontier whose prerequisites are settled. Hold only dependent actions; continue independent authorized work.
4. Classify questions as architecture, contract, scope, or taste for context; any class can be consequential. A full grill is reserved for manual /grill-me or deep discovery.

## Goals

- The operator can rule on everything in one message, without opening a file.
- Consequential guesses are settled before dependent work; facts and answered decisions do not become redundant questions.
- The output is pasteable: a `rulings` block the planner copies into the plan's implementation notes{% if route != 'interview' %}, or the next prompt's arguments{% endif %}.

## Execution

{% if route == 'interview' %}

If probes and existing rulings settle the signal, produce no questions and proceed within authorization. Otherwise produce one focused question or a small frontier:

```
### Round <n>

1. <title> — class: <architecture|contract|scope|taste> · priority <1-4>
   <body: the concrete options where they are real>
   ➡ <recommended answer> — <why>
2. ...
```

{% if stance == 'exploring' %}Offer candidate rulings where useful for reaction.{% elif stance == 'committed' %}Preserve stated rulings; ask only consequential gaps still unresolved.{% endif %} Scope and taste may require an explicit answer. Silence or elapsed time never supplies a required answer or approval. State reversible, low-impact assumptions only where existing authorization covers proceeding.

Close with:

```
rulings:
  - D1 · <decision> · <answer> · <YYYY-MM-DD>
open:
  - <consequential question awaiting an explicit answer, or authorized low-impact assumption with flip condition>
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

After answers, recompute only the remaining consequential frontier. Proceed with authorized work once relevant decisions are settled; no redundant final shared-understanding confirmation. Preserve required consent and hold only dependent actions.
