Episode root: {{episode_root}}
Beat: {{beat}}
Frame: {{frame}}
Question for the owner: {{question}}

Read `{{episode_root}}/vocabulary.json` and `{{episode_root}}/vocabulary-overrides.json` (the words you may use), `{{episode_root}}/timeline.json` (the beat's frame range; the frame must sit inside it), `{{episode_root}}/screenplay.json` (the story point `sp-…` whose frame range holds the frame: the last one of the beat whose `frame` is at or before {{frame}}), `{{episode_root}}/bible.json` (what each lane says at that frame), `{{episode_root}}/references/board.json` (the cards) and the highest-numbered file in `{{episode_root}}/proposals/` (ids are never reused).

Put the question to the owner in the five parts of the interview form and no others: Situation (it starts with the story point id, `sp-<beat>.<n>`), Options (vocabulary words, each with the one thing it changes), Default, Changes (the lane or property, from the chosen term's `governs`), Reference (one card id). Then file it as one proposal, `{{episode_root}}/proposals/pNNN-<slug>.json`, where NNN is the highest existing number plus one and `<slug>` is the title in at most five kebab-case words, in this shape and no other:
```json
{
  "id": "pNNN",
  "kind": "owner-ask",
  "from": "director",
  "date": "<today, YYYY-MM-DD>",
  "anchor": {"beat": "{{beat}}", "frame": {{frame}}},
  "title": "<the decision, in a few words>",
  "text": "<the situation: starts with the story point id, then what the page shows at the frame, in reader voice>",
  "references": ["<card id>"],
  "intent": "<the vocabulary word you would write after because if the owner takes the default>",
  "options": ["<vocabulary word>", "<vocabulary word>"],
  "default": "<one of the options>",
  "changes": "<the lane, material property or facet the answer sets>",
  "before": {"note": "<what the page shows now>"},
  "after": {"note": "<what each option would make true, one clause per option>"},
  "status": "open",
  "ruling": null
}
```
`frame` is an episode frame inside the beat's start and end in `timeline.json`; the bible gate refuses a frame outside its beat. Do not edit an existing proposal. Then run `npm run bible` in the production root and `python3 scripts/animation/probe-vocabulary.py {{episode_root}}/vocabulary.json --overrides {{episode_root}}/vocabulary-overrides.json`; quote the pass line of each, or on a refusal quote the refused line, replace the refused word in your own proposal with a vocabulary term and run both again. Never edit the vocabulary or a probe to make it pass.

Return: Question (the five parts as the owner reads them, one short line each; the situation line starts with the story point id); Proposal (the JSON you filed and its path); Probe Lines (bible, vocabulary); Concerns.