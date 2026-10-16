# Study board-01 · the design bible as a board

2026-10-12 · owner asked for the bible viewable at a glance, each reference next to its intent, video references included. Medium decision: not PureRef (desktop app, binary `.pur`, no API reachable from this box) and not a new MCP. One manifest, `v3/references/board.json`, is the board's single source; `scripts/build-board.mjs` renders it two ways from the same data: `board.html` (clickable, plays the local study copies of every video at its timestamp, links the public originals) and `board.png` (the glance render through headless system Chrome, trimmed to content). `npm run board` does both; the build refuses to run if any card points at a file that is not there.

Outputs (absolute paths for T3 Code):

- `/home/minipuft/Applications/claude-prompts-mcp-showcase/media/showcase/v3/references/board.png` · 1600x5746
- `/home/minipuft/Applications/claude-prompts-mcp-showcase/media/showcase/v3/references/board.html` · served at `http://127.0.0.1:3119/v3/references/board.html` while the static server from this session runs (`python3 -m http.server 3119` in `media/showcase`)
- `/home/minipuft/Applications/claude-prompts-mcp-showcase/media/showcase/v3/references/board.json`

## Changed

- `v3/references/board.json` (new): 7 sections, 34 cards. Each card carries title, author/source, what we **borrow**, what we **refuse**, and the rulings (D) and rubric rows (C) it governs; each section carries its one-line law and the library files that implement it. A top block holds the five roles, the identity pigments, the timing table and the six motion laws.
- `scripts/build-board.mjs` (new) and `package.json` `board` script.
- `v3/references/` new files, all hashed into `style-references.json`: `midnight-gospel-bg-pecini-01.jpg` (background paint, Olivia Pecini portfolio), `cloudysky-visual-guide.png` (the owner's cloudySky moodboard, copied unchanged), three low-resolution private study copies of videos (`yt-0kQWAqjFJS0.mp4` Midnight Gospel trailer, `yt-nTcblxN8TGQ.mp4` Klaus lighting time-lapse, `yt-it3PGEcaobk.mp4` line-boil tutorial) with chosen stills, one thumbnail for the Spider-Verse twos explainer (external link only), and the four owner-supplied X clips (Kevin Ngo, shfred, LCSlates, chetaslua) re-fetched from the CDN renditions the 2026-09-30 research recorded; their sha256 match those receipts exactly (`40423fda…`, `c59b0c25…`, `be992c7d…`, `b08ff286…`), so the research frames and these files are the same bytes.
- Video timestamps chosen from contact sheets: trailer 0:16 (simulator opens, emitter in speckled field), 1:12 (inside a simulated world), 1:44 (ribbons); Klaus 0:20 pre-lighting vs 20:00 lit (poster is the lit frame); line boil 1:30; X clips at the research sample times (20 s, 8 s, 38 s, 20 s).

## Grades

Board as an artifact, graded against what the owner asked for:

- Glance: HOLDS — `board.png` reads top to bottom as laws → world → shadow → field → motion → cast → controls → where the film stands; viewed at 600 px wide the section structure still reads.
- Intent next to each reference: HOLDS — every card has borrow/refuse/governs; no card is an image without a sentence.
- Video references: HOLDS — 10 video cards, 9 playable locally at their timestamp, 1 external.
- Provenance: HOLDS — 22 entries in `style-references.json` with bytes and sha256; `board.json` asserts file existence at build.
- C19 on the board itself: n/a (a board is not a scene asset).

Rubric rows the board makes checkable at a glance: C1 (identity swatches), C16–C18 (timing table and laws), C5/C7/C19 (failing controls in section 6 next to the current stills in section 7).

## Controls

- The v2 `moodboard.html` (2026-09-30) is the sibling and the control: a carousel of 20 references with observation/interpretation/transfer/boundary text, hand-written HTML with no manifest, no rulings mapping, no video, no glance render. The new board keeps its four-part reading (borrow/refuse ≈ transfer/boundary) and adds the governs mapping and the generated outputs.

## Owner

1. TASTE — section 7 "Where the film stands" shows the three latest stills. Keep it on the board (default keep: it is what makes the board a comparison and not a mood collage), or move it to the top so the gap is the first thing seen?
2. TASTE — the Spider-Verse card is a third-party explainer, not primary source. Keep as the twos reference (default keep) or drop it and let the Midnight Gospel trailer carry twos alone?

## Next

- The board becomes an input to the muse pass: `showcase_asset_sheet` variants cite card ids from `board.json` instead of free-text reference names, so a borrow is traceable to a card.
- Re-run `npm run board` after every accepted study so section 7 stays current; the planner adds a card when a ruling lands.
- Still open from earlier studies: owner's pick on human sheet 14; muse on the frame and the bubble; C6/C15 fixes.

## Revision board-02 (2026-10-12, D56)

Owner: the board is a clean slate; remove every reference to the human muse sheet and previous iterations. Removed: the skin study card, the poster study card, the human sheet card, section 6 (failing controls) and section 7 (where the film stands). The anti-references moved into the laws block as text. 5 sections, 24 cards; `board.png` 1600x4612. The two TASTE questions above are withdrawn: section 7 is gone and the Spider-Verse card stays. Controls and current stills remain under `studies/`, graded against the board, never shown on it.

Owner, same day: human sheet 14 is withdrawn, no pick. The human is re-mused from the board before anything else; sheet 14 and the beat1-11 draw are history, not candidates.

## Revision board-03 (2026-10-12)

Owner asked where the original inspirations and script went. Answer filed in chat: v2 references and the v2 episode script stay under `v2/`; the v3/v4 six-beat script is unchanged; Mind Game left with the owner's D43 correction. Added section 6 Lineage: seven v2 references that survived the medium change as a property, each card naming the law it became (Chicory → hands place pieces; Unravel → join is a seam pulse; Tiny Glade → one join at a time; Adventure Time → companion ease, same creator as Midnight Gospel; Ed Edd n Eddy → D52 boil; Foster's → silhouette test; Katamari → the frame holds the whole environment). 6 sections, 31 cards; `board.png` 1600x5750. Mind Game is not on the board pending the interview.
