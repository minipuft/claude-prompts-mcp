#!/usr/bin/env node
// Compiles the beat ledger (seconds) into frames: v3/beats-v2.json -> v3/timeline.json.
// usage: node scripts/animation/compile-timeline.mjs [--ledger <path>] [--out <path>]
import fs from 'node:fs';
import path from 'node:path';
import {loadTs, root} from './load-ts.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const ledgerPath = path.resolve(arg('ledger', path.join(root, 'v3/beats-v2.json')));
const outPath = path.resolve(arg('out', path.join(root, 'v3/timeline.json')));

const {compileTimeline} = await loadTs('src/library/animation/timeline.ts');
let timeline;
try {
  timeline = compileTimeline(JSON.parse(fs.readFileSync(ledgerPath, 'utf8')));
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e)); // the bundled stack is a data URL of the whole module: print the message only
  process.exit(1);
}
fs.writeFileSync(outPath, JSON.stringify(timeline, null, 2) + '\n');
const sum = timeline.beats.reduce((n, b) => n + b.frames, 0);
console.log(`timeline: ${timeline.beats.length} beats, ${sum} frames (declared duration ${timeline.durationInFrames}), ${timeline.crossings.length} crossings -> ${path.relative(root, outPath)}`);
if (sum !== timeline.durationInFrames) {
  console.error('timeline: beat frames do not sum to the duration');
  process.exit(1);
}
