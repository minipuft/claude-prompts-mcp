# light-01 · the light as a signed-distance layer (row 8.6, D98)

2026-10-19 · shot `s01-arrival-overwhelm`, frames 0-420, the arrival and the flood. Provisional: the owner has ruled the layer (D98) and none of its numbers. Plain words first; codes are in the collapsed lines.

<details><summary>Codes used below</summary>
D98 adopts the light as one cached signed-distance shader layer; D47 and D48 make shadows drawn shapes of stipple, never ramps; D45 is the glass; D74 one hue pair and one emitter per shot; C1 the identity pigments never grade; C29 the eye finds the emitter. p005 and p006 are the proposals this study files. "Without the layer" means the same cached drawings composed with the layer's two left out (`scripts/animation/compose-without-light-sdf.py`).
</details>

## What the viewer sees

The lamp now lights the black field, and what stands in its way casts a shadow. Before, the light was a glow at the seam and nothing else: the figure, the Codex and the box shadowed nothing. Now the field around the seam is dusted with fine dots of the lamp's own pale blue, thick near the lamp and thinning with distance, and every solid thing between the lamp and the field leaves a wedge with no dots behind it, its edge drawn in coarser dots. Nothing is a smooth gradient: every pixel is a dot or it is the field.

![frame 0 without and with the layer](light-01/f000-before-after.png)

- **Frame 0 (the closed box).** The lamp sits in the box's seam. The human standing on the box blocks the light going up: two wedges of dots spread to her left and right, and above her head there is a dark wedge no light reaches. The Codex (left) and Clawd (right) shade the ground behind them. The box itself lets its light out of its own seam, so it casts no shadow over its top.
- **Frame 90 (the lid up).** The lid is a solid above the seam, so the light escapes only through the slit: one long fan to the left, past the Codex, and nothing to the right.

![frame 90](light-01/f090-before-after.png)

- **Frames 102-107, a strip.** The fan keeps its shape from frame to frame because the light is on ones and the stipple is fixed to the screen; the dots do not shimmer.

![six frames around 104](light-01/strip-102-107.png)

- **Frame 177, the last frame of the seam.** The camera has widened; the fan is the same fan, smaller. Frames 178-181 carry no emitter (the handoff from the seam to the dial), so the layer draws nothing there: frame 179, which the brief names, is a frame without light by the chart.

![frame 177](light-01/f177-before-after.png)

- **Frame 300 (the flood).** The dial is the lamp; the gadget is the lamp's own body and lets the light out. Rings, panels and stalks cast wedge shadows over the blue; the dots are the same pale colour over the flood.

![frame 300](light-01/f300-before-after.png)

### Where the shadow falls, close up

The shadow's own edge is drawn in dots of the class's size (stipple-2: 2 px), the weighted edge of D47; inside the lit area the dots are 1 px.

