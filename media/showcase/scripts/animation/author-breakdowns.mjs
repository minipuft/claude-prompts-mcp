#!/usr/bin/env node
// Writes authored `joints` into the breakdowns of the named moves of a pose sheet, for a move whose angle-space blend (`breakdownPose`) swings a limb round a bone
// longer than the move: each drawing is the straight world-space blend of the two keys (position along the chord = `chordPosition`, so an anticipation sits behind
// the from-key and an overshoot past the to-key), plus an arc: every joint is pushed off its chord by `rootArc` x w(t) perpendicular to the ROOT's chord (the body
// travels on an arc, head and arms with it), and the lead wrist (and half of the elbow) by `wristArc` x w(t) perpendicular to its OWN chord, with w(t) = sin(pi t)
// inside the move and `outside` (default 0.35) of the peak for an anticipation or an overshoot, so every drawing of a move bows to the same side.
// usage: node scripts/animation/author-breakdowns.mjs <poses.json> "<from>><to>:<rootArcPx>:<wristArcPx>[:<wristJoint>]" ...   (writes the sheet; run `npm run solve-poses` after)
// The numbers are the author's: key joints changed -> run again. A breakdown written here carries `authored: "world blend + arc"` and `keysHash`, the sha256 of the joints of the two keys it was built
// on (probe_common.keys_hash writes the same string): `probe-poses.py` refuses an authored breakdown whose keys have moved since, so a re-solved or re-plated key cannot leave a stale drawing behind.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {loadTs, root} from './load-ts.mjs';

const [file, ...specs] = process.argv.slice(2);
if (!file || !specs.length) {
  console.error('usage: author-breakdowns.mjs <poses.json> "<from>><to>:<rootArcPx>:<wristArcPx>[:<wristJoint>]" ...');
  process.exit(2);
}
const {chordPosition} = await loadTs('src/library/animation/pose.ts');
const posesPath = path.resolve(root, file);
const sheet = JSON.parse(fs.readFileSync(posesPath, 'utf8'));
const keySheet = JSON.parse(fs.readFileSync(path.join(root, sheet.source.keys), 'utf8'));
const joints = (name) => keySheet.keys.find((k) => k.name === name).joints;
// the same string probe_common.keys_hash builds: joints in name order as `name=x,y` at two decimals, the two keys joined by `|`
const keysHash = (a, b) => {
  const one = (j) => Object.keys(j).sort().map((n) => `${n}=${j[n][0].toFixed(2)},${j[n][1].toFixed(2)}`).join(';');
  return crypto.createHash('sha256').update(`${one(a)}|${one(b)}`).digest('hex');
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const unit = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
const right = (u) => [-u[1], u[0]];
const OUTSIDE = 0.35;
for (const spec of specs) {
  const [move, rootArc, wristArc, wristJoint] = spec.split(':');
  const [from, to] = move.split('>');
  const a = joints(from), b = joints(to), toKey = sheet.keys.find((k) => k.name === to);
  const wj = wristJoint ?? (toKey.lead.arm === 'none' ? null : `wrist${toKey.lead.arm}`);
  const nRoot = right(unit(sub(b.root, a.root)));
  const nWrist = wj ? right(unit(sub(b[wj], a[wj]))) : null;
  const hit = sheet.breakdowns.filter((x) => x.between[0] === from && x.between[1] === to);
  if (!hit.length) throw new Error(`no breakdowns between ${from} and ${to}`);
  for (const x of hit) {
    const t = chordPosition(x);
    const w = t >= 0 && t <= 1 ? Math.sin(Math.PI * t) : OUTSIDE;
    const pose = {};
    for (const [n, p] of Object.entries(a)) {
      const q = b[n];
      pose[n] = [p[0] + (q[0] - p[0]) * t + nRoot[0] * Number(rootArc) * w, p[1] + (q[1] - p[1]) * t + nRoot[1] * Number(rootArc) * w];
    }
    if (wj) {
      const side = wj.slice(-1), share = {[`elbow${side}`]: 0.5, [wj]: 1};
      for (const [n, k] of Object.entries(share)) pose[n] = [pose[n][0] + nWrist[0] * Number(wristArc) * w * k, pose[n][1] + nWrist[1] * Number(wristArc) * w * k];
    }
    x.joints = Object.fromEntries(Object.entries(pose).map(([n, p]) => [n, [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]]));
    x.arc = {joint: x.arc?.joint ?? 'root', offsetPx: Number(rootArc) * (x.kind === 'settle' ? 0 : 1) * (w > 0 ? 1 : 0)};
    x.authored = 'world blend + arc';
    x.keysHash = keysHash(a, b);
  }
  console.log(`${move}: ${hit.length} drawings, root arc ${rootArc} px${wj ? `, ${wj} arc ${wristArc} px` : ''}`);
}
fs.writeFileSync(posesPath, JSON.stringify(sheet, null, 2) + '\n');
