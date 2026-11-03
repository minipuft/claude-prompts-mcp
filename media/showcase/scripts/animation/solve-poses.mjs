#!/usr/bin/env node
// Writes the joints `solvePose` draws for every key of a pose sheet back into the sheet as `solved: {joint: [x, y]}` (the key sheet's joint names) and `solvedAt`.
// The rest skeleton is the one check-pose.mjs solves from: assets/human/skeleton.json at restHeightPx 922, scaled to the sheet's heightPx.
// `probe-poses.py --joints solved` measures these joints; run this again after any change to a key's lineOfAction, weight, lead or heightPx.
// usage: node scripts/animation/solve-poses.mjs <shot-id | path/to/poses.json>   (npm run solve-poses -- <shot-id>)   exit 0 written, 2 input error
import fs from 'node:fs';
import path from 'node:path';
import {loadTs, root} from './load-ts.mjs';

const arg = process.argv[2];
if (!arg || arg.startsWith('--')) {
  console.error('usage: solve-poses.mjs <shot-id | path/to/poses.json>');
  process.exit(2);
}
const file = arg.endsWith('.json') ? path.resolve(root, arg) : path.join(root, 'v3/poses', `${arg}.json`);
if (!fs.existsSync(file)) {
  console.error(`input error: ${file} does not exist`);
  process.exit(2);
}
const {parsePoseSheet, solvePose, spineCurve} = await loadTs('src/library/animation/pose.ts');
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const sheet = parsePoseSheet(structuredClone(raw));
const skeleton = JSON.parse(fs.readFileSync(path.join(root, 'assets/human/skeleton.json'), 'utf8')).skeleton;
const rest = {joints: Object.fromEntries(skeleton.map((j) => [j.name, j.loc])), restHeightPx: 922};
const round = (p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];
const solvedAt = new Date().toISOString().slice(0, 10);
for (const key of raw.keys) {
  const spec = sheet.keys.find((k) => k.name === key.name);
  const joints = solvePose(spec, rest, sheet.heightPx);
  key.solved = Object.fromEntries(Object.entries(joints).map(([n, p]) => [n, round(p)]));
  key.solvedAt = solvedAt;
  const got = spineCurve(joints, sheet.heightPx);
  console.log(`${key.name}: declared ${spec.lineOfAction.class} bow ${spec.lineOfAction.bow}; solved reads ${got.class} bow ${got.bow.toFixed(3)}`);
}
fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n');
console.log(`wrote solved joints for ${raw.keys.length} keys to ${path.relative(root, file)} (${solvedAt})`);
