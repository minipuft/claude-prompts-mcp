// Lay the trace pane beside the session: a panel that slides in from the right at the
// beats beats.json names, with a caption per beat on the session itself and a title card
// at the start. Everything is driven by the warped session cast's marker times, so a
// re-pace in beats.json moves the scenes with it.
//   node compose.mjs hero.warped.cast beats.json session.mp4 trace.mp4 out.mp4
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

const [cast, beatsFile, sessionMp4, traceMp4, outMp4] = process.argv.slice(2);
const beats = JSON.parse(readFileSync(beatsFile, "utf8"));
const FONT = process.env.FONT_FILE ?? "/home/minipuft/.local/share/fonts/FiraCode-Regular.ttf";
const FONT_BOLD = process.env.FONT_BOLD_FILE ?? FONT.replace("Regular", "Bold");
const SLIDE = 0.35;

// Marker → warped seconds, read from the cast that was rendered.
const markers = {}; let t = 0;
for (const line of readFileSync(cast, "utf8").split("\n").filter(Boolean).slice(1)) {
  const [dt, code, data] = JSON.parse(line); t += dt; if (code === "m") markers[data] = t;
}
const total = t;
const termRows = (file) => JSON.parse(readFileSync(file, "utf8").split("\n")[0]).term.rows;
// Screen rows at a moment, via screen.py (pyte with tmux's scroll sequences), for highlights.
const screenAt = (file, when) => JSON.parse(spawnSync("python3", [new URL("./screen.py", import.meta.url).pathname, file, when.toFixed(3), "--json"], { encoding: "utf8" }).stdout);
// A highlight names text; this finds the row span it occupies on a screen, or null.
const findRows = (lines, hl) => {
  const re = new RegExp(hl.match);
  const hits = lines.map((l, i) => (re.test(l) ? i : -1)).filter((i) => i >= 0);
  if (!hits.length) return null;
  const hit = hl.last ? hits[hits.length - 1] : hits[0];
  const r = hit - (hl.before ?? 0);
  const m = hl.text ? lines[hit].match(re) : null;   // text mode: box only the matched characters
  const cols = m ? [[...lines[hit].slice(0, m.index)].length, [...m[0]].length] : null;
  return { rows: [Math.max(0, r), Math.max(0, r) + (hl.rows ?? 1)], cols };
};
// How a highlight is drawn. Row highlights (the lines the pane explains) default to a box; the
// token highlights that colour a kind (prompt, framework, gate, chain) are secondary and default
// to `highlightStyle`: a translucent marker fill, an underline, a faint outline, or a box.
const styleOf = (hl) => hl.style ?? (hl.text ? beats.highlightStyle ?? "marker" : beats.rowStyle ?? "box");
const mark = (style, x, y0, y1, w, color, on) => {
  switch (style) {
    case "marker": return `drawbox=x=${x}:y=${y0}:w=${w}:h=${y1 - y0}:color=${color}@${beats.markerAlpha ?? 0.28}:t=fill:${on}`;
    case "underline": return `drawbox=x=${x}:y=${y1 - 3}:w=${w}:h=3:color=${color}@0.9:t=fill:${on}`;
    case "outline": return `drawbox=x=${x - 2}:y=${y0 - 1}:w=${w + 4}:h=${y1 - y0 + 2}:color=${color}@0.55:t=1:${on}`;
    default: return `drawbox=x=${x - 3}:y=${y0 - 2}:w=${w + 6}:h=${y1 - y0 + 4}:color=${color}@0.95:t=2:${on}`;
  }
};
const colorOf = (hl) => hl.color ?? (beats.highlightColors ?? {})[hl.kind] ?? beats.highlightColor ?? "#ffd866";
const at = (ref) => { const m = markers[ref]; if (m === undefined) throw new Error(`no marker "${ref}" in ${cast}`); return m; };
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\u2019").replace(/:/g, "\\:").replace(/,/g, "\\,").replace(/%/g, "%%");
const box = (text, opts) => `drawtext=fontfile='${esc(opts.font ?? FONT)}':text='${esc(text)}':fontsize=${opts.size}:fontcolor=${opts.color ?? "white"}:x=${opts.x}:y=${opts.y}:box=1:boxcolor=${opts.box ?? "black@0.72"}:boxborderw=${opts.pad ?? 10}:enable='${opts.enable}'`;

const probe = (f) => spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", f], { encoding: "utf8" }).stdout.trim().split(",").map(Number);
const duration = (f) => Number(spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f], { encoding: "utf8" }).stdout.trim());
const [aw, ah] = probe(sessionMp4); const [bw, bh] = probe(traceMp4);
// The session render holds its last frame past the final marker (agg --last-frame-duration), and
// a scene at `complete` plays in that hold; cut at the render's length, not the cast's.
const clipSeconds = Math.max(total, duration(sessionMp4));
if (ah !== bh) throw new Error(`track heights differ: session ${ah}, trace ${bh} — render both with the same rows and font`);

