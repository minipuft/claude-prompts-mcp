// Re-time an asciicast v3 per beat: each marker-delimited span gets its own speed
// factor from beats.json, so verdicts play at 1x while thinking plays at 3x and
// agg renders a single file.
//   node warp.mjs hero.cast beats.json hero.warped.cast          # writes hero.timemap.json too
//   node warp.mjs trace.cast --map hero.timemap.json --align hero.cast trace.warped.cast
// The time map is the session cast's own re-timing (original → warped seconds at
// every event); a second cast recorded alongside it is mapped through the same
// breakpoints, so both tracks stay on one clock when compose.mjs lays them side by side.
import { readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const src = args[0];
const lines = readFileSync(src, "utf8").split("\n").filter(Boolean);
const events = lines.slice(1).map((l) => JSON.parse(l));

function warpByBeats(beatsFile) {
  const beats = JSON.parse(readFileSync(beatsFile, "utf8")); // { "open": {"speed": 1, "cap": 2.5}, ... }
  // A scene with `freeze` holds the session on its marker frame for `hold` seconds while the
  // trace pane plays: the pause is inserted here, after the marker, and recorded so the trace's
  // next `spread` real seconds are mapped into it (warpByMap) instead of after it.
  const freezes = Object.fromEntries((beats.scenes ?? []).filter((sc) => sc.freeze).map((sc) => [sc.at, sc]));
  const pauses = [];
  const map = [[0, 0]]; let beat = null; let abs = 0; let warped = 0; const out = []; let teardown = false; let teardownAt = null; let pending = 0;
  for (const [dt, code, data] of events) {
    const cfg = beats[beat] ?? beats.default ?? { speed: 1 };
    let ndt = dt / cfg.speed;
    if (cfg.cap != null && ndt > cfg.cap) ndt = cfg.cap;
    abs += dt;
    if (code === "m") beat = data;
    if (beats[beat]?.drop) { map.push([abs, warped]); continue; }   // beats marked drop are cut from the output entirely
    // The session's own teardown is never part of the clip: after it, only markers pass (a
    // `complete` that landed after the last paint still has to reach compose.mjs).
    if (code === "o" && /Resume this session with|\[exited\]/.test(data) && !teardown) { teardown = true; teardownAt = abs; }
    if (teardown && code !== "m") { map.push([abs, warped]); continue; }
    ndt += pending; pending = 0;
    warped += ndt;
    map.push([abs, warped]);
    out.push([Number(ndt.toFixed(6)), code, data]);
    if (code === "m" && freezes[data]) {
      const { hold, spread = 0 } = freezes[data];
      pauses.push({ abs, w0: warped, length: hold, spread });
      pending = hold;                        // the next paint's interval carries the hold, so the marker frame stays up
      map.push([abs, warped + hold]);        // a vertical step: everything after the marker lands after the pause
    }
  }
  return { out, map: { points: map, teardownAt: teardownAt ?? abs, pauses } };
}

// The trace cast started at its own moment; the first marker both casts share gives the
// offset between their clocks (markers were injected at the same wall-clock instants).
function clockOffset(alignCast) {
  const markerTimes = (file) => { const m = {}; let t = 0; for (const l of readFileSync(file, "utf8").split("\n").filter(Boolean).slice(1)) { const [dt, c, d] = JSON.parse(l); t += dt; if (c === "m" && m[d] === undefined) m[d] = t; } return m; };
  const mine = markerTimes(src); const theirs = markerTimes(alignCast);
  const label = Object.keys(theirs).find((k) => mine[k] !== undefined);
  if (label === undefined) throw new Error(`no marker shared between ${src} and ${alignCast}`);
  return mine[label] - theirs[label];   // seconds to subtract from this cast's times to land on the session's clock
}

function warpByMap(mapFile, alignCast) {
  const { points: map, teardownAt, pauses = [] } = JSON.parse(readFileSync(mapFile, "utf8"));
  const offset = alignCast ? clockOffset(alignCast) : 0;
  const end = Math.min(map[map.length - 1][0], teardownAt);   // nothing after the session's teardown, on either track
  const at = (t) => {   // piecewise-linear lookup; beyond the session's last event the track is cut
    if (t >= end) return null;
    const p = pauses.find((q) => q.spread > 0 && t >= q.abs && t < q.abs + q.spread);
    if (p) return p.w0 + ((t - p.abs) / p.spread) * p.length;   // this track keeps playing through the session's freeze
    let i = 1; while (i < map.length && map[i][0] < t) i++;
    const [o0, w0] = map[i - 1]; const [o1, w1] = map[i];
    return o1 === o0 ? w0 : w0 + ((t - o0) * (w1 - w0)) / (o1 - o0);
  };
  const out = []; let abs = 0; let lastW = 0;
  for (const [dt, code, data] of events) {
    abs += dt;
    const w = at(abs - offset);
    if (w === null) break;
    out.push([Number(Math.max(0, w - lastW).toFixed(6)), code, data]);
    lastW = Math.max(lastW, w);
  }
  return { out, map: null };
}

const byMap = args[1] === "--map";
const align = byMap && args[3] === "--align" ? args[4] : undefined;
const dst = byMap ? (align ? args[5] : args[3]) : args[2];
const { out, map } = byMap ? warpByMap(args[2], align) : warpByBeats(args[1]);
writeFileSync(dst, [lines[0], ...out.map((e) => JSON.stringify(e))].join("\n") + "\n");
if (map) writeFileSync(dst.replace(/\.warped\.cast$/, ".timemap.json"), JSON.stringify(map));
const total = out.reduce((s, e) => s + e[0], 0);
console.log(`warped -> ${dst} (${total.toFixed(1)} s)`);
