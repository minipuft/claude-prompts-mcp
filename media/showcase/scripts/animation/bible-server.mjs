#!/usr/bin/env node
// The bible's editing server (D95, row 7.6): serves out/ (the page at /out/bible.html and at /) and v3/ read-only, and accepts the page's edits as
// JSON POSTs. Every edit validates, patches ONE file (a rule also writes its proposal), runs `npm run bible` so the probe sees it, and answers
// {ok, hash, inputsHash, output} or {ok:false, refusal, output}; a refusal restores the pre-edit bytes, so a bad edit never persists.
// Binds 127.0.0.1 only. No dependencies: node:http, node:fs, node:child_process.
//   GET  /state                                                  -> {ok, hash, inputsHash, today}
//   POST /edit       {file:'beats-v2', beat, field, value}       field: seconds | register | light_pushes | camera | actions | asks
//   POST /edit       {file:'materials', material, field, value}  field: any non-null property of v3/materials.json; the value is patched as a number or a word and the probe judges the range
//   POST /boundary   {beat, newEndSeconds}
//   POST /proposal   {kind, title, text, anchor:{beat, frame?}, references:[], before?, after?, from}
//   POST /inspiration  the same plus url?: a proposal of kind inspiration, then an Eagle inbox entry through the inspiration skill's `add`
//   POST /rule       {proposal:'pNNN', text, who:'owner'}
// usage: node scripts/animation/bible-server.mjs [--port 8765]
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {loadMaterials, loadSchema, propertyShape, writeMaterials} from './materials-io.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(here, '..', '..');
const argv = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const port = Number(argv('port', 8765));
const HOST = '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error(`bible-server: --port ${argv('port')} is not a port`);
  process.exit(1);
}
const P = {
  ledger: path.join(root, 'v3/beats-v2.json'),
  timeline: path.join(root, 'v3/timeline.json'),
  bible: path.join(root, 'v3/bible.json'),
  materials: path.join(root, 'v3/materials.json'),
  spec: path.join(root, 'v3/creative-spec.md'),
  proposals: path.join(root, 'v3/proposals'),
  ownerRefs: path.join(root, 'v3/references/owner'),
};
const EAGLE = process.env.BIBLE_EAGLE_CMD
  ? process.env.BIBLE_EAGLE_CMD.split(' ')
  : ['python3', path.join(os.homedir(), '.claude/skills/inspiration/scripts/eagle_board.py')];
const KINDS = ['change', 'inspiration', 'eureka', 'owner-ask', 'finding'];
const FIELDS = ['seconds', 'register', 'light_pushes', 'camera', 'actions', 'asks'];

class Refusal extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const bad = (m) => new Refusal(m);

// ---------- small pure helpers ----------
const today = () => new Date().toLocaleDateString('sv');
const isText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
const clean = (v) => String(v).replace(/\s+/g, ' ').trim();
const slug = (s) => clean(s).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40).replace(/-$/, '') || 'proposal';
const rel = (p) => path.relative(root, p).split(path.sep).join('/');
const readText = (p) => fs.readFileSync(p, 'utf8');

/** The ledger is rewritten from its parsed form; refuse to touch a file whose bytes that form does not reproduce. */
const loadLedger = () => {
  const text = readText(P.ledger);
  const data = JSON.parse(text);
  if (JSON.stringify(data, null, 1) + '\n' !== text) throw new Refusal(`${rel(P.ledger)} is not in the canonical one-space JSON layout, so rewriting it would reformat the whole file; edit it by hand`, 500);
  return data;
};
const writeLedger = (data) => fs.writeFileSync(P.ledger, JSON.stringify(data, null, 1) + '\n');

/** Cumulative seconds -> frames, with the compiler's own rounding (timeline.ts: Math.round of the running second count). */
const reframe = (ledger) => {
  let seconds = 0;
  for (const b of ledger.beats) {
    const start = Math.round(seconds * ledger.fps);
    seconds += b.seconds;
    b.frames = [start, Math.round(seconds * ledger.fps)];
  }
  ledger.durationInFrames = Math.round(seconds * ledger.fps);
};

const findBeat = (ledger, id) => {
  const beat = typeof id === 'string' ? ledger.beats.find((b) => b.id === id) : null;
  if (!beat) throw bad(`there is no beat called ${JSON.stringify(id)}; the beats are ${ledger.beats.map((b) => b.id).join(', ')}`);
  return beat;
};