const filters = [];
// Session track: 24 fps for a smooth slide, title card, one caption per beat.
// A caption bar under the frame: captions and the legend share it, outside the terminal and above
// the strip a video player covers with its controls (measured 2026-10-28: the player's control bar
// hid the bottom captions and the pane's last line). Two rows, then dead space the controls may cover.
const BAR = Number(beats.captionBar ?? 120);
let a = [`[0:v]fps=24,pad=w=iw:h=ih+${BAR}:color=black`];
const title = beats.title ?? [];
title.forEach((line, i) => a.push(box(line, { size: i === 0 ? 30 : 20, font: i === 0 ? FONT_BOLD : FONT, x: "(w-text_w)/2", y: `(${ah}-text_h)/2${i === 0 ? "-28" : "+22"}`, enable: `lt(t,${beats.titleSeconds ?? 2.6})`, box: "black@0.78", pad: 14 })));
for (const [ref, text] of Object.entries(beats.captions ?? {})) {
  if (markers[ref] === undefined) continue;
  const s = at(ref) + (ref === "open" ? (beats.titleSeconds ?? 2.6) : 0);
  a.push(box(text, { size: 20, font: FONT_BOLD, color: "#ffd866", x: 26, y: `${ah + 16}`, box: "black@0", pad: 6, enable: `between(t,${s.toFixed(2)},${(s + (beats.captionSeconds ?? 3.5)).toFixed(2)})` }));
}
// Trace track: one copy per scene, each with its own caption, slid in over the session.
const scenes = (beats.scenes ?? []).filter((sc) => {
  if (markers[sc.at] !== undefined) return true;
  console.warn(`scene at "${sc.at}" skipped: no such marker in ${cast}`);   // a rehearsal take may stop before the beat
  return false;
}).map((sc) => ({ ...sc, s: at(sc.at) + (sc.offset ?? 0), e: at(sc.at) + (sc.offset ?? 0) + sc.hold }));
// The trace render ends at its last line plus agg's hold, before the session does; without
// padding, a scene past that point gets the overlay's repeated last frame and none of its
// drawboxes, because no frames exist for them to be drawn on.
filters.push(`[1:v]fps=24,tpad=stop_mode=clone:stop_duration=${Math.ceil(clipSeconds)},drawbox=x=0:y=0:w=3:h=ih:color=#ffd866@0.9:t=fill,split=${scenes.length}${scenes.map((_, i) => `[b${i}]`).join("")}`);
// Under a scene the session drops to `sceneDim` brightness (0 = untouched), so the eye goes to the
// pane; a frozen scene (warp.mjs `freeze`) also holds the session's frame, so nothing is missed under it.
const dim = Number(beats.sceneDim ?? 0);
const traceCast = process.env.TRACE_WARPED ?? cast.replace(/^hero/, "trace");
const sRows = termRows(cast), tRows = traceCast && existsSync(traceCast) ? termRows(traceCast) : 36;
// agg pads the frame: cell width from the two renders' widths, then the padding, then cell height.
const sCols = JSON.parse(readFileSync(cast, "utf8").split("\n")[0]).term.cols;
const tCols = traceCast && existsSync(traceCast) ? JSON.parse(readFileSync(traceCast, "utf8").split("\n")[0]).term.cols : 48;
const cellW = (aw - bw) / (sCols - tCols); const pad = (aw - sCols * cellW) / 2;
const cellA = (ah - 2 * pad) / sRows, cellB = (bh - 2 * pad) / tRows, cellB_w = cellW;
const rowY = (r, cell) => Math.round(pad + r * cell);
const dimmed = []; const traceOutlines = scenes.map(() => []);
scenes.forEach((sc, i) => {
  const on = `enable='between(t,${sc.s.toFixed(2)},${(sc.e + SLIDE).toFixed(2)})'`;
  const onExpr = `between(t,${sc.s.toFixed(2)},${(sc.e + SLIDE).toFixed(2)})`;
  // The pane's caption and the colour legend sit on the bar under the pane, on the same two rows
  // as the session caption, for as long as the pane is in.
  if (sc.caption) a.push(box(sc.caption, { size: 17, font: FONT_BOLD, color: "#78dce8", x: aw - bw + 14, y: `${ah + 18}`, box: "black@0", pad: 6, enable: onExpr }));
  if ((sc.legend ?? beats.legend) && beats.highlightColors) {
    let lx = aw - bw + 14;
    for (const [kind, color] of Object.entries(beats.highlightColors)) {
      a.push(box(kind, { size: 15, font: FONT_BOLD, color, x: lx, y: `${ah + 54}`, box: "black@0", pad: 4, enable: onExpr }));
      lx += kind.length * 9 + 22;   // Fira Code bold 15 is ~9 px per character
    }
  }
  const hls = sc.highlights ?? [];
  // Session: the frame is frozen, so one lookup at the marker gives the rows for the whole scene.
  const found = [];
  if (hls.some((h) => h.track === "session")) {
    const lines = screenAt(cast, sc.s + 0.01);
    for (const h of hls.filter((h) => h.track === "session")) {
      const f = findRows(lines, h);
      if (!f) { console.warn(`scene ${sc.at}: no session row matches /${h.match}/`); continue; }
      found.push({ ...f, color: colorOf(h), style: styleOf(h) });
    }
  }
  // Dim everything except the highlighted rows (a spotlight), then outline each highlight:
  // the whole row, or in text mode just the matched characters.
  if (dim > 0) {
    let y = 0;
    for (const { rows: [r0, r1] } of [...found].sort((p, q) => p.rows[0] - q.rows[0])) {
      const y0 = rowY(r0, cellA), y1 = rowY(r1, cellA);
      if (y0 > y) dimmed.push(`drawbox=x=0:y=${y}:w=iw:h=${y0 - y}:color=black@${dim}:t=fill:${on}`);
      y = Math.max(y, y1);
    }
    if (y < ah) dimmed.push(`drawbox=x=0:y=${y}:w=iw:h=${ah - y}:color=black@${dim}:t=fill:${on}`);
  }
  for (const { rows: [r0, r1], cols, color, style } of found) {
    const x = cols ? Math.round(pad + cols[0] * cellW) : 7;
    const w = cols ? Math.round(cols[1] * cellW) : aw - bw - 14;
    dimmed.push(mark(style, x, rowY(r0, cellA), rowY(r1, cellA), w, color, on));
  }
  // Trace: lines arrive and scroll during the pause, so sample the screen and outline each
  // (row, interval) the match occupies.
  const traceHls = hls.filter((h) => h.track === "trace");
  if (traceHls.length) {
    const step = 0.25; const samples = [];
    for (let tt = sc.s; tt <= sc.e + 1e-6; tt += step) samples.push([tt, screenAt(traceCast, tt)]);
    for (const h of traceHls) {
      let cur = null;
      const flush = () => { if (cur) traceOutlines[i].push(cur); cur = null; };
      for (const [tt, lines] of samples) {
        const f = findRows(lines, h);
        if (!f) { flush(); continue; }
        if (cur && cur.rows[0] === f.rows[0]) cur.end = tt; else { flush(); cur = { ...f, color: colorOf(h), style: styleOf(h), start: tt, end: tt }; }
      }
      flush();
      if (!traceOutlines[i].length) console.warn(`scene ${sc.at}: no trace row matches /${h.match}/ during the pause`);
    }
  }
});
filters.push(`${[a[0], ...dimmed, ...a.slice(1)].join(",")}[a0]`);   // dim under the title and captions, not over them
scenes.forEach((sc, i) => {
  const outlines = traceOutlines[i].map(({ rows: [r0, r1], cols, color, style, start, end }) => {
    const x = cols ? Math.round(pad + cols[0] * cellB_w) : 8;
    const w = cols ? Math.round(cols[1] * cellB_w) : bw - 16;
    return mark(style, x, rowY(r0, cellB), rowY(r1, cellB), w, color, `enable='between(t,${start.toFixed(2)},${(end + 0.3).toFixed(2)})'`);
  });
  const chain = outlines.length ? outlines : ["null"];
  const captioned = `[b${i}]${chain.join(",")}[c${i}]`;
  filters.push(captioned);
  const x = `W-w*if(lt(t\\,${sc.e.toFixed(2)})\\,min(1\\,(t-${sc.s.toFixed(2)})/${SLIDE})\\,1-min(1\\,(t-${sc.e.toFixed(2)})/${SLIDE}))`;
  filters.push(`[a${i}][c${i}]overlay=x='${x}':y=0:enable='between(t,${sc.s.toFixed(2)},${(sc.e + SLIDE).toFixed(2)})'[a${i + 1}]`);
});
const last = `[a${scenes.length}]`;
const graph = filters.join(";");
if (process.env.COMPOSE_DEBUG) console.error(graph.split(";").join("\n"));
const still = process.env.COMPOSE_STILL;   // COMPOSE_STILL=12.5 writes one frame (jpg/png) instead of the clip
const args = still
  ? ["-v", "error", "-y", "-i", sessionMp4, "-i", traceMp4, "-filter_complex", graph, "-map", last, "-ss", still, "-frames:v", "1", outMp4]
  : ["-v", "error", "-y", "-i", sessionMp4, "-i", traceMp4, "-filter_complex", graph, "-map", last, "-t", String(clipSeconds.toFixed(2)), "-c:v", "libx264", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outMp4];
const r = spawnSync("ffmpeg", args, { stdio: "inherit" });
if (r.status !== 0) { console.error(graph); process.exit(r.status ?? 1); }
console.log(`composed -> ${outMp4} (${scenes.length} scenes, ${aw}x${ah} over ${bw}x${bh})`);
