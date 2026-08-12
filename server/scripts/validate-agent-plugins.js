#!/usr/bin/env node

/**
 * Validates the repository's Agent Plugins canonical tree against the PINNED 1.0.0 schemas.
 *
 * WHY THIS EXISTS
 * Agent Plugins 1.0.0 was announced 2026-08-06 — days before this migration started. A spec that
 * young moves, and a validator that fetches the live schema would turn someone else's point
 * release into a red build on an unrelated PR. So the schemas are vendored under
 * `tooling/contracts/vendor/agent-plugins/1.0.0/` and this script never touches the network.
 * Re-pinning is a deliberate commit with the new sha256 in its message, not a background event.
 *
 * WHAT IT CHECKS
 * The two spec-mandated files at the repository root — `plugin.json` against plugin.schema.json,
 * `mcp.json` against mcp.schema.json. Both schemas set `additionalProperties: false` and require
 * `$schema`, so this catches the two drifts that matter: a field the spec does not permit, and a
 * manifest that never declares which spec version it targets.
 *
 * `.claude-plugin/plugin.json` and `.mcp.json` are deliberately NOT checked. They are the Claude
 * Code legacy render — Anthropic is not on the standard, that format has no `$schema`, and
 * validating it here would fail a file that is correct for its own client.
 *
 * ABSENT TARGETS ARE REPORTED, NOT PASSED OVER. Before the canonical tree is promoted there is
 * genuinely nothing to validate, and a check that prints nothing in that state reads as "the
 * manifests are fine" when it means "there are no manifests". It says which it is.
 *
 * `--self-test` proves each rule can still fail.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(SERVER, '..');
const VENDOR = path.join(SERVER, 'tooling', 'contracts', 'vendor', 'agent-plugins', '1.0.0');

/** The spec mandates these filenames at these locations; neither is configurable. */
const TARGETS = [
  { file: 'plugin.json', schema: 'plugin.schema.json', label: 'plugin manifest' },
  { file: 'mcp.json', schema: 'mcp.schema.json', label: 'MCP configuration' },
];

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Compile one vendored schema. Pure apart from the read — the self-test drives it directly. */
function compile(schemaName) {
  const ajv = new (Ajv2020.default ?? Ajv2020)({ allErrors: true, strict: false });
  return ajv.compile(readJson(path.join(VENDOR, schemaName)));
}

/**
 * Validate one already-parsed document. Returns violation strings.
 * Pure — takes the document, not a path, so the self-test can feed it fabricated manifests.
 */
export function violationsFor(schemaName, doc, label) {
  const validate = compile(schemaName);
  if (validate(doc)) return [];
  return (validate.errors ?? []).map((e) => {
    const where = e.instancePath === '' ? '(root)' : e.instancePath;
    const extra = e.params?.additionalProperty ? ` — "${e.params.additionalProperty}"` : '';
    return `${label} ${where}: ${e.message}${extra}`;
  });
}

/**
 * Check that every path `scripts/render-targets.json` promises to read actually exists.
 *
 * The matrix's own Verify column names a renderer self-check, and the renderer is a tier away.
 * A target list nobody reads is a list nobody corrects, so the cheap half of that check runs
 * now: a `consumes` entry naming a path that is not there is the most likely way this file
 * goes wrong, and it is exactly what a wrong render would trip over later.
 */
function renderTargetViolations() {
  const file = path.join(REPO, 'scripts', 'render-targets.json');
  if (!existsSync(file)) return { violations: [], checked: 0 };

  let doc;
  try {
    doc = readJson(file);
  } catch (error) {
    return { violations: [`render-targets.json: not parseable — ${error.message}`], checked: 0 };
  }

  const violations = [];
  const targets = Array.isArray(doc.targets) ? doc.targets : [];
  if (targets.length === 0) {
    violations.push('render-targets.json: declares no targets');
  }

  for (const target of targets) {
    const label = `render-targets.json[${target.client ?? '?'}]`;
    if (typeof target.client !== 'string' || target.client === '') {
      violations.push(`${label}: missing "client"`);
    }
    if (target.output?.repo === undefined) {
      violations.push(`${label}: missing "output.repo"`);
    }
    for (const rel of target.consumes ?? []) {
      if (!existsSync(path.join(REPO, rel))) {
        violations.push(`${label}: consumes "${rel}", which does not exist`);
      }
    }
  }

  return { violations, checked: targets.length };
}

