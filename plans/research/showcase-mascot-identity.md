---
title: Showcase mascot identity and visual-rework research
date: 2026-09-30
status: reference
scope: planning-research-only
---

# Identity sources before another character pass

The defensible default pair is **the built-in pet named Codex** and **Claude Code's Clawd mascot**.
Both have official source evidence. This does not establish which Codex visual the owner intended,
select one or two companions, or approve a stylization. No new artwork, prompt/resource changes,
renderer changes, or global preference capture was produced for this research.

## Official sources inspected

| Identity surface                  | Source and evidence                                                                                                                                                                                                                                                      | What it establishes                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex original companion          | [Pinned official catalog](https://github.com/openai/codex/blob/6996cde697b228fbf5695ce855b2498c5c668795/codex-rs/tui/src/pets/catalog.rs)                                                                                                                                | `id:"codex"`, display name `Codex`, description **“The original Codex companion”**, asset `codex-spritesheet-v4.webp`. The same catalog contains seven other named built-ins. This is a named pet, not an invented species.                                                                                                                                                                                                                     |
| Codex official raster             | [Original sprite sheet](https://persistent.oaistatic.com/codex/pets/v1/codex-spritesheet-v4.webp), endpoint owned by [pinned asset acquisition code](https://github.com/openai/codex/blob/6996cde697b228fbf5695ce855b2498c5c668795/codex-rs/tui/src/pets/asset_pack.rs)  | Downloaded temporarily and visually inspected unchanged. Blue soft/cloud-like outer head, dark rounded screen face, cyan `>_` face glyph, small blue torso with a related chest glyph, short arms/feet. Multiple pose/expression frames exist. No official animal species is declared.                                                                                                                                                          |
| Interface/custom pet scope        | [Fetched official pets documentation](https://learn.chatgpt.com/docs/pets.md), reached from `developers.openai.com/codex/pets`; [developer commands](https://learn.chatgpt.com/docs/developer-commands.md?surface=cli)                                                   | Built-in and custom companions are selectable. Codex CLI supports `/pets` and `/pet`; docs distinguish desktop floating pets, terminal pets and the IDE extension. Selecting a pet changes appearance, not task behavior. A user's chosen avatar is not necessarily the original Codex pet.                                                                                                                                                     |
| Clawd name/current product status | [Pinned official Claude Code changelog](https://github.com/anthropics/claude-code/blob/732e167ee9d71296b4b63d6f529ac1334513826a/CHANGELOG.md), section **2.1.282**                                                                                                       | Explicitly names **“the Clawd mascot”** and its eyes/feet. Also records feet in the startup banner being moved under the body's corners. The name is first-party evidence, not a community naming guess.                                                                                                                                                                                                                                        |
| Clawd visual                      | [Pinned official demo GIF](https://raw.githubusercontent.com/anthropics/claude-code/732e167ee9d71296b4b63d6f529ac1334513826a/demo.gif), embedded by [official README](https://github.com/anthropics/claude-code/blob/732e167ee9d71296b4b63d6f529ac1334513826a/README.md) | Downloaded temporarily and viewed unchanged. Its opening shows Claude Code v2.0.0's startup: broad coral/orange block body, two narrow dark vertical eye slots, short lateral protrusions, small lower feet. This is an older depicted product version; use the current changelog to avoid treating its exact foot placement as an immutable current master. “Crab-like” is a visual description, not an established official species taxonomy. |
| Claude product mark               | [Official documentation](https://code.claude.com/docs/en/overview) references [this header SVG](https://mintcdn.com/claude-code/c5r9_6tjPMzFdDDT/logo/light.svg)                                                                                                         | The product header mark is a radial/starburst symbol plus lettering, not Clawd's block-body/eyes/feet. Anthropic's corporate wordmark is a separate company identity; do not use “Claude mascot” to mean any of these interchangeably.                                                                                                                                                                                                          |
| OpenAI brand mark                 | [Official brand URL](https://openai.com/brand/) returned HTTP403 in this run                                                                                                                                                                                             | The OpenAI company/product logo and the named screen-faced Codex pet are different identity surfaces. Brand-page restrictions prevented refreshed usage-rule claims. Nothing in the pet catalog makes the company mark a character or declares a mascot species.                                                                                                                                                                                |

Repository snapshots: Codex `6996cde697b228fbf5695ce855b2498c5c668795`; Claude Code
`732e167ee9d71296b4b63d6f529ac1334513826a`. These are the fetched main snapshots, not a claim that
the installed local binaries use the same revision. The spritesheet is the official versioned v4
asset found through that Codex source.

One web search was used, restricted to the official OpenAI topic. Official pages, repository files
and assets were fetched directly afterward. Exa page-fetch schema/timeouts were recovered through
direct HTTP retrieval; successful source fetches above supply the claims. No generated substitute
was used as identity evidence.

## Recognition forks to rule

1. **Which Codex surface?** Recommend the named original screen-faced companion. Confirm it against
   the actual official sprite before committing. A different selected pet, a terminal ASCII mark,
   a desktop icon or the OpenAI brand symbol would require its own exact visual reference.
2. **Which Claude surface?** Recommend startup **Clawd**. The Claude radial mark and a custom/hatched
   `/buddy` creature are different references. The changelog describes `/buddy` separately; it does
   not make every hatched creature Clawd.
3. **One helper or both?** Owner proposed “perhaps both.” This remains a narrative choice: one
   recurring helper or two recognizable peer collaborators. Do not infer a rivalry, a provider
   hierarchy, or a default cast from the existence of the two product mascots.

Focused question for the next owner exchange: **“Do you mean the original blue `>_` Codex pet and
the coral block-shaped Clawd—and should they both accompany the selected human?”** The sources
settle the candidate identities; they do not settle that choice for the owner.

## Original stylization constraints, not new designs

- **Codex recognition:** preserve screen-versus-outer-head contrast, the `>_`-like face identity,
  blue family and compact head/body relationship. Treat the soft outer rim as a graphic shape;
  avoid turning it into an unrelated animal by adding leaf crests, muzzle, antlers or species lore.
- **Clawd recognition:** preserve the broad compact coral body, two narrow dark eye slots, short
  appendages and lower/corner-feet relationship. Rounding/staging/line weight can become our film's
  language without replacing that relationship with a literal biological crab shell/claws.
- **Common film language:** original expressive acting, deliberate contour hierarchy, matte cel
  planes and soft painted surroundings. Their product identities should remain readable at rest,
  not depend on a logo stamped onto a new unrelated creature.
- **Narrative roles:** familiar capable helpers who remain curious, beside the human. The client
  executes and the authored workflow guides it. A mascot does not imply autonomous learning,
  guaranteed checks, undocumented tools, or an actual captured provider run.
- **Palette consequence:** Clawd's coral would share pigment with the selected human's coral top.
  A two-helper scene needs a tested focal/palette hierarchy rather than adding both to the current
  colors unchanged. Codex's dark screen/cyan glyph also needs legible separation from human hair
  and dark costume masses.
- Keep the approved **Claude Prompts** project logo separate. Provider-helper references do not
  authorize replacing or reshaping that canonical mark.

## Negative controls: what actually changed

Inspected the original `media/showcase/v2/assets/hair-drape-01.png` and actual movie export frame
`media/showcase/v2/episode/out/default/frames/frame-0216.png`, plus compact02 for comparison.

| Surface           | Visible change                                                                                                                                                                             | Missing rework                                                                                                                                                                                                                                                                               |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hair              | Quiff/swept side, chunky swept-back clumps, high off-center knot change the outer hair mass. Middle/B was selected for the first animation.                                                | All still use a similar soft dark-blue filled-plane treatment and fine/quiet edges. This compares hair contours; it does not establish a varied line-weight/cel-shadow grammar or a whole clothing redesign.                                                                                 |
| Body/face         | Earlier passes genuinely changed head/body mass, shortened body/neck stretch, simplified faces and added small full lips.                                                                  | The hair sheet intentionally held those masses; no additional proportion redesign is demonstrated by three copies of the selected figure.                                                                                                                                                    |
| Clothing          | Coral drop-shoulder top, a diagonal torso shadow/drape and offset hem remain visible; dark loose trousers and cream shoes stay ordinary.                                                   | The three hair variants have almost the same torso/sleeve/cuff/hem shapes and shadow recipe. A clearly considered turned cuff, fold rhythm, garment cut, weight and moving joint behavior were not fully re-derived. The weak cuff detail was explicitly noted before production.            |
| Line/shadow       | Colored edges and broad painted fill/shadow regions provide some graphic softness.                                                                                                         | No clear hierarchy of heavy occluding/contact edges, medium outer silhouette and light internal marks; no purposeful variable shadow thickness was established. Painted sprite planes do not by themselves prove a cel-lighting law.                                                         |
| Actual clip frame | Cutout human/companion occupy a modeled stage; broad ground pigmentation and simple tree/hut geometry are visible. The front sleeve reads as a conspicuous separate mass at the arm joint. | The frame retains the source garment masses; assembly motion did not complete their shape/material redesign. Stage solids have fairly uniform edge treatment and broad soft tonal regions. More intentional stepped light/shadow, contour contrast and palette hierarchy remain design work. |

The owner's “Pokémon-like” companion judgment is a taste ruling, not evidence that the generated
creature is a specific copied species. Its leaf crests, large eyes, animal muzzle/body and mint/
lavender creature palette explain why the current silhouette is an animal companion rather than
either identified provider mascot. Recoloring it or adding a provider logo would preserve the wrong
identity mechanism.

## Next planning boundary

Before production: settle the specific mascot pair/cast, then define one common cel/contour/palette
law against the same still. Separate human hair/garment construction from that rendering law.
The next comparison should demonstrate structural costume choices and varied edge/shadow weight,
not merely another haircut on unchanged clothing. No character designs or production changes are
selected by this research note.
