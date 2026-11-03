#!/usr/bin/env node
// Compiles the fixed role colours the frame probes mask: every fill that colour-continuity (C24/C30) and the eye trace (C29) must not read as light or as a hue.
// Source: src/library/tokens.ts (identity pigments, the human, kit and gadget role maps) and v3/worlds/*.json (each world's own texture colours: crayon's stroke palette and ink,
// the shaded world's edge colour); the probes cannot import them, so this writes v3/roles.json.
// usage: node scripts/animation/compile-roles.mjs [--out <path>]
import fs from 'node:fs';
import path from 'node:path';
import {loadTs, root} from './load-ts.mjs';

const i = process.argv.indexOf('--out');
const outPath = path.resolve(i > -1 ? process.argv[i + 1] : path.join(root, 'v3/roles.json'));
const {identity, settled, s01Turrell} = await loadTs('src/library/tokens.ts');

/** A #rrggbb colour `t` of the way from `b` to `a` (sRGB, the way the browser blends an element at opacity `t` over its background). */
const mix = (a, b, t) => '#' + [1, 3, 5].map((k) => Math.round(parseInt(a.slice(k, k + 2), 16) * t + parseInt(b.slice(k, k + 2), 16) * (1 - t)).toString(16).padStart(2, '0')).join('');
/**
 * The shot's own fills (D74, `s01Turrell` of tokens.ts: the kit, gadget and box role maps, the outline and the stipple's cool tint): fixed per palette like the settled ones, and brighter than the light's dots in places. Also drawn in the shot and in no
 * role map: the box's tape (`Box.tsx`: the accent at opacity 0.85 over the box's main1, a yellow no hex names) and the title lockup (`ShotS01.tsx` TitlePass: the mark, `public/mark-reversed.svg` `fill="white"`, drawn (245, 247, 246), and the
 * text in kit.light, both fading to nothing over frames 150-210, `titleOpacityAt`). The pair's own radiance and accent are the light's hues, not fills.
 * The mark's neighbourhood is centred 16 levels under its colour: the probes mask a 28-level sphere around each fill, and one around pure white would take the lamp's own white core with it. A fade is a greyer, darker blend over the field, masked at four steps.
 */
/** A colour with the lamp's white screened over it by `t` (the core and grain are screen-blended: `Core` in `ShotS01.tsx`): the tape and the accent lit by the lamp stay the tape and the accent. */
const lit = (c, t) => '#' + [1, 3, 5].map((k) => { const v = parseInt(c.slice(k, k + 2), 16); return Math.round(v + (255 - v) * t).toString(16).padStart(2, '0'); }).join('');
const TAPE = mix(s01Turrell.box.accent, s01Turrell.box.main1, 0.85);
const yellowLit = [0.25, 0.5, 0.75].flatMap((t) => [lit(TAPE, t), lit(s01Turrell.accent, t)]);
const MARK = '#f5f7f6', MARK_MASKED = '#e5e7e6';
const titleFade = [0.8, 0.6, 0.4, 0.2].flatMap((t) => [mix(MARK, settled.field, t), mix(settled.kit.light, settled.field, t)]);
const shotKit = [...Object.values(s01Turrell.kit), ...Object.values(s01Turrell.box), s01Turrell.outline, s01Turrell.cool, TAPE, ...yellowLit, MARK_MASKED, ...titleFade];
const shotGadget = Object.values(s01Turrell.gadget);

/** A world's own texture colours: its `field` (the crayon world's paper is brighter than any light), `line.hex`, `shading.edgeColour` and every value of `stroke.palette`. Not `radiance.colour`: the light is what the beat grades. */
const worldColours = (w) => [w.field, w.line?.hex, w.shading?.edgeColour, ...Object.values(w.stroke?.palette ?? {})].filter(Boolean);
const worlds = Object.fromEntries(
  fs.readdirSync(path.join(root, 'v3/worlds')).filter((f) => f.endsWith('.json')).map((f) => [f.slice(0, -5), worldColours(JSON.parse(fs.readFileSync(path.join(root, 'v3/worlds', f), 'utf8')))]),
);

const roles = {
  note: 'Fixed fills: identity pigments never grade (C1/C2), the human\'s, kit and gadget roles are fixed per palette, not per beat, and each world\'s texture colours are the look track\'s, not the radiance. The frame probes mask a neighbourhood of each. Written by scripts/animation/compile-roles.mjs from src/library/tokens.ts (the settled palette and, in kit and gadget, the shot palette s01Turrell with the box tape and the title mark); do not edit.',
  identity: {codex: Object.values(identity.codex), clawd: Object.values(identity.clawd), humanSkin: Object.values(identity.humanSkin)},
  human: Object.values(settled.human),
  kit: [...Object.values(settled.kit), ...shotKit],
  gadget: [...Object.values(settled.gadget), ...shotGadget],
  worlds,
  /** The shaded world's own emissive tints (shaded.tsx `Gate`: `mix(edge, '#c8f6ff', ...)` and `mix(edge, '#8fdcf2', ...)`): its bloom runs from the edge colour toward them. Code constants, not in the world JSON. */
  emissive: ['#c8f6ff', '#8fdcf2'],
  /** Plates a role-mapped fill is not enough for: the human is drawn from this texture (MeshFigure's useFigureTexture), whose pale contour and shading are not the five role colours. The probes sample its palette. */
  plates: ['assets/human/cutout.png'],
  /** A world's reference render (the world-sheet still the byte-identity baselines pin) whose palette is the world's own, bloom and all: the shaded world's emissive edges are lit past any colour its JSON names. The probes sample it like a plate. */
  sheets: ['out/baseline/final-world-sheet-Shaded.png'],
  field: settled.field,
  outline: settled.outline,
};
fs.writeFileSync(outPath, JSON.stringify(roles, null, 2) + '\n');
const n = new Set([...roles.identity.codex, ...roles.identity.clawd, ...roles.identity.humanSkin, ...roles.human, ...roles.kit, ...roles.gadget, ...Object.values(worlds).flat(), ...roles.emissive]).size;
console.log(`roles: ${n} distinct fixed colours -> ${path.relative(root, outPath)}`);
