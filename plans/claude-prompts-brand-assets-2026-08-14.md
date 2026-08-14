---
title: "Claude Prompts Brand Asset Promotion"
date: 2026-08-14
status: active
tags:
  - brand
  - assets
---

# Claude Prompts Brand Asset Promotion

- **Status:** complete
- **Lifecycle:** scratch studies → canonical production assets
- **Source study:** `assets/studies/claude-prompts-mark-finalization-study.svg`

## Intent

Promote the approved mascot mark into a reproducible, GitHub-ready asset system without publishing the ignored design studies or their third-party references.

## Decisions

- Preserve the approved compressed-C body, cranial-P head, directional eye paths, loaded asymmetry, and hidden rear hook.
- Keep the canonical mark monochrome. Color belongs to containers and communication surfaces, not the silhouette.
- Use source-derived responsive eye masters at 16 px; do not substitute generic circles.
- Maintain separate positive and reversed 16 px masters because white-on-black requires different optical compensation.
- Keep `assets/logo.png` and `assets/icon-512.png` as compatibility aliases for existing README and listing consumers.
- Store canonical sources, usage guidance, GitHub avatar, social preview, and raster exports under `assets/brand/`.

## Deliverables

- Canonical positive, reversed, attention, and responsive SVG marks.
- Transparent positive/reversed PNG exports from 16 through 1024 px.
- 500 px GitHub avatar and 1280×640 repository social preview.
- Reproducible generator and deterministic asset validation.
- Root README logo reference and brand usage guide.

## Acceptance

- Both eyes remain distinct at actual 16 px in positive and reversed polarity.
- Every SVG parses and contains no external references.
- Every PNG has its declared dimensions; the social preview remains below GitHub's 1 MB limit.
- README validation passes.
- Ignored studies remain ignored and no third-party reference image is promoted.

## Unknowns Resolved

- **Repository avatar:** GitHub repositories do not expose a separate repository avatar; provide an optional 500 px profile/organization avatar and retain a square listing icon.
- **Social preview:** GitHub requires manual upload in repository settings; committing the file alone does not activate it.
- **Dark mode:** use a contained dark avatar in the README and provide polarity-specific standalone marks.
- **Trademark policy:** no new legal policy is inferred. Brand licensing remains an explicit follow-up decision.

## Removal Guard

Delete the old illustrated `assets/logo.png` and `assets/icon-512.png` content once the canonical aliases render correctly and all tracked references resolve to the new asset system. The filenames remain for compatibility; the legacy artwork does not.
