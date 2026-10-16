Episode root: {{episode_root}}
Renderer: {{renderer}}
Production root: {{output_root}}
Notes:
{{context | default("none")}}

Read `timeline.json`, `shots.json` (`hue.radiance`/`hue.accent` per shot, beats mapped by each shot's `beat` list), the ledger's `effects` per beat (emitter, radiance, grain, boil), `worlds/*.json` (each world's radiance colour) and `rubric.md` C6, C15, C18, C24. Write `<episode_root>/light.json`: per beat the hue pair, the emitter (anchor, start→end position from blocking, intensity on ones, colour), radiance level, grain; per crossing window the hue path from the from-beat's pair to the to-beat's (monotonic in hue, through the line world's no-radiance hold, never grey); and every handoff (one emitter at a time: the frame where one goes out and the next comes on, 2–4 frames apart per C18). Keep one hue pair per beat; a beat that needs a second saturated hue outside identity pigments is a FAIL to name, not a third colour to add. The gate runs `probe-colour.py --contract light.json`; quote its lines. Reply: Light script (table: beat · pair · emitter · intensity · handoff frame), Crossings (hue path each), Fails named, Changed, Receipt.