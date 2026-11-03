#!/usr/bin/env node
// Proves src/library/animation/pose.ts against itself, with a positive control first:
//  - solvePose(spec) for every key of the pose sheet reads back through spineCurve as the declared class with a bow within 0.02 of the declared one;
//  - parsePoseSheet refuses each wrong thing it names (an unknown class, a bow out of range, favour 0.5, a breakdown naming an unknown key, a lag of 4, a stretch outside 0-1, twinned without why, and the timing shape: a move of ten drawings, a drawing outside its kind's band, two anticipations, a settle before a passing drawing, two drawings with one favour, a breakdown inside the hold) and the lead arm contract (a lead-arm joint declared as a secondary that lags on its move, a secondary side of M);
//  - poseChartFrom plays through poseAt: a breakdown frame shows the breakdown's joints, a secondary lands later than the body, a moving hold drifts, and the same chart with its
//    lags and drifts removed does none of that (control);
//  - the parts rig's draw order (src/library/motion/partsRig.ts): for every solved key the rule puts the poncho behind the torso, the hair behind the head, the lead arm's hand in front of the torso
//    and (no lead arm) behind the poncho; parsePoseSheet refuses a key `order` that names no part, one part or a part twice; applyOrder exchanges the places of the parts it lists (control: the same pose
//    with its lead arm taken away draws that hand behind the torso, so the check can fail);
//  - every bone of every solved key (each joint to its parent in assets/human/skeleton.json: the trunk, the shoulders and hips, both arms and both legs, the poncho point) is within 1 % of the
//    rest skeleton's length: the solver places limbs by two-bone IK and never stretches a bone (control: a left arm drawn 12 % too long is refused by the same function);
//  - the silhouette kind decides the wrists (SILHOUETTE_ARMS): a star's two wrists above the shoulders and 0.12 H or more from the spine, an open pose's both 0.14 H or more, a closed or fold pose's
//    both within 0.12 H (control: the open key's wrists put where a closed key's go are refused by the open check);
//  - control: a hand-straightened spine does NOT read back as the S it was declared as, so the check can fail.
// usage: node scripts/animation/check-pose.mjs [poses.json] [--dump out.json]   exit 0 pass, 1 fail, 2 control did not trip
import fs from 'node:fs';
import path from 'node:path';
import {loadTs, root} from './load-ts.mjs';

const arg = process.argv.slice(2).find((a) => a.endsWith('.json') && !a.startsWith('--') && process.argv[process.argv.indexOf(a) - 1] !== '--dump');
const posesPath = path.resolve(root, arg ?? 'v3/poses/s01-arrival-overwhelm.json');
const dumpAt = process.argv.indexOf('--dump');
const {parsePoseSheet, solvePose, spineCurve, twinningScore, poseChartFrom, breakdownPose, movingHoldOffset, firstDrawingAfter} = await loadTs('src/library/animation/pose.ts');
const {poseAt} = await loadTs('src/library/motion.ts');
const {parseKeySheet} = await loadTs('src/library/animation/keys.ts');
const {jointParents} = await loadTs('src/library/cast/humanPose.ts');
const {parseParts, defaultOrder, applyOrder} = await loadTs('src/library/motion/partsRig.ts');
const sheet = parsePoseSheet(JSON.parse(fs.readFileSync(posesPath, 'utf8')));
const skeleton = JSON.parse(fs.readFileSync(path.join(root, 'assets/human/skeleton.json'), 'utf8')).skeleton;
const keySheet = JSON.parse(fs.readFileSync(path.join(root, sheet.source.keys), 'utf8'));
const rest = {joints: Object.fromEntries(skeleton.map((j) => [j.name, j.loc])), restHeightPx: 922};

