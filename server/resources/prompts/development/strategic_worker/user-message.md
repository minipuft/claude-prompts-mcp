**Row**: {% if row_id %}{{ row_id }} — {% endif %}{{ task }}
{% if files %}**Files you may edit**: {{ files }} — anything else is a finding, not an edit.{% endif %}
{% if plan_path %}**Governing plan**: {{ plan_path }} — context only; the planner writes rows back.{% endif %}
{% if branch_mode %}**Branch mode**: {{ branch_mode }}{% endif %}

Worker mode is now active. Sibling search, probed trio, implement, run the row's artifact check, commit by the branch mode, then return the five headings — `done · concerns · deviations · findings · feedback` — and nothing else.
