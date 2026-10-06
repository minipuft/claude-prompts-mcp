# Math Fidelity — Derivation Card Gate

New shader/GL terms in this stack are novel compositions with no external reference
implementation to diff against. The failure history is consistent: the _math_ is usually fine;
what ships broken is the **translation** — ranges undeclared, sampling regimes assumed,
capability checks unverified, thresholds never named. This gate requires the six-section
derivation card and checks the sections that historically get skipped.

## Required card sections (all six)

1. **OPTICAL MODEL** — what the light does, in words, BEFORE math; names the finest visible
   feature and its perceptual character (crisp / soft / organic / sparse…).
2. **CONTINUOUS MATH** — equations with units; a RANGE CONTRACT for every generator/operator
   (the csStoneBed lesson: ranges live at the generator, consumers never remap by convention).
3. **DISCRETIZATION (the load-bearing step)** — for every signal: where it lives (bake / FBO /
   procedural), allocation size, tiling factor, screen footprint, filter + mip state, and the
   full path to display (fboScale × composeScale × dpr). Numbers must be **measured** (live
   probe or pipeline read) — an eyeballed regime got minification/magnification BACKWARDS in
   the founding dry-run. Classify the regime: **minified** (needs mip chain) | **magnified**
   (needs res / SDF reconstruction / procedural) | **native**.
4. **LOCK** — the 0-value byte-identical identity path and what A/Bs it.
5. **OFFLINE HARNESS** — how the term's shape is verified before the live client sees it
   (TS twin, color.mjs-style bundle, edge-profile plot).
6. **LIVE PROBE + THRESHOLD** — the named tools/cdp probe, the metric, and a NUMERIC
   threshold; carries the creed-fidelity statement alongside.

## Failure modes this gate catches

- **Assumed regime** — "it's about 5× magnified" without a tiling/footprint measurement.
- **Rangeless generator** — a noise/height function with no stated output range.
- **Capability faith** — filter modes / extensions asserted from intent, not verified
  (the WebGL1-extension-on-WebGL2 NEAREST trap shipped silently for weeks).
- **Vibe threshold** — "looks better" with no metric a probe could pass or fail.
- **Client-first shape** — a term whose spatial response was never rendered offline.

## Verdict

PASS only when all six sections are present, the discretization cites measured numbers with a
classified regime, and the live probe names a numeric threshold. FAIL names the missing or
assumed section.
