#!/usr/bin/env node
// The production bible page (D94): v3/bible.json as one static page, read-only until edit mode is switched on (D95, row 7.7). A lane per track over the frame axis, a frame cursor whose
// readout lists every track's item at that frame, the animatic frame under the cursor, the flags, and the proposals as pins and cards.
// Edit mode (a header toggle, off by default) talks to scripts/animation/bible-server.mjs (/state, /edit, /boundary, /proposal, /inspiration, /rule);
// with no server answering (file://, a plain static server) the toggle stays disabled and the page is exactly the read-only page. Reading needs no fetch.
// usage: node scripts/animation/bible-page.mjs [--bible v3/bible.json] [--out out/bible.html] [--frames out/animatic-seq] [--frame 700]
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..', '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const biblePath = path.resolve(root, arg('bible', 'v3/bible.json'));
const outPath = path.resolve(root, arg('out', 'out/bible.html'));
const framesDir = path.resolve(root, arg('frames', 'out/animatic-seq'));
const startFrame = Number(arg('frame', 0));
if (!fs.existsSync(biblePath)) {
  console.error(`bible-page: ${path.relative(root, biblePath)} does not exist; run compile-bible.mjs first`);
  process.exit(1);
}
const bible = JSON.parse(fs.readFileSync(biblePath, 'utf8'));
if (bible.schema !== 'showcase.bible.1') {
  console.error(`bible-page: ${path.relative(root, biblePath)} has schema ${bible.schema}, this page reads showcase.bible.1`);
  process.exit(1);
}
if (!Number.isInteger(startFrame) || startFrame < 0 || startFrame >= bible.duration) {
  console.error(`bible-page: --frame ${arg('frame')} is outside 0-${bible.duration - 1}`);
  process.exit(1);
}
const hashPrefix = bible.inputsHash.slice(0, 12);
const boardFile = path.join(root, 'v3/references/board.json');
const boardCards = fs.existsSync(boardFile)
  ? JSON.parse(fs.readFileSync(boardFile, 'utf8')).sections.flatMap((sec) => sec.cards.map((c) => ({id: c.id, title: c.title, section: sec.title})))
  : [];
const rootFromOut = path.relative(path.dirname(outPath), root).split(path.sep).join('/') || '.';
const view = {
  bible,
  hashPrefix,
  startFrame,
  boardCards,
  animBase: fs.existsSync(framesDir) ? path.relative(path.dirname(outPath), framesDir).split(path.sep).join('/') : null,
  rootFromOut,
};
// the data rides inside a script element: `<` is escaped so no string in it can close the element
const data = JSON.stringify(view).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

