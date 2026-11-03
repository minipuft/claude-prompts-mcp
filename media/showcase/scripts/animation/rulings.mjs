#!/usr/bin/env node
// The ruling form (D96): one parser for the spec's ruling bullets, shared by the bible compiler and the vocabulary probe.
//
//   D<N>, <who>, <date>: <verb> <object> <value> because <intent word> (ref <card id>) (closes p<NNN>)
//
// parseRuling(raw) takes one bullet (with or without its leading "- ") and returns
//   {id, ids, who, date, closes, text, raw, form, verb, object, value, intent, reason, ref, refs}
// A bullet is in the form when its text starts with a ruling verb, has a `because` clause and a `(ref ...)` group. Anything else
// is free prose (D35-D95 and later prose): only the header facts and `text` are filled, form is false and the rest are null.
// `intent` is the because clause when it is an intent word list (at most three words); a longer clause is a sentence of reasons and goes to `reason`,
// so a prose reason is never checked against the vocabulary as if it were one word.
//
// usage: node scripts/animation/rulings.mjs --test                  parse D96-D99 from the spec and print the fields (self-test)
//        node scripts/animation/rulings.mjs --parse <rulings.json|->   print the parse of every entry's `raw` (or of the bullets on stdin) as JSON
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const RULING_VERBS = ['adopt', 'set', 'move', 'change', 'make', 'add', 'remove', 'drop', 'keep', 'replace', 'use', 'cut', 'extend', 'shorten', 'lengthen', 'hold', 'raise', 'lower', 'reject', 'defer', 'rename', 'split', 'merge', 'ban', 'pick', 'swap'];
// Where the object ends and the value begins: the earliest of these in the text after the verb.
const VALUE_MARKERS = [' to ', ' as ', ' with ', ' at ', ' from ', ' = '];
const MAX_INTENT_WORDS = 3;

// The header ends at the first colon outside parentheses ("D38 (carried): ..." keeps its parenthetical in the header).
const headerColon = (line) => {
  let depth = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ':' && depth === 0 && line[i + 1] === ' ') return i;
  }
  return -1;
};

const trim = (x) => x.replace(/^[\s,]+|[\s,]+$/g, '');

const splitObjectValue = (rest) => {
  let at = -1;
  let marker = '';
  for (const m of VALUE_MARKERS) {
    const i = rest.indexOf(m);
    if (i > 0 && (at === -1 || i < at)) { at = i; marker = m; }
  }
  if (at === -1) return {object: trim(rest), value: ''};
  return {object: trim(rest.slice(0, at)), value: trim(rest.slice(at + marker.length))};
};

const isIntentList = (clause) => clause.split(/\s+/).filter(Boolean).length <= MAX_INTENT_WORDS;

export function parseRuling(raw) {
  const line = raw.replace(/^- /, '');
  const colon = headerColon(line);
  const header = colon > -1 ? line.slice(0, colon) : line;
  const text = colon > -1 ? line.slice(colon + 2).trim() : '';
  const idMatch = header.match(/^D\d+(?:\/D\d+)*/);
  const ids = idMatch ? [...new Set(idMatch[0].split('/'))] : [];
  const bare = header.replace(/\([^)]*\)/g, '').replace(/^D\d+(?:\/D\d+)*/, '');
  const date = (bare.match(/\d{4}-\d{2}-\d{2}/) || [null])[0];
  const who = bare.split(',').map((x) => x.trim()).filter((x) => x && !/^\d{4}-\d{2}-\d{2}$/.test(x) && !/^corrected\b/.test(x))[0] ?? null;
  const closes = [...new Set([...text.matchAll(/\(closes ((?:p\d+[,\s]*)+)\)/g)].flatMap((m) => m[1].match(/p\d+/g)))];
  const out = {id: ids[0] ?? null, ids, who, date, closes, text, raw: line, form: false, verb: null, object: null, value: null, intent: null, reason: null, ref: null, refs: []};

  const refGroup = text.match(/\(ref ([^)]+)\)/);
  const body = text.replace(/\((?:ref|closes) [^)]*\)/g, '').replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();
  const because = body.indexOf(' because ');
  const verb = body.split(' ')[0].toLowerCase();
  if (!refGroup || because < 0 || !RULING_VERBS.includes(verb)) return out;

  const clause = body.slice(because + ' because '.length).trim();
  const {object, value} = splitObjectValue(body.slice(verb.length, because).trim());
  out.form = true;
  out.verb = verb;
  out.object = object;
  out.value = value;
  if (isIntentList(clause)) out.intent = clause;
  else out.reason = clause;
  out.refs = refGroup[1].split(/[,\s]+/).filter(Boolean);
  out.ref = out.refs[0] ?? null;
  return out;
}