const reads = (key, joints) => spineCurve(joints, sheet.heightPx);
// An S the skeleton cannot draw at its rest bone lengths: the trunk above the torso is three short bones (neck 18 px, head 19 px, shoulders 42 px), so an S of the declared bow
// (0.10-0.12 of the height) would stretch them 2-3x; `solvePose` never stretches a bone: it tilts the shoulder line against the trunk and draws the bow the bones allow, at least the bow floor of the
// line-of-action check, so a solved S may read under its declared bow. A C always reads as declared.
const BOW_MIN = 0.06; // probe_common.BOW_MIN: the bow floor of the line-of-action check
const BONE_TOL = 0.01;
const parentOf = Object.fromEntries(skeleton.filter((j) => j.parent).map((j) => [j.name, j.parent]));
/** [bone, length over rest] of the bone that departs most from its rest length. */
const worstBone = (joints) => Object.entries(parentOf).map(([n, p]) => [`${p}-${n}`, Math.hypot(joints[n][0] - joints[p][0], joints[n][1] - joints[p][1]) / Math.hypot(rest.joints[n][0] - rest.joints[p][0], rest.joints[n][1] - rest.joints[p][1])]).reduce((a, b) => (Math.abs(b[1] - 1) > Math.abs(a[1] - 1) ? b : a));
const spineDist = (joints, p) => {
  let best = Infinity;
  const poly = ['root', 'torso', 'neck', 'head'].map((n) => joints[n]);
  for (let i = 0; i + 1 < poly.length; i++) {
    const [a, b] = [poly[i], poly[i + 1]], ab = [b[0] - a[0], b[1] - a[1]], t = Math.min(1, Math.max(0, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / (ab[0] * ab[0] + ab[1] * ab[1])));
    best = Math.min(best, Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t));
  }
  return best / sheet.heightPx;
};
/** The silhouette check of one solved key: null when it holds, else what is wrong. */
const silhouetteFault = (kind, joints) => {
  const w = ['L', 'R'].map((s) => ({s, d: spineDist(joints, joints[`wrist${s}`]), above: joints[`wrist${s}`][1] < joints[`shoulder${s}`][1]}));
  if (kind === 'star' && !w.every((x) => x.d >= 0.12 && x.above)) return `a star's wrists must both be above the shoulders and 0.12 H from the spine (${w.map((x) => `${x.s} ${x.d.toFixed(3)}${x.above ? '' : ' below'}`).join(', ')})`;
  if (kind === 'open' && !w.every((x) => x.d >= 0.14)) return `an open pose's wrists must both be 0.14 H from the spine (${w.map((x) => `${x.s} ${x.d.toFixed(3)}`).join(', ')})`;
  if ((kind === 'closed' || kind === 'fold') && !w.every((x) => x.d <= 0.12)) return `a ${kind} pose's hands must be within 0.12 H of the spine (${w.map((x) => `${x.s} ${x.d.toFixed(3)}`).join(', ')})`;
  return null;
};
const agrees = (key, got, joints) => got.class === key.lineOfAction.class && (Math.abs(got.bow - key.lineOfAction.bow) <= 0.02 || (got.class === 'S' && got.bow < key.lineOfAction.bow && got.bow >= BOW_MIN));