const setSeconds = (ledger, beat, seconds) => {
  if (!Number.isInteger(seconds) || seconds < 1) throw bad(`seconds must be a whole number of at least 1, not ${JSON.stringify(seconds)}`);
  if (seconds > 600) throw bad('seconds above 600 is not a beat length');
  beat.seconds = seconds;
  reframe(ledger);
};

const line = (name, max) => (v) => {
  if (!isText(v, max)) throw bad(`${name} must be a non-empty line of at most ${max} characters`);
  return clean(v);
};
const validators = {
  register: line('register', 200),
  light_pushes: line('light_pushes', 600),
  camera: line('camera', 600),
  actions: (v) => {
    if (!Array.isArray(v) || v.length > 30) throw bad('actions must be a list of at most 30 {actor, does}');
    return v.map((a, i) => {
      if (!a || typeof a !== 'object' || Array.isArray(a) || Object.keys(a).sort().join() !== 'actor,does' || !isText(a.actor, 60) || !isText(a.does, 400)) {
        throw bad(`action ${i + 1} must be exactly {actor, does}, both non-empty lines`);
      }
      return {actor: clean(a.actor), does: clean(a.does)};
    });
  },
  asks: (v) => {
    if (!Array.isArray(v) || v.length > 30 || !v.every((x) => isText(x, 600))) throw bad('asks must be a list of at most 30 non-empty lines');
    return v.map(clean);
  },
};

// ---------- the edits: each returns {files:[abs paths it may write], apply():void, after?(): Promise} ----------
/** A material's property value, patched in place; the file is rewritten in its canonical layout and the probe (probe-materials.py, through `npm run bible`) refuses a value outside the schema's range. */
const planMaterialEdit = (body) => {
  let materials;
  try {
    materials = loadMaterials();
  } catch (e) {
    throw new Refusal(e instanceof Error ? e.message : String(e), 500);
  }
  const schema = loadSchema();
  const material = typeof body.material === 'string' && Object.hasOwn(materials, body.material) ? materials[body.material] : null;
  if (!material) throw bad(`there is no material called ${JSON.stringify(body.material)}; the materials are ${Object.keys(materials).join(', ')}`);
  const fields = Object.keys(schema.$defs.material.properties);
  if (!fields.includes(body.field)) throw bad(`field must be one of ${fields.join(', ')}, not ${JSON.stringify(body.field)}`);
  const rated = material[body.field];
  if (rated === null) throw bad(`${body.material} declares no ${body.field} (it is null), so there is no value to change; add one by hand in v3/materials.json`);
  const {value: rule} = propertyShape(schema, body.field);
  const wantsWord = Array.isArray(rule.enum);
  if (wantsWord ? typeof body.value !== 'string' : typeof body.value !== 'number' || !Number.isFinite(body.value)) throw bad(`${body.field} takes ${wantsWord ? `one of ${rule.enum.join(', ')}` : 'a number'}, not ${JSON.stringify(body.value)}`);
  rated.value = body.value;
  return {files: [P.materials], apply: () => writeMaterials(materials), what: `${body.material}.${body.field}`};
};

const planEdit = (body) => {
  if (body.file === 'materials') return planMaterialEdit(body);
  if (body.file !== 'beats-v2') throw bad(`/edit patches the beat ledger (file "beats-v2") or the materials (file "materials"), not ${JSON.stringify(body.file)}`);
  if (!FIELDS.includes(body.field)) throw bad(`field must be one of ${FIELDS.join(', ')}, not ${JSON.stringify(body.field)}`);
  const ledger = loadLedger();
  const beat = findBeat(ledger, body.beat);
  if (body.field === 'seconds') setSeconds(ledger, beat, body.value);
  else beat[body.field] = validators[body.field](body.value);
  return {files: [P.ledger], apply: () => writeLedger(ledger), what: `${body.beat}.${body.field}`};
};

const planBoundary = (body) => {
  const ledger = loadLedger();
  const beat = findBeat(ledger, body.beat);
  if (!Number.isInteger(body.newEndSeconds)) throw bad(`newEndSeconds must be a whole number of seconds, not ${JSON.stringify(body.newEndSeconds)}`);
  let start = 0;
  for (const b of ledger.beats) {
    if (b === beat) break;
    start += b.seconds;
  }
  setSeconds(ledger, beat, body.newEndSeconds - start);
  return {files: [P.ledger], apply: () => writeLedger(ledger), what: `${body.beat} ends at ${body.newEndSeconds} s`};
};

