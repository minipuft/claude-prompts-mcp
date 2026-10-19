#!/usr/bin/env node
// The production bible page (D94): v3/bible.json as one static, read-only page. A lane per track over the frame axis, a frame cursor whose
// readout lists every track's item at that frame, the animatic frame under the cursor, the flags, and the proposals as pins and cards.
// No fetch and no external file but the animatic frames, so it opens from file:// and from http://127.0.0.1:8765/out/.
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
const rootFromOut = path.relative(path.dirname(outPath), root).split(path.sep).join('/') || '.';
const view = {
  bible,
  hashPrefix,
  startFrame,
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
footer{margin-top:30px;color:#777;font-size:12px;border-top:1px solid #2a2a2a;padding-top:10px}
</style>
<body>
<h1>Production bible</h1>
<div class="sub" id="sub"></div>
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
  <div class="ctl"><input type="range" id="range" min="0" step="1" value="0" aria-label="frame cursor"><output id="out"></output></div>
</div>
<h2>Flags</h2>
<ul class="flags" id="flags"></ul>
<h2>Proposals</h2>
<div class="cards" id="cards"></div>
<footer id="foot">bible ${hashPrefix} · read-only: edit v3/*.json and re-run compile-bible.mjs then bible-page.mjs</footer>
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
    });
    lane.addEventListener('click', function (e) { var r = $('area').getBoundingClientRect(); setFrame(Math.max(0, Math.min(D - 1, Math.floor((e.clientX - r.left) / r.width * D)))); });
    lanes.appendChild(lane);
  });
  axis.addEventListener('click', function (e) { var r = $('area').getBoundingClientRect(); setFrame(Math.max(0, Math.min(D - 1, Math.floor((e.clientX - r.left) / r.width * D)))); });

  // ---- cursor, readout, animatic ----
  var range = $('range'); range.max = D - 1;
  function setFrame(f) {
    f = Math.max(0, Math.min(D - 1, f | 0));
    range.value = f;
    $('cursor').style.left = pct(f + 0.5);
    $('out').textContent = 'frame ' + f + ' · ' + seconds(f);
    var beat = itemsAt(track('pacing'), f)[0];
    var look = itemsAt(track('look'), f);
    var h = '<h3>Frame ' + f + ' · ' + seconds(f) + (beat ? ' · beat ' + esc(beat.beat) : '') + '</h3>';
    B.tracks.forEach(function (t) {
      var hits = itemsAt(t, f);
      if (t.name === 'proposals') hits = t.items.filter(function (it) { return f >= it.start && f < it.end; });
      var cls = hits[0] && t.name === 'pacing' ? pacingColour(f) : '';
      if (!hits.length) { h += '<div class="rt none"><b class="tn">' + esc(t.name) + '</b> nothing at this frame</div>'; return; }
      hits.forEach(function (it) {
        h += '<div class="rt" style="border-color:' + (t.name === 'pacing' ? ({warm: '#f0b35a', rev: '#8fb7ff', gag: '#f58a7a', foc: '#c9c9c9'})[cls] : '#555') + '"><b class="tn">' + esc(t.name) + '</b> <span class="lbl">' + esc(it.label) + '</span> <small style="color:#777">' + it.start + '–' + it.end + '</small>' + fields(it) + '</div>';
      });
    });
    $('readout').innerHTML = h;
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
  var cards = track('proposals').items.map(function (it) {
    var d = it.data, kc = KIND_COLOUR[d.kind] || '#f0b35a';
    var refs = d.references.length ? '<ul class="refs">' + d.references.map(function (r) { return '<li><b>' + esc(r.title || r.id) + '</b> <small>' + esc(r.id) + ' · ' + esc(r.kind) + (r.section ? ' · ' + esc(r.section) : '') + '</small>' + (r.borrow ? '<br><small>borrow: ' + plain(r.borrow) + '</small>' : '') + '</li>'; }).join('') + '</ul>' : '';
    return '<div class="card" id="card-' + esc(d.id) + '" style="--c:' + kc + '"><h3>' + esc(d.id) + ' · ' + esc(d.title) + '</h3>' +
      '<div class="meta">from <b>' + esc(d.from) + '</b> · kind <b>' + esc(d.kind) + '</b> · anchor <b>' + esc(anchorText(d.anchor)) + '</b> (frames ' + it.start + '–' + it.end + ') · status <b>' + esc(d.status) + '</b>' + (d.ruling ? ' · ruling <b>' + esc(d.ruling) + '</b>' : ' · no ruling yet') + (d.date ? ' · ' + esc(d.date) : '') + '</div>' +
      '<p class="text">' + esc(d.text) + '</p>' + '<div class="ba"><section><h4>Before</h4>' + side(d.before) + '</section><section><h4>After</h4>' + side(d.after) + '</section></div>' + refs + '</div>';
  });
  $('cards').innerHTML = cards.length ? cards.join('') : '<div style="color:#999">no proposals</div>';


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
