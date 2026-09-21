#!/usr/bin/env tsx
/**
 * A framework's tool guidance may not restate a list the tool contract owns.
 *
 * WHY THIS EXISTS. Each framework's `toolDescriptions` entry used to REPLACE the tool description
 * the contract generates, so every framework carried its own copy of the contract's facts — the
 * action list, the resource types, the command syntax — and nothing updated the copies. Measured
 * 2026-09-16 on a live server: under CAGEERF, the default framework, `resource_manager` described
 * 8 of the 15 actions its input schema accepted; four bundled frameworks listed 7. The contract's
 * own `frameworkAware` variants replaced the text for every other framework, which described 0.
 *
 * The fix moved ownership rather than correcting the copies: the server now appends a framework's
 * guidance after the contract text (`composeToolDescription`), so a framework has no reason to
 * restate anything. This gate is the closure condition for that class, not for the four files that
 * were wrong.
 *
 * WHAT IT CHECKS, per contract that describes a tool (`tooling/contracts/*.json`):
 *   · a labelled pipe list in the contract description (`ACTIONS: a | b`) that restates one of the
 *     tool's enum parameters names exactly that enum's values — the contract's own copy is the one
 *     every client reads, and it had drifted too (13 of 15 actions);
 * and per framework directory under `resources/frameworks/` holding a `framework.yaml`, for every
 * tool its `toolDescriptions` names:
 *   · the tool is one a contract describes, and every parameter it names is one that tool declares;
 *   · no guidance text uses a section label the contract description uses (`ACTIONS:`, `SYNTAX:`,
 *     `MODIFIERS:`, `RESOURCE TYPES:` against the contract's `TYPES:`), labels read from the
 *     contract rather than listed here;
 *   · no guidance text lists two or more values of one of the tool's enum parameters in a row
 *     (`create | update`, `prompt|gate`, `'prompt', 'gate', or 'framework'`);
 *   · composing the guidance onto the contract text leaves the contract text first and intact.
 *
 * WHAT IT DOES NOT CHECK: prose that paraphrases a list without enumerating it, and frameworks an
 * operator creates outside the bundled tree. The composition check is what bounds the second case:
 * whatever a user framework says, the contract text is still served ahead of it.
 *
 * `--self-test` proves each rule can still fail, then runs the live check.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as yaml from 'js-yaml';

import { composeToolDescription } from '../src/mcp/tools/tool-description-overlays.js';

import type { FrameworkToolDescription } from '../src/engine/frameworks/types/index.js';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FRAMEWORKS_DIR = path.join(SERVER_ROOT, 'resources', 'frameworks');
const CONTRACTS_DIR = path.join(SERVER_ROOT, 'tooling', 'contracts');

/** What a tool contract owns that a framework's guidance must not restate. */
interface ToolFacts {
  tool: string;
  description: string;
  parameters: ReadonlySet<string>;
  enums: ReadonlyMap<string, readonly string[]>;
  /** The last word of every section label in the description (`PROMPT AUTHORING:` → `AUTHORING`). */
  labels: ReadonlySet<string>;
}

interface FrameworkOverlay {
  framework: string;
  label: string;
  tools: Record<string, unknown>;
}

type Compose = (
  _contractText: string,
  _overlay: FrameworkToolDescription | undefined,
  _label: string
) => string;

interface RawContract {
  tool: string;
  toolDescription?: { description: string };
  parameters: { name: string; type: string }[];
}

/**
 * An ALL-CAPS phrase followed by a colon, optionally with one bracketed group: `MODIFIERS (x):`,
 * `RESOURCE MANAGER [CAGEERF]:`. The bracket form is how the old framework headers restated the
 * tool's own heading, which the server now owns.
 */
const SECTION_LABEL = /\b([A-Z][A-Z0-9]*(?: [A-Z][A-Z0-9]*)*)(?: (?:\([^)\n]*\)|\[[^\]\n]*\]))?:/g;