const nextProposalId = () => {
  const nums = fs.existsSync(P.proposals) ? fs.readdirSync(P.proposals).map((f) => /^p(\d+)-/.exec(f)).filter(Boolean).map((m) => Number(m[1])) : [];
  return `p${String(Math.max(0, ...nums) + 1).padStart(3, '0')}`;
};

const planProposal = (body, forceKind) => {
  const kind = forceKind ?? body.kind;
  if (!KINDS.includes(kind)) throw bad(`kind must be one of ${KINDS.join(', ')}, not ${JSON.stringify(kind)}`);
  if (!isText(body.title, 120)) throw bad('title must be a non-empty line of at most 120 characters');
  if (!isText(body.text, 6000)) throw bad('text must be non-empty and at most 6000 characters');
  if (body.from !== 'owner' && body.from !== 'director') throw bad(`from must be "owner" or "director", not ${JSON.stringify(body.from)}`);
  const a = body.anchor;
  if (!a || typeof a !== 'object' || Array.isArray(a) || Object.keys(a).some((k) => k !== 'beat' && k !== 'frame')) throw bad('anchor must be {beat} or {beat, frame}');
  const ledger = loadLedger();
  findBeat(ledger, a.beat);
  if (a.frame !== undefined && !Number.isInteger(a.frame)) throw bad(`anchor.frame must be a whole frame number, not ${JSON.stringify(a.frame)}`);
  const refs = body.references ?? [];
  if (!Array.isArray(refs) || !refs.every((r) => typeof r === 'string' && /^[\w.:\-§ ]{1,120}$/.test(r))) throw bad('references must be a list of board card ids');
  const id = nextProposalId();
  const file = path.join(P.proposals, `${id}-${slug(body.title)}.json`);
  const record = {id, kind, from: body.from, date: today(), anchor: a.frame === undefined ? {beat: a.beat} : {beat: a.beat, frame: a.frame}, title: clean(body.title), text: body.text.trim(), references: refs};
  for (const k of ['before', 'after']) if (body[k] !== undefined && body[k] !== null && body[k] !== '') record[k] = body[k];
  // The vocabulary gate (D96) requires an owner-ask to carry an intent word, at least two options and a default that is one of them; carry them through.
  for (const k of ['intent', 'default']) if (isText(body[k], 60)) record[k] = clean(body[k]);
  if (Array.isArray(body.options) && body.options.every((o) => isText(o, 60))) record.options = body.options.map(clean);
  if (kind === 'owner-ask') {
    const missing = ['intent', 'options', 'default'].filter((k) => !record[k]);
    if (missing.length) throw bad(`an owner-ask carries intent, options (two or more) and default (the vocabulary gate refuses it otherwise): missing ${missing.join(', ')}`);
    if (record.options.length < 2) throw bad('an owner-ask offers at least two options');
    if (!record.options.includes(record.default)) throw bad('an owner-ask default must be one of its options');
  }
  record.status = 'open';
  record.ruling = null;
  return {files: [file], apply: () => { fs.mkdirSync(P.proposals, {recursive: true}); fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n'); }, what: `proposal ${id}`, id, record, file};
};

const specRulingNumbers = (text) => text.split('\n').filter((l) => /^- D\d+/.test(l)).flatMap((l) => (/^- (D\d+(?:\/D\d+)*)/.exec(l)[1].split('/')).map((d) => Number(d.slice(1))));

const planRule = (body) => {
  if (typeof body.proposal !== 'string' || !/^p\d{3,}$/.test(body.proposal)) throw bad(`proposal must be an id like p002, not ${JSON.stringify(body.proposal)}`);
  if (body.who !== 'owner') throw bad('only the owner rules: who must be "owner"');
  if (!isText(body.text, 6000)) throw bad('text must be non-empty and at most 6000 characters');
  const name = fs.existsSync(P.proposals) ? fs.readdirSync(P.proposals).find((f) => f.startsWith(`${body.proposal}-`) && f.endsWith('.json')) : null;
  if (!name) throw bad(`there is no proposal ${body.proposal} in v3/proposals`);
  const file = path.join(P.proposals, name);
  const raw = readText(file);
  const record = JSON.parse(raw);
  if (record.status !== 'open') throw bad(`${body.proposal} is ${record.status}, only an open proposal can be ruled`);
  const spec = readText(P.spec);
  const lines = spec.split('\n');
  const last = lines.map((l, i) => (/^- D\d+/.test(l) ? i : -1)).filter((i) => i > -1).pop();
  if (last === undefined) throw bad('the spec has no ruling bullet to append after', 500);
  const number = Math.max(...specRulingNumbers(spec)) + 1;
  const d = `D${number}`;
  lines.splice(last + 1, 0, `- ${d}, owner, ${today()}: ${clean(body.text)} (closes ${body.proposal})`);
  record.status = 'ruled';
  record.ruling = d;
  const tail = raw.endsWith('\n') ? '\n' : '';
  return {files: [P.spec, file], apply: () => { fs.writeFileSync(P.spec, lines.join('\n')); fs.writeFileSync(file, JSON.stringify(record, null, 2) + tail); }, what: `${d} closes ${body.proposal}`, ruling: d};
};

// ---------- running a plan: snapshot, apply, rebuild, restore on refusal ----------
const run = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, {cwd: root, env: {...process.env, ...opts.env}, stdio: ['ignore', 'pipe', 'pipe']});
    let output = '';
    child.stdout.on('data', (d) => { output += d; });
    child.stderr.on('data', (d) => { output += d; });
    child.on('error', (e) => resolve({code: 127, output: output + String(e.message)}));
    child.on('close', (code) => resolve({code, output}));
  });

