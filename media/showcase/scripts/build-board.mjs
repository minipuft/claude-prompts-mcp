#!/usr/bin/env node
// Builds the design-bible board from v3/references/board.json.
// Outputs v3/references/board.html (clickable, local video) and, with --png, a glance render via headless Chrome.
// Every src/poster path is asserted to exist, so a card can never point at a file that was moved.
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {dirname, resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync, spawnSync} from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const refDir = resolve(here, '../v3/references');
const manifestPath = join(refDir, 'board.json');
const outHtml = join(refDir, 'board.html');
const board = JSON.parse(readFileSync(manifestPath, 'utf8'));

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[c]);
const mmss = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

const missing = [];
const assertFile = (p, card) => {
  if (!p) return;
  if (p.startsWith('http') || p.startsWith('file:')) return;
  if (!existsSync(join(refDir, p))) missing.push(`${card}: ${p}`);
};

const tag = (t) => `<span class="tag ${t.startsWith('D') ? 'ruling' : 'criterion'}">${esc(t)}</span>`;
const list = (items, cls, label) => items?.length ? `<p class="${cls}"><b>${label}</b> ${items.map(esc).join(' · ')}</p>` : '';

const media = (c) => {
  assertFile(c.src, c.id);
  assertFile(c.poster, c.id);
  if (c.kind === 'text') return `<div class="media text"><span>no image, on purpose</span></div>`;
  if (c.kind === 'video') {
    const at = c.at != null ? `<span class="at">at ${mmss(c.at)}</span>` : '';
    if (c.src) {
      return `<div class="media"><video controls preload="none" poster="${esc(c.poster)}" src="${esc(c.src)}#t=${c.at ?? 0}"></video>${at}</div>`;
    }
    return `<div class="media"><a href="${esc(c.href)}" target="_blank" rel="noopener"><img src="${esc(c.poster)}" alt="${esc(c.title)}"></a><span class="at">external</span></div>`;
  }
  return `<div class="media"><img src="${esc(c.src)}" alt="${esc(c.title)}" loading="lazy"></div>`;
};

const card = (c) => `
<article class="card" id="${esc(c.id)}">
  ${media(c)}
  <div class="text-block">
    <h3>${esc(c.title)}</h3>
    <p class="by">${esc(c.by)}${c.href ? ` · <a href="${esc(c.href)}" target="_blank" rel="noopener">source</a>` : ''}</p>
    ${list(c.borrow, 'borrow', 'Borrow')}
    ${list(c.refuse, 'refuse', 'Refuse')}
    ${c.note ? `<p class="note">${esc(c.note)}</p>` : ''}
    <p class="tags">${(c.governs ?? []).map(tag).join('')}</p>
  </div>
</article>`;

const section = (s) => `
<section id="${esc(s.id)}">
  <header>
    <h2>${esc(s.title)}</h2>
    <p class="law">${esc(s.law)}</p>
    <p class="meta">${(s.governs ?? []).map(tag).join('')}${s.lives?.length ? `<span class="lives">lives in ${s.lives.map((l) => `<code>${esc(l)}</code>`).join(', ')}</span>` : ''}</p>
  </header>
  <div class="grid">${s.cards.map(card).join('')}</div>
</section>`;

