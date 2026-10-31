#!/usr/bin/env node
// Writes the exposure sheet of shot s01 as data for the probes (scripts/animation/README.md "What the probes read"): one row per frame 0..419, from
// src/scenes/shotS01Plan.ts, the module ShotS01 is drawn from. The global writer (scripts/animation/xsheet.mjs) reads the animatic's plan and writes
// the whole 1950-frame film, so a shot study gets its own: same row shape (src/library/animation/xsheet.ts xsheetJsonRows), the emitter in stage
// pixels, as the global writer's is: stage pixels, projected through the row's camera by probe-eyetrace.
// usage: node scripts/s01-xsheet.mjs [--out out/s01-arrival-overwhelm-xsheet.json] [--timeline-out out/s01-arrival-overwhelm-timeline.json]
import fs from 'node:fs';
import path from 'node:path';
import {loadTs, root} from './animation/load-ts.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const {xstateOf, chart, SHOT} = await loadTs('src/scenes/shotS01Plan.ts');
const out = path.resolve(arg('out', path.join(root, `out/${SHOT}-xsheet.json`)));
const tlOut = path.resolve(arg('timeline-out', path.join(root, `out/${SHOT}-timeline.json`)));
const {xsheetJsonRows} = await loadTs('src/library/animation/xsheet.ts');
const [first, last] = chart.frames;
const states = Array.from({length: last - first}, (_, i) => xstateOf(first + i));
const rows = xsheetJsonRows(states);
fs.writeFileSync(out, JSON.stringify({rows}) + '\n');
// the shot's own timeline: the two beats of v3/timeline.json it spans, durationInFrames = the shot's length (the film's timeline is untouched)
const film = JSON.parse(fs.readFileSync(path.join(root, 'v3/timeline.json'), 'utf8'));
const beats = film.beats.filter((b) => b.start >= first && b.end <= last).map((b) => ({...b, crossingIn: null, crossingOut: null}));
fs.writeFileSync(tlOut, JSON.stringify({fps: film.fps, durationInFrames: last - first, beats, crossings: []}, null, 1) + '\n');
console.log(`s01 xsheet: ${rows.length} rows -> ${path.relative(root, out)}; shot timeline (${beats.map((b) => b.id).join(', ')}, ${last - first} frames) -> ${path.relative(root, tlOut)}`);
process.exit(rows.length === last - first ? 0 : 1);
