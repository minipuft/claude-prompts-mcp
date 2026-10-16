# Owner-supplied references — workflow evidence

**Research only, 2026-09-30.** The owner supplied these exact posts and confirmed the original blue Codex + Clawd direction. Neither reference selects our renderer or supplies approved replacement characters. Primary X pages returned HTTP200; both public CDN MP4 renditions were downloaded unchanged. Raw HTML, mirror corroboration, hashes and eight unaltered analysis frames are in `/tmp/showcase-user-reference-sources/`. This folder is temporary research evidence, not a production asset pack.

## 1. LCSlates / Chris Riley: mosaic film

[Main post](https://x.com/LCSlates/status/2102503027340988559), **2026-09-22 20:59:18 UTC** (primary timestamp; mirror agrees): “Well this is something new... Opus 5.5 by itself. … Prompt and agent read out below.” The model name and autonomous-work claim belong to the creator; no provider/run receipt was retrieved.

[Prompt self-reply](https://x.com/LCSlates/status/2102503028859211905), **20:59:19 UTC**, contains this exact available long-form text:

> Prompt:
>
> Make an 80 second square animated film as a single HTML file, using WebGL2 and plain JavaScript, with no libraries and no image, font or audio files. It should look like a glass and gold leaf wall mosaic whose tiles were never glued down, so they can lift, flip, fly and click back into place. Figures are flocks of tiles, so a fish swims by its tiles swimming

The posted note ends at **“swimming”**; no missing continuation was invented. This is the requested implementation contract, **not the actual HTML/JS source**.

[Agent-readout self-reply](https://x.com/LCSlates/status/2102503030469833168), also **20:59:19 UTC**, describes timed beats: light/ripples0–8s; fish flock8–21s; cranes/dove~21–34s; night-face flip34–40s; constellation40–58s; day flip58s; spiral/reassembly63–72s; final tile/fade75s. It claims browser-synthesized pad/shimmer/landing clicks.

Its strongest workflow evidence is the quoted correction loop: **“Changes I made after watching it frame by frame”** followed by fish palette/outline separation, tighter flock shape, less intense reflections, quieter plaster contrast and different inner/outer spiral rotation. It also records unresolved pale sky during edge-on flips and a nearly black night sea. These are **agent-reported review/revisions**, not independently observed tool calls or proof of a literal one-shot generation.

**Actual media observations:** sampled5/15/38/65s show one persistent tessera language, gold/copper/blue day imagery, navy/silver night imagery, figure-shaped openings, lifted tiles and a large disassembly/spiral state. The substrate and transformations share a material metaphor. This supports reading a coordinated material/story progression. Four stills do not prove smoothness, every narrated beat, synthesis code, 3D engine or source editability. It is not a cel/ink human-clothing example.

## 2. chetaslua: “Little Company” animal interaction

[Main post](https://x.com/chetaslua/status/2101599959367999968), **2026-09-20 09:10:50 UTC** (primary timestamp; mirror agrees), says:

> Fable 5.2 is pure JS thats it one shot
>
> animal edition , i did not even prompt it to be so detailed and it made proper snacks for different animal

The rest refers readers to prior tweets for access and claims “opus 5.2 is being tested in claude web,” then requests credits. These are creator statements, not verified provider availability, model identity or source/runtime evidence. “Fable” must not be silently interpreted as a JS renderer/library.

The primary page embeds [preceding face-grid post](https://x.com/chetaslua/status/2101376238703333883), **2026-09-19 18:21:51 UTC**, claiming pureJS/one-shot. That page quotes [earlier video/game post](https://x.com/chetaslua/status/2101071418507366895), claiming routing from another named model. The earlier post's quoted text was visible in primary pages; its standalone page/source was not fetched. Inspected main/ancestor links point to X media, not downloadable JS, HTML or a repository. Other users' prompt suggestions/replies do not establish the creator's prompt.

**Actual media observations:** sampled8/20/36/50s show an18-head grid titled “Little Company,” pale paper-like field, quiet muted animal colors, contour/feature lines and small texture marks. Eye/mouth/ear/face-direction states differ across samples; treats, cursor and action controls are visible. Later species/order differ, so the captured interface demonstrates visible variation. This is useful for facial personality and line/fill economy. It does not demonstrate full-body gesture, cloth volumes, world contact, shadow-weighted contours or cel lighting. The footer “every little line is code” is visible **presentation text**, not source verification. The film of an interaction also does not prove the underlying UI's reproducibility.

## Retrieved media and analysis frames

| Reference | Unchanged public rendition / measured file                                                                                                                                                                                                                                          | Temporary paths / requested sample times                                                                    |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| LCSlates  | [CDN MP4](https://video.twimg.com/amplify_video/2102502315185803264/vid/avc1/1080x1080/sAv8kDNKSV7KmtgO.mp4?tag=29); H.2641080×1080,30fps + AAC; FFprobe duration80.042667s;53,169,226 bytes. SHA256 `be992c7d91e70edc21ac2bac812ea3448b52b32aa1f23d5d523ffa3366038046`             | `lcslates-2102503027340988559.mp4`; `lcslates-frame-05.png`, `-15.png`, `-38.png`, `-65.png`:5/15/38/65s.   |
| chetaslua | [CDN MP4](https://video.twimg.com/amplify_video/2101599305777991680/vid/avc1/2940x1600/I2rys141sNUzeM2F.mp4?tag=29); H.2642940×1600 + AAC; FFprobe duration55.36s, average rate7100/123;82,311,822 bytes. SHA256 `b08ff286e182a3fec1e6ecfcb848c0bfdbf15b96125a45f7321889b7c206cfde` | `chetaslua-2101599959367999968.mp4`; `chetaslua-frame-08.png`, `-20.png`, `-36.png`, `-50.png`:8/20/36/50s. |

All paths are under the temporary folder above. Extraction: `ffmpeg -ss <seconds> -i <unchanged clip> -frames:v 1 <frame.png>`; no montage, crop, scaling or image filter. These are requested seek times, not independently measured original-render frame IDs. FFprobe and successful sample decoding are complete; this researcher did not play either complete clip or drive a browser. Root owns native playback/review. Raw provenance: `retrieval-receipt.json`, `lc-primary.html`, `che-primary.html`, and self-reply/ancestor HTML. FxTwitter JSON corroborated text/media metadata; primary pages themselves supplied note fields and CDN URLs.

## Transfer to our cel/ink/story workflow

| Property worth transferring       | What is actually supported                                                                                                          | Required local proof before adoption                                                                                                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Medium as an animation rule       | LC's tiles define both image construction and transformations; prompt/readout specify narrative beats and material-aware revisions. | Original Codex/Clawd shape/line/value keys, then a short real action whose transformations obey that medium; source and frame-review receipts. Do not transplant gold mosaic as our target.                   |
| Small independent acting controls | Chetas samples show varied gaze/expression/ear states and contextual treats.                                                        | Original character expression/gesture states and one readable interaction; preserve selected silhouettes and shared story intent. No need to build its grid or website.                                       |
| Palette/story continuity          | LC's recurring tile/material system carries day/night and reassembly; Chetas keeps restrained fills against a quiet substrate.      | Our approved beat/color keys, light/shadow/line hierarchy and actual consecutive-frame review. Neither supplies a verified shadow-side line-weight technique.                                                 |
| Reproducibility and editability   | LC provides a compact requested format; Chetas presents procedural-variety claims. **Neither exposes an inspected implementation.** | Pinned actual source, deterministic clock/seed, separate original asset/choreography/palette declarations and a concrete item/character edit with coherent re-export. A “one-shot” label cannot satisfy this. |

**Planning implication:** retain the richer artistic targets from [the render-gap audit](showcase-render-gaps.md). Add explicit review/revision evidence and a change test before full production. These references widen the procedural-drawing/material-choreography candidates for later `tech_recommendation`; they do not yet choose WebGL, prove a reusable rig, or make the rejected cutout episode acceptable. Footage is available; implementation source, original generation transcript and independently verified model/runtime claims remain unavailable in the inspected sources.
