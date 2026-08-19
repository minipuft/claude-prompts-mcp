#!/usr/bin/env node
/**
 * A hand-written copy of a phase-guard `section_header` must name a header some `phases.yaml`
 * actually declares.
 *
 * WHY THIS EXISTS. `section-splitter.ts` and `phase-guard-evaluator.ts` grade model output
 * against `section_header` strings declared in each framework's `phases.yaml` under
 * `resources/frameworks/`. Five prompt
 * files hand-restate that vocabulary so the model knows what to emit — `resource_manager` edits
 * are the only sanctioned way to change them, and nothing checked that the restated copy still
 * named a header the framework actually declares. `verification/user-message.md` drifted on a
 * *value* (min_length 80 vs the framework's 100) without the header STRINGS ever disagreeing —
 * plan `phase-guard-declaration-contract-2026-08-15.md` (OQ-3) resolved that by deleting the
 * value columns outright (task 4.0) rather than tracking them here. What is left to drift, and
 * what this checks, is the header string itself: rename `## Context` to `## Setup` in a
 * `phases.yaml` and the five hand-written copies still say `## Context` — the model would then be
 * told to emit a header the guard no longer looks for.
 *
 * THE DISCRIMINATOR, STATED ONCE. `## Context` is a plain ASCII heading — the token by itself
 * cannot tell a phase-guard DECLARATION (naming a header as part of the contract) from an
 * ORDINARY HEADING (a prompt using `## Context` to title its own section, same as any markdown
 * document does), and it ALSO cannot tell a phase-guard fenced example (verification's RESULT
 * block) from an unrelated prompt's own fenced example output format (measured 2026-08-17: dozens
 * of prompts fence a bare `## Executive Summary` / `## Quick Start` with no framework behind it
 * at all). Two rules, applied in order:
 *
 *   1. UNAMBIGUOUS mentions are never confusable with an ordinary heading, because nothing else
 *      in a prompt writes these shapes: backtick-quoted inline, in prose or a table cell
 *      (`` `## Context` ``), or a `marker:`/`section_header:` YAML value (`marker: '## Context'`).
 *      Both are declarations, full stop.
 *   2. A bare `## Context`-shaped line OUTSIDE any fence IS the document's own heading — never a
 *      declaration, regardless of its text. A bare `## Context`-shaped line INSIDE a fence is
 *      ambiguous on fence-position alone, so it counts as a declaration only when rule 1 already
 *      found that SAME header elsewhere in the SAME file (corroboration) — otherwise it is some
 *      other prompt's own illustrative output format and is left alone.
 *
 * An ordinary heading is never added to the checked set, regardless of its text, and an
 * uncorroborated fenced heading is never promoted into one — so neither can produce a finding by
 * coincidentally matching, only by actually restating a declared header. That structural
 * guarantee, not today's absence of findings, is what `--self-test` proves.
 *
 * WHAT COUNTS AS THE SSOT. Every `section_header` (current field) and `marker` (the field name
 * `examples/create_framework/user-message.md`'s own reference material still teaches, and
 * `resources/frameworks/verify/phases.yaml` still uses) across every framework's `phases.yaml`
 * under `resources/frameworks/`.
 * Both names the same concept — the literal heading the splitter/marker matcher looks for — so
 * both feed one set. This check is header-string-only, per the OQ-3 ruling: it does not compare
 * `min_length` or any other guard value, because task 4.0 deleted that class of restatement
 * rather than asking a gate to track it.
 *
 * `--self-test` proves: a clean tree reports nothing, the four ordinary-heading prompts extract
 * zero declarations (not just zero findings), a seeded backtick declaration is caught, a seeded
 * fenced-example declaration is caught, and mutating an ordinary heading's text never fires.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SERVER = path.resolve(path.dirname(SCRIPT_PATH), '..');
const FRAMEWORKS_DIR = path.join(SERVER, 'resources/frameworks');
const PROMPTS_DIR = path.join(SERVER, 'resources/prompts');

const FENCE_LINE = /^\s*```/;
const HEADER_LINE = /^##\s+(.+?)\s*$/;
const BACKTICK_HEADER = /`(##\s+[^`]+?)`/g;
const YAML_QUOTED_HEADER = /(?:marker|section_header)\s*:\s*['"](##\s+[^'"]+?)['"]/g;

function normalizeHeader(raw) {
  return raw.trim().replace(/\s+/g, ' ');
}

/** Recursively collect files under `dir` matching `test(entry.name)`. */
function walk(dir, test) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, test);
    return test(entry.name) ? [full] : [];
  });
}

