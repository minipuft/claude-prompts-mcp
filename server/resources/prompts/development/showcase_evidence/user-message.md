Brief: {{brief}}
Shot: {{shot}}
Production root: {{output_root}}
Previous handoff (the review's receipt):
{{context | default("Read the review step from chain history; a missing receipt is BLOCKED.")}}

File the shot so the next run starts from it. Copy the rendered stills and strip from `out/` to `v3/studies/<shot>-<pass>/` unchanged, recording sha256 prefixes. Save the review's five-part receipt as `v3/studies/<shot>-<pass>.md`. Feed the script: set the shot's `measured` in `v3/shots.json` to the frame range and timing actually rendered and graded, and update only that beat's provisional frame range in `v3/script.md` with a dated note; never rewrite the owner's beat text. If the receipt's Owner section was answered, record the ruling in `v3/creative-spec.md` (next D number) and add or amend the board card it governs in `v3/references/board.json`, then run `npm run board`. Update the plan's `## Now` block with the pass. Every write is listed with its path; nothing is committed or pushed.

Return: Filed (paths, sha256 prefixes); Script Feed (shots.json and script.md deltas); Rulings Recorded; Board Rebuilt (yes/no); Concerns.