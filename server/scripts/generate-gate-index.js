#!/usr/bin/env node
/**
 * Gate Index Generator
 *
 * Reads all gate.yaml files and generates gates/_index.md.
 * Source of truth is the YAML files — the index is derived, never manually edited.
 *
 * Usage:
 *   node scripts/generate-gate-index.js [--check]
 *
 * Options:
 *   --check   Verify index is up-to-date without writing (exit 1 if stale)
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as yaml from 'js-yaml';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GATES_DIR = join(__dirname, '..', 'resources', 'gates');
const INDEX_PATH = join(GATES_DIR, '_index.md');
const CHECK_MODE = process.argv.includes('--check');

// ============================================
// DISCOVERY
// ============================================
function discoverGates() {
  return readdirSync(GATES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name !== 'config')
    .map((e) => {
      const yamlPath = join(GATES_DIR, e.name, 'gate.yaml');
      if (!existsSync(yamlPath)) return null;
      try {
        const data = yaml.load(readFileSync(yamlPath, 'utf-8'));
        return { dir: e.name, ...data, _guidanceText: loadGuidanceText(e.name, data) };
      } catch (err) {
        console.warn(`  ⚠ Failed to parse ${e.name}/gate.yaml: ${err.message}`);
        return null;
      }
    })
    .filter(Boolean);
}

// Mirrors GateDefinitionLoader's guidance inlining (server/src/engine/gates/core/
// gate-definition-loader.ts): a `guidanceFile` reference wins over inline `guidance`.
function loadGuidanceText(dirName, data) {
  if (data.guidanceFile) {
    const guidancePath = join(GATES_DIR, dirName, data.guidanceFile);
    if (existsSync(guidancePath)) {
      return readFileSync(guidancePath, 'utf-8');
    }
    return '';
  }
  return data.guidance ?? '';
}

// ============================================
// TIER (mirrors server/src/engine/gates/core/gate-tier.ts — kept in step by the
// registry cross-check in server/tests/unit/gates/core/gate-tier.test.ts)
// ============================================
const EVALUATED_PASS_CRITERIA_TYPES = new Set(['shell_verify', 'script_tool']);

function deriveGateTier(gate) {
  const criteria = gate.pass_criteria ?? [];
  const hasEvaluator = criteria.some((c) => EVALUATED_PASS_CRITERIA_TYPES.has(c?.type));
  return hasEvaluator ? 'check' : 'reminder';
}

// ============================================
// CLASSIFICATION (inferred from existing fields)
// ============================================
function classifyGate(gate) {
  const cats = gate.activation?.prompt_categories ?? [];
  const hasFramework = gate.activation?.framework_context?.length > 0;

  // PR review gates
  if (cats.includes('pr-review')) return 'PR Review';
  // Framework
  if (hasFramework || gate.gate_type === 'framework') return 'Framework';
  // Planning / workflow
  if (cats.includes('planning') && !cats.includes('code')) return 'Planning';
  // Testing
  if (gate.id.startsWith('test-')) return 'Testing';
  // Security
  if (gate.id.includes('security')) return 'Security';
  // Research / analysis
  if (cats.includes('research') && !cats.includes('development')) return 'Research';
  // Development (broad)
  return 'Development';
}

function severityBadge(gate) {
  const s = gate.severity ?? '—';
  const e = gate.enforcementMode ?? null;
  if (e === 'advisory') return `${s} (advisory)`;
  if (e === 'blocking') return `${s} (blocking)`;
  return s;
}

function activationSummary(gate) {
  // Ruling B13: when a gate names `activation.artifacts`, artifacts alone decide — the
  // runtime (`isGateActiveForContext`) never consults `prompt_categories` once this is set, so
  // printing them beside it would claim a say they no longer have.
  const artifacts = gate.activation?.artifacts ?? [];
  const explicit = gate.activation?.explicit_request;
  if (artifacts.length > 0) {
    // `explicit_request` still applies on this branch: artifacts decide WHICH surfaces the gate
    // is eligible for, `explicit_request: true` decides that it never auto-attaches to any of
    // them. Dropping the suffix here printed `pr-security` and `pr-performance` as if they
    // attached to every source change.
    const summary = `artifacts: ${artifacts.join(', ')}`;
    return explicit === true ? `${summary} · explicit only` : summary;
  }

  const parts = [];
  const cats = gate.activation?.prompt_categories ?? [];
  const frameworks = gate.activation?.framework_context ?? [];

  if (cats.length > 0) parts.push(cats.join(', '));
  if (frameworks.length > 0) parts.push(`frameworks: ${frameworks.join(', ')}`);
  if (explicit) parts.push('explicit only');
  if (parts.length === 0) {
    // Mirrors isGateActiveForContext (server/src/engine/gates/utils/gate-activation.ts):
    // a MISSING activation block never auto-activates (opt-in only, since claude-prompts-mcp
    // #286); an activation block with no restricting rule still auto-attaches (always).
    return gate.activation === undefined ? 'opt-in' : 'always';
  }
  return parts.join(' · ');
}

function subjectOf(gate) {
  return typeof gate.subject === 'string' && gate.subject.length > 0 ? gate.subject : '—';
}

function tokenEstimate(gate) {
  const text = gate._guidanceText ?? '';
  return text.length === 0 ? 0 : Math.ceil(text.length / 4);
}

// ============================================
// RENDER
// ============================================
function renderIndex(gates) {
  const grouped = {};
  for (const gate of gates) {
    const group = classifyGate(gate);
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(gate);
  }

  // Stable group order
  const groupOrder = [
    'Development',
    'Security',
    'Testing',
    'Planning',
    'Research',
    'PR Review',
    'Framework',
  ];

  const lines = [
    '<!-- Generated by scripts/generate-gate-index.js — do not edit manually -->',
    '',
    '# Gate Index',
    '',
    `${gates.length} gates across ${Object.keys(grouped).length} groups.`,
    '',
    'For the full enforcement-mode taxonomy (`inline_guidance` / `framework_compliance` / `shell_verify` / `script_tool`) and how each `pass_criteria.type` actually behaves at runtime, see [docs/guides/gates.md](../../../docs/guides/gates.md#enforcement-modes).',
    '',
    '> **Note:** Gate types `content_check` and `pattern_check` were renamed to `inline_guidance` — neither had a runtime enforcement path; both rendered guidance text only. Gates using the old names should migrate.',
    '',
    '**Tier** is `check` when a gate carries a real runtime evaluator (`shell_verify` or `script_tool` in its `pass_criteria`); every other gate, pattern/length fields included, is `reminder` — guidance text with no runtime pass/fail path (see the taxonomy link above).',
    '',
    '**Activation** reads `opt-in` when a gate has no `activation` block at all: since claude-prompts-mcp #286, `isGateActiveForContext` never auto-attaches an undefined activation — the gate still applies when named explicitly (`gateConfiguration.include`, `inlineGateIds`). `always` marks a gate whose `activation` block carries no restricting rule and so auto-attaches to every context.',
    '',
  ];

  for (const group of groupOrder) {
    const items = grouped[group];
    if (!items?.length) continue;

    // Sort within group: severity critical > high > medium > none, then alphabetical
    const severityRank = { critical: 0, high: 1, medium: 2 };
    items.sort((a, b) => {
      const ra = severityRank[a.severity] ?? 3;
      const rb = severityRank[b.severity] ?? 3;
      if (ra !== rb) return ra - rb;
      return a.id.localeCompare(b.id);
    });

    lines.push(`## ${group}`, '');
    lines.push('| Gate | Tier | Severity | Activation | Subject | ~tokens | Description |');
    lines.push('|------|------|----------|------------|---------|---------|-------------|');

    for (const gate of items) {
      const desc = (gate.description ?? '').replace(/\n/g, ' ').trim();
      lines.push(
        `| \`${gate.id}\` | ${deriveGateTier(gate)} | ${severityBadge(gate)} | ${activationSummary(gate)} | ${subjectOf(gate)} | ${tokenEstimate(gate)} | ${desc} |`
      );
    }
    lines.push('');
  }

  lines.push('---', '');
  lines.push(`*Generated: ${new Date().toISOString().split('T')[0]}*`, '');

  return lines.join('\n');
}

// ============================================
// MAIN
// ============================================
function main() {
  const gates = discoverGates();

  if (gates.length === 0) {
    console.log('No gates found.');
    process.exit(0);
  }

  const content = renderIndex(gates);

  if (CHECK_MODE) {
    const existing = existsSync(INDEX_PATH) ? readFileSync(INDEX_PATH, 'utf-8') : '';
    // Compare ignoring the Generated date line
    const normalize = (s) => s.replace(/\*Generated:.*\*/, '').trim();
    if (normalize(existing) !== normalize(content)) {
      console.error('✗ Gate index is stale. Run: node scripts/generate-gate-index.js');
      process.exit(1);
    }
    console.log('✓ Gate index is up-to-date');
    process.exit(0);
  }

  writeFileSync(INDEX_PATH, content, 'utf-8');
  console.log(`✓ Generated ${INDEX_PATH}`);
  console.log(`  ${gates.length} gates indexed`);
}

main();