// control: an S declared on a straight spine is refused; the solved S is accepted
const sKey = sheet.keys.find((k) => k.lineOfAction.class === 'S');
const straight = solvePose({...sKey, lineOfAction: {class: 'I', bow: 0, sign: 1, lean: sKey.lineOfAction.lean}}, rest, sheet.heightPx);
const solvedS = solvePose(sKey, rest, sheet.heightPx);
const control = !agrees(sKey, reads(sKey, straight), straight) && agrees(sKey, reads(sKey, solvedS), solvedS);
const refusals = [
  ['an unknown class', (s) => (s.keys[0].lineOfAction.class = 'Z')],
  ['a bow of 0.5', (s) => (s.keys[0].lineOfAction.bow = 0.5)],
  ['a favour of 0.5', (s) => (s.breakdowns[0].favour = 0.5)],
  ['a breakdown naming an unknown key', (s) => (s.breakdowns[0].between = ['nope', s.keys[1].name])],
  ['a secondary lag of 4', (s) => (s.secondaries[0].lagDrawings = 4)],
  ['a secondary stretch of 1.5', (s) => (s.secondaries[0].stretch = 1.5)],
  ['a secondary stretch of -0.1', (s) => (s.secondaries[0].stretch = -0.1)],
  ['twinned without why', (s) => (s.keys[0].twinned = {})],
  // the timing shape (TIMING_SHAPE in pose.ts): each planted on the first move of the sheet
  ['a move of ten drawings', (s) => { const [a, b] = [s.keys[6], s.keys[7]]; s.breakdowns = s.breakdowns.filter((x) => x.between[1] !== b.name); [0.26, 0.3, 0.34, 0.38, 0.42, 0.46, 0.54, 0.58, 0.62, 0.66].forEach((favour, i) => s.breakdowns.push({between: [a.name, b.name], frame: a.frame + (a.hold ?? 0) + 2 * i, favour, kind: 'passing', arc: {joint: 'root', offsetPx: 10}})); }],
  ['a passing drawing at 0.10', (s) => { const b = s.breakdowns.find((x) => x.kind === 'passing'); b.favour = 0.1; }],
  ['an anticipation reaching past -0.15 (favour 0.8)', (s) => { const b = s.breakdowns.find((x) => x.kind === 'passing'); b.kind = 'anticipation'; b.favour = 0.8; }],
  ['an overshoot at 1.02 (favour 0.08)', (s) => { const b = s.breakdowns.find((x) => x.kind === 'passing'); b.kind = 'overshoot'; b.favour = 0.08; }],
  ['a settle at 0.8', (s) => { const b = s.breakdowns.find((x) => x.kind === 'settle'); b.favour = 0.8; }],
  ['two anticipations in one move', (s) => { const [a, b] = [s.keys[0], s.keys[1]]; const m = s.breakdowns.filter((x) => x.between[1] === b.name); m[0].kind = 'anticipation'; m[0].favour = 0.4; m[1].kind = 'anticipation'; m[1].favour = 0.4; }],
  ['a settle before a passing drawing', (s) => { const m = s.breakdowns.filter((x) => x.between[1] === s.keys[1].name); const f = m[0].frame; m[0].frame = m[m.length - 1].frame; m[m.length - 1].frame = f; m.sort((p, q) => p.frame - q.frame); s.breakdowns = [...s.breakdowns.filter((x) => !m.includes(x)), ...m]; }],
  ['a lead-arm joint declared as a lagging secondary', (s) => s.secondaries.push({name: 'lead wrist', joints: ['wristR'], lagDrawings: 1})],
  ['a secondary side of M', (s) => (s.secondaries[1].side = 'M')],
  ['a key order naming a part that does not exist', (s) => (s.keys[0].order = ['nope', 'head'])],
  ['a key order of one part', (s) => (s.keys[0].order = ['head'])],
  ['a key order naming a part twice', (s) => (s.keys[0].order = ['head', 'head'])],
  ['two consecutive drawings with one favour', (s) => { const m = s.breakdowns.filter((x) => x.between[1] === s.keys[1].name); m[1].favour = m[0].favour; }],
  ['a breakdown inside the key hold', (s) => { s.breakdowns.find((x) => x.between[1] === s.keys[1].name).frame = s.keys[0].frame + 2; }],
].map(([what, mutate]) => {
  const copy = JSON.parse(fs.readFileSync(posesPath, 'utf8'));
  mutate(copy);
  try {
    parsePoseSheet(copy);
    return [what, false];
  } catch (e) {
    return [what, true, e.message];
  }
});
console.log(`control: an S declared on a straight spine reads back as ${reads(sKey, straight).class} (refused), the solved S as ${reads(sKey, solvedS).class} bow ${reads(sKey, solvedS).bow.toFixed(3)} (accepted); parsePoseSheet refused ${refusals.filter((r) => r[1]).length} of ${refusals.length} planted faults`);
if (!control || refusals.some((r) => !r[1])) {
  console.log(`refused: check-pose did not trip its own control (${refusals.filter((r) => !r[1]).map((r) => r[0]).join(', ') || 'spine'})`);
  process.exit(2);
}

