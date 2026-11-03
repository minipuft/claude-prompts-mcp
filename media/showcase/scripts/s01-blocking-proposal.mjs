#!/usr/bin/env node
// What shot s01's staging (v3/layouts/s01-arrival-overwhelm.json `staging`) changes against the beats' blocking files, as a proposal: the blocking files
// are another worker's and are only read. Prints one line per changed field (old -> new) and writes out/s01-blocking-proposal.diff.
// usage: node scripts/s01-blocking-proposal.mjs
import fs from 'node:fs';
import path from 'node:path';
import {loadTs, root} from './animation/load-ts.mjs';

const {blockingFiles, stagedBlocking, layout} = await loadTs('src/scenes/shotS01Plan.ts');
const st = layout.staging;
const proposals = {
  arrival: {
    'figure': stagedBlocking('arrival').figure,
    'codex': stagedBlocking('arrival').codex,
    'clawd': stagedBlocking('arrival').clawd,
    'actors.box': {x: st.box.x, y: st.box.y, scale: st.box.scale},
    'actors.bubble': {x: st.gadgetEnd.dialXY[0], y: 330, scale: 1.2},
    'emitter': {start: st.seamXY, end: st.seamXY, anchor: 'box seam'},
  },
  'everything-at-once': {
    'figure': stagedBlocking('everything-at-once').figure,
    'codex': stagedBlocking('everything-at-once').codex,
    'clawd': stagedBlocking('everything-at-once').clawd,
    'actors.box': {x: st.box.x, y: st.box.y, scale: st.box.scale},
    'actors.gadget': {x: st.gadgetEnd.dialXY[0], y: st.gadgetEnd.dialXY[1], scale: st.gadgetEnd.scale},
    'emitter': {start: [745, 330], end: st.gadgetEnd.dialXY, anchor: 'gadget dial'},
  },
};
const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const lines = [];
for (const [beat, fields] of Object.entries(proposals)) {
  lines.push(`--- v3/blocking/${beat}.json (read only)`, `+++ proposed by shot s01 (${layout.shot})`);
  for (const [field, next] of Object.entries(fields)) {
    const was = get(blockingFiles[beat], field);
    if (JSON.stringify(was) !== JSON.stringify(next)) lines.push(`@@ ${field}`, `- ${JSON.stringify(was)}`, `+ ${JSON.stringify(next)}`);
  }
}
fs.writeFileSync(path.join(root, 'out/s01-blocking-proposal.diff'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
