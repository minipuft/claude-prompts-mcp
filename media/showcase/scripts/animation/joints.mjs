#!/usr/bin/env node
// Writes the joints a shot's renderer draws, frame by frame: the input of scripts/animation/probe-inbetweens.py.
// usage: node scripts/animation/joints.mjs <shot-id> [--out out/<shot>-joints.json]      (npm run joints -- <shot-id>)
// It loads the shot's plan (the module its composition draws from, which already runs poseAt on twos) through load-ts.mjs and writes
//   {shot, fps, frames: [first, last), parents, rows: [{frame, phase, from, to, favour, camera, joints}]}
// for every frame of the shot. `phase`/`from`/`to`/`favour` say what the frame is (describeFrame: key, hold or breakdown between two keys); `camera` is the
// stage camera of the frame (probe-inbetweens inverts it to cut the figure out of a moving frame); `joints` are the joint positions in the key sheet's space.
// Rows are exactly what the renderer draws, so odd frames repeat the even frame before them. Add a shot by naming its plan below.
import fs from 'node:fs';
import path from 'node:path';
import {loadTs, root} from './load-ts.mjs';

/** shot id -> the module that exports `stateAt(frame)` (with `.pose`, `.poseInfo`, `.camera`) and `chart` (fps, frames), and the module that exports `jointParents`. */
const PLANS = {'s01-arrival-overwhelm': {plan: 'src/scenes/shotS01Plan.ts', parents: 'src/library/cast/humanPose.ts'}};

const shot = process.argv[2];
if (!shot || shot.startsWith('--') || !PLANS[shot]) {
  console.error(`usage: node scripts/animation/joints.mjs <shot-id> [--out <file>]; shots: ${Object.keys(PLANS).join(', ')}`);
  process.exit(2);
}
const o = process.argv.indexOf('--out');
const outPath = path.resolve(root, o > -1 ? process.argv[o + 1] : `out/${shot}-joints.json`);

const {stateAt, chart} = await loadTs(PLANS[shot].plan);
const {jointParents} = await loadTs(PLANS[shot].parents);
const round = (v) => Math.round(v * 1000) / 1000;
const [first, last] = chart.frames;
const rows = [];
for (let frame = first; frame < last; frame++) {
  const s = stateAt(frame);
  rows.push({
    frame,
    phase: s.poseInfo.phase,
    from: s.poseInfo.from,
    to: s.poseInfo.to,
    favour: s.poseInfo.favour,
    camera: {x: round(s.camera.x), y: round(s.camera.y), zoom: round(s.camera.zoom), rot: round(s.camera.rotation)},
    joints: Object.fromEntries(Object.entries(s.pose).map(([n, p]) => [n, [round(p[0]), round(p[1])]])),
  });
}
fs.mkdirSync(path.dirname(outPath), {recursive: true});
fs.writeFileSync(outPath, JSON.stringify({shot, fps: chart.fps, frames: [first, last], parents: jointParents, rows}) + '\n');
const drawings = rows.filter((r, i) => i === 0 || JSON.stringify(r.joints) !== JSON.stringify(rows[i - 1].joints)).length;
console.log(`joints: ${rows.length} rows (${drawings} distinct drawings) for ${shot}, frames ${first}-${last - 1} -> ${path.relative(root, outPath)}`);
process.exit(rows.length === last - first ? 0 : 1);