/** What may sit between two list items: a pipe, comma or slash, or `or`/`and`, quotes allowed. */
const LIST_SEPARATOR = /^\s*['"`]?\s*(?:[|,/]|,?\s*(?:or|and))\s*['"`]?\s*$/i;

const ENUM_TYPE = /^enum\[(.+)\]$/;

function lastWord(label: string): string {
  return label.trim().split(/\s+/).pop() ?? label;
}

function sectionLabels(text: string): string[] {
  return [...text.matchAll(SECTION_LABEL)].map((match) => lastWord(match[1] ?? ''));
}

function toolFacts(contract: RawContract): ToolFacts | null {
  if (contract.toolDescription === undefined) return null;
  const enums = new Map<string, string[]>();
  for (const parameter of contract.parameters) {
    const match = ENUM_TYPE.exec(parameter.type);
    if (match?.[1] !== undefined) enums.set(parameter.name, match[1].split('|'));
  }
  const description = contract.toolDescription.description;
  return {
    tool: contract.tool.replace(/-/g, '_'),
    description,
    parameters: new Set(contract.parameters.map((parameter) => parameter.name)),
    enums,
    labels: new Set(sectionLabels(description)),
  };
}

/**
 * Every run of two or more values of one enum, listed one after another.
 *
 * Values are matched as whole identifiers (`_` and `-` count as identifier characters, so
 * `analyze_type` is never read as `type`), and two occurrences form a run only when what sits
 * between them is a list separator.
 */
function enumRuns(text: string, enums: ReadonlyMap<string, readonly string[]>): string[] {
  const runs: string[] = [];
  for (const [name, values] of enums) {
    const pattern = new RegExp(
      `(?<![\\w-])(${[...values]
        .sort((a, b) => b.length - a.length)
        .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|')})(?![\\w-])`,
      'g'
    );
    const hits = [...text.matchAll(pattern)].map((match) => ({
      value: match[1] ?? '',
      start: match.index,
      end: match.index + match[0].length,
    }));
    for (let i = 1; i < hits.length; i += 1) {
      const previous = hits[i - 1];
      const current = hits[i];
      if (previous === undefined || current === undefined) continue;
      if (previous.value === current.value) continue;
      if (LIST_SEPARATOR.test(text.slice(previous.end, current.start))) {
        runs.push(`${name}: ${previous.value} … ${current.value}`);
      }
    }
  }
  return runs;
}

/** A labelled pipe list in a contract description must name its enum's values exactly. */
function checkContractLists(facts: ToolFacts): string[] {
  const findings: string[] = [];
  for (const line of facts.description.split('\n')) {
    const match = /^([A-Z][A-Z0-9 ]*):\s*(.+)$/.exec(line);
    const label = match?.[1];
    const body = match?.[2];
    if (label === undefined || body === undefined || !body.includes('|')) continue;
    const listed = body.split('|').map((token) => token.trim());
    let best: { name: string; values: readonly string[]; overlap: number } | undefined;
    for (const [name, values] of facts.enums) {
      const overlap = listed.filter((token) => values.includes(token)).length;
      if (overlap >= 2 && (best === undefined || overlap > best.overlap)) {
        best = { name, values, overlap };
      }
    }
    if (best === undefined) continue;
    const { name, values } = best;
    const missing = values.filter((value) => !listed.includes(value));
    const extra = listed.filter((token) => !values.includes(token));
    if (missing.length > 0 || extra.length > 0) {
      findings.push(
        `${facts.tool}: contract description line "${label}:" restates enum '${name}' ` +
          `but ${missing.length > 0 ? `omits ${missing.join(', ')}` : ''}` +
          `${missing.length > 0 && extra.length > 0 ? ' and ' : ''}` +
          `${extra.length > 0 ? `names ${extra.join(', ')}, which the enum does not hold` : ''}`
      );
    }
  }
  return findings;
}

function guidanceTexts(entry: FrameworkToolDescription): { where: string; text: string }[] {
  const texts: { where: string; text: string }[] = [];
  if (typeof entry.description === 'string') {
    texts.push({ where: 'description', text: entry.description });
  }
  if (typeof entry.responseFormat === 'string') {
    texts.push({ where: 'responseFormat', text: entry.responseFormat });
  }
  for (const [name, value] of Object.entries(entry.parameters ?? {})) {
    const text = typeof value === 'string' ? value : value.description;
    if (typeof text === 'string') texts.push({ where: `parameters.${name}`, text });
  }
  return texts;
}

function checkEntry(
  overlay: FrameworkOverlay,
  facts: ToolFacts,
  entry: FrameworkToolDescription,
  compose: Compose
): string[] {
  const findings: string[] = [];
  const at = `${overlay.framework} → ${facts.tool}`;

  for (const name of Object.keys(entry.parameters ?? {})) {
    if (!facts.parameters.has(name)) {
      findings.push(`${at}: parameters.${name} names a parameter the contract does not declare`);
    }
  }

  for (const { where, text } of guidanceTexts(entry)) {
    const labels = sectionLabels(text).filter((label) => facts.labels.has(label));
    if (labels.length > 0) {
      findings.push(
        `${at}: ${where} uses the contract's section label(s) ${[...new Set(labels)].join(', ')} — ` +
          `the contract text already carries that section`
      );
    }
    for (const run of enumRuns(text, facts.enums)) {
      findings.push(`${at}: ${where} lists contract enum values (${run})`);
    }
  }

  const served = compose(facts.description, entry, overlay.label);
  if (!served.startsWith(facts.description.trimEnd())) {
    findings.push(
      `${at}: the composed description does not begin with the contract description, so the ` +
        `framework text replaces or rewrites what the contract owns`
    );
  }
  return findings;
}

function checkOverlay(
  overlay: FrameworkOverlay,
  contracts: ReadonlyMap<string, ToolFacts>,
  compose: Compose
): string[] {
  const findings: string[] = [];
  for (const [tool, raw] of Object.entries(overlay.tools)) {
    const facts = contracts.get(tool);
    if (facts === undefined) {
      findings.push(`${overlay.framework} → ${tool}: no contract describes a tool by that name`);
      continue;
    }
    if (typeof raw !== 'object' || raw === null) {
      findings.push(`${overlay.framework} → ${tool}: the entry is not an object`);
      continue;
    }
    findings.push(...checkEntry(overlay, facts, raw as FrameworkToolDescription, compose));
  }
  return findings;
}

function loadContracts(): Map<string, ToolFacts> {
  const contracts = new Map<string, ToolFacts>();
  for (const file of readdirSync(CONTRACTS_DIR).filter((name) => name.endsWith('.json'))) {
    const raw = JSON.parse(readFileSync(path.join(CONTRACTS_DIR, file), 'utf8')) as RawContract;
    const facts = toolFacts(raw);
    if (facts !== null) contracts.set(facts.tool, facts);
  }
  return contracts;
}

function loadOverlays(): FrameworkOverlay[] {
  if (!existsSync(FRAMEWORKS_DIR)) return [];
  return readdirSync(FRAMEWORKS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(FRAMEWORKS_DIR, entry.name, 'framework.yaml'))
    .filter((file) => existsSync(file))
    .sort()
    .map((file) => {
      const data = yaml.load(readFileSync(file, 'utf8')) as Record<string, unknown>;
      const id = typeof data['id'] === 'string' ? data['id'] : path.basename(path.dirname(file));
      const tools = data['toolDescriptions'];
      return {
        framework: id,
        label: typeof data['type'] === 'string' ? data['type'] : id,
        tools:
          typeof tools === 'object' && tools !== null ? (tools as Record<string, unknown>) : {},
      };
    });
}

function liveFindings(): { findings: string[]; frameworks: number; entries: number } {
  const contracts = loadContracts();
  const overlays = loadOverlays();
  const findings = [...contracts.values()].flatMap(checkContractLists);
  let entries = 0;
  for (const overlay of overlays) {
    entries += Object.keys(overlay.tools).length;
    findings.push(...checkOverlay(overlay, contracts, composeToolDescription));
  }
  if (contracts.size === 0) findings.push(`no tool contracts found under ${CONTRACTS_DIR}`);
  if (overlays.length === 0) findings.push(`no frameworks found under ${FRAMEWORKS_DIR}`);
  if (overlays.length > 0 && entries === 0) {
    findings.push('no bundled framework names any toolDescriptions entry, so nothing was checked');
  }
  return { findings, frameworks: overlays.length, entries };
}

function selfTest(): number {
  const facts = toolFacts({
    tool: 'fixture-tool',
    toolDescription: {
      description: 'FIXTURE: does things.\n\nTYPES: page | card\nACTIONS: open | close | pin_note',
    },
    parameters: [
      { name: 'action', type: 'enum[open|close|pin_note]' },
      { name: 'resource_type', type: 'enum[page|card]' },
      { name: 'note', type: 'string' },
    ],
  });
  if (facts === null) throw new Error('self-test fixture contract produced no facts');
  const contracts = new Map([[facts.tool, facts]]);
  const overlay = (tools: Record<string, unknown>): FrameworkOverlay => ({
    framework: 'fixture',
    label: 'FIXTURE',
    tools,
  });
  const replacing: Compose = (contractText, entry) => entry?.description ?? contractText;

  const cases: { name: string; findings: string[]; expect: (_f: string[]) => boolean }[] = [
    {
      name: 'guidance that names one value in prose reports nothing',
      findings: checkOverlay(
        overlay({
          fixture_tool: {
            description: 'Use action:"open" with note:"why" before you pin_note anything.',
            parameters: { note: 'Say why the page matters.' },
          },
        }),
        contracts,
        composeToolDescription
      ),
      expect: (f) => f.length === 0,
    },
    {
      name: 'a restated ACTIONS line is reported (the motivating instance)',
      findings: checkOverlay(
        overlay({ fixture_tool: { description: 'ACTIONS: open | close' } }),
        contracts,
        composeToolDescription
      ),
      expect: (f) =>
        f.some((m) => m.includes('ACTIONS')) && f.some((m) => m.includes('open … close')),
    },
    {
      name: 'a label whose last word is a contract label is reported (RESOURCE TYPES vs TYPES)',
      findings: checkOverlay(
        overlay({ fixture_tool: { description: 'Folded text. RESOURCE TYPES: page (a leaf)' } }),
        contracts,
        composeToolDescription
      ),
      expect: (f) => f.length === 1 && f[0]?.includes('TYPES') === true,
    },
    {
      name: "a restated tool heading is reported (FIXTURE [X]: against the contract's FIXTURE:)",
      findings: checkOverlay(
        overlay({ fixture_tool: { description: 'FIXTURE [FW]: does things the framework way.' } }),
        contracts,
        composeToolDescription
      ),
      expect: (f) => f.length === 1 && f[0]?.includes('FIXTURE') === true,
    },
    {
      name: "a quoted list in a parameter is reported ('page', or 'card')",
      findings: checkOverlay(
        overlay({ fixture_tool: { parameters: { note: "Either 'page', or 'card'." } } }),
        contracts,
        composeToolDescription
      ),
      expect: (f) => f.length === 1 && f[0]?.includes('page … card') === true,
    },
    {
      name: 'an identifier is matched whole (pin_note is not note)',
      findings: enumRuns('pin_note, pin_note_x | close', facts.enums),
      expect: (f) => f.length === 0,
    },
    {
      name: 'a parameter the contract does not declare is reported',
      findings: checkOverlay(
        overlay({ fixture_tool: { parameters: { stale_param: 'x' } } }),
        contracts,
        composeToolDescription
      ),
      expect: (f) => f.length === 1 && f[0]?.includes('stale_param') === true,
    },
    {
      name: 'a tool no contract describes is reported',
      findings: checkOverlay(
        overlay({ retired_tool: { description: 'x' } }),
        contracts,
        composeToolDescription
      ),
      expect: (f) => f.length === 1 && f[0]?.includes('retired_tool') === true,
    },
    {
      name: 'a composition that replaces the contract text is reported',
      findings: checkOverlay(
        overlay({ fixture_tool: { description: 'Framework text only.' } }),
        contracts,
        replacing
      ),
      expect: (f) => f.length === 1 && f[0]?.includes('does not begin') === true,
    },
    {
      name: 'the real composition keeps the contract text first',
      findings: checkOverlay(
        overlay({ fixture_tool: { description: 'Framework text only.' } }),
        contracts,
        composeToolDescription
      ),
      expect: (f) => f.length === 0,
    },
    {
      name: 'an agreeing contract list reports nothing',
      findings: checkContractLists(facts),
      expect: (f) => f.length === 0,
    },
    {
      name: 'a contract list missing an enum value is reported',
      findings: checkContractLists({
        ...facts,
        description: 'ACTIONS: open | close\nTYPES: page | card | sheet',
      }),
      expect: (f) =>
        f.length === 2 &&
        f.some((m) => m.includes('omits pin_note')) &&
        f.some((m) => m.includes('names sheet')),
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const ok = c.expect(c.findings);
    console.log(
      `${ok ? 'PASS' : 'FAIL'}  ${c.name}${ok ? '' : ` — got ${JSON.stringify(c.findings)}`}`
    );
    if (!ok) failed += 1;
  }

  const live = liveFindings();
  const liveOk = live.findings.length === 0;
  console.log(`${liveOk ? 'PASS' : 'FAIL'}  the bundled frameworks and contracts in this checkout`);
  if (!liveOk) failed += 1;

  return failed === 0 ? 0 : 1;
}

function run(): number {
  const { findings, frameworks, entries } = liveFindings();
  if (findings.length > 0) {
    for (const finding of findings) console.error(`✖ ${finding}`);
    console.error(
      `\nFix: a framework's toolDescriptions entry is guidance the server appends after the ` +
        `contract's description — say what the framework adds, and leave lists, labels and ` +
        `parameter names to tooling/contracts/*.json. A contract description's own list must ` +
        `name exactly the values of the enum it restates.`
    );
    return 1;
  }
  console.log(
    `✅ Framework tool descriptions: ${entries} entries across ${frameworks} frameworks restate ` +
      `no contract-owned list, and each composes after its contract text.`
  );
  return 0;
}

process.exit(process.argv.includes('--self-test') ? selfTest() : run());