const html = String.raw`<!doctype html>
<html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Production bible</title>
<style>
:root{--warm:#f0b35a;--rev:#8fb7ff;--gag:#f58a7a;--foc:#c9c9c9;--bg:#111;--panel:#181818;--line:#2c2c2c;--dim:#999}
*{box-sizing:border-box}
body{background:var(--bg);color:#eee;font:14px/1.45 system-ui,sans-serif;margin:0;padding:22px 32px 40px}
h1{font-weight:500;margin:0 0 2px}.sub{color:var(--dim);margin-bottom:16px}
h2{font-weight:500;font-size:16px;margin:26px 0 8px}
code{background:#222;padding:0 4px;border-radius:3px}
.top{display:grid;grid-template-columns:minmax(300px,520px) 1fr;gap:20px;align-items:start;margin-bottom:18px}
.anim{background:var(--panel);border-radius:8px;padding:10px}
.anim img{width:100%;display:block;border-radius:4px;background:#222;min-height:120px}
.anim .cap{color:var(--dim);font-size:12px;margin-top:4px}
.readout{background:var(--panel);border-radius:8px;padding:10px 14px;max-height:560px;overflow:auto}
.readout h3{margin:0 0 6px;font-size:15px;font-weight:600}
.rt{margin:0 0 8px;padding-left:10px;border-left:4px solid #444}
.rt b.tn{display:inline-block;min-width:110px;color:var(--dim);font-weight:500}
.rt .lbl{font-weight:600}
.rt dl{display:grid;grid-template-columns:130px 1fr;gap:1px 12px;margin:2px 0 0;font-size:13px}.rt dt{color:#888}.rt dd{margin:0;overflow-wrap:anywhere}
.rt.none{color:#666;border-color:#2a2a2a}
.sw{display:inline-block;width:11px;height:11px;border:1px solid #555;margin-right:4px;vertical-align:-1px}
details summary{cursor:pointer;color:#aaa}
.laneWrap{background:var(--panel);border-radius:8px;padding:10px 14px 12px}
.area{position:relative;margin-left:104px}
.axis{position:relative;height:22px;border-bottom:1px solid #444;margin-bottom:4px;cursor:crosshair}
.tick{position:absolute;top:0;height:22px;border-left:1px solid #555;padding-left:3px;font-size:11px;color:#888;white-space:nowrap;pointer-events:none}
.lane{position:relative;height:30px;margin:3px 0;background:#141414;cursor:crosshair}
.lane.tall{height:46px}
.lane>label{position:absolute;right:calc(100% + 8px);top:0;width:96px;text-align:right;color:var(--dim);font-size:12px;line-height:30px;white-space:nowrap;pointer-events:none}
.lane.tall>label{line-height:46px}
.seg{position:absolute;top:1px;bottom:1px;overflow:hidden;white-space:nowrap;font-size:11px;line-height:28px;padding:0 3px;border-left:1px solid #000;background:#2a2a2a;color:#ddd;pointer-events:none;min-width:1px}
.lane.tall .seg{line-height:44px}
.seg:nth-child(even){background:#333}
.warm{background:var(--warm)!important;color:#111}.rev{background:var(--rev)!important;color:#111}.gag{background:var(--gag)!important;color:#111}.foc{background:var(--foc)!important;color:#111}
.lane[data-track=camera] .seg{border-left:0;background:#2e3238}.lane[data-track=camera] .seg:nth-child(even){background:#363b42}
.seg.pair{padding:0;color:#111;font-size:10px;line-height:normal;display:flex;flex-direction:column;justify-content:flex-end}
.seg.pair span{display:block;padding:0 3px;background:rgba(255,255,255,.55);overflow:hidden;text-overflow:ellipsis}
.seg.cross{background:#5b4a7a;color:#fff;top:auto;height:14px;line-height:14px;font-size:10px}
.seg.key{background:#3b4a63;color:#fff}
.pin{position:absolute;top:2px;width:22px;height:26px;margin-left:-11px;cursor:pointer;pointer-events:auto;text-align:center;font-size:11px;color:#111;line-height:20px}
.pin i{display:block;width:16px;height:16px;margin:2px auto 0;transform:rotate(45deg);border:2px solid #111;background:var(--c,#f0b35a)}
.pinrange{position:absolute;top:13px;height:4px;background:var(--c,#f0b35a);opacity:.45;pointer-events:none}
.cursor{position:absolute;top:0;bottom:0;width:2px;background:#fff;pointer-events:none;z-index:5;box-shadow:0 0 6px #fff8}
.bline{position:absolute;top:22px;bottom:0;border-left:1px dashed #333;pointer-events:none}
.ctl{margin:10px 0 0 104px}
.ctl input[type=range]{width:100%;margin:0;accent-color:#f0b35a}
.ctl output{display:block;color:#ccc;font-variant-numeric:tabular-nums;margin-top:2px}
.flags{background:var(--panel);border-radius:8px;padding:8px 16px;border-left:6px solid var(--gag)}
.flags li{color:#ff9d8f;margin:3px 0}.flags li b{color:var(--gag)}
.cards{display:grid;gap:14px}
.card{background:var(--panel);border-radius:8px;padding:12px 16px;border-left:6px solid var(--c,#f0b35a)}
.card.hit{outline:2px solid #fff}
.card h3{margin:0 0 4px;font-size:16px}.card .meta{color:var(--dim);font-size:13px;margin-bottom:8px}
.card .meta b{color:#ddd;font-weight:600}
.card p.text{margin:0 0 10px;max-width:110ch}
.ba{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.ba section{background:#121212;border-radius:6px;padding:8px 10px;min-width:0}
.ba h4{margin:0 0 4px;font-size:12px;color:var(--dim);font-weight:500;text-transform:uppercase;letter-spacing:.05em}
.ba pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;color:#cfd}
.ba img{max-width:100%;display:block;margin-bottom:6px;border-radius:4px}
.refs{margin:8px 0 0;padding-left:18px;font-size:13px;color:#ccc}.refs small{color:#888}
header.bar{display:flex;gap:18px;align-items:baseline;flex-wrap:wrap}
.edtoggle{color:#ddd;font-size:13px;user-select:none}.edtoggle input{accent-color:#f58a7a;vertical-align:-2px}.edtoggle[aria-disabled=true]{color:#777}
#edstat{color:var(--dim);font-size:12px}
.banner{border-radius:6px;padding:8px 14px;margin:0 0 12px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px}
.banner.bad{background:#3a1d19;border:1px solid var(--gag);color:#ffb3a8}.banner.ok{background:#1d2e1f;border:1px solid #6fbf73;color:#b9e5bc}.banner.info{background:#222;border:1px solid #555;color:#ccc}
.banner button{float:right;background:none;border:0;color:inherit;cursor:pointer;font-size:16px;line-height:1}
body:not(.editing) .edonly{display:none!important}
button.eb{background:#2a2a2a;color:#eee;border:1px solid #555;border-radius:5px;padding:3px 10px;font:inherit;font-size:12px;cursor:pointer}button.eb:hover{border-color:#f0b35a}button.eb:disabled{opacity:.45;cursor:default}
button.eb.go{background:#4a3a18;border-color:#f0b35a}
.acts{display:flex;gap:8px;margin:0 0 8px}
.editbox{margin:6px 0 4px;padding:6px 8px;background:#121212;border:1px dashed #5a4a2a;border-radius:6px}
.erow{display:grid;grid-template-columns:96px 1fr auto;gap:6px 8px;align-items:start;margin:3px 0;font-size:12px}.erow>label{color:#999;padding-top:4px}
.erow input,.erow textarea,.dlg input,.dlg textarea,.dlg select{background:#1c1c1c;color:#eee;border:1px solid #444;border-radius:4px;padding:3px 6px;font:inherit;font-size:12px;width:100%}
.erow input[type=number]{width:80px}
.arow{display:grid;grid-template-columns:90px 1fr auto;gap:4px;margin:0 0 3px}
.handle{position:absolute;top:0;bottom:0;width:11px;margin-left:-6px;z-index:6;cursor:ew-resize;display:none;touch-action:none;background:rgba(255,255,255,.18);border-left:2px solid #fff}
body.editing .handle{display:block}.handle:hover,.handle.on{background:rgba(245,138,122,.55)}
.lane[data-track=pacing] .seg{transition:none}
.laneWrap.drag{overflow:hidden}
#dragnote{color:#f0b35a;font-size:12px;min-height:16px;margin-top:2px}
.rpin{position:absolute;top:7px;width:16px;height:16px;margin-left:-8px;background:#8fb7ff;border:2px solid #111;cursor:pointer;font-size:0}
.unanch{background:var(--panel);border-radius:8px;padding:8px 16px}.unanch li{margin:4px 0;font-size:13px;color:#ccc;overflow-wrap:anywhere}.unanch li b{color:#8fb7ff}.unanch li small{color:#888}
.dlgback{position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:50;display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:30px 12px}
.dlg{background:#1a1a1a;border:1px solid #555;border-radius:10px;padding:14px 18px;width:min(760px,100%)}.dlg h3{margin:0 0 8px}
.dlg label.f{display:block;margin:8px 0 2px;color:#aaa;font-size:12px}
.dlg input[type=checkbox]{width:auto;margin-right:6px;vertical-align:-2px}
.dlg .refs{max-height:190px;overflow:auto;background:#121212;border:1px solid #333;border-radius:4px;padding:4px 8px}.dlg .refs label{display:block;font-size:12px;color:#ccc;padding:1px 0}.dlg .refs small{color:#777}
.dlg .btns{display:flex;gap:8px;margin-top:12px}
.rulebox{margin-top:8px}.rulebox textarea{width:100%;min-height:60px;background:#1c1c1c;color:#eee;border:1px solid #444;border-radius:4px;padding:4px 6px;font:inherit;font-size:13px}
footer{margin-top:30px;color:#777;font-size:12px;border-top:1px solid #2a2a2a;padding-top:10px}
</style>
<body>
<header class="bar"><h1>Production bible</h1>
  <label class="edtoggle" id="edlabel"><input type="checkbox" id="editToggle" disabled> edit mode</label><span id="edstat">checking for the bible server…</span></header>
<div class="sub" id="sub"></div>
<div class="banner" id="banner" hidden></div>
<div class="top">
  <div class="anim"><img id="anim" alt="animatic frame at the cursor"><div class="cap" id="animcap"></div></div>
  <div class="readout" id="readout"></div>
</div>
<div class="laneWrap">
  <div class="area" id="area">
    <div class="axis" id="axis"></div>
    <div id="lanes"></div>
    <div class="cursor" id="cursor"></div>
  </div>
  <div class="ctl"><input type="range" id="range" min="0" step="1" value="0" aria-label="frame cursor"><output id="out"></output><div id="dragnote"></div></div>
</div>
<h2>Flags</h2>
<ul class="flags" id="flags"></ul>
<h2>Rulings with no proposal on a beat</h2>
<div id="unanch"></div>
<h2>Proposals</h2>
<div class="cards" id="cards"></div>
<footer id="foot">bible ${hashPrefix} · read-only unless edit mode is on; edits need <code>npm run bible:serve</code> (they patch v3/*.json and rebuild through <code>npm run bible</code>)</footer>
<div id="dlgroot"></div>
<script type="application/json" id="view">${data}</script>
<script>
(function () {
  var V = JSON.parse(document.getElementById('view').textContent);
  var B = V.bible, D = B.duration, FPS = B.fps;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]; }); };
  var pct = function (f) { return (100 * f / D) + '%'; };
  var regClass = function (r) { return /reverent/.test(r) ? 'rev' : /gag|comic/.test(r) ? 'gag' : /focus/.test(r) ? 'foc' : 'warm'; };
  var KIND_COLOUR = {change: '#f0b35a', inspiration: '#8fb7ff', eureka: '#ffe9b0', 'owner-ask': '#ffd37a', finding: '#c9c9c9'};
  var track = function (n) { return B.tracks.filter(function (t) { return t.name === n; })[0]; };
  var seconds = function (f) { return (f / FPS).toFixed(1) + ' s'; };
  var EDIT = {on: false, ok: false}, CUR = 0, pacingSegs = [], pacingHandles = [], rulingsPerBeat = {};

  $('sub').textContent = B.revision + ' · bible ' + V.hashPrefix + ' · ' + D + ' frames · ' + (D / FPS) + ' s at ' + FPS + ' fps · colours: amber warm/playful, blue reverent, coral gag, grey focus';

  // ---- plain-words rendering of an item's data ----
  function human(k) { return k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase(); }
  function plain(v) {
    if (v == null) return '–';
    if (typeof v === 'string') {
      if (/^#[0-9a-fA-F]{6}$/.test(v)) return '<span class="sw" style="background:' + v + '"></span>' + esc(v);
      return esc(v);
    }
    if (typeof v === 'number' || typeof v === 'boolean') return esc(v);
    if (Array.isArray(v)) return v.length === 0 ? '–' : v.every(function (x) { return typeof x === 'number'; }) ? '(' + v.join(', ') + ')' : v.map(plain).join('; ');
    return Object.keys(v).map(function (k) { return esc(human(k)) + ' ' + plain(v[k]); }).join(', ');
  }
  function fields(item) {
    var d = item.data || {};
    var keys = Object.keys(d).filter(function (k) { return k !== 'prose' && k !== 'text' && k !== 'before' && k !== 'after' && k !== 'file'; });
    var out = '<dl>' + keys.map(function (k) { return '<dt>' + esc(human(k)) + '</dt><dd>' + plain(d[k]) + '</dd>'; }).join('') + '</dl>';
    var long = d.prose || d.text;
    if (long) out += '<details><summary>' + (d.prose ? 'script prose' : 'text') + ' (' + long.length + ' characters)</summary>' + esc(long).replace(/\n/g, '<br>') + '</details>';
    return out;
  }
  function itemsAt(t, f) {
    return t.items.filter(function (it) { return f >= it.start && f < it.end; });
  }
  function pacingColour(f) {
    var it = itemsAt(track('pacing'), f)[0];
    return it ? regClass(it.data.register) : 'warm';
  }

  // ---- axis, lanes ----
  var axis = $('axis'), lanes = $('lanes');
  var step = 150;
  for (var f = 0; f < D; f += step) {
    var tk = document.createElement('div'); tk.className = 'tick'; tk.style.left = pct(f); tk.textContent = f + ' · ' + (f / FPS) + 's'; axis.appendChild(tk);
  }
  track('pacing').items.forEach(function (it) {
    if (it.start === 0) return;
    var l = document.createElement('div'); l.className = 'bline'; l.style.left = pct(it.start); $('area').appendChild(l);
  });
  B.tracks.forEach(function (t) {
    var lane = document.createElement('div');
    lane.className = 'lane' + (t.name === 'colour-script' ? ' tall' : '');
    lane.dataset.track = t.name;
    var lab = document.createElement('label'); lab.textContent = t.name; lane.appendChild(lab);
    t.items.forEach(function (it) {
      if (t.name === 'proposals') {
        var kc = KIND_COLOUR[it.data.kind] || '#f0b35a';
        if (it.end - it.start > 1) {
          var r = document.createElement('div'); r.className = 'pinrange'; r.style.left = pct(it.start); r.style.width = (100 * (it.end - it.start) / D) + '%'; r.style.setProperty('--c', kc); lane.appendChild(r);
        }
        var pin = document.createElement('div'); pin.className = 'pin'; pin.style.left = pct(it.start); pin.style.setProperty('--c', kc);
        pin.title = it.label + ' (' + it.data.kind + ', ' + it.data.status + ')'; pin.innerHTML = '<i></i>';
        pin.addEventListener('click', function (e) { e.stopPropagation(); setFrame(it.start); var c = $('card-' + it.data.id); if (c) { c.scrollIntoView({block: 'center'}); c.classList.add('hit'); setTimeout(function () { c.classList.remove('hit'); }, 1600); } });
        lane.appendChild(pin);
        return;
      }
      if (t.name === 'rulings') {
        var n = rulingsPerBeat[it.beat] = (rulingsPerBeat[it.beat] || 0) + 1;
        var rp = document.createElement('div'); rp.className = 'rpin'; rp.style.left = (100 * it.start / D + (n - 1) * 1.2) + '%';
        rp.title = it.label + ' · ' + (it.data.who || '') + ' ' + (it.data.date || '') + ' · closes ' + it.data.closes.join(', ');
        rp.addEventListener('click', function (e) { e.stopPropagation(); setFrame(it.start); });
        lane.appendChild(rp);
        return;
      }
      var s = document.createElement('div');
      s.className = 'seg';
      s.style.left = pct(it.start); s.style.width = (100 * (it.end - it.start) / D) + '%';
      s.title = it.label + ' (' + it.start + '–' + it.end + ')';
      if (t.name === 'pacing') { s.className += ' ' + regClass(it.data.register); s.textContent = it.label + ' · ' + it.data.seconds + ' s'; }
      else if (t.name === 'colour-script') {
        var a = it.data.radiance, b = it.data.accent;
        s.className += ' pair';
        if (a && b) s.style.background = 'linear-gradient(to right,' + a + ' 50%,' + b + ' 50%)';
        s.innerHTML = '<span>' + esc(it.beat) + ' ' + esc(a || '') + ' ' + esc(b || '') + '</span>';
      }
      else if (t.name === 'look' && it.data.crossing) { s.className += ' cross'; s.textContent = it.label; }
      else if (t.name === 'keys') { s.className += ' key'; s.textContent = it.label; }
      else s.textContent = it.label;
      lane.appendChild(s);
      if (t.name === 'pacing') pacingSegs.push({el: s, item: it});
    });
    if (t.name === 'pacing') t.items.forEach(function (it, i) {
      var hd = document.createElement('div'); hd.className = 'handle'; hd.style.left = pct(it.end);
      hd.title = 'drag: move the end of ' + it.beat + ' (whole seconds; the later beats shift)';
      hd.addEventListener('pointerdown', function (e) { startDrag(e, i, hd); });
      hd.addEventListener('click', function (e) { e.stopPropagation(); });
      lane.appendChild(hd); pacingHandles.push(hd);
    });
    lane.addEventListener('click', function (e) { var r = $('area').getBoundingClientRect(); setFrame(Math.max(0, Math.min(D - 1, Math.floor((e.clientX - r.left) / r.width * D)))); });
    lanes.appendChild(lane);
  });
  axis.addEventListener('click', function (e) { var r = $('area').getBoundingClientRect(); setFrame(Math.max(0, Math.min(D - 1, Math.floor((e.clientX - r.left) / r.width * D)))); });

  // ---- cursor, readout, animatic ----
  var range = $('range'); range.max = D - 1;
  function setFrame(f) {
    f = Math.max(0, Math.min(D - 1, f | 0));
    CUR = f;
    range.value = f;
    $('cursor').style.left = pct(f + 0.5);
    $('out').textContent = 'frame ' + f + ' · ' + seconds(f);
    var beat = itemsAt(track('pacing'), f)[0];
    var look = itemsAt(track('look'), f);
    var h = '<h3>Frame ' + f + ' · ' + seconds(f) + (beat ? ' · beat ' + esc(beat.beat) : '') + '</h3>' +
      (EDIT.on ? '<div class="acts"><button class="eb go" id="btnPropose">propose here</button><button class="eb go" id="btnInsp">file inspiration</button></div>' : '');
    B.tracks.forEach(function (t) {
      var hits = itemsAt(t, f);
      if (t.name === 'proposals') hits = t.items.filter(function (it) { return f >= it.start && f < it.end; });
      var cls = hits[0] && t.name === 'pacing' ? pacingColour(f) : '';
      if (!hits.length) { h += '<div class="rt none"><b class="tn">' + esc(t.name) + '</b> nothing at this frame</div>'; return; }
      hits.forEach(function (it) {
        h += '<div class="rt" style="border-color:' + (t.name === 'pacing' ? ({warm: '#f0b35a', rev: '#8fb7ff', gag: '#f58a7a', foc: '#c9c9c9'})[cls] : '#555') + '"><b class="tn">' + esc(t.name) + '</b> <span class="lbl">' + esc(it.label) + '</span> <small style="color:#777">' + it.start + '–' + it.end + '</small>' + fields(it) + (t.name === 'pacing' && EDIT.on ? editBox(it) : '') + '</div>';
      });
    });
    $('readout').innerHTML = h;
    if (EDIT.on) wireReadout();
    var img = $('anim'), name = 'element-' + ('0000' + f).slice(-4) + '.png';
    if (V.animBase) { img.style.display = ''; img.alt = 'animatic frame ' + f; img.src = V.animBase + '/' + name; $('animcap').textContent = V.animBase + '/' + name; }
    else { img.style.display = 'none'; $('animcap').textContent = 'no animatic frames next to this page'; }
    try { history.replaceState(null, '', '#' + f); } catch (e) {}
  }
  $('anim').addEventListener('error', function () { $('animcap').textContent += ' · this frame is not rendered'; this.removeAttribute('src'); });
  range.addEventListener('input', function () { setFrame(Number(range.value)); });

  // ---- flags ----
  $('flags').innerHTML = B.flags.length ? B.flags.map(function (f) { return '<li><b>' + esc(f.beat) + '</b> · ' + esc(f.text) + '</li>'; }).join('') : '<li style="color:#999">no flags</li>';

  // ---- proposals as cards ----
  var IMG = /\.(png|jpe?g|gif|webp|svg)$/i;
  function side(v) {
    if (v == null) return '<pre>–</pre>';
    var imgs = [];
    function walk(x) {
      if (typeof x === 'string') { if (IMG.test(x)) imgs.push(x); return x; }
      if (Array.isArray(x)) return x.map(walk);
      if (x && typeof x === 'object') { var o = {}; Object.keys(x).forEach(function (k) { o[k] = walk(x[k]); }); return o; }
      return x;
    }
    var rest = walk(v);
    var html = imgs.map(function (p) { return '<img src="' + esc(/^(https?:|\/)/.test(p) ? p : V.rootFromOut + '/' + p) + '" alt="' + esc(p) + '">'; }).join('');
    return html + '<pre>' + esc(typeof rest === 'string' ? rest : JSON.stringify(rest, null, 2)) + '</pre>';
  }
  function anchorText(a) {
    if (a.frame != null) return 'frame ' + a.frame + (a.beat ? ' in ' + a.beat : '');
    if (a.frames) return 'frames ' + a.frames.join('–');
    if (a.beats) return 'beats ' + a.beats.join(' to ');
    return 'beat ' + a.beat;
  }
  function renderCards() {
  var cards = track('proposals').items.map(function (it) {
    var d = it.data, kc = KIND_COLOUR[d.kind] || '#f0b35a';
    var refs = d.references.length ? '<ul class="refs">' + d.references.map(function (r) { return '<li><b>' + esc(r.title || r.id) + '</b> <small>' + esc(r.id) + ' · ' + esc(r.kind) + (r.section ? ' · ' + esc(r.section) : '') + '</small>' + (r.borrow ? '<br><small>borrow: ' + plain(r.borrow) + '</small>' : '') + '</li>'; }).join('') + '</ul>' : '';
    return '<div class="card" id="card-' + esc(d.id) + '" style="--c:' + kc + '"><h3>' + esc(d.id) + ' · ' + esc(d.title) + '</h3>' +
      '<div class="meta">from <b>' + esc(d.from) + '</b> · kind <b>' + esc(d.kind) + '</b> · anchor <b>' + esc(anchorText(d.anchor)) + '</b> (frames ' + it.start + '–' + it.end + ') · status <b>' + esc(d.status) + '</b>' + (d.ruling ? ' · ruling <b>' + esc(d.ruling) + '</b>' : ' · no ruling yet') + (d.date ? ' · ' + esc(d.date) : '') + '</div>' +
      '<p class="text">' + esc(d.text) + '</p>' + '<div class="ba"><section><h4>Before</h4>' + side(d.before) + '</section><section><h4>After</h4>' + side(d.after) + '</section></div>' + refs +
      (EDIT.on && d.status === 'open' ? '<div class="rulebox"><button class="eb go" data-rule="' + esc(d.id) + '">rule</button></div>' : '') + '</div>';
  });
  $('cards').innerHTML = cards.length ? cards.join('') : '<div style="color:#999">no proposals</div>';
  }
  renderCards();

  // ---- rulings with no proposal on a beat: listed, not timed ----
  (function () {
    var u = B.unanchored || [];
    $('unanch').innerHTML = u.length ? '<details class="unanch"><summary>' + u.length + ' rulings (' + esc(u[0].id) + ' to ' + esc(u[u.length - 1].id) + ') close no proposal</summary><ul>' + u.map(function (r) {
      return '<li><b>' + esc(r.ids.join('/')) + '</b> <small>' + esc(r.who || 'no author') + (r.date ? ' · ' + esc(r.date) : '') + '</small> ' + esc(r.text.length > 260 ? r.text.slice(0, 260) + '…' : r.text) + '</li>';
    }).join('') + '</ul></details>' : '<div style="color:#999">every ruling is anchored to a proposal</div>';
  })();

  // ---- edit mode: talks to bible-server.mjs; nothing here runs unless the toggle is on ----
  function banner(text, kind) {
    var b = $('banner');
    if (!text) { b.hidden = true; return; }
    b.className = 'banner ' + kind; b.hidden = false;
    b.textContent = text;
    var x = document.createElement('button'); x.textContent = '×'; x.title = 'dismiss'; x.addEventListener('click', function () { b.hidden = true; });
    b.insertBefore(x, b.firstChild);
  }
  function post(url, body, btn) {
    if (btn) btn.disabled = true;
    banner('saving…', 'info');
    return fetch(url, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)}).then(function (r) {
      return r.json().catch(function () { return {ok: false, refusal: 'the server answered ' + r.status + ' without a JSON body'}; });
    }).then(function (j) {
      if (j.ok) {
        try { sessionStorage.setItem('bibleNote', 'saved · bible ' + j.hash + (j.what ? ' · ' + j.what : '') + (j.eagle ? ' · inspiration ' + (j.eagle.ok ? 'sent' : 'not sent: ' + j.eagle.output) : '')); sessionStorage.setItem('bibleEdit', '1'); } catch (e) {}
        location.reload();
      } else { banner(j.refusal || 'refused without a reason', 'bad'); if (btn) btn.disabled = false; resetPreview(); }
      return j;
    }, function (err) { banner('the bible server did not answer: ' + err.message, 'bad'); if (btn) btn.disabled = false; resetPreview(); });
  }

  // the pacing lane while a boundary is dragged: the dragged beat gets its new length, every later beat shifts by the same amount
  function resetPreview() { previewPacing(-1, 0); $('dragnote').textContent = ''; }
  function previewPacing(i, secs) {
    var items = track('pacing').items, at = 0, total0 = 0, total1 = 0;
    items.forEach(function (it, k) {
      var sec = k === i ? secs : it.data.seconds;
      var a = Math.round(at * FPS), b = Math.round((at + sec) * FPS);
      var seg = pacingSegs[k].el;
      seg.style.left = pct(a); seg.style.width = (100 * (b - a) / D) + '%';
      seg.textContent = it.label + ' · ' + sec + ' s';
      pacingHandles[k].style.left = pct(b);
      at += sec; total0 += it.data.seconds; total1 += sec;
    });
    return {total0: total0, total1: total1};
  }
  function startDrag(e, i, hd) {
    if (!EDIT.on) return;
    e.preventDefault(); e.stopPropagation();
    var items = track('pacing').items, it = items[i], startSec = 0, k;
    for (k = 0; k < i; k++) startSec += items[k].data.seconds;
    var orig = it.data.seconds, cur = orig, r = $('area').getBoundingClientRect();
    hd.classList.add('on'); $('area').parentNode.classList.add('drag');
    try { hd.setPointerCapture(e.pointerId); } catch (x) {}
    function move(ev) {
      var t = Math.max(startSec + 1, Math.min(startSec + 600, Math.round((ev.clientX - r.left) / r.width * D / FPS)));
      cur = t - startSec;
      var tot = previewPacing(i, cur), later = items.length - 1 - i, d = cur - orig;
      $('dragnote').textContent = it.beat + ' ' + orig + ' s → ' + cur + ' s (ends at ' + t + ' s)' + (d ? ' · the ' + later + ' later beat' + (later === 1 ? '' : 's') + ' shift' + (later === 1 ? 's' : '') + ' ' + (d > 0 ? '+' : '') + d + ' s' : '') + ' · total ' + tot.total0 + ' s → ' + tot.total1 + ' s';
    }
    function up() {
      hd.removeEventListener('pointermove', move); hd.removeEventListener('pointerup', up); hd.removeEventListener('pointercancel', up);
      hd.classList.remove('on'); $('area').parentNode.classList.remove('drag');
      if (cur === orig) { resetPreview(); return; }
      post('/boundary', {beat: it.beat, newEndSeconds: startSec + cur});
    }
    hd.addEventListener('pointermove', move); hd.addEventListener('pointerup', up); hd.addEventListener('pointercancel', up);
  }

  // the inline fields of the readout (pacing item at the cursor)
  function editBox(it) {
    var d = it.data, acts = (d.actions || []).map(function (a) { var j = a.indexOf(': '); return j > -1 ? {actor: a.slice(0, j), does: a.slice(j + 2)} : {actor: '', does: a}; });
    return '<div class="editbox" data-beat="' + esc(it.beat) + '">' +
      '<div class="erow"><label>seconds</label><input type="number" min="1" step="1" data-f="seconds" value="' + esc(d.seconds) + '"><button class="eb" data-save="seconds">save</button></div>' +
      '<div class="erow"><label>register</label><input type="text" data-f="register" value="' + esc(d.register) + '"><button class="eb" data-save="register">save</button></div>' +
      '<div class="erow"><label>light pushes</label><textarea rows="2" data-f="light_pushes">' + esc(d.light_pushes) + '</textarea><button class="eb" data-save="light_pushes">save</button></div>' +
      '<div class="erow"><label>actions</label><div data-f="actions">' + acts.map(actionRow).join('') + '</div><span><button class="eb" data-add="action">add</button> <button class="eb" data-save="actions">save</button></span></div></div>';
  }
  function actionRow(a) { return '<div class="arow"><input type="text" data-k="actor" placeholder="actor" value="' + esc(a.actor) + '"><input type="text" data-k="does" placeholder="does" value="' + esc(a.does) + '"><button class="eb" data-del="1" title="remove">×</button></div>'; }
  function wireReadout() {
    var ro = $('readout'), box = ro.querySelector('.editbox');
    var bp = $('btnPropose'), bi = $('btnInsp');
    if (bp) bp.addEventListener('click', function () { openCard('proposal'); });
    if (bi) bi.addEventListener('click', function () { openCard('inspiration'); });
    if (!box) return;
    box.addEventListener('click', function (e) {
      var t = e.target;
      if (t.dataset.del) { t.parentNode.parentNode.removeChild(t.parentNode); return; }
      if (t.dataset.add) { var holder = box.querySelector('[data-f=actions]'), tmp = document.createElement('div'); tmp.innerHTML = actionRow({actor: '', does: ''}); holder.appendChild(tmp.firstChild); return; }
      var field = t.dataset.save;
      if (!field) return;
      var value;
      if (field === 'seconds') value = Number(box.querySelector('[data-f=seconds]').value);
      else if (field === 'actions') value = Array.prototype.map.call(box.querySelectorAll('.arow'), function (r) { return {actor: r.querySelector('[data-k=actor]').value, does: r.querySelector('[data-k=does]').value}; });
      else value = box.querySelector('[data-f=' + field + ']').value;
      post('/edit', {file: 'beats-v2', beat: box.dataset.beat, field: field, value: value}, t);
    });
  }

  // the card form: a proposal or an inspiration anchored at the cursor
  function openCard(mode) {
    var beat = itemsAt(track('pacing'), CUR)[0], insp = mode === 'inspiration';
    var root = $('dlgroot');
    root.innerHTML = '<div class="dlgback"><form class="dlg"><h3>' + (insp ? 'File an inspiration' : 'Propose') + ' at frame ' + CUR + ' · beat ' + esc(beat ? beat.beat : '?') + '</h3>' +
      (insp ? '' : '<label class="f">kind</label><select name="kind">' + ['change', 'inspiration', 'eureka', 'owner-ask', 'finding'].map(function (k) { return '<option>' + k + '</option>'; }).join('') + '</select>') +
      '<label class="f">title</label><input name="title" required maxlength="120">' +
      '<label class="f">text</label><textarea name="text" rows="5" required></textarea>' +
      '<label class="f">from</label><select name="from"><option>owner</option><option>director</option></select>' +
      (insp ? '<label class="f">url (sent to the Eagle inbox through the inspiration skill; leave empty to file the proposal only)</label><input name="url" placeholder="https://…">' : '') +
      '<label class="f">references (board cards)</label><div class="refs">' + V.boardCards.map(function (c) { return '<label><input type="checkbox" name="ref" value="' + esc(c.id) + '"> ' + esc(c.title) + ' <small>' + esc(c.id) + ' · ' + esc(c.section) + '</small></label>'; }).join('') + '</div>' +
      '<label class="f">before (text)</label><textarea name="before" rows="2"></textarea><label class="f">after (text)</label><textarea name="after" rows="2"></textarea>' +
      '<div class="btns"><button class="eb go" type="submit">file it</button><button class="eb" type="button" id="dlgCancel">cancel</button></div></form></div>';
    root.querySelector('#dlgCancel').addEventListener('click', function () { root.innerHTML = ''; });
    root.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var f = e.target, body = {
        kind: insp ? 'inspiration' : f.kind.value, title: f.title.value, text: f.text.value, from: f.from.value,
        anchor: {beat: beat ? beat.beat : null, frame: CUR},
        references: Array.prototype.map.call(f.querySelectorAll('input[name=ref]:checked'), function (c) { return c.value; })
      };
      if (f.before.value.trim()) body.before = f.before.value;
      if (f.after.value.trim()) body.after = f.after.value;
      if (insp && f.url.value.trim()) body.url = f.url.value.trim();
      root.innerHTML = '';
      post(insp ? '/inspiration' : '/proposal', body);
    });
  }

  // a ruling on an open proposal card
  $('cards').addEventListener('click', function (e) {
    var t = e.target, id = t.dataset && t.dataset.rule;
    if (id) {
      t.parentNode.innerHTML = '<textarea placeholder="the ruling, in the owner’s words"></textarea><div style="margin-top:4px"><button class="eb go" data-rule-go="' + esc(id) + '">write the ruling</button> <button class="eb" data-rule-no="1">cancel</button></div>';
      return;
    }
    if (t.dataset && t.dataset.ruleNo) { renderCards(); return; }
    var go = t.dataset && t.dataset.ruleGo;
    if (go) post('/rule', {proposal: go, text: t.parentNode.parentNode.querySelector('textarea').value, who: 'owner'}, t);
  });

  // the toggle: available only when the bible server answers
  function setEdit(on) {
    EDIT.on = !!on && EDIT.ok;
    document.body.classList.toggle('editing', EDIT.on);
    $('editToggle').checked = EDIT.on;
    try { sessionStorage.setItem('bibleEdit', EDIT.on ? '1' : '0'); } catch (e) {}
    $('edstat').textContent = EDIT.on ? 'edit mode: drag a beat end on the pacing lane, edit fields in the readout, or propose at the cursor' : EDIT.ok ? 'the bible server answers; switch on to edit' : $('edstat').textContent;
    setFrame(CUR); renderCards();
  }
  $('editToggle').addEventListener('change', function () { setEdit(this.checked); });
  (location.protocol === 'file:' ? Promise.resolve(null) : fetch('/state', {cache: 'no-store'}).then(function (r) { return r.ok ? r.json() : null; })).catch(function () { return null; }).then(function (j) {
    EDIT.ok = !!(j && j.ok);
    $('editToggle').disabled = !EDIT.ok;
    $('edlabel').setAttribute('aria-disabled', String(!EDIT.ok));
    $('edstat').textContent = EDIT.ok ? 'the bible server answers; switch on to edit' : 'read-only: no bible server answers here (npm run bible:serve, then open http://127.0.0.1:8765/)';
    var keep = false, note = null;
    try { keep = sessionStorage.getItem('bibleEdit') === '1'; note = sessionStorage.getItem('bibleNote'); sessionStorage.removeItem('bibleNote'); } catch (e) {}
    if (EDIT.ok && keep) setEdit(true);
    if (note) banner(note, 'ok');
  });


  var m = /^#(\d+)$/.exec(location.hash || '');
  var q = /[?&]frame=(\d+)/.exec(location.search || '');
  setFrame(m ? Number(m[1]) : q ? Number(q[1]) : V.startFrame);
})();
</script>
</html>
`;
fs.mkdirSync(path.dirname(outPath), {recursive: true});
fs.writeFileSync(outPath, html);
console.log(`bible-page: ${bible.tracks.length} tracks, ${bible.flags.length} flags, hash ${hashPrefix}, frame ${startFrame} -> ${path.relative(root, outPath)}`);