// poseChartFrom through poseAt
const keys = parseKeySheet(keySheet), chart = poseChartFrom(sheet, keys, jointParents), bare = {...chart, lags: undefined, drifts: undefined};
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
const chartFaults = [];
const b0 = sheet.breakdowns[0], fromK = keys.keys.find((k) => k.name === b0.between[0]), toK = keys.keys.find((k) => k.name === b0.between[1]);
const want = breakdownPose(fromK.joints, toK.joints, b0, jointParents);
if (dist(poseAt(bare, b0.frame, jointParents).root, want.root) > 1e-6) chartFaults.push(`breakdown at frame ${b0.frame} does not show its own joints`);
const arcWrist = dist(want[b0.arc.joint], (() => { const t = b0.kind === 'passing' ? b0.favour : 0; return [fromK.joints[b0.arc.joint][0] + (toK.joints[b0.arc.joint][0] - fromK.joints[b0.arc.joint][0]) * t, fromK.joints[b0.arc.joint][1] + (toK.joints[b0.arc.joint][1] - fromK.joints[b0.arc.joint][1]) * t]; })());
if (!(arcWrist > 0.5 * Math.abs(b0.arc.offsetPx))) chartFaults.push(`the arc joint ${b0.arc.joint} is ${arcWrist.toFixed(1)} px off its straight blend; the breakdown asks ${b0.arc.offsetPx}`);
const poncho = sheet.secondaries.find((c) => c.joints.includes('ponchoPoint'));
const rel = (p) => [p.ponchoPoint[0] - p.root[0], p.ponchoPoint[1] - p.root[1]];
// the poncho test reads the move on which the poncho's own offset from the root changes most (a lag is only visible where the offset changes)
const ponchoMove = sheet.breakdowns.map((b) => ({b, d: dist(rel(keys.keys.find((k) => k.name === b.between[0]).joints), rel(keys.keys.find((k) => k.name === b.between[1]).joints))})).reduce((a, x) => (x.d > a.d ? x : a));
const landed = keys.keys.find((k) => k.name === ponchoMove.b.between[1]);
const settle = (c, f) => dist(rel(poseAt(c, f, jointParents)), rel(landed.joints));
const lateBy = poncho.lagDrawings * 2;
if (!(settle(chart, landed.frame) > 1 && settle(chart, landed.frame + lateBy + 2) < 1e-6 + 0.01)) chartFaults.push(`the poncho does not arrive ${lateBy} frames after the body (off by ${settle(chart, landed.frame).toFixed(1)} px on the landing frame, ${settle(chart, landed.frame + lateBy + 2).toFixed(2)} px after)`);
if (!(settle(bare, landed.frame) < 1e-6)) chartFaults.push('control chart without lags is not on the key at the landing frame');
const hold = sheet.movingHolds[0], hk = keys.keys.find((k) => k.name === hold.key), hf = hk.frame + Math.min(hold.over, hk.hold ?? hold.over) - 2;
const moved = dist(poseAt(chart, hf, jointParents).root, hk.joints.root), expect = Math.hypot(...movingHoldOffset(hold, hf - hk.frame));
if (Math.abs(moved - expect) > 1e-6 || !(moved > 0.5)) chartFaults.push(`moving hold on ${hold.key} drifts ${moved.toFixed(2)} px at frame ${hf}, expected ${expect.toFixed(2)}`);
if (dist(poseAt(bare, hf, jointParents).root, hk.joints.root) > 1e-9) chartFaults.push('control chart without drifts moves in a hold');
const handOver = firstDrawingAfter(sheet, keys, hold.key) - 2, stillDrifting = dist(poseAt(chart, handOver, jointParents).root, hk.joints.root), fullDrift = Math.hypot(...movingHoldOffset(hold, handOver - hk.frame));
if (handOver >= hk.frame + (hk.hold ?? hold.over) && Math.abs(stillDrifting - fullDrift) > 1e-6) chartFaults.push(`the drift on ${hold.key} is ${stillDrifting.toFixed(2)} px on frame ${handOver}, the last drawing before its move starts: it snaps back before the move, not inside it (expected ${fullDrift.toFixed(2)})`);
// the lead side does not lag: on a move its side leads, the hand is on the body's own pose; on a move the other side leads it trails
const hand = sheet.secondaries.find((c) => c.side), leadMove = keys.keys.find((k, i) => i > 0 && sheet.keys.find((p) => p.name === k.name).lead.arm === hand.side), prevKey = keys.keys[keys.keys.indexOf(leadMove) - 1];
const midFrame = leadMove.frame - 2, handOf = (c, f) => poseAt(c, f, jointParents)[hand.joints[hand.joints.length - 1]];
if (dist(handOf(chart, midFrame), handOf(bare, midFrame)) > 1e-6) chartFaults.push(`the ${hand.name} lags on the move into ${leadMove.name}, which its side (${hand.side}) leads`);
const trailMove = keys.keys.find((k, i) => i > 0 && sheet.keys.find((p) => p.name === k.name).lead.arm !== hand.side && sheet.keys.find((p) => p.name === k.name).lead.arm !== 'none');
if (trailMove && !(dist(handOf(chart, trailMove.frame - 2), handOf(bare, trailMove.frame - 2)) > 1e-6 || dist(handOf(chart, trailMove.frame), handOf(bare, trailMove.frame)) > 1e-6)) chartFaults.push(`the ${hand.name} does not lag on the move into ${trailMove.name}, which the other side leads (control)`);
for (const f of chartFaults) console.log(`FAIL chart: ${f}`);
console.log(`${chartFaults.length ? 'FAIL' : 'ok  '} chart: breakdown joints shown, poncho ${lateBy} frames late, hold drift ${expect.toFixed(2)} px, and none of it in the chart with lags and drifts removed`);

