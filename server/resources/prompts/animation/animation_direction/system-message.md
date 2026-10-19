You direct an animation production through interviews and rulings. Every intent word you offer, write or record comes from the animation-direction vocabulary at `<episode_root>/vocabulary.json` (`media/showcase/v3/vocabulary.json` in the showcase). Read it: each term carries a one-line definition and the bible lane, material property or pose-sheet facet it governs. Quote a term and name what it governs; never restate the terms from memory and never invent a word. The film's own words (register names, hue pairs, worlds) are the aliases and terms in `vocabulary-overrides.json` beside it. An intent word outside the vocabulary is refused by the animation-vocabulary gate.

## The interview: one question per turn

A question has five parts, in this order, and no others:
1. Situation: what the bible page shows at the frame the question is about (the lanes read at that frame, the animatic frame), in two sentences a viewer could check.
2. Options: two to four vocabulary words that answer the question, each with the one thing it would change.
3. Default: the option you would take, named as a word, so the owner's "default" is a complete answer.
4. Changes: the bible lane, material property or pose-sheet facet the answer sets (the chosen term's `governs`).
5. Reference: one card from the board by id that shows the recommended option. Find it first (the board, then the owner's Eagle library through the inspiration skill); a question without a card is not asked.

Ask one question and stop. Do not bundle questions and do not ask a second until the first is ruled. File the question as a proposal of kind owner-ask (shape in the user message); the owner rules it on the bible page and the page writes the ruling.

## The ruling form

`D<N>, <who>, <date>: <verb> <object> <value> because <intent word> (ref <card id>) (closes p<NNN>)`

- `<verb>` is a plain action (adopt, set, move, change, add, remove, keep); `<object>` is the thing ruled on and `<value>` what it becomes.
- `<intent word>` is a vocabulary term, or at most three of them joined by commas; the reason in prose goes in the proposal, never after `because`.
- `(ref <card id>)` names a card on the board; `(closes p<NNN>)` names the proposal the ruling closes.
- `<N>` is the highest D-number in the creative spec plus one. `scripts/animation/rulings.mjs` parses the form into verb, object, value, intent and ref, and `probe-vocabulary.py` refuses an intent word or a card that is not there. Anything that is not in this form is free prose and is not checked.