// ---------- CLI ----------
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

const showFields = (r) => [
  `${r.id}  who=${r.who}  date=${r.date}  form=${r.form}`,
  `  verb=${JSON.stringify(r.verb)}`,
  `  object=${JSON.stringify(r.object)}`,
  `  value=${JSON.stringify(r.value)}`,
  `  intent=${JSON.stringify(r.intent)}  reason=${JSON.stringify(r.reason)}`,
  `  ref=${JSON.stringify(r.ref)}  closes=${JSON.stringify(r.closes)}`,
].join('\n');

function selfTest() {
  const spec = fs.readFileSync(path.join(root, 'v3', 'creative-spec.md'), 'utf8').split('\n');
  const wanted = ['D96', 'D97', 'D98', 'D99'];
  const lines = wanted.map((id) => spec.find((l) => l.startsWith(`- ${id},`)));
  const problems = [];
  wanted.forEach((id, i) => { if (!lines[i]) problems.push(`${id} is not in the spec`); });
  const parsed = lines.filter(Boolean).map(parseRuling);
  for (const r of parsed) {
    console.log(showFields(r));
    if (!r.form) problems.push(`${r.id} did not parse in the form`);
    if (r.form && (!r.verb || !r.object || !r.ref || r.closes.length !== 1)) problems.push(`${r.id} lost a field: verb=${r.verb} object=${r.object} ref=${r.ref} closes=${r.closes}`);
  }
  // controls: free prose stays prose, and a ruling in the form with a one-word reason keeps that word as its intent.
  const prose = parseRuling('- D41, owner, 2026-10-06: medium is Remotion as the single substrate; the Three.js kit beat mounts inside it.');
  const planted = parseRuling('- D100, owner, 2026-10-18: set the cloak drag to float because vibey (ref samurai-jack-holds) (closes p005)');
  console.log('control (free prose):\n' + showFields(prose));
  console.log('control (planted):\n' + showFields(planted));
  if (prose.form || prose.verb !== null) problems.push('free prose was parsed as the form');
  if (!planted.form || planted.verb !== 'set' || planted.object !== 'the cloak drag' || planted.value !== 'float' || planted.intent !== 'vibey' || planted.ref !== 'samurai-jack-holds' || planted.closes[0] !== 'p005') problems.push(`the planted ruling parsed as ${JSON.stringify(planted)}`);
  if (problems.length) { console.log('FAIL: ' + problems.join('; ')); process.exit(1); }
  console.log(`pass: ${parsed.length} rulings parsed in the form, free prose stays prose, the planted ruling's intent word is kept`);
}

function parseFile(source) {
  const input = source === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.resolve(source), 'utf8');
  let raws;
  try {
    const data = JSON.parse(input);
    raws = data.map((e) => (typeof e === 'string' ? e : e.raw));
  } catch {
    raws = input.split('\n').filter((l) => /^- D\d+/.test(l));
  }
  process.stdout.write(JSON.stringify(raws.map(parseRuling)) + '\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [flag, arg] = process.argv.slice(2);
  if (flag === '--test') selfTest();
  else if (flag === '--parse' && arg) parseFile(arg);
  else { console.error('usage: rulings.mjs --test | --parse <rulings.json|->'); process.exit(2); }
}
