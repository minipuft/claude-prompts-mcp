#!/usr/bin/env node
// Renders the stills probe-props.py reads: per beat whose blocking names actors, the animatic's frame in the middle of the beat, and the same frame once per actor with that actor omitted; an actor that is not on stage
// on that frame (`on` and `off` in the blocking) gets its own pair on the middle of its time on stage (`<beat>--at-<actor>.png`, `<beat>--no-<actor>.png`). `stills.json` in the out directory names the frame and the omitted actors of every still.
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
  const placed = JSON.parse(fs.readFileSync(file, 'utf8')).actors ?? {};
  const actors = Object.keys(placed);
  if (!actors.length) continue;
  const frame = Math.floor((beat.start + beat.end) / 2);
  jobs.push({file: `${beat.id}.png`, frame, omit: []});
  for (const name of actors) {
    // a prop that is not on stage on the beat's middle frame (`on` after it, `off` before it) is drawn on the middle of the frames it IS on stage: its own with and without pair
    const on = Math.max(beat.start, placed[name].on ?? beat.start), off = Math.min(beat.end, placed[name].off ?? beat.end);
    const own = Math.floor((on + off) / 2);
    if (frame >= on && frame < off) jobs.push({file: `${beat.id}--no-${name}.png`, frame, omit: [name]});
    else {
      jobs.push({file: `${beat.id}--at-${name}.png`, frame: own, omit: []});
      jobs.push({file: `${beat.id}--no-${name}.png`, frame: own, omit: [name]});
    }
  }
}
const manifest = {};
for (const job of jobs) {
  const r = spawnSync('npx', ['remotion', 'still', 'src/index.ts', 'Animatic65', path.join(out, job.file), `--frame=${job.frame}`, `--scale=${scale}`, `--props=${JSON.stringify({captions: false, omit: job.omit})}`], {cwd: root, stdio: ['ignore', 'ignore', 'inherit']});
  if (r.status !== 0) {
    console.error(`render-props: ${job.file} failed (exit ${r.status})`);
    process.exit(1);
  }
  manifest[job.file] = {frame: job.frame, omit: job.omit};
  console.log(`${job.file} (frame ${job.frame}${job.omit.length ? `, without ${job.omit.join(',')}` : ''})`);
}
fs.writeFileSync(path.join(out, 'stills.json'), JSON.stringify(manifest, null, 1) + '\n');
