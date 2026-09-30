**Row**: {% if row_id %}{{ row_id }} — {% endif %}{{ task }}
{% if files %}**Files you may edit**: {{ files }} — anything else is a finding, not an edit.{% endif %}
{% if plan_path %}**Governing plan**: {{ plan_path }} — context only; the planner writes rows back.{% endif %}
{% if branch_mode %}**Branch mode**: {{ branch_mode }}{% endif %}

Worker mode is now active. Sibling search, probed trio, implement, run the row's artifact check, commit by the branch mode, then return the five-heading work product — `done · concerns · deviations · findings · feedback`.

The authored heading format governs framework reasoning. When the brief requests a fenced `HANDOFF RESULT`/`node:` transport envelope, append the supplied block after `feedback`; it is mandatory and separate from the work product. Put any separately required protocol verdict line before that final envelope. Return no transcript or narration.
