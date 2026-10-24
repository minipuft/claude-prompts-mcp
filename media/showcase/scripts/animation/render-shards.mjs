#!/usr/bin/env node
// Deterministic parallel render: N separate `remotion render` processes at --concurrency=1, each over a contiguous shard of the frame list, merged into one
// element-NNN.png sequence. Measured 2026-10-16: separate processes at concurrency 1 are pixel-identical frame for frame; one process at --concurrency=4 puts ~3 of 291
// crayon frames over the determinism bar per run, on different frames each run (concurrency-dependent rasteriser state). The canonical render is therefore concurrency 1,
// parallel by PROCESS. A concurrency-4 render is a preview.
// usage: node scripts/animation/render-shards.mjs <composition> <outDir> [--shards N] [--frames a-b[,c[,d-e]]] [--props JSON] [--scale S] [--entry src/index.ts] [any other remotion render flag]
//   --shards N   processes (default DEFAULT_SHARDS: one Chrome each, see the memory note in the README)
//   --frames     inclusive ranges and single frames, comma separated (default: the whole composition); numbering is the composition's, `element-<frame>.png` as the probes read it
//   Any other `--flag[=value]` is passed to every `remotion render`. `--concurrency`, `--sequence`, `--image-format` and `--frames` are owned here and refused/forced.
// writes <outDir>/element-NNN.png (zero-padded to the width of the composition's last frame), <outDir>/shards.json (plan, per-shard wall time and exit code, peak RSS, sha256
// of every frame) and <outDir>/shard-logs/shard-K.log. Exit 0 only when every shard exited 0 and every planned frame exists; 1 otherwise; 2 input error.
// A positive control runs first: a planted 7-frame list over 3 shards must split into contiguous, complete, disjoint shards, and a planted missing frame must be named.
import {execFile, spawn} from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_SHARDS = 4;
const OWNED = ['concurrency', 'sequence', 'image-format', 'frames'];

/** "830-1120,5,7-8" -> sorted unique frame numbers. */
export const parseFrames = (spec) => {
  const out = new Set();
  for (const part of spec.split(',')) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part.trim());
    if (!m) throw new Error(`--frames: cannot read "${part}" (want a, a-b, or a comma list of them)`);
    const a = Number(m[1]), b = m[2] === undefined ? a : Number(m[2]);
    if (b < a) throw new Error(`--frames: range ${part} runs backwards`);
    for (let f = a; f <= b; f++) out.add(f);
  }
  return [...out].sort((x, y) => x - y);
};

/** Frame list -> "a-b,c,d-e" over its contiguous runs. */
export const toSpec = (frames) => {
  const runs = [];
  for (const f of frames) {
    const last = runs[runs.length - 1];
    if (last && f === last[1] + 1) last[1] = f; else runs.push([f, f]);
  }
  return runs.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(',');
};

/** N contiguous, disjoint, complete chunks of the frame list, sizes differing by at most one (never more chunks than frames). */
export const splitShards = (frames, n) => {
  const k = Math.max(1, Math.min(n, frames.length));
  const base = Math.floor(frames.length / k), extra = frames.length % k;
  const out = []; let at = 0;
  for (let i = 0; i < k; i++) { const size = base + (i < extra ? 1 : 0); out.push(frames.slice(at, at + size)); at += size; }
  return out;
};

const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const pad = (f, width) => String(f).padStart(width, '0');

const parseArgs = (argv) => {
  const pos = [], flags = {}, extra = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const eq = a.indexOf('=');
    const name = (eq < 0 ? a : a.slice(0, eq)).slice(2);
    const value = eq >= 0 ? a.slice(eq + 1) : (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[++i] : null);
    if (OWNED.includes(name) && name !== 'frames') throw new Error(`--${name} is owned by render-shards (each shard is concurrency 1, a PNG sequence); remove it`);
    if (['shards', 'frames', 'entry'].includes(name)) flags[name] = value;
    else extra.push(value === null ? `--${name}` : `--${name}=${value}`);
  }
  return {pos, flags, extra};
};

