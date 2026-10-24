# owner-library-01 — reading the Eagle library `E:\Stable Diffusion.library` (2026-10-13)

Read directly from `/mnt/e/Stable Diffusion.library` (Eagle keeps one `metadata.json` per item, so no plugin is needed). Index: `v3/references/owner/eagle-index.json` (5,534 items, 139 in trash, 5,395 live). Sheets: `calarts-folder.png`, `unfiled-recent.png`, `unfiled-picks.png`, `sample-<facet>.png`. Nothing in the library was modified.

## How it is organised

Two axes, and an item is filed on both at once (multi-folder is the norm; 987 items carry only Eagle's automatic `Screenshot` tag, no hand tags; 77 annotations and all of them are Stable Diffusion prompts saved with the output).

| Axis | Folders | Count |
|---|---|---|
| Source | Movies (1,008: Spider-Verse, GotG 3, Avatar, Lily Chou-Chou, Eternal Sunshine, Cyborg; Shorts → CalArts 2025 ×18 films, Windshield Wiper, Go Fishboy), TV Shows (895: Arcane S1 by episode, Steven Universe, Smiling Friends, Downtown, Severance, Mr. Robot, The Boys, Squid Game), Videogames (730: Miles Morales, Stray, Ghost of Tsushima, Cyberpunk, BotW, Ena Dream BBQ, Poco, Hypergonia) | 2,633 |
| Facet | Composition (517), Character Design (515, with a Fashion Design → Designers tree: Walter Van Beirendonck, Y/Project, Yuima Nakazato, Professor-E, Flaneur, J-LA), Colors (310), Lighting (287), Architecture/Location (264), Atmosphere (161), Texture/Patterns (112) | 2,166 |
| People | Artwork → Directors (Kubrick, Wes Anderson, Satoshi Kon, Jodorowsky, Fincher), Cinematographers (Deakins, Toland), Artists (Miyazaki, Remedios Varo, Jochen Mühlenbrink, Basquiat, Dr. Seuss) | 393 |
| Own work | Personal Art (532: Silhouette Test, 4D Crowd Test, Graffiti Test, Style Test, Mind Eye, Brain Location), Artwork/Stable Diffusion (mine) | |

Reading: a source folder answers "where is this from", a facet folder answers "what do I want from it". When something is filed under Lighting + Colors + Composition it is a full-frame reference; a single facet means one property was the reason. The library name is the origin story: it started as a Stable Diffusion output and prompt archive and grew into a film reference library on top.

## The CalArts 2025 folder (258 frames, 18 films)

Most frames per film: THIS IS NOT AN EMERGENCY (26), family dinner (24), Sweet on You (23), Lulu Mckown (20). What the saved frames have in common, read off the sheet:

1. **One or two saturated colours per scene** as whole fields (magenta/teal, pink/green, orange/blue), the character as a flat silhouette inside the field.
2. **Screen-space light sources**: a lamp, a TV, a window, drawn as a flat glow shape with the character lit by it. This is our "radiance under assets" medium, already in the spec.
3. **Staging with the figure small** in a big graphic field, then a cut to a very close face.
4. Very few frames of fast action; the saves are composition and colour, not animation. The cadence measured in craft-ref-01 is the complementary half.

Eight items sit in the parent `CalArts 2025` folder that are not CalArts: Hi-Fi Rush character designs ×4, Boondocks Riley poster, a kick.com still. Guess: saved while that folder was selected. They belong under Videogames/Hi-Fi Rush (new) and TV Shows/Animation/The Boondocks (new).

## Unfiled (512 live), and why each cluster was probably saved

| Cluster | Items | Guess | Proposed folder |
|---|---|---|---|
| Work screenshots (terminals, dashboards, forms, Spotify, a certificate) | ~330 | not references; Eagle is the default screenshot sink | a `Scratch` folder, or delete |
| Boondocks: Huey/Riley model sheets, "Disegno del personaggio" tutorial sheet, Riley two-tone poster, Huey still (Jun–Aug 2026) | 7 | saved during this film's character work: a 2D show with a strong single-weight line and a model-sheet discipline, plus a two-tone poster as a silhouette test | TV Shows/Animation/The Boondocks + Character Design |
| Hercules (1997) Hades and the Styx boat, blue flame on black (2026-09-07, six frames in a minute) | 6 | black field with one coloured light source, exactly the medium | Movies/Hercules + Lighting |
| James Turrell ×3, Olafur Eliasson Weather Project, Guggenheim rotunda (Jun–Jul 2026) | 5 | light as a volume, one hue filling the frame, figures as silhouettes in it | Lighting + Atmosphere |
| SD output 2026-07-29 "celestial figure mid-turn on an S-curve, cloak thrown wide, glitter like a starfield" (prompt in the annotation) | 1 | the Cloak/Swoop figure before it had a name; the only unfiled item with a prompt | Personal Art + Character Design |
| Hair: spiky fan (@hair_mastery), Autumnandwinter, x_xzzin portraits | 4 | hair as a graphic shape, for the human's hair mass | Character Design/Hair |
| Downtown (MTV 1999) frame + IMDb | 2 | rough-line 2D with grounded acting; there is already a TV Shows/Animation/Downtown folder | that folder |
| Abstract liquid / TouchDesigner generative blobs | 3 | a soft-body look for a companion or the "boil" | Texture/Patterns or Atmosphere |
| Tristán (COLORS show), Tomb Raider, Squid Game stills, sneakers | ~10 | general, not for this film | their source folders |

## What this changes for the film

- The owner's own CalArts picks confirm the two-layer black-field medium and the two-colour scene rule; they argue for **colour scripts per shot** (one hue pair) as a spec item rather than a per-asset palette. Candidate D74.
- Boondocks and the model-sheet tutorial saves say the owner already wanted the D72 model sheet before it was ruled; line weight target stays single-weight.
- Turrell, Eliasson and Hercules are the strongest unfiled cluster: light as the subject, figure as silhouette. They belong on the board as cards (`board.json`) with provenance = Eagle item id.

## Open to the owner

1. Are the cluster guesses right? Any I should drop before they become board cards.
2. May I file the clusters in the Eagle library (writes `folders` into those items' metadata.json; Eagle picks it up on next launch), or do you file and I only propose?
3. Default: add the Turrell/Eliasson/Hercules/Boondocks items and 12 CalArts frames as board cards citing Eagle ids, no library writes.

## Addendum 2026-10-13 — synced board

Owner confirmed the cluster guesses and asked for a board that stays in sync. `~/.claude/skills/inspiration/scripts/eagle_board.py` (the global `/inspiration` skill; npm scripts here pass `--out v3/references/owner`) reads the library incrementally (Eagle's `mtime.json`, falling back to each item's file clock), keeps 220 px thumbnails under `references/owner/thumbs/`, and renders `eagle-board.html`: a source × facet matrix, a month strip, the folder tree with counts, the unfiled items grouped by the rules in `clusters.json`, search, a detail panel with `eagle://item/<id>` links, and film picks. Filters live in the URL hash, so a view can be shared. `pick` and `cards` promote items into `picks.json` and emit board.json card stubs with Eagle provenance plus full-size copies under `owner/picks/`. First 20 picks: Hercules ×2, Turrell/Eliasson ×3, Boondocks ×2, the cloak generation, and twelve CalArts frames. No write into the library.

## Addendum 2026-10-13 — intake: inspirations go INTO the library

`eagle_board.py add` files a URL or a local file into Eagle through its local API (Windows side, reached at the WSL gateway on port 41595), with folder path, a why, a source trailer (chain id, study file or date) and tags, all written into the item's annotation so the provenance travels with the image. Eagle closed or no token → the entry waits in `references/owner/inbox.json` and `add --flush` sends it later. `add --from file.md` reads one or more ```inspirations fenced JSON blocks, which is the shape a muse or tech_recommendation answer can end with. Token: Eagle > Preferences > Developer, stored in `$EAGLE_TOKEN` or `~/.config/eagle/token`, never in the repo. Verified 2026-10-13: the live API refuses without a token (401) and both the no-token and bad-token paths queue instead of failing; two entries are waiting in the inbox (Continue? and the Hilda production note).
