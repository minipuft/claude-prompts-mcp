Brief: {{brief}}
Production root: {{output_root}}
Previous handoff:
{{context | default("Start of pre-production; no prior step.")}}

The board is the bible at a glance. Read `v3/references/board.json` and `v3/creative-spec.md` (rulings list). Check, in order: every card has title, by, borrow, refuse and governs; every `src`/`poster` path exists; no card shows anything the project drew (D56: no study still, no muse sheet, no failing control); every ruling D41 and later is governed by at least one card or named in the laws block; every video card has a local study copy or an explicit external href. Run `npm run board` from the production root; it refuses on a missing path. Do not add references on your own: a new card needs an owner ruling or a filed provenance entry in `style-references.json` with bytes and sha256.

Return: Board Revision; Sections and Card Count; Rulings Without a Card; Paths Fixed; Build Output (html, png size); Concerns.