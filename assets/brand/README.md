# Claude Prompts Brand Assets

This directory is the canonical source for the Claude Prompts mascot mark and GitHub-facing exports. The ignored files under `assets/studies/` are iteration scratch, not production artwork.

## Asset map

| Asset                                        | Use                                                               |
| -------------------------------------------- | ----------------------------------------------------------------- |
| `claude-prompts-mark.svg`                    | Primary dark mark on a light or transparent field                 |
| `claude-prompts-mark-reversed.svg`           | Primary light mark on a dark field                                |
| `claude-prompts-mark-attention.svg`          | Optional notification or active-attention state                   |
| `claude-prompts-mark-micro-24.svg`           | Optical master for 24 px presentation                             |
| `claude-prompts-mark-micro-16.svg`           | Positive optical master for 16 px presentation                    |
| `claude-prompts-mark-micro-16-reversed.svg`  | Reversed optical master for 16 px presentation                    |
| `png/`                                       | Transparent positive and reversed exports from 16 through 1024 px |
| `claude-prompts-avatar-500.png`              | Optional GitHub profile or organization avatar                    |
| `claude-prompts-icon-512.png`                | Square marketplace and directory icon                             |
| `claude-prompts-social-preview-1280x640.png` | GitHub repository social preview upload                           |
| `source/claude-prompts-symbols.svg`          | Geometry source consumed by the generator                         |

`assets/logo.png` and `assets/icon-512.png` are compatibility aliases of the square 512 px icon.

## Identity invariants

The mark carries five fixed relationships:

1. The body is one compressed organic curve. It must not split into a separate torso and tail.
2. The interior counter reads as a `C` without requiring the exterior contour to repeat the letter.
3. The cranial mass suggests a `P` and remains supported by the loaded neck junction.
4. Both eyes derive from the same directional wedge paths as the master. The farther eye stays smaller.
5. The rear appendage remains a hidden tapered hook. It returns the body's flow instead of becoming a second symbol.

Do not add a mouth, outline, gradient, drop shadow, or internal texture to the canonical mark.

## Responsive and polarity rules

| Presentation     | Asset rule                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 32 px and larger | Use the primary mark. Reversal changes color only.                                                                          |
| 24 px            | Use the 24 px optical master. It enlarges the far aperture without changing its path grammar.                               |
| 16 px positive   | Use the positive 16 px optical master.                                                                                      |
| 16 px reversed   | Use the reversed 16 px optical master. Its white mass is slightly reduced and its dark counters are compensated separately. |

The micro masters change spacing and optical weight, not character. Do not substitute circles for the eyes. Test raster assets at actual size on their intended background; a zoomed preview does not prove eye survival.

## Color

The silhouette remains monochrome. Containers and communication surfaces may use this small palette:

| Token | Value     | Role                                          |
| ----- | --------- | --------------------------------------------- |
| Ink   | `#111715` | Dark field, primary positive mark, text       |
| Paper | `#F5F7F6` | Light field, reversed mark                    |
| Route | `#2A8F83` | Workflow direction and active routing accents |
| Gate  | `#E3A63B` | Sparse validation or attention accent         |

Route and Gate are not alternate logo colors. Maintain sufficient foreground and background contrast when adapting the communication surfaces.

## Clear space and cropping

- Preserve clear space around the mark approximately equal to the near eye's height.
- Center the square icon optically, not by the silhouette's bounding-box center.
- Keep the full rear hook visible.
- A circular avatar crop may remove the square field's corners, but it must not crop the mark.

## GitHub use

The root README uses `claude-prompts-avatar.svg`: the vector stays crisp when GitHub scales it, and
its contained dark field keeps the mark legible in light and dark themes. Keep the setup actions and
repository metadata in separate badge rows so interface chrome does not compete with the mark.

GitHub does not automatically activate a committed social preview. Upload `claude-prompts-social-preview-1280x640.png` through **Repository settings → Social preview → Edit**. GitHub recommends 1280×640 for best display and requires the image to remain below 1 MB. See [GitHub's social preview documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview).

Use this alt text for the base mark:

> Claude Prompts mascot, an asymmetric curled creature forming a C-shaped counter with two directional eyes.

The 500 px avatar is optional. A repository has a social preview but no independent repository avatar, so do not replace a personal or organization avatar automatically.

## Attention state

The attention state adds pupils without changing the base silhouette. Use it for a temporary active, unread, or notification state. Do not use it as the default logo or animate it without defining reduced-motion behavior.

## Generation and validation

Run from the repository root:

```bash
python3 scripts/generate-brand-assets.py
python3 scripts/generate-brand-assets.py --check
```

The generator requires a local Chrome or Chromium executable for raster output. Validation checks SVG parsing, external references, PNG dimensions, the GitHub file-size limit, and two-eye survival at 16 px in both polarities.

## Open brand-governance decisions

The asset system does not invent legal policy. Before third parties redistribute or modify the artwork, decide whether the repository's MIT license covers the brand assets or whether the project will reserve the name and mark separately. A custom wordmark and trademark review are also outside this first production package.