/** The probe's refused line when there is one, else the compiler's error, else the tail of the output. */
const refusalOf = (output) => {
  const lines = output.split('\n').map((l) => l.trimEnd()).filter(Boolean);
  const refused = lines.filter((l) => /^refused:/.test(l)).pop();
  if (refused) return refused;
  const errors = lines.filter((l) => /^(timeline|compile-bible|bible-page|light|xsheet)[\w-]*:/.test(l) || /^Error:/.test(l));
  if (errors.length) return errors.join('\n');
  return lines.filter((l) => !/^npm /.test(l)).slice(-4).join('\n') || 'the rebuild failed without saying why';
};

const readHash = () => {
  const b = JSON.parse(readText(P.bible));
  return {hash: b.inputsHash.slice(0, 12), inputsHash: b.inputsHash};
};

let queue = Promise.resolve();
const serial = (fn) => {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
};

const execute = (plan) =>
  serial(async () => {
    const before = new Map(plan.files.map((f) => [f, fs.existsSync(f) ? fs.readFileSync(f) : null]));
    const restore = () => {
      for (const [f, bytes] of before) {
        if (bytes === null) fs.rmSync(f, {force: true});
        else fs.writeFileSync(f, bytes);
      }
    };
    try {
      plan.apply();
    } catch (e) {
      restore();
      throw e;
    }
    const build = await run('npm', ['run', 'bible']);
    if (build.code !== 0) {
      restore();
      const resync = await run('npm', ['run', 'bible']); // derived outputs (timeline, light, xsheet, bible, page) follow the restored bytes
      return {status: 422, body: {ok: false, refusal: refusalOf(build.output), restored: plan.files.map(rel), resynced: resync.code === 0, output: build.output}};
    }
    return {status: 200, body: {ok: true, ...readHash(), changed: plan.files.map(rel), what: plan.what, output: build.output}, build};
  });

const fileEagle = async (plan, body) => {
  const folder = `Movies › Timing and acting › ${clean(body.title)}`;
  const args = [...EAGLE.slice(1), 'add', body.url, '--folder', folder, '--why', clean(body.text), '--source', `bible ${plan.id}`];
  const r = await run(EAGLE[0], args, {env: {INSPIRATION_OUT: P.ownerRefs}});
  return {ok: r.code === 0, command: [EAGLE[0], ...args].join(' '), output: r.output.trim()};
};

// ---------- http ----------
const TYPES = {'.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8'};
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, {'cache-control': 'no-store', ...headers});
  res.end(body);
};
const sendJson = (res, status, obj) => send(res, status, JSON.stringify(obj), {'content-type': 'application/json; charset=utf-8'});

