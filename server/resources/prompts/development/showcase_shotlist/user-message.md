Brief: {{brief}}
Constraints: {{constraints}}
Production root: {{output_root}}
Previous handoff:
{{context | default("Read v3/script.md and the story step's beats.json from chain history.")}}

Read `v3/script.md` (resource vocabulary, six beats), the story step's `beats.json`, `v3/creative-spec.md` (animation language: the camera is locked within a beat and moves at most once per beat; one actor at a time; one emitter per shot) and `v3/references/board.json` (card ids). Write `v3/shots.json`: an array of shots, each `{id, beat, title, frames:[start,end], camera, actors:[], emitter, join, objects:[], cards:[], measured:null}`. Rules: a shot is one locked camera; a cut starts a new shot; `frames` are provisional until a shot run writes `measured`; `cards` cite board card ids for the shot's look; `objects` lists every asset the shot needs in the resource vocabulary (box, bubble, gadget, frame, human, stalk, string, arch, patch, ring, companions). Then write the object inventory: every distinct object across shots, which has a muse sheet accepted (none at a clean slate), and the exact command to muse each: `>>showcase_asset_muse asset:"<object: its job>"`. The muse runs per object from this inventory, not inside this chain. Keep `script.md` the owner's text: do not rewrite beats, only reference them.

Return: Shot Table (id · beat · frames · camera · emitter · join · cards); Object Inventory With Muse Commands; Frame Total Versus Script; Concerns.