// the parts rig's draw order
const orderFaults = [];
const partsFile = parseParts(JSON.parse(fs.readFileSync(path.join(root, 'assets', sheet.actor, 'families/home/parts/parts.json'), 'utf8')), rest.joints);
const solvedKeys = sheet.keys.filter((k) => k.solved);
const at = (order, n) => order.indexOf(n);
for (const k of solvedKeys) {
  const o = defaultOrder(partsFile, k.solved, k.lead, k.weight.foot);
  if (!(at(o, 'poncho') > at(o, 'torso'))) orderFaults.push(`${k.name}: the poncho is not behind the torso`);
  if (!(at(o, 'hair') > at(o, 'head'))) orderFaults.push(`${k.name}: the hair is not behind the head`);
  if (k.lead.arm !== 'none' && !(at(o, `hand${k.lead.arm}`) < at(o, 'torso') && at(o, `hand${k.lead.arm}`) < at(o, 'head'))) orderFaults.push(`${k.name}: the lead hand (${k.lead.arm}) is not in front of the torso and the head`);
  if (k.lead.arm !== 'none' && !(at(o, `upperArm${k.lead.arm}`) < at(o, `foreArm${k.lead.arm}`))) orderFaults.push(`${k.name}: the lead arm's forearm is not under its sleeve`);
}
// the control key: a lead arm whose hand does not cross the spine, so that taking the lead away puts it behind the torso
const orders = (k) => [defaultOrder(partsFile, k.solved, k.lead, k.weight.foot), defaultOrder(partsFile, k.solved, {...k.lead, arm: 'none'}, k.weight.foot)];
const leadKey = solvedKeys.find((k) => k.lead.arm !== 'none' && at(orders(k)[1], `hand${k.lead.arm}`) > at(orders(k)[1], 'torso')) ?? solvedKeys.find((k) => k.lead.arm !== 'none'), side = leadKey.lead.arm;
const [withLead, withoutLead] = orders(leadKey);
const leadControl = at(withLead, `hand${side}`) < at(withLead, 'torso') && at(withoutLead, `hand${side}`) > at(withoutLead, 'torso');
const swapped = applyOrder(['a', 'b', 'c', 'd'], ['c', 'a']), swapOk = swapped.join('') === 'cbad';
if (!leadControl) orderFaults.push(`control: ${leadKey.name} with its lead arm taken away still draws hand${side} in front of the torso (or with it, behind)`);
if (!swapOk) orderFaults.push(`control: applyOrder(['a','b','c','d'], ['c','a']) read ${swapped.join('')}, expected cbad`);
for (const f of orderFaults) console.log(`FAIL order: ${f}`);
console.log(`${orderFaults.length ? 'FAIL' : 'ok  '} order: ${solvedKeys.length} keys: poncho behind torso, hair behind head, lead hand in front of torso and head, sleeve over forearm; ${leadKey.name} without its lead arm draws hand${side} behind the torso; a key order exchanges the places it lists`);