const serveStatic = (req, res, urlPath) => {
  if (urlPath === '/' || urlPath === '/index.html') {
    const file = path.join(root, 'out/bible.html');
    if (!fs.existsSync(file)) return sendJson(res, 404, {ok: false, refusal: 'out/bible.html does not exist; run npm run bible'});
    return send(res, 200, readText(file), {'content-type': TYPES['.html']});
  }
  // the page names its files relative to out/ (animatic-seq/..., ../v3/...): at /out/bible.html those resolve under /out/ and /v3/, at / they resolve to /animatic-seq/... and /v3/...,
  // so a path outside /out/ and /v3/ is read from out/ as well (a <base> tag would instead turn the page's own #frame updates into /out/#frame)
  const under = (dir) => urlPath.startsWith(`/${dir}/`);
  const base = under('v3') ? path.join(root, 'v3') : path.join(root, 'out');
  const file = path.resolve(root, under('out') || under('v3') ? '.' + urlPath : path.join('out', '.' + urlPath));
  if (file !== base && !file.startsWith(base + path.sep)) return sendJson(res, 403, {ok: false, refusal: 'that path leaves the served folders'});
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return sendJson(res, 404, {ok: false, refusal: `${urlPath} does not exist; the page is at / and /out/bible.html, files under /out/ and /v3/`});
  }
  if (!stat.isFile()) return sendJson(res, 404, {ok: false, refusal: `${urlPath} is not a file`});
  res.writeHead(200, {'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-length': stat.size, 'cache-control': 'no-store'});
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) {
        reject(bad('the request body is over 1 MB'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
        resolve(v);
      } catch {
        reject(bad('the body must be one JSON object'));
      }
    });
    req.on('error', reject);
  });

const hostOk = (req) => [`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host ?? '');
const originOk = (req) => !req.headers.origin || [`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin);

const ROUTES = {
  '/edit': (b) => execute(planEdit(b)),
  '/boundary': (b) => execute(planBoundary(b)),
  '/proposal': (b) => execute(planProposal(b)),
  '/inspiration': async (b) => {
    if (b.url !== undefined && b.url !== '' && !(typeof b.url === 'string' && /^https?:\/\/\S+$/.test(b.url))) throw bad('url must be an http(s) address');
    const plan = planProposal(b, 'inspiration');
    const r = await execute(plan);
    if (r.body.ok && b.url) r.body.eagle = await fileEagle(plan, b);
    if (r.body.ok) r.body.id = plan.id;
    return r;
  },
  '/rule': (b) => execute(planRule(b)),
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${HOST}:${port}`);
    if (!hostOk(req)) return sendJson(res, 403, {ok: false, refusal: 'this server answers only on 127.0.0.1 or localhost under its own port'});
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (url.pathname === '/state') return sendJson(res, 200, {ok: true, ...readHash(), today: today()});
      return serveStatic(req, res, decodeURIComponent(url.pathname));
    }
    if (req.method !== 'POST') return sendJson(res, 405, {ok: false, refusal: `${req.method} is not accepted; pages are read with GET, edits are POSTs`});
    const route = ROUTES[url.pathname];
    if (!route) return sendJson(res, 400, {ok: false, refusal: `nothing here takes a POST at ${url.pathname}; the endpoints are ${Object.keys(ROUTES).join(', ')}`});
    if (!originOk(req)) return sendJson(res, 403, {ok: false, refusal: 'a page from another origin cannot edit the bible'});
    if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return sendJson(res, 400, {ok: false, refusal: 'send the edit as application/json'});
    const result = await route(await readBody(req));
    return sendJson(res, result.status, result.body);
  } catch (e) {
    if (e instanceof Refusal) return sendJson(res, e.status, {ok: false, refusal: e.message});
    console.error('bible-server:', e);
    return sendJson(res, 500, {ok: false, refusal: `the server failed on this request: ${e instanceof Error ? e.message : String(e)}`});
  }
});
server.on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `bible-server: ${HOST}:${port} is already in use; stop the process holding it or pass --port` : `bible-server: ${e.message}`);
  process.exit(1);
});
server.listen(port, HOST, () => console.log(`bible-server: http://${HOST}:${port}/ serving out/ and v3/ (read-only), edits at /edit /boundary /proposal /inspiration /rule`));
