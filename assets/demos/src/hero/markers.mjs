// Inject the driver's beat markers into an asciicast v3 file as "m" events, so
// agg can cut by `--select marker:run..marker:complete` and warp.mjs can re-time
// each beat. Usage: node markers.mjs <cast> markers.txt t0 [cast-t0]
// markers.txt holds seconds since t0; a cast that started at a different moment
// (the trace pane's) passes its own start file so the same markers land at the
// same wall-clock instant in both casts.
import { readFileSync, writeFileSync } from "node:fs";
const [cast, markersFile, t0File, castT0File] = process.argv.slice(2);
const offset = castT0File ? Number(readFileSync(t0File, "utf8")) - Number(readFileSync(castT0File, "utf8")) : 0;
const raw = readFileSync(cast, "utf8").split("\n").filter(Boolean);
const header = JSON.parse(raw[0]);
// Idempotent: drop any marker events from a previous run, keeping their time in the stream.
const lines = [raw[0]]; let carry = 0;
for (const line of raw.slice(1)) {
  const [dt, code, data] = JSON.parse(line);
  if (code === "m") { carry += dt; continue; }
  lines.push(JSON.stringify([dt + carry, code, data])); carry = 0;
}
if (header.version !== 3) throw new Error(`expected asciicast v3, got v${header.version}`);
const markers = readFileSync(markersFile, "utf8").trim().split("\n").filter(Boolean)
  .map((l) => { const [t, label] = l.split(" "); return { t: Number(t) + offset, label }; })
  .filter((m) => m.t >= 0)
  .sort((a, b) => a.t - b.t);
// v3 events carry intervals; walk absolute time and splice markers in order.
const out = [lines[0]]; let abs = 0; let mi = 0;
for (const line of lines.slice(1)) {
  const [dt, code, data] = JSON.parse(line);
  const next = abs + dt;
  let last = abs;
  while (mi < markers.length && markers[mi].t <= next) {
    out.push(JSON.stringify([Number((markers[mi].t - last).toFixed(6)), "m", markers[mi].label]));
    last = markers[mi].t; mi++;
  }
  out.push(JSON.stringify([Number((next - last).toFixed(6)), code, data]));
  abs = next;
}
// Markers after the last event (the driver's `end` lands after the final paint) still count.
let last = abs;
for (; mi < markers.length; mi++) { out.push(JSON.stringify([Number((markers[mi].t - last).toFixed(6)), "m", markers[mi].label])); last = markers[mi].t; }
writeFileSync(cast, out.join("\n") + "\n");
console.log(`markers injected into ${cast} (offset ${offset.toFixed(3)}s): ${markers.map((m) => m.label).join(", ")}`);
