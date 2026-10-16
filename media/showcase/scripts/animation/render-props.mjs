#!/usr/bin/env node
// Renders the stills probe-props.py reads: per beat whose blocking names actors, the animatic's frame in the middle of the beat, and the same frame once per actor with that actor omitted.
// usage: node scripts/animation/render-props.mjs <out-dir> [--scale 0.5]
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {loadTs, root} from './load-ts.mjs';

const out = path.resolve(process.argv[2] ?? '');
if (!process.argv[2]) {
  console.error('usage: node scripts/animation/render-props.mjs <out-dir> [--scale 0.5]');
  process.exit(2);
}
const si = process.argv.indexOf('--scale');
const scale = si > -1 ? process.argv[si + 1] : '0.5';
fs.mkdirSync(out, {recursive: true});

const {timeline} = await loadTs('src/scenes/animaticPlan.ts');
const jobs = [];
for (const beat of timeline.beats) {
  const file = path.join(root, 'v3/blocking', `${beat.id}.json`);
  const actors = Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).actors ?? {});
  if (!actors.length) continue;
  const frame = Math.floor((beat.start + beat.end) / 2);
  jobs.push({file: `${beat.id}.png`, frame, omit: []});
  for (const name of actors) jobs.push({file: `${beat.id}--no-${name}.png`, frame, omit: [name]});
}
for (const job of jobs) {
  const r = spawnSync('npx', ['remotion', 'still', 'src/index.ts', 'Animatic65', path.join(out, job.file), `--frame=${job.frame}`, `--scale=${scale}`, `--props=${JSON.stringify({captions: false, omit: job.omit})}`], {cwd: root, stdio: ['ignore', 'ignore', 'inherit']});
  if (r.status !== 0) {
    console.error(`render-props: ${job.file} failed (exit ${r.status})`);
    process.exit(1);
  }
  console.log(`${job.file} (frame ${job.frame}${job.omit.length ? `, without ${job.omit.join(',')}` : ''})`);
}