/** Composition length from `remotion compositions`: lines read `Name  fps  WxH  frames (sec)`. */
const durationOf = async (entry, composition) => {
  const {stdout} = await run('npx', ['remotion', 'compositions', entry], {cwd: root, maxBuffer: 1 << 24});
  for (const line of stdout.split('\n')) {
    const m = /^(\S+)\s+\d+\s+\d+x\d+\s+(\d+)\s/.exec(line.replace(/\x1b\[[0-9;]*m/g, ''));
    if (m && m[1] === composition) return Number(m[2]);
  }
  return null;
};

/** Sum of resident set sizes (MB) of this process's descendants. */
const treeRssMB = async () => {
  const {stdout} = await run('ps', ['-eo', 'pid=,ppid=,rss=']);
  const kids = new Map(), rss = new Map();
  for (const line of stdout.trim().split('\n')) {
    const [pid, ppid, kb] = line.trim().split(/\s+/).map(Number);
    rss.set(pid, kb); if (!kids.has(ppid)) kids.set(ppid, []); kids.get(ppid).push(pid);
  }
  let total = 0; const stack = [...(kids.get(process.pid) ?? [])];
  while (stack.length) { const p = stack.pop(); total += rss.get(p) ?? 0; stack.push(...(kids.get(p) ?? [])); }
  return total / 1024;
};

const runShard = (index, spec, shardDir, logFile, entry, composition, extra) => new Promise((resolve) => {
  const started = Date.now();
  const log = fs.openSync(logFile, 'w');
  const args = ['remotion', 'render', entry, composition, shardDir, '--sequence', '--image-format=png', '--concurrency=1', `--frames=${spec}`, ...extra];
  const child = spawn('npx', args, {cwd: root, stdio: ['ignore', log, log]});
  child.on('close', (code) => { fs.closeSync(log); resolve({shard: index, exitCode: code ?? -1, wallSeconds: +((Date.now() - started) / 1000).toFixed(1)}); });
});

const control = () => {
  const frames = parseFrames('10-12,20,22-24');
  const shards = splitShards(frames, 3);
  const flat = shards.flat();
  const sizes = shards.map((s) => s.length);
  const ok = flat.length === frames.length && flat.every((f, i) => f === frames[i]) && Math.max(...sizes) - Math.min(...sizes) <= 1 && shards.every((s) => s.every((f, i) => i === 0 || f > s[i - 1]));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shards-control-'));
  fs.writeFileSync(path.join(dir, 'element-10.png'), 'x');
  const missing = frames.filter((f) => !fs.existsSync(path.join(dir, `element-${f}.png`)));
  fs.rmSync(dir, {recursive: true});
  if (!ok || missing.length !== frames.length - 1 || toSpec(shards[1]) !== '20,22') throw new Error(`control failed: split ${shards.map(toSpec).join(' | ')}, missing ${missing.length}`);
  console.log(`control ok: ${frames.length} frames over 3 shards -> ${shards.map(toSpec).join(' | ')}; a planted missing-frame check names ${missing.length} of ${frames.length}`);
};

const main = async () => {
  const {pos, flags, extra} = parseArgs(process.argv.slice(2));
  if (pos.length !== 2) { console.error('usage: render-shards.mjs <composition> <outDir> [--shards N] [--frames a-b[,c]] [--props JSON] [--scale S] [--entry src/index.ts] [remotion render flags]'); process.exit(2); }
  const [composition, outArg] = pos;
  const outDir = path.resolve(process.cwd(), outArg);
  const entry = flags.entry ?? 'src/index.ts';
  const shardsWanted = flags.shards === undefined ? DEFAULT_SHARDS : Number(flags.shards);
  if (!Number.isInteger(shardsWanted) || shardsWanted < 1) throw new Error(`--shards: want a positive integer, got ${flags.shards}`);
  control();

  const duration = await durationOf(entry, composition);
  if (duration === null) throw new Error(`composition "${composition}" not found in ${entry} (npx remotion compositions ${entry})`);
  const frames = flags.frames ? parseFrames(flags.frames) : Array.from({length: duration}, (_, i) => i);
  const outside = frames.filter((f) => f >= duration);
  if (outside.length) throw new Error(`--frames: ${outside[0]} is past the last frame ${duration - 1} of ${composition}`);
  const width = String(duration - 1).length;
  const shards = splitShards(frames, shardsWanted);

  fs.mkdirSync(outDir, {recursive: true});
  const stale = fs.readdirSync(outDir).filter((n) => /^element-\d+\.png$/.test(n));
  for (const n of stale) fs.unlinkSync(path.join(outDir, n));
  const logDir = path.join(outDir, 'shard-logs'); fs.mkdirSync(logDir, {recursive: true});
  const workDir = path.join(outDir, '.shards'); fs.rmSync(workDir, {recursive: true, force: true}); fs.mkdirSync(workDir);

  const loadStart = os.loadavg()[0];
  const started = Date.now();
  let peakRss = 0, stop = false;
  const sampler = (async () => { while (!stop) { peakRss = Math.max(peakRss, await treeRssMB()); await new Promise((r) => setTimeout(r, 1000)); } })();
  const results = await Promise.all(shards.map((list, i) => runShard(i, toSpec(list), path.join(workDir, `s${i}`), path.join(logDir, `shard-${i}.log`), entry, composition, extra)));
  stop = true; await sampler;
  const wallSeconds = +((Date.now() - started) / 1000).toFixed(1);

  // merge: a shard's files are named by composition frame; move them under the full-sequence width
  const sha = {};
  for (let i = 0; i < shards.length; i++) {
    const dir = path.join(workDir, `s${i}`);
    const have = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    for (const n of have) {
      const m = /^element-(\d+)\.png$/.exec(n);
      if (m) fs.renameSync(path.join(dir, n), path.join(outDir, `element-${pad(Number(m[1]), width)}.png`));
    }
  }
  fs.rmSync(workDir, {recursive: true, force: true});
  const missing = frames.filter((f) => !fs.existsSync(path.join(outDir, `element-${pad(f, width)}.png`)));
  const planned = new Set(frames.map((f) => pad(f, width)));
  const unplanned = fs.readdirSync(outDir).filter((n) => /^element-\d+\.png$/.test(n) && !planned.has(/\d+/.exec(n)[0]));
  for (const f of frames) if (!missing.includes(f)) sha[f] = sha256(path.join(outDir, `element-${pad(f, width)}.png`));

  const plan = shards.map((list, i) => ({shard: i, frames: toSpec(list), count: list.length, ...results[i]}));
  const record = {
    composition, entry, shards: shards.length, concurrencyPerShard: 1, frames: toSpec(frames), frameCount: frames.length, extraArgs: extra,
    wallSeconds, peakRssMB: +peakRss.toFixed(0), peakRssMBPerShard: +(peakRss / shards.length).toFixed(0), loadAvgAtStart: +loadStart.toFixed(2), loadAvgAtEnd: +os.loadavg()[0].toFixed(2),
    cores: os.cpus().length, plan, missing, unplanned, sha256: sha,
  };
  fs.writeFileSync(path.join(outDir, 'shards.json'), JSON.stringify(record, null, 1) + '\n');

  const failed = results.filter((r) => r.exitCode !== 0);
  console.log(`${composition}: ${frames.length} frames in ${shards.length} shards (concurrency 1 each), ${wallSeconds} s wall, peak RSS ${record.peakRssMB} MB (${record.peakRssMBPerShard} MB per shard), load ${record.loadAvgAtStart} -> ${record.loadAvgAtEnd}`);
  for (const p of plan) console.log(`  shard ${p.shard}: frames ${p.frames} (${p.count}) exit ${p.exitCode} in ${p.wallSeconds} s`);
  if (failed.length || missing.length) {
    console.error(`FAIL: ${failed.length} shard(s) exited non-zero${failed.length ? ` (${failed.map((r) => `shard ${r.shard} exit ${r.exitCode}, log ${path.join(logDir, `shard-${r.shard}.log`)}`).join('; ')})` : ''}; ${missing.length} planned frame(s) missing${missing.length ? `: ${toSpec(missing)}` : ''}`);
    process.exit(1);
  }
  console.log(`ok: all ${frames.length} frames present -> ${outDir}/element-*.png, plan and sha256 in ${path.join(outDir, 'shards.json')}`);
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`render-shards: ${e.message}`); process.exit(2); });
}