/**
 * Every `section_header` / `marker` value declared across all `phases.yaml` files, with
 * provenance for error messages. One header may be declared by more than one framework
 * (`## Context` is legitimately CAGEERF's alone today, but the set does not assume that).
 */
function loadDeclaredHeaders() {
  const declared = new Map(); // header -> [{ framework, phaseId }]
  for (const file of walk(FRAMEWORKS_DIR, (name) => name === 'phases.yaml')) {
    const framework = path.basename(path.dirname(file));
    let doc;
    try {
      doc = yaml.load(readFileSync(file, 'utf8'));
    } catch (error) {
      throw new Error(`${path.relative(SERVER, file)}: not parseable as YAML — ${error.message}`, {
        cause: error,
      });
    }
    for (const step of doc?.processingSteps ?? []) {
      const header = step.section_header ?? step.marker;
      if (!header) continue;
      const key = normalizeHeader(header);
      if (!declared.has(key)) declared.set(key, []);
      declared.get(key).push({ framework, phaseId: step.id ?? '(no id)' });
    }
  }
  return declared;
}

/**
 * Every phase-guard-shaped header DECLARATION in `text` — never an ordinary heading. Pure: takes
 * file text, returns data. `--self-test` calls this directly on mutated in-memory strings so the
 * discriminator itself is provable without touching disk.
 *
 * TWO PASSES, because a bare `## Header` line inside a fence is structurally ambiguous on its
 * own. `verification/user-message.md`'s RESULT block fences a worked example of the CAGEERF
 * response it wants — bare `## Context` inside a fence there. But measured 2026-08-17: dozens of
 * OTHER prompts fence a bare `## Executive Summary` / `## Quick Start` / `## Blocking Issues` —
 * their OWN example output format, with no relationship to any framework's phase guard. Fence
 * position alone cannot tell these apart; both are "a heading-shaped line inside a code fence."
 *
 * The resolving signal is CORROBORATION: a fenced bare heading counts as a declaration only when
 * the SAME file also names that exact header via an unambiguous mechanism elsewhere — backtick-
 * quoted prose/table cell, or a `marker:`/`section_header:` YAML value. Those two shapes are
 * unambiguous by construction (nothing else in a prompt writes `` `## X` `` or `marker: '## X'`
 * except naming a phase-guard header) REGARDLESS of fence state — `create_framework`'s own
 * `marker: '## Context'` reference example sits inside a ```yaml fence and is still a direct,
 * unambiguous declaration, not something needing corroboration. Pass 1 collects both shapes on
 * every line; pass 2 admits a bare fenced heading only if pass 1 already established that exact
 * header for this file. A prompt whose only mention of `## Executive Summary` is the fence itself
 * has nothing to corroborate it, so it is never treated as a declaration — which is the correct
 * outcome: there is no other place in that file claiming that heading is a phase-guard contract.
 */