function run() {
  const violations = [];
  const absent = [];
  let checked = 0;

  for (const target of TARGETS) {
    const file = path.join(REPO, target.file);
    if (!existsSync(file)) {
      absent.push(target.file);
      continue;
    }
    checked += 1;
    let doc;
    try {
      doc = readJson(file);
    } catch (error) {
      violations.push(`${target.file}: not parseable as JSON — ${error.message}`);
      continue;
    }
    violations.push(...violationsFor(target.schema, doc, target.file));
  }

  const renderTargets = renderTargetViolations();
  violations.push(...renderTargets.violations);

  for (const name of absent) {
    console.log(`ℹ ${name} not present — the canonical tree has not been promoted yet.`);
  }
  if (renderTargets.checked > 0) {
    console.log(`✔ render-targets.json: ${renderTargets.checked} target(s), all consumes resolve.`);
  }

  if (violations.length > 0) {
    console.error(`✖ Agent Plugins 1.0.0 validation failed (${violations.length}):`);
    for (const v of violations) console.error(`  - ${v}`);
    return 1;
  }

  if (checked === 0) {
    console.log('✔ Agent Plugins: nothing to validate (no canonical manifests at the root).');
    return 0;
  }

  console.log(`✔ Agent Plugins 1.0.0: ${checked}/${TARGETS.length} manifest(s) schema-valid.`);
  return 0;
}

/** Each case must FAIL; a rule that cannot fail is not enforcing anything. */
function selfTest() {
  const PLUGIN_SCHEMA_ID = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
  const MCP_SCHEMA_ID = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json';

  const cases = [
    {
      name: 'plugin.json missing $schema is rejected',
      schema: 'plugin.schema.json',
      doc: { name: 'claude-prompts' },
    },
    {
      name: 'plugin.json with an unpermitted top-level field is rejected',
      schema: 'plugin.schema.json',
      doc: { $schema: PLUGIN_SCHEMA_ID, name: 'claude-prompts', hooks: {} },
    },
    {
      name: 'plugin.json with an uppercase name is rejected',
      schema: 'plugin.schema.json',
      doc: { $schema: PLUGIN_SCHEMA_ID, name: 'Claude-Prompts' },
    },
    {
      name: 'mcp.json stdio server without an explicit type is rejected',
      schema: 'mcp.schema.json',
      doc: {
        $schema: MCP_SCHEMA_ID,
        mcpServers: { 'claude-prompts': { command: 'node', args: ['x.js'] } },
      },
    },
    {
      name: 'mcp.json env may not redeclare PLUGIN_ROOT',
      schema: 'mcp.schema.json',
      doc: {
        $schema: MCP_SCHEMA_ID,
        mcpServers: {
          'claude-prompts': { type: 'stdio', command: 'node', env: { PLUGIN_ROOT: '/x' } },
        },
      },
    },
  ];

  let failures = 0;
  for (const c of cases) {
    const found = violationsFor(c.schema, c.doc, 'self-test');
    if (found.length === 0) {
      console.error(`✖ self-test: "${c.name}" produced no violation — the rule is not enforced.`);
      failures += 1;
    } else {
      console.log(`✔ self-test: ${c.name}`);
    }
  }

  // A conforming document must pass, or every case above proves only that nothing validates.
  const clean = violationsFor(
    'plugin.schema.json',
    { $schema: PLUGIN_SCHEMA_ID, name: 'claude-prompts', version: '3.2.1' },
    'self-test'
  );
  if (clean.length > 0) {
    console.error(`✖ self-test: a conforming manifest was rejected — ${clean.join('; ')}`);
    failures += 1;
  } else {
    console.log('✔ self-test: a conforming manifest is accepted');
  }

  return failures === 0 ? 0 : 1;
}

process.exit(process.argv.includes('--self-test') ? selfTest() : run());
