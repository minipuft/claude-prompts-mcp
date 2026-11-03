#!/usr/bin/env node
// Drawn props step on twos (rubric C16/C27, D51; row 6.12c): the props of a shot (lid, bubble, gadget, leans, the stalk, every piece's flight) change only on even frames; the camera and the light (flood, dial, pop) may change on every frame.
// usage: node scripts/animation/probe-prop-twos.mjs [shot-id=s01-arrival-overwhelm] [--json out]      exit 0 pass, 1 an odd-frame change in a drawn prop, 2 a control that did not trip
// Method: per frame, the props passes' projections (src/scenes/shotS01Passes.ts, what the browser draws from) less the camera and the light they carry (camera, field, under, motes, pop); list every ODD frame on which the rest changed.
// Control first (D81): the parser refuses a drawn prop on ones without a `why` and accepts a light track on ones or a prop with a `why`; the same detector on the lid sampled on ones reports odd frames, on twos reports none.
import fs from 'node:fs';
import path from 'node:path';
import {loadTs, root} from './load-ts.mjs';

const shot = process.argv[2]?.startsWith('--') || !process.argv[2] ? 's01-arrival-overwhelm' : process.argv[2];
const ji = process.argv.indexOf('--json');
const [chartMod, passes] = await Promise.all([loadTs('src/library/animation/chart.ts'), loadTs('src/scenes/shotS01Passes.ts')]);
const chartJson = JSON.parse(fs.readFileSync(path.join(root, `v3/charts/${shot}.json`), 'utf8'));
const {parseChart, scalarAt} = chartMod;

const oddChanges = (series) => series.flatMap((v, f) => (f % 2 && f > 0 && v !== series[f - 1] ? [f] : []));
const refuses = (mutate) => { const c = structuredClone(chartJson); mutate(c); try { parseChart(c); return false; } catch { return true; } };
const actor = Object.keys(chartJson.actors).find((n) => chartJson.actors[n].kind === 'scalar' && !n.startsWith('light.'));
const lid = structuredClone(chartJson.actors['box.lid']);
const onOnes = {...lid, quantise: 'ones'};
const frames = Array.from({length: chartJson.frames[1] - chartJson.frames[0]}, (_, i) => chartJson.frames[0] + i);
const lidTwos = oddChanges(frames.map((f) => String(scalarAt(lid, f)))), lidOnes = oddChanges(frames.map((f) => String(scalarAt(onOnes, f))));
const refusedOnes = refuses((c) => { c.actors[actor].quantise = 'ones'; delete c.actors[actor].why; });
const acceptedWhy = !refuses((c) => { c.actors[actor].quantise = 'ones'; c.actors[actor].why = 'a probe control'; });
const acceptedLight = !refuses((c) => { for (const n of Object.keys(c.actors)) if (n.startsWith('light.')) c.actors[n].quantise = 'ones'; });
const refusedBlank = refuses((c) => { c.actors[actor].quantise = 'ones'; c.actors[actor].why = '  '; });
const control = refusedOnes && refusedBlank && acceptedWhy && acceptedLight && lidTwos.length === 0 && lidOnes.length > 0;
console.log(`control: "${actor}" on ones with no why ${refusedOnes ? 'refused' : 'ACCEPTED'}, with a blank why ${refusedBlank ? 'refused' : 'ACCEPTED'}, with a why ${acceptedWhy ? 'accepted' : 'REFUSED'}, light tracks on ones ${acceptedLight ? 'accepted' : 'REFUSED'}; box.lid on twos: ${lidTwos.length} odd-frame changes, on ones: ${lidOnes.length} (${lidOnes.slice(0, 4).join(',')}...)`);
if (!control) { console.log('refused: the control did not trip, so this probe would say nothing when it passes'); process.exit(2); }

const LIGHT_AND_CAMERA = {back: ['camera', 'field', 'under'], front: ['camera', 'motes', 'pop']};
const strip = (p, keys) => { const c = {...p}; for (const k of keys) delete c[k]; return c; };
const rows = frames.map((f) => passes.projectFrame(f).passes);
const prop = rows.map((r) => JSON.stringify([strip(r.back, LIGHT_AND_CAMERA.back), strip(r.front, LIGHT_AND_CAMERA.front)]));
const seriesOf = (pick) => oddChanges(rows.map((r) => JSON.stringify(pick(r))));
const oddProps = oddChanges(prop);
const evenProps = prop.filter((v, f) => f > 0 && f % 2 === 0 && v !== prop[f - 1]).length;
const camera = seriesOf((r) => r.back.camera).length, light = seriesOf((r) => [r.back.field, r.back.under, r.front.motes, r.front.pop]).length;
// the same detector against the lid sampled on ones, planted in the real projection: it must see it
const planted = oddChanges(rows.map((r, i) => JSON.stringify([strip(r.back, LIGHT_AND_CAMERA.back), {...strip(r.front, LIGHT_AND_CAMERA.front), lid: scalarAt(onOnes, frames[i])}])));
console.log(`control: the real projection with the lid planted on ones reports ${planted.length} odd-frame changes`);
if (!planted.length) { console.log('refused: the projection control did not trip'); process.exit(2); }
console.log(`shot ${shot}: ${frames.length} frames, drawn props changed on ${evenProps} even frames and ${oddProps.length} odd frames${oddProps.length ? `: ${oddProps.slice(0, 20).join(',')}` : ''}; the camera moved on ${camera} odd frames, the light (flood, dial, field, pop) on ${light}`);
if (ji > -1) fs.writeFileSync(path.resolve(process.argv[ji + 1]), JSON.stringify({shot, oddFrames: oddProps, evenChanges: evenProps, cameraOdd: camera, lightOdd: light, control: {lidTwos: lidTwos.length, lidOnes: lidOnes.length, planted: planted.length}}, null, 1) + '\n');
console.log(oddProps.length ? 'FAIL: a drawn prop changed on an odd frame' : 'pass: every drawn prop steps on twos');
process.exit(oddProps.length ? 1 : 0);