function extractDeclarations(text) {
  const lines = text.split('\n');

  // Pass 1 — unambiguous declarations: backtick-inline and YAML-quoted, on every line regardless
  // of fence state (both shapes are unambiguous wherever they appear). A bare heading-shaped line
  // is skipped here either way — unfenced it is the document's own heading (never a mention),
  // fenced it is pass 2's concern (a declaration only when corroborated).
  const unambiguous = [];
  const corroborated = new Set();
  let inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNumber = i + 1;
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (HEADER_LINE.test(line.trim())) continue; // a heading line, fenced or not — not a mention

    for (const match of line.matchAll(BACKTICK_HEADER)) {
      const header = normalizeHeader(match[1]);
      unambiguous.push({ header, lineNumber, kind: 'inline-backtick' });
      corroborated.add(header);
    }
    for (const match of line.matchAll(YAML_QUOTED_HEADER)) {
      const header = normalizeHeader(match[1]);
      unambiguous.push({ header, lineNumber, kind: 'yaml-quoted' });
      corroborated.add(header);
    }
  }

  // Pass 2 — fenced bare headers, admitted only when pass 1 corroborated the same header
  // elsewhere in this file.
  const fenced = [];
  inFence = false;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineNumber = i + 1;
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence) continue;
    const trimmed = line.trim();
    if (!HEADER_LINE.test(trimmed)) continue;
    // The header is the whole line ("## Setup"), not the capture group (which holds only the
    // text after "## ") — a fenced bare heading and an SSOT `section_header` must compare like
    // for like against `declaredHeaders`, which stores the full "## X" string.
    const header = normalizeHeader(trimmed);
    if (corroborated.has(header)) {
      fenced.push({ header, lineNumber, kind: 'fenced-example' });
    }
  }

  return [...unambiguous, ...fenced];
}

/** Check one file's declarations against the SSOT. Returns problem strings, empty if clean. */
function checkFile(relativePath, text, declaredHeaders) {
  const problems = [];
  for (const { header, lineNumber, kind } of extractDeclarations(text)) {
    if (declaredHeaders.has(header)) continue;
    problems.push(
      `${relativePath}:${lineNumber} (${kind}): declares '${header}', which no phases.yaml ` +
        `section_header/marker names. Either the header renamed upstream, or this copy is stale.`
    );
  }
  return problems;
}

function checkTree(promptSources, declaredHeaders) {
  const problems = [];
  for (const [relativePath, text] of promptSources) {
    problems.push(...checkFile(relativePath, text, declaredHeaders));
  }
  return problems;
}

function loadPromptSources() {
  const files = walk(PROMPTS_DIR, (name) => name.endsWith('.md'));
  return new Map(files.map((file) => [path.relative(SERVER, file), readFileSync(file, 'utf8')]));
}

/**
 * Ordinary-heading fixture, inline rather than read off disk.
 *
 * This started as four real files under `resources/prompts/development/`. They are gitignored
 * (`resources/prompts/.gitignore`: `development/*`), so the self-test passed on a machine that
 * happened to have them and failed in any fresh clone — a green local run predicting nothing
 * about CI. An inline fixture is also the stronger test: it pins the exact shapes the
 * discriminator must ignore, instead of whatever those prompts happen to contain today.
 *
 * Every heading here is a plain document heading. None is backtick-inline or YAML-quoted, and
 * the fenced block is uncorroborated, so a correct extractor returns zero declarations.
 */
const ORDINARY_HEADING_FIXTURE = [
  '# Technical Recommendation',
  '',
  '## Context',
  '',
  'Describe the situation that prompted this evaluation.',
  '',
  '## Evaluation Summary',
  '',
  'Summarize the options considered.',
  '',
  '```markdown',
  '## Decision',
  '',
  'A fenced example heading with nothing corroborating it elsewhere in the file.',
  '```',
  '',
  '## Rationale',
  '',
  'Explain why. Prose may mention a section by name without quoting it as a header.',
  '',
].join('\n');

const ORDINARY_HEADING_FIXTURE_PATH = '<inline>/ordinary-headings.md';

/**
 * Proves the discriminator, not just today's absence of findings.
 */