const laws = board.laws;
const lawsBlock = `
<section id="laws" class="laws">
  <div class="roles">
    <h2>Five roles per asset</h2>
    <div class="swatches">${laws.roles.map((r) => `<div class="swatch"><i style="background:${r.hex}"></i><b>${esc(r.role)}</b><span>${esc(r.meaning)}</span></div>`).join('')}</div>
    <h2>Identity pigments, never graded</h2>
    <div class="swatches">${laws.identity.map((r) => `<div class="swatch"><i style="background:linear-gradient(90deg,${r.hex} 60%,${r.second} 60%)"></i><b>${esc(r.name)}</b><span>${esc(r.hex)} · ${esc(r.second)}</span></div>`).join('')}
      <div class="swatch"><i style="background:${laws.field};border:1px solid #333"></i><b>field</b><span>${laws.field}</span></div>
      <div class="swatch"><i style="background:${laws.emitter}"></i><b>emitter</b><span>${laws.emitter}, one per shot</span></div>
    </div>
  </div>
  <div class="timing">
    <h2>Timing at 30 fps</h2>
    <table>${laws.timing.map((t) => `<tr><td><b>${esc(t.phase)}</b></td><td>${esc(t.frames)}</td><td>${esc(t.shape)}</td></tr>`).join('')}</table>
    <h2>Laws</h2>
    <ol>${laws.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ol>
    ${laws.medium ? `<h2>Medium</h2><ul class="anti">${laws.medium.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
    ${laws.process ? `<h2>Process</h2><ol class="process">${laws.process.map((r) => `<li>${esc(r)}</li>`).join('')}</ol>` : ''}
    ${laws.antireference ? `<h2>What the film is not</h2><ul class="anti">${laws.antireference.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}
  </div>
</section>`;

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(board.title)}</title>
<style>
:root{--field:#07060c;--ink:#e7e4da;--muted:#9a9ab0;--line:#1f1f2e;--gold:#d28a21;--blue:#56b0d4;--coral:#e8694a;--green:#67b479;--mauve:#c885c2}
*{box-sizing:border-box}
body{margin:0;background:var(--field);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--blue);text-underline-offset:3px}
code{font:12px ui-monospace,monospace;color:var(--muted)}
.wrap{max-width:1560px;margin:auto;padding:28px 32px 60px}
.masthead{display:grid;grid-template-columns:1.2fr 1fr;gap:32px;align-items:end;border-bottom:1px solid var(--line);padding-bottom:18px;margin-bottom:8px}
.masthead h1{font-size:30px;line-height:1.1;margin:0 0 8px;font-weight:650}
.masthead .rev{color:var(--muted);font-size:13px;margin:0}
.masthead .thesis{font-size:16px;margin:0 0 6px}
.masthead .prov{color:var(--muted);font-size:12.5px;margin:0}
.laws{display:grid;grid-template-columns:1.1fr 1fr;gap:36px;padding:18px 0 22px;border-bottom:1px solid var(--line)}
.laws h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:14px 0 8px;font-weight:600}
.laws h2:first-child{margin-top:0}
.swatches{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px 14px}
.swatch{display:grid;grid-template-columns:34px 1fr;gap:0 8px;align-items:center;font-size:12.5px}
.swatch i{display:block;width:34px;height:34px;border-radius:6px;grid-row:1/3}
.swatch b{font-weight:600}
.swatch span{color:var(--muted);font-size:11.5px;line-height:1.25}
.timing table{border-collapse:collapse;font-size:13px;width:100%}
.timing td{padding:3px 10px 3px 0;vertical-align:top;border-bottom:1px solid var(--line)}
.timing td:nth-child(2){white-space:nowrap;color:var(--gold)}
.timing ol{margin:0;padding-left:20px;font-size:13px;color:var(--ink)}
.timing li{margin:2px 0}
.timing ul.anti{margin:0;padding-left:18px;font-size:13px;color:var(--muted)}
.timing ul.anti li::marker{color:var(--coral)}
section{padding:26px 0 8px}
section>header h2{font-size:22px;margin:0 0 6px;font-weight:650}
.law{font-size:15px;margin:0 0 8px;max-width:1100px}
.meta{margin:0 0 14px;font-size:12px;color:var(--muted);display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.lives{margin-left:8px}
.tag{display:inline-block;font:11px/1 ui-monospace,monospace;padding:4px 6px;border-radius:4px;margin:0 4px 4px 0;border:1px solid var(--line)}
.tag.ruling{color:var(--gold);border-color:#4a3614}
.tag.criterion{color:var(--blue);border-color:#163a4a}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(480px,1fr));gap:18px}
.card{display:grid;grid-template-columns:220px 1fr;gap:14px;background:#0d0c16;border:1px solid var(--line);border-radius:10px;padding:12px;min-height:200px}
.media{position:relative;background:#000;border-radius:6px;overflow:hidden;aspect-ratio:4/3;display:flex;align-items:center;justify-content:center}
.media img,.media video{width:100%;height:100%;object-fit:contain;display:block}
.media.text{color:var(--muted);font-size:12px;border:1px dashed var(--line);background:transparent}
.media .at{position:absolute;right:6px;bottom:6px;font:11px ui-monospace,monospace;background:#000c;color:var(--ink);padding:3px 6px;border-radius:4px}
.card h3{font-size:16px;margin:0 0 2px;font-weight:650}
.by{color:var(--muted);font-size:12px;margin:0 0 8px}
.borrow,.refuse,.note{font-size:13px;margin:4px 0}
.borrow b{color:var(--green);font-weight:600}
.refuse b{color:var(--coral);font-weight:600}
.tags{margin:8px 0 0}
@media print{.card{break-inside:avoid}}
</style></head>
<body><div class="wrap">
<div class="masthead">
  <div><h1>${esc(board.title)}</h1><p class="rev">${esc(board.revision)}</p></div>
  <div><p class="thesis">${esc(board.thesis)}</p><p class="prov">${esc(board.provenance)}</p></div>
</div>
${lawsBlock}
${board.sections.map(section).join('')}
</div></body></html>`;

if (missing.length) {
  console.error('board.json points at files that do not exist:\n  ' + missing.join('\n  '));
  process.exit(1);
}
writeFileSync(outHtml, html);
const cards = board.sections.reduce((n, s) => n + s.cards.length, 0);
console.log(`wrote ${outHtml} · ${board.sections.length} sections · ${cards} cards`);

if (process.argv.includes('--png')) {
  const chrome = process.env.CHROME ?? '/usr/bin/google-chrome';
  const width = 1600;
  const height = Number(process.argv[process.argv.indexOf('--png') + 1]) || 9000;
  const outPng = join(refDir, 'board.png');
  execFileSync(chrome, [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars',
    `--window-size=${width},${height}`, `--screenshot=${outPng}`,
    '--virtual-time-budget=8000', `file://${outHtml}`,
  ], {stdio: 'pipe', timeout: 120_000});
  // Trim the empty field below the content: decode to 8-bit gray and find the last row brighter than the field.
  const gray = spawnSync('ffmpeg', ['-v', 'error', '-i', outPng, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], {maxBuffer: 1 << 28, timeout: 60_000}).stdout;
  let last = 0;
  for (let y = 0; y < height; y++) {
    const row = gray.subarray(y * width, (y + 1) * width);
    if (row.some((v) => v > 16)) last = y;
  }
  const h = Math.min(height, last + 40);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', outPng, '-vf', `crop=${width}:${h}:0:0`, outPng + '.tmp.png'], {stdio: 'pipe', timeout: 60_000});
  execFileSync('mv', [outPng + '.tmp.png', outPng]);
  console.log(`wrote ${outPng} (${width}x${h}, trimmed from ${height})`);
}
