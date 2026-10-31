#!/usr/bin/env node
// Writes the joints a pose sheet plays, frame by frame, from the sheets alone: the input of probe-inbetweens.py and probe-followthrough.py for a shot that has no scene plan of its own (s02 and on).
// usage: node scripts/animation/played-joints.mjs <shot-id> [--out out/<shot>-joints.json] [--tail 60] [--animatic]      (npm run played-joints -- <shot-id>)
// `--animatic` writes the joints the ANIMATIC draws for that shot instead (src/scenes/animaticPlan.ts `frameState`: its pose with the derived secondaries, its body without them as the rigid ride, the xsheet's camera), over the frames of the beat that plays the shot, default out/<shot>-animatic-joints.json:
// the same probes read it, so a secondary the animatic draws is measured against its material the way the shot's own render is.
// It reads v3/poses/<shot>.json and the key sheet it names, builds the chart `poseChartFrom` plays (secondaries drawn from their material, v3/materials.json) and writes the same file scripts/animation/joints.mjs
// writes for s01: {shot, fps, frames: [first, last), parents, rows: [{frame, phase, from, to, favour, camera, joints}]}, from the first key's frame to the last key's hold plus `--tail` frames (default 60: the longest settle a
// material declares is 30), with the camera at identity (a shot's camera is its own sheet's). `sheets` carries the sha256 of the pose sheet, the key sheet and the materials file it was written from, so a probe can refuse a dump
// that is older than its sheets. Beyond joints.mjs' file it carries `heightPx`, `shotFrames` (the chart's own span: the dump runs on past it so a part can settle), `chart` (the pose sheet's secondaries, keys with holds and lead arms, breakdowns) and, on a sheet with a secondary made of a material, `rigid` on every row:
// where each such joint would be riding its primary rigidly (what the material's chain was driven by), which probe-followthrough.py measures the drawn joint against. For s01 the rows are byte-identical to joints.mjs' (its plan plays the same chart).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {loadTs, root} from './load-ts.mjs';

const shot = process.argv[2];
if (!shot || shot.startsWith('--')) {
  console.error('usage: node scripts/animation/played-joints.mjs <shot-id> [--out <file>] [--tail <frames>]');
  process.exit(2);
}
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const animatic = process.argv.includes('--animatic');
const outPath = path.resolve(root, arg('out', animatic ? `out/${shot}-animatic-joints.json` : `out/${shot}-joints.json`));
const tail = Number(arg('tail', 60));
const posesPath = path.join(root, 'v3/poses', `${shot}.json`);
if (!fs.existsSync(posesPath)) {
  console.error(`input error: ${path.relative(root, posesPath)} does not exist`);
  process.exit(2);
}
const read = (p) => fs.readFileSync(p);
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const posesBytes = read(posesPath), posesRaw = JSON.parse(posesBytes.toString('utf8'));
const keysBytes = read(path.join(root, posesRaw.source.keys)), materialsBytes = read(path.join(root, 'v3/materials.json'));
const {parsePoseSheet, poseChartFrom, poseKeySheet} = await loadTs('src/library/animation/pose.ts');
const {parseKeySheet, describeFrame} = await loadTs('src/library/animation/keys.ts');
const {poseAt, virtualJoint} = await loadTs('src/library/motion.ts');
const {jointParents} = await loadTs('src/library/cast/humanPose.ts');
const poseSheet = parsePoseSheet(posesRaw), keySheet = parseKeySheet(JSON.parse(keysBytes.toString('utf8')));
const shotFrames = JSON.parse(read(path.join(root, poseSheet.source.chart)).toString('utf8')).frames;
const chart = poseChartFrom(poseSheet, keySheet, jointParents), described = poseKeySheet(poseSheet, keySheet);
const round = (v) => Math.round(v * 1000) / 1000;
let first = Math.min(...keySheet.keys.map((k) => k.frame)), last = Math.max(...keySheet.keys.map((k) => k.frame + (k.hold ?? 0))) + tail;
const plan = animatic ? await loadTs('src/scenes/animaticPlan.ts') : null;
if (plan) {
  const beats = plan.timeline.beats.filter((b) => plan.frameState(b.start).sheet.shot === shot);
  if (!beats.length) { console.error(`input error: no beat of the animatic plays ${shot}`); process.exit(2); }
  first = beats[0].start; last = beats[beats.length - 1].end;
}
const rows = [];
const rounded = (pose) => Object.fromEntries(Object.entries(pose).map(([n, p]) => [n, [round(p[0]), round(p[1])]]));
// where each part made of a material would be if it rode its primary rigidly: the chart with its derived secondaries taken out (drifts stay, they move the whole figure), which is the path the material's chain was driven by
const bare = {...chart, follows: undefined};
const derived = (chart.follows ?? []).flatMap((f) => f.joints.map((name) => ({name, virtual: f.virtual})));
for (let frame = first; frame < last; frame++) {
  const at = plan ? plan.frameState(frame) : null;
  const info = at ? at.chart : describeFrame(described, frame), pose = at ? at.pose : poseAt(chart, frame, jointParents);
  const row = {frame, phase: info.phase, from: info.from, to: info.to, favour: info.favour, camera: at ? at.camera : {x: 640, y: 360, zoom: 1, rot: 0}, joints: rounded(pose)};
  if (derived.length) {
    const ride = at ? at.bodyPose : poseAt(bare, frame, jointParents);
    row.rigid = rounded(Object.fromEntries(derived.map(({name, virtual}) => [name, virtual ? virtualJoint(virtual, ride) : ride[name]])));
  }
  rows.push(row);
}
const compact = {
  secondaries: poseSheet.secondaries,
  keys: poseSheet.keys.map((k) => ({name: k.name, frame: k.frame, hold: keySheet.keys.find((n) => n.name === k.name)?.hold ?? k.hold ?? 0, lead: k.lead})),
  breakdowns: poseSheet.breakdowns.map((b) => ({between: b.between, frame: b.frame, kind: b.kind, favour: b.favour, ...(b.contact ? {contact: b.contact} : {})})),
};
fs.mkdirSync(path.dirname(outPath), {recursive: true});
fs.writeFileSync(outPath, JSON.stringify({shot, fps: 30, frames: [first, last], heightPx: poseSheet.heightPx, shotFrames, parents: jointParents, chart: compact, sheets: {poses: sha(posesBytes), keys: sha(keysBytes), materials: sha(materialsBytes)}, rows}) + '\n');
const drawings = rows.filter((r, i) => i === 0 || JSON.stringify(r.joints) !== JSON.stringify(rows[i - 1].joints)).length;
console.log(`played joints: ${rows.length} rows (${drawings} distinct drawings) for ${shot}, frames ${first}-${last - 1} -> ${path.relative(root, outPath)}`);
