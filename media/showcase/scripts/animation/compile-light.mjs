#!/usr/bin/env node
// Compiles the light contract: v3/timeline.json + v3/shots.json hue pairs + the ledger's effects (carried on the timeline) + v3/worlds/*.json
// radiance + v3/blocking/<beat>.json emitters -> v3/light.json (shape: scripts/animation/README.md). Run after compile-timeline.mjs, before xsheet.mjs.
// usage: node scripts/animation/compile-light.mjs [--timeline <path>] [--out <path>] [--floor <luma>]
// --floor: the least luma an emitter's core draws at (colour x intensity, 0-255; default 200, 0 = none): the light is the brightest thing outside the fixed role fills (C29).
import fs from 'node:fs';
import path from 'node:path';
import {loadTs, root} from './load-ts.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const timelinePath = path.resolve(arg('timeline', path.join(root, 'v3/timeline.json')));
const outPath = path.resolve(arg('out', path.join(root, 'v3/light.json')));
const floor = Number(arg('floor', '200'));
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

const {compileLight, parseLightContract} = await loadTs('src/library/animation/light.ts');
const {parseBlocking} = await loadTs('src/library/animation/blocking.ts');
const {hueOf} = await loadTs('src/scenes/lightPlan.ts');

const timeline = readJson(timelinePath);
const blockingOf = (id) => parseBlocking(readJson(path.join(root, 'v3/blocking', `${id}.json`)));
const worldOf = (id) => readJson(path.join(root, 'v3/worlds', `${id}.json`)).radiance ?? {on: false};

let contract;
try {
  contract = compileLight({
    beats: timeline.beats,
    crossings: timeline.crossings,
    pairOf: hueOf,
    worldRadiance: worldOf,
    emitterOf: (id) => blockingOf(id).emitter,
    size: {width: 1280, height: 720},
    luminanceFloor: floor,
  });
  parseLightContract(contract);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
fs.writeFileSync(outPath, JSON.stringify(contract, null, 2) + '\n');
const lit = Object.values(contract.beats).filter((b) => b.emitter).length;
console.log(`light: ${Object.keys(contract.beats).length} beats (${lit} with an emitter), ${contract.crossings.length} crossings -> ${path.relative(root, outPath)}`);
