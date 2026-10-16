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
const {identity, settled} = await loadTs('src/library/tokens.ts');

/** A world's own texture colours: its `field` (the crayon world's paper is brighter than any light), `line.hex`, `shading.edgeColour` and every value of `stroke.palette`. Not `radiance.colour`: the light is what the beat grades. */
const worldColours = (w) => [w.field, w.line?.hex, w.shading?.edgeColour, ...Object.values(w.stroke?.palette ?? {})].filter(Boolean);
const worlds = Object.fromEntries(
  fs.readdirSync(path.join(root, 'v3/worlds')).filter((f) => f.endsWith('.json')).map((f) => [f.slice(0, -5), worldColours(JSON.parse(fs.readFileSync(path.join(root, 'v3/worlds', f), 'utf8')))]),
);

const roles = {
  note: 'Fixed fills: identity pigments never grade (C1/C2), the human\'s, kit and gadget roles are fixed per palette, not per beat, and each world\'s texture colours are the look track\'s, not the radiance. The frame probes mask a neighbourhood of each. Written by scripts/animation/compile-roles.mjs from src/library/tokens.ts; do not edit.',
  identity: {codex: Object.values(identity.codex), clawd: Object.values(identity.clawd), humanSkin: Object.values(identity.humanSkin)},
  human: Object.values(settled.human),
  kit: Object.values(settled.kit),
  gadget: Object.values(settled.gadget),
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