function selfTest() {
  const declaredHeaders = loadDeclaredHeaders();
  const clean = loadPromptSources();
  let failures = 0;

  if (declaredHeaders.size === 0) {
    console.error('  ✗ baseline: no phases.yaml declared any section_header/marker at all');
    failures += 1;
  } else {
    console.log(`  ✓ baseline: ${declaredHeaders.size} distinct declared headers loaded`);
  }

  const baselineProblems = checkTree(clean, declaredHeaders);
  if (baselineProblems.length !== 0) {
    console.error('  ✗ baseline: the unmutated tree already reports drift:');
    for (const p of baselineProblems) console.error(`      ${p}`);
    failures += 1;
  } else {
    console.log('  ✓ baseline: clean tree reports no drift');
  }

  // A document of ordinary headings must extract ZERO declarations — proving the discriminator
  // structurally excludes them, not that their (English-word) headers happen to be declared
  // somewhere by coincidence.
  {
    const found = extractDeclarations(ORDINARY_HEADING_FIXTURE);
    if (found.length === 0) {
      console.log('  ✓ ordinary headings extract zero declarations (plain headings only)');
    } else {
      console.error(
        `  ✗ ordinary-heading fixture: expected 0 extracted declarations, got ` +
          `${found.length}: ${found.map((d) => d.header).join(', ')}`
      );
      failures += 1;
    }
  }

  // Mutating an ordinary heading's TEXT must never produce a finding — proves the exclusion is
  // structural (fence/backtick/yaml-quote position), not an accident of current header spelling.
  {
    const relativePath = ORDINARY_HEADING_FIXTURE_PATH;
    const original = ORDINARY_HEADING_FIXTURE;
    const mutated = original.replace(/^## Context$/m, '## NotARealPhaseHeaderAtAll');
    if (mutated === original) {
      console.error(`  ✗ ordinary-heading mutation: no-op — fixture line shape changed?`);
      failures += 1;
    } else {
      const mutatedSources = new Map(clean);
      mutatedSources.set(relativePath, mutated);
      const problems = checkTree(mutatedSources, declaredHeaders);
      if (problems.length !== 0) {
        console.error(
          '  ✗ ordinary-heading mutation: renaming a plain heading tripped the gate — the ' +
            'discriminator is reading heading TEXT instead of heading POSITION'
        );
        failures += 1;
      } else {
        console.log(
          '  ✓ renaming an ordinary heading never fires (position-based, not text-based)'
        );
      }
    }
  }

  // Seed a stale INLINE-BACKTICK declaration (the shape used by system-message.md /
  // plan_table / completion — prose naming the header vocabulary).
  {
    const relativePath = 'resources/prompts/planning/implementation_plan/system-message.md';
    const original = clean.get(relativePath);
    if (original === undefined) {
      console.error(`  ✗ inline-backtick fixture missing: ${relativePath}`);
      failures += 1;
    } else {
      const mutated = original.replace('`## Context`', '`## Kontext`');
      if (mutated === original) {
        console.error('  ✗ inline-backtick mutation: no-op — `## Context` not found to mutate');
        failures += 1;
      } else {
        const mutatedSources = new Map(clean);
        mutatedSources.set(relativePath, mutated);
        const problems = checkTree(mutatedSources, declaredHeaders);
        if (problems.some((p) => p.includes("'## Kontext'"))) {
          console.log('  ✓ a stale inline-backtick declaration is caught');
        } else {
          console.error('  ✗ inline-backtick mutation: stale header did not trip the gate');
          failures += 1;
        }
      }
    }
  }

  // CORROBORATION, both directions — verification/user-message.md's RESULT block fences a bare
  // `## Context` (line 40, inside the ````markdown fence), corroborated by the table's backtick-
  // quoted `` `## Context` `` (line 17) and the closing paragraph's mention (line 118). `## Goals`
  // and `## Execution` in the SAME file are bare headings OUTSIDE any fence (lines 79/112) — a
  // reminder that even within one file the two shapes are not interchangeable, which is why this
  // targets `## Context` specifically.
  {
    const relativePath =
      'resources/prompts/planning/implementation_plan/verification/user-message.md';
    const original = clean.get(relativePath);
    if (original === undefined) {
      console.error(`  ✗ corroboration fixture missing: ${relativePath}`);
      failures += 1;
    } else {
      // Direction 1: mutate ONLY the fenced bare line, leaving every backtick declaration intact.
      // Now-uncorroborated fenced text must be silently dropped, not flagged — it is exactly the
      // shape of every other prompt's own (unrelated) fenced example output.
      const fencedOnly = original.replace(/^## Context$/m, '## TotallyMadeUpHeaderXYZ');
      if (fencedOnly === original) {
        console.error('  ✗ corroboration/uncorroborated: no-op — bare `## Context` not found');
        failures += 1;
      } else {
        const sources = new Map(clean);
        sources.set(relativePath, fencedOnly);
        const problems = checkTree(sources, declaredHeaders);
        if (problems.length === 0) {
          console.log('  ✓ an uncorroborated fenced heading is silently ignored, not flagged');
        } else {
          console.error(
            '  ✗ corroboration/uncorroborated: mutating ONLY the fence produced a finding — ' +
              'fenced content is being checked without requiring corroboration'
          );
          failures += 1;
        }
      }

      // Direction 2: rename EVERY occurrence — backtick declarations and the fenced line — to
      // the same undeclared header, as a phases.yaml rename would leave a stale prompt looking.
      // Corroboration still holds (both shapes agree), so both the inline-backtick and the now-
      // corroborated fenced-example path should report it.
      const both = original
        .replace(/`## Context`/g, '`## Setup`')
        .replace(/^## Context$/m, '## Setup');
      if (both === original) {
        console.error('  ✗ corroboration/renamed-together: no-op — nothing matched to mutate');
        failures += 1;
      } else {
        const sources = new Map(clean);
        sources.set(relativePath, both);
        const problems = checkTree(sources, declaredHeaders);
        const kinds = new Set(
          problems.filter((p) => p.includes("'## Setup'")).map((p) => p.match(/\((\S+?)\)/)?.[1])
        );
        if (kinds.has('inline-backtick') && kinds.has('fenced-example')) {
          console.log(
            '  ✓ renaming a header consistently is caught via both inline-backtick and fenced-example'
          );
        } else {
          console.error(
            `  ✗ corroboration/renamed-together: expected inline-backtick AND fenced-example ` +
              `findings for '## Setup', got kinds: ${[...kinds].join(', ') || '(none)'}`
          );
          failures += 1;
        }
      }
    }
  }

  // Seed a stale YAML-QUOTED declaration (the shape used by create_framework's `marker:` field).
  {
    const relativePath = 'resources/prompts/examples/create_framework/user-message.md';
    const original = clean.get(relativePath);
    if (original === undefined) {
      console.error(`  ✗ yaml-quoted fixture missing: ${relativePath}`);
      failures += 1;
    } else {
      const mutated = original.replace("marker: '## Analysis'", "marker: '## Diagnosis'");
      if (mutated === original) {
        console.error("  ✗ yaml-quoted mutation: no-op — marker: '## Analysis' not found");
        failures += 1;
      } else {
        const mutatedSources = new Map(clean);
        mutatedSources.set(relativePath, mutated);
        const problems = checkTree(mutatedSources, declaredHeaders);
        if (problems.some((p) => p.includes("'## Diagnosis'"))) {
          console.log('  ✓ a stale yaml-quoted declaration is caught');
        } else {
          console.error('  ✗ yaml-quoted mutation: stale header did not trip the gate');
          failures += 1;
        }
      }
    }
  }

  if (failures > 0) {
    console.error(`\n❌ self-test: ${failures} case(s) failed`);
    process.exit(1);
  }
  console.log(
    '\n✅ self-test: every check fails on its own mutation, and never on an ordinary heading'
  );
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }

  const declaredHeaders = loadDeclaredHeaders();
  const promptSources = loadPromptSources();
  const problems = checkTree(promptSources, declaredHeaders);

  if (problems.length > 0) {
    console.error('❌ Phase-header drift — a prompt declares a header no phases.yaml names:');
    for (const problem of problems) console.error(`  • ${problem}`);
    console.error(
      '\nphases.yaml is the SSOT for section_header/marker. Update the prompt copy to the ' +
        'current header, or the phases.yaml if the copy is right and the framework drifted.'
    );
    process.exit(1);
  }

  console.log(
    `✅ Phase-header drift: ${promptSources.size} prompt files agree with ${declaredHeaders.size} ` +
      'declared headers across every phases.yaml'
  );
}

main();