![the figure's shadow edge, frame 0](light-01/shadow-edge-f000.png)

### What the bounce warms

A lit edge gives a little of its material's albedo back to the pixels within 48 px, in the pair colour nearest the role's hue: blue for the box, the Codex and the kit, the accent yellow for the human and for Clawd (their hues are nearer it than the blue). It is weak by design (`albedo` 0.15-0.3, drawn at half the pair colour and always under the direct dots) and on a black field it reads as a few blue and yellow dots along the edges that face the lamp.

![bounce beside the Codex, frame 0](light-01/bounce-f000.png)
![bounce around the gadget, frame 300](light-01/bounce-f300.png)

### How the layer reads the picture

The mask is drawn from the same projections as the figure and the props, each group flat in its material's code colour; the layer alone is dots on transparency.

![occluder masks, frames 0 and 90](light-01/occluder-masks-f000-f090.png)
![the layer alone, frames 0 and 90](light-01/light-layer-alone-f000-f090.png)

## The probes, verbatim

Every command ran from `media/showcase` on the render of `npm run render -- s01-arrival-overwhelm` recorded in `out/s01-arrival-overwhelm/render-manifest.json`; the files are under `out/light-01/`. The whole run is `out/light-01/proof.sh`.

### probe-light.py (row 8.6's occlusion control)

```
$ python3 scripts/animation/probe-light.py out/s01-arrival-overwhelm-seq --light v3/light.json --timeline v3/timeline.json --materials v3/materials.json --xsheet out/s01-arrival-overwhelm-xsheet.json --manifest out/s01-arrival-overwhelm/render-manifest.json --base-frames out/light-01/base-seq --every 6
control: a solid between the emitter and the far field with its stipple shadow darkens the far side by 90 % (margin 50 %); the same frame with no block 25 % -> not darkened; the block with its shadow missing 25 % -> not darkened, so the probe would FAIL it; a stipple penumbra reads two-peaked (17.8 % at the dot level, 0.0 % between (at most 10 %), field 5, dots 203); a ramp shadow -> refused (0.0 % at the dot level, 55.3 % between (at most 10 %), field 112, dots 203); a bounce at luma 224 against dots at 208 -> refused, one at 107 inside the pair -> accepted, one off the pair's hues (100 % outside +-15 degrees) -> refused
  frames 420; measured 69 with an emitter at full strength, skipped 1; solid materials body, box, cloth, hair, line, paper; fixed fills from v3/roles.json
  ok   measured something: 69 frames carry an emitter
  ok   far side darker: 62 frames with a measurable solid; median darkening over them 100 % (lowest 91 %, highest 100 %) against a margin of 50 %
  ok   shadows are stipple: 32 penumbra bands with dots in them read on black-field frames (5 more held no dots: wholly in shadow or past the reach, not informative); every one holds two levels and nothing between (at most 10 % between)
  ok   bounce inside the pair and under the dots: 52 frames carry bounce dots; all inside the pair's hues and under the direct dots
  FAIL eye trace holds: 69 frames compared with the same frames without the layer (the top set is the same number of pixels, 0.5 % of what the frame without the layer holds outside the fixed fills: the layer's own dots are light and would otherwise let a dimmer fill in); a frame holds when the brightest region is within 3 % of the emitter or the layer moved it by at most 1 % of the width: 46 within 3 % with the layer (52 without it), layer moved it most 6.0 % (frame 222); offset worst 9.7 % at frame 210 with the layer, 7.3 % without; 10 frames over on both counts, 7 of them within 3 % without the layer; first (frame, with %, without %) [(72, 3.5, 1.5), (78, 3.5, 1.5), (84, 3.5, 1.5), (102, 3.7, 1.5), (108, 3.5, 1.6), (132, 3.3, 0.2), (192, 7.4, 5.7), (204, 8.2, 5.6)]
FAIL: light - 1 of 5 checks failed: eye trace holds
probe-light exit 1
```

Four of the five checks pass. The fifth, the eye trace, does not (see "What is left"): the control tripped, the occlusion and the stipple and the bounce hold on every measured frame, and the layer moves the brightest region past the 3 % limit on seven sampled frames that were inside it without the layer (six of them by under 0.7 points), and makes three worse that were already outside.

### probe-eyetrace.py, the stock probe, on the strip with and without the layer

It fails on both, by the same numbers, for a reason older than this row: the title lockup's white mark is outside every role and is the brightest thing on the frame (offset 56.7 % on frames 0-107).

```
$ python3 scripts/animation/probe-eyetrace.py out/light-01/proof-seq --timeline v3/timeline.json --xsheet out/s01-arrival-overwhelm-xsheet.json
control: bright blob 10 % of the width off the emitter -> FAIL (offset 10.0 % > 3 %); blob on the emitter -> pass (0.0 %); identity, garment and kit-contour patches brighter than the blob are ignored (read unmasked they would put the offset at 46 %); the same blob against an emitter projected through a camera that moved 140 stage px -> FAIL (10.9 %), so the camera is read; 120 lone white specks, brighter than the blob and a share of the 0.5 % ranked, are not a region: offset 2.2 % blurred, 8.7 % unblurred
  frames 11; masked 36 fixed colours everywhere and the human cutout's 82 inside its crop, from v3/roles.json; measured 10; skipped (no emitter in the xsheet row) 1; skipped (emitter drawn below strength 1, a crossing) 0; worst offset 56.7 % at frame 106
  ok   measured something: 10 frames carry an emitter
  FAIL emitter within tolerance: 9 frame(s) over 3 % of the width: [(0, 56.6), (90, 56.7), (102, 56.7), (103, 56.7), (104, 56.7), (105, 56.7), (106, 56.7), (107, 56.7), (177, 23.0)]
FAIL: eye-trace - 1 of 2 checks failed: emitter within tolerance
exit 1

$ python3 scripts/animation/probe-eyetrace.py out/light-01/proof-base --timeline v3/timeline.json --xsheet out/s01-arrival-overwhelm-xsheet.json
control: bright blob 10 % of the width off the emitter -> FAIL (offset 10.0 % > 3 %); blob on the emitter -> pass (0.0 %); identity, garment and kit-contour patches brighter than the blob are ignored (read unmasked they would put the offset at 46 %); the same blob against an emitter projected through a camera that moved 140 stage px -> FAIL (10.9 %), so the camera is read; 120 lone white specks, brighter than the blob and a share of the 0.5 % ranked, are not a region: offset 2.2 % blurred, 8.7 % unblurred
  frames 11; masked 36 fixed colours everywhere and the human cutout's 82 inside its crop, from v3/roles.json; measured 10; skipped (no emitter in the xsheet row) 1; skipped (emitter drawn below strength 1, a crossing) 0; worst offset 56.7 % at frame 0
  ok   measured something: 10 frames carry an emitter
  FAIL emitter within tolerance: 9 frame(s) over 3 % of the width: [(0, 56.7), (90, 56.7), (102, 56.7), (103, 56.7), (104, 56.7), (105, 56.7), (106, 56.7), (107, 56.7), (177, 23.0)]
FAIL: eye-trace - 1 of 2 checks failed: emitter within tolerance
exit 1
```

### probe-colour.py on the strip

```
$ python3 scripts/animation/probe-colour.py out/light-01/proof-seq --timeline v3/timeline.json --contract v3/light.json --xsheet out/s01-arrival-overwhelm-xsheet.json
control: magenta patch off both pairs -> FAIL (frame 5: 576 of 15376 saturated pixels outside); hue detour through green across a crossing -> FAIL (crossing 14-34 detours: sample 1 (205 deg) sits 16 deg behind the start); clean sequence with identity, garment and kit-accent patches (all saturated, all off the pair) -> pass; a pale blue glow on the emitter reads 221 deg -> inside the blue pair, the same glow in pale green reads 144 deg -> off it, a frame with no glow reads nothing
control: a crossing whose frames pass through a tan -> FAIL (crossing 100-105: the dominant colour dips at frame 101 (value 0.55 under the floor 0.83); 2 of 5 frames read dip); through a grey -> FAIL (crossing 100-105: the dominant colour dips at frame 101 (chroma 0.00 under the lower endpoint's 0.82); 3 of 5 frames read dip); a hue walk between the same ends that holds both floors -> pass
  frames 11; masked 36 fixed colours from v3/roles.json; skipped (no pair for the beat, or under 30 saturated pixels) 0; crossing windows [(895, 965), (1195, 1265), (1315, 1385), (1615, 1685)]
  ok   radiance hue per frame: the light's own hue sits inside the beat's pair on 0 of 0 frames where it is drawn and readable (10 drawn but unreadable: the brightest region outside the fixed fills is not on the emitter, or has no chroma to read a hue from)
  ok   saturated pixels inside the pair: 0 of 11 measured frame(s) (0 had under 30 saturated pixels left outside the fixed fills and their blends, or no pair) with saturated pixels outside the pair +-15 deg
  ok   crossing hue path: 0 of 4 crossings measured on frames move monotonically between pairs; 4 left too few measurable frames at one end (2 are needed in its first third and 2 in its last, and a frame needs 30 saturated pixels outside the fixed fills and their blends; the line world in the middle has none by design): [(895, 965, '0 in the first third, 0 in the last'), (1195, 1265, '0 in the first third, 0 in the last'), (1315, 1385, '0 in the first third, 0 in the last'), (1615, 1685, '0 in the first third, 0 in the last')]; only the light contract's path covers those (probe-colour.py --contract)
  ok   crossing value and chroma held: 0 of 4 crossings hold value and chroma on their dominant colour: ; 4 with under 3 frames read: [(895, 965, 0), (1195, 1265, 0), (1315, 1385, 0), (1615, 1685, 0)]
pass: colour-continuity - all measured frames sit inside their beat's hue pair; 0 of 4 crossings measured on frames run without a detour (0 frames skipped)
exit 0
```

### probe-render-manifest.py

```
$ python3 scripts/animation/probe-render-manifest.py out/s01-arrival-overwhelm/render-manifest.json
control: clean fixture -> passes; a camera value edited after the render -> refused, names camera only; the staging edited after the render -> refused, names figure and props, and light-sdf through the figure it reads, not camera; the light layer removed -> refused, names light; a layer whose inputsHash is not its inputs' hash -> refused, names world; a confirm frame over tolerance -> refused, names the frame and light; a cacheKey that is not the hash of the drawing inputs -> refused, names figure; a plan that leaves out a magnified frame it had room for -> refused, names the frames left out; a plan frame the browser never drew -> refused, names frame 3; a plan that counts candidates the rows do not hold -> refused, names the count; a backend edited after the render -> refused, names light-sdf; a light layer with no backend recorded -> refused, names light-sdf; a layer input that is not the layer's cacheKey -> refused, names light-sdf; a confirm block with no plan -> refused, names the missing plan; a composed frame deleted -> refused, names the missing frames
  ok   s01-arrival-overwhelm: 420 frames, layers figure, props, world, light, light-sdf, camera all current by inputs hash, 40 of 40 confirm frames inside the tolerance
pass: render-manifest - 1 manifest(s) current: every layer's inputs hash to what the render recorded, every composed frame is on disk, every confirm frame is inside the tolerance
exit 0
```

The layer's entry in the manifest (`layers["light-sdf"]`): inputs `src/library/light/sdfShaders.ts`, `v3/light.json`, `v3/materials.json`, `v3/charts/...`, `v3/layouts/...#staging`, `v3/blocking/*`, `v3/timeline.json`, `code:e403d2ba109f4623`, `layer:figure`, `layer:props` and `backend:name`; 493 drawings (232 occluder masks, 261 light); inputsHash = cacheKey `9bd18be4b2ca...`; backend recorded at the top of the manifest and on the layer:

```
{
 "userAgent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.7790.0 Safari/537.36",
 "renderer": "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
 "vendor": "Google Inc. (Google)",
 "version": "WebGL 2.0 (OpenGL ES 3.0 Chromium)",
 "floatTargets": true,
 "name": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0.7790.0 Safari/537.36 | ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)"
}
```

### Determinism: two sharded renders of the strip, byte-identical

`render-shards.mjs` over the whole-frame composition `ShotS01` (the layer drawn in the browser from the served mask), frames 102-107, 2 shards at concurrency 1, run twice:

```
$ node scripts/animation/render-shards.mjs ShotS01 out/light-01/shards-a --shards 2 --frames 102-107 --props out/light-01/strip-props.json --gl=swangle
$ node scripts/animation/render-shards.mjs ShotS01 out/light-01/shards-b --shards 2 --frames 102-107 --props out/light-01/strip-props.json --gl=swangle
$ python3 scripts/animation/probe-determinism.py out/light-01/shards-a out/light-01/shards-b --bytes
control: two writes of the same frame -> pass; one altered pixel -> FAIL (frame [0] differs)
  ok   same frame list: 6 frames in a, 6 in b
  ok   byte-identical: 6 of 6 common frames identical
pass: determinism - 6 frames, sha256 identical across both renders
exit 0
$ python3 scripts/animation/probe-determinism.py out/s01-arrival-overwhelm-seq out/light-01/shards-a --subset
control: two writes of the same frame -> pass; 1 pixel 1 level off (rasteriser noise) -> pass; 40 pixels 1 level off (noise) -> pass; 60 pixels 40 levels off -> FAIL (60 beyond 2 levels, allowance 5); every pixel 3 levels off -> FAIL (57600 beyond 2 levels); 1 pixel 40 levels off -> tolerated (inside the allowance of 5)
  ok   same frame list: 420 frames in a, 6 in b
  6 of 6 common frames differ at all; 6 of those inside the tolerance (at most 0 pixels beyond 2 levels, 2 levels the largest difference)
  ok   identical within tolerance: 6 of 6 common frames match within 2 levels on all but 0.01 % of the pixels
pass: determinism - 6 frames, within 2 levels on all but 0.01 % of the pixels across both renders
exit 0
```

The second line is the cache's own parity: the frames composed from cached drawings against the browser's whole frames, within the 2-level tolerance. `npm run render` confirms 40 frames the same way, the layer in both: `confirm: 40 of 40 frames inside the tolerance`.

### The glass reads its material (D45)

The frame interior's index of refraction is `1 + 0.75 x refraction` and its base roughness `1.25 x diffusion`, read from `glass` in `v3/materials.json` (0.6 and 0.4 give the constants it had, 1.45 and 0.5). Beat 4's frame 90 rendered before and after the edit, and once more with diffusion planted at +0.2 as the control:

```
$ cmp out/light-01/glass-before-f090.png out/light-01/glass-after-final-f090.png && echo "glass cmp: byte-identical"
glass cmp: byte-identical
$ sha256sum out/light-01/glass-before-f090.png out/light-01/glass-after-final-f090.png
899d4f38fe341a1ab4770ee6f6de8ff824d7f8dd8ef8eb29c6550c5571e880a6  out/light-01/glass-before-f090.png
899d4f38fe341a1ab4770ee6f6de8ff824d7f8dd8ef8eb29c6550c5571e880a6  out/light-01/glass-after-final-f090.png
$ cmp out/light-01/glass-before-f090.png out/light-01/glass-control-f090.png
out/light-01/glass-before-f090.png out/light-01/glass-control-f090.png differ: byte 55, line 3
```

Rendered twice before the edit the frame is identical too (`glass-before-f090-b.png`), so the cmp is a real test. The cmp ran against `v3/poses/s01-arrival-overwhelm.json` as it stands on disk, with its three `"material": "cloth"` lines; the glass frame does not read it.

## What it costs

Render time per drawing, from the render reports (`out/light-01/baseline-render-report.json` before, `out/light-01/final-render-report.json` after), on a box shared with other sessions (load average 18 before, 27 after, so read these as orders of magnitude):

| | before | after |
| --- | --- | --- |
| the lamp's core and grain (`light`, 148 drawings) | 8.5 s, 0.057 s each, 20 ms per frame of the shot | unchanged code, drawn in the same run |
| occluder masks (`light-sdf`, 232 drawings) | none | 30.4 s, 0.131 s each |
| the light itself (`light-sdf`, 261 drawings) | none | 70.3 s, 0.269 s each |
| the layer per frame of the shot (420) | 20 ms | 240 ms |
| a cold `npm run render` | 109 s (730 drawings, load 18) | 207 s (1 223 drawings, backend probe 2.0 s, confirm 23 s, load 33) |
| warm, nothing changed | 1.6 s | a few seconds longer: the backend is probed on every run |

The jump flood is 11 passes at 1280 x 720; the march is at most 64 steps per pixel (24 for the bounce).

## Choices I took (filed as proposals p005 and p006)

The rulings name the layer, not its numbers, so the contract's first values are in `src/library/light/sdf.ts`: shadow `k` 4, 12 and 48 for stipple-1, -2 and -3; stipple dots 1, 2 and 3 px in the shadow's edge; the bounce at gain 1.0 over 48 px drawn at 0.5 of the pair colour; the lit volume's radii; the density floor 0.08; the dots at 0.6 of the emitter's level; the owner seat 140 px. The materials file has no character, so the cast is `body` and the props `box`. Both proposals are on the bible page for you to rule.

## What is left

- **The eye trace, a real finding.** On 69 sampled frames (every sixth) the brightest 0.5 % of what is outside the fixed fills is within 3 % of the width of the emitter on 52 frames without the layer and 46 with it. Six frames (72-132, lid open) go from 0.2-1.6 % to 3.3-3.7 %: the light is one-sided there, so the dense dots beside the lamp pull the centroid off it. One flood frame (222) goes from 0.6 % to 6.6 %. Three more flood frames (192, 204, 210) were already 5.4-5.7 % off and are 1.7-4.3 points worse. The 17 frames that fail without the layer fail for reasons in the shot, not the layer: `v3/roles.json` is written from the settled palette, not the shot's own (the box's yellow ribbon is darker than its accent hex; the title mark is white). The fix that would let C29 measure the light is `compile-roles.mjs` reading `s01Turrell` (proposal p006). I tried the dots at 1.0, 0.6 and 0.45 of the emitter's level: 0.6 held 46 of 69 frames, 0.45 held 40.
- **The class scale is not yet visible.** Every solid on s01 is stipple-2, so soft, medium and hard shadows are exercised only by the probe's planted frames and the shader's constants.
- **The cloak and the hair** are one figure to the light (`body`); a per-part split needs the parts rig to draw per material.
- **Beat 4, frame 700.** The animatic (`Animatic65`) draws no passes, so the light layer is wired for `s01-arrival-overwhelm` only (`SHOTS` in `render-manifest.mjs`); frame 700 was not rendered. The next row wires the shot that holds beat 4.
- **The full cascade trial** (radiance cascades proper) and **the world beats** (the art and programming worlds' paper and line materials: stipple-3 and `none`) are untouched.
- The light layer is not yet read by the glass pass ("glass reads the same buffer" in p003); the glass reads its material's numbers, not the buffer.