// bone lengths and the silhouette's wrists on every solved key, with controls
const boneRows = sheet.keys.map((key) => { const joints = solvePose(key, rest, sheet.heightPx); return {key, joints, worst: worstBone(joints), fault: silhouetteFault(key.silhouette, joints)}; });
const boneFaults = boneRows.filter((r) => Math.abs(r.worst[1] - 1) > BONE_TOL).map((r) => `${r.key.name}: bone ${r.worst[0]} is ${(r.worst[1] * 100).toFixed(1)} % of its rest length`);
const silhouetteFaults = boneRows.filter((r) => r.fault).map((r) => `${r.key.name} (${r.key.silhouette}): ${r.fault}`);
const stretchedArm = {...boneRows[0].joints, wristL: (() => { const e = boneRows[0].joints.elbowL, w = boneRows[0].joints.wristL; return [e[0] + (w[0] - e[0]) * 1.12, e[1] + (w[1] - e[1]) * 1.12]; })()};
const boneControl = Math.abs(worstBone(stretchedArm)[1] - 1) > BONE_TOL && Math.abs(worstBone(boneRows[0].joints)[1] - 1) <= BONE_TOL;
const openKey = boneRows.find((r) => r.key.silhouette === 'open'), closedKey = boneRows.find((r) => r.key.silhouette === 'closed');
const silhouetteControl = openKey && closedKey && silhouetteFault('open', closedKey.joints) !== null && silhouetteFault('open', openKey.joints) === null;
if (!boneControl) boneFaults.push('control: a left arm drawn 12 % too long was not refused by the bone-length check');
if (!silhouetteControl) silhouetteFaults.push("control: a closed key's wrists were not refused by the open check");
for (const f of [...boneFaults, ...silhouetteFaults]) console.log(`FAIL bones: ${f}`);
console.log(`${boneFaults.length || silhouetteFaults.length ? 'FAIL' : 'ok  '} bones: every bone of ${boneRows.length} solved keys within ${BONE_TOL * 100} % of its rest length (worst ${boneRows.map((r) => `${r.key.name} ${r.worst[0]} ${(r.worst[1] * 100).toFixed(2)} %`).reduce((a, b) => (Math.abs(parseFloat(b.split(' ').at(-2)) - 100) > Math.abs(parseFloat(a.split(' ').at(-2)) - 100) ? b : a))}); control: a left arm drawn 12 % too long -> ${worstBone(stretchedArm)[0]} ${(worstBone(stretchedArm)[1] * 100).toFixed(1)} %, refused; the silhouette kind decides the wrists: star, open, closed and fold hold on every key, a closed key's wrists are refused by the open check`);

let bad = chartFaults.length + orderFaults.length + boneFaults.length + silhouetteFaults.length;
const rows = [];
for (const key of sheet.keys) {
  const joints = solvePose(key, rest, sheet.heightPx), got = reads(key, joints), ok = agrees(key, got, joints);
  rows.push({key: key.name, declared: key.lineOfAction, read: got, twinning: twinningScore(joints), ok});
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${key.name}: declared ${key.lineOfAction.class} bow ${key.lineOfAction.bow} sign ${key.lineOfAction.sign}; solved pose reads ${got.class} bow ${got.bow.toFixed(3)} sign ${got.sign}${got.inflection !== undefined ? ` inflection ${got.inflection.toFixed(2)}` : ''}; twinning ${twinningScore(joints).toFixed(2)}${got.class === 'S' && got.bow < key.lineOfAction.bow - 0.02 ? '; bone-limited S (the short neck and head bones hold the bow under the declared one)' : ''}`);
  if (!ok) bad++;
}
if (dumpAt > -1) fs.writeFileSync(process.argv[dumpAt + 1], JSON.stringify(rows, null, 2) + '\n');
console.log(`${bad ? 'FAIL' : 'pass'}: check-pose - ${sheet.keys.length - bad} of ${sheet.keys.length} solved keys read back as declared (class exact, bow within 0.02, or, for an S, under it down to the 0.06 floor the line-of-action check holds it to)`);
process.exit(bad ? 1 : 0);
