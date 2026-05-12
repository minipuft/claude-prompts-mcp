#!/usr/bin/env node
// @lifecycle canonical - Verifies agent path claims against filesystem ground truth.
/**
 * Path Claims Verification Script
 *
 * Consumes the `verified_paths:` YAML block from an agent response (piped via
 * stdin by the path-verification gate's response-injection wiring) and verifies
 * each claim against the actual filesystem.
 *
 * Catches plan-author drift: wrong file paths, fabricated line counts, missing
 * fields. Used by the `path-verification` shell_verify gate to provide
 * ground-truth enforcement that the verification step's structural pattern
 * (Phase 2.5 of >>implementation_plan) cannot.
 *
 * ## Contract
 *
 * stdin:  agent response text containing one or more `verified_paths:` blocks.
 *         Only the FIRST verified_paths block is consumed.
 * stdout: human-readable summary of checks (✓/✗ per file).
 * stderr: detailed mismatch report for any failures.
 * exit 0: all path/line/symbol claims match filesystem ground truth.
 * exit 1: at least one claim mismatches reality.
 * exit 2: malformed input (no verified_paths block found, or YAML parse failure).
 *
 * ## Claim schema (per file entry)
 *
 *   verified_paths:
 *     - file: <path>                # required
 *       exists: yes | no             # required
 *       line_count: <number>         # optional
 *       target_symbols:              # optional
 *         - symbol: <name>           # required if entry present
 *           actual_line: <number>    # optional — verified via rg
 *
 * Fields not enumerated above (is_shim, drift, target_fields_exist, etc.) are
 * passed-through prose: the script does not validate them, only what it can
 * deterministically check.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import yaml from 'js-yaml';

const EXIT_PASS = 0;
const EXIT_MISMATCH = 1;
const EXIT_MALFORMED = 2;

function readStdin() {
  try {
    return readFileSync(0, 'utf8');
  } catch (err) {
    process.stderr.write(`[path-verify] failed to read stdin: ${err.message}\n`);
    process.exit(EXIT_MALFORMED);
  }
}

function extractVerifiedPathsBlock(text) {
  const yamlBlockMatch = text.match(/verified_paths:\s*\n(?:[ \t]+- [\s\S]+?)(?=\n\S|$)/);
  if (!yamlBlockMatch) {
    return null;
  }
  return yamlBlockMatch[0];
}

function parseYaml(blockText) {
  try {
    const parsed = yaml.load(blockText);
    if (!parsed || !Array.isArray(parsed.verified_paths)) {
      return null;
    }
    return parsed.verified_paths;
  } catch (err) {
    process.stderr.write(`[path-verify] yaml parse error: ${err.message}\n`);
    return null;
  }
}

function verifyEntry(entry) {
  const mismatches = [];
  const filePath = entry.file;

  if (typeof filePath !== 'string' || filePath.length === 0) {
    mismatches.push('missing or empty `file` field');
    return mismatches;
  }

  let actualLineCount;
  let fileExists = false;
  try {
    statSync(filePath);
    fileExists = true;
    const wcOutput = execFileSync('wc', ['-l', filePath], { encoding: 'utf8' });
    actualLineCount = parseInt(wcOutput.trim().split(/\s+/)[0], 10);
  } catch {
    fileExists = false;
  }

  const claimsExists =
    typeof entry.exists === 'string' ? entry.exists.startsWith('yes') : entry.exists === true;
  if (claimsExists !== fileExists) {
    mismatches.push(
      `file=${filePath}: claims exists=${entry.exists}, filesystem says exists=${fileExists}`
    );
  }

  if (fileExists && typeof entry.line_count === 'number') {
    if (entry.line_count !== actualLineCount) {
      mismatches.push(
        `file=${filePath}: claims line_count=${entry.line_count}, actual=${actualLineCount}`
      );
    }
  }

  if (fileExists && Array.isArray(entry.target_symbols)) {
    for (const sym of entry.target_symbols) {
      if (typeof sym?.symbol !== 'string' || typeof sym.actual_line !== 'number') continue;
      try {
        const rgOutput = execFileSync('rg', ['-n', '--fixed-strings', sym.symbol, filePath], {
          encoding: 'utf8',
        });
        const matchLines = rgOutput
          .split('\n')
          .filter(Boolean)
          .map((l) => parseInt(l.split(':')[0], 10));
        if (!matchLines.includes(sym.actual_line)) {
          mismatches.push(
            `file=${filePath} symbol="${sym.symbol}": claims line=${sym.actual_line}, rg found ${matchLines.length === 0 ? 'no matches' : `lines ${matchLines.join(',')}`}`
          );
        }
      } catch {
        // rg returns non-zero when no matches found; treat as mismatch
        mismatches.push(`file=${filePath} symbol="${sym.symbol}": rg found no matches`);
      }
    }
  }

  return mismatches;
}

function main() {
  const stdin = readStdin();
  const block = extractVerifiedPathsBlock(stdin);
  if (block === null) {
    process.stderr.write('[path-verify] no `verified_paths:` block found in input\n');
    process.exit(EXIT_MALFORMED);
  }

  const entries = parseYaml(block);
  if (entries === null) {
    process.exit(EXIT_MALFORMED);
  }

  const allMismatches = [];
  for (const entry of entries) {
    const m = verifyEntry(entry);
    if (m.length === 0) {
      process.stdout.write(`✓ ${entry.file}\n`);
    } else {
      process.stdout.write(`✗ ${entry.file}\n`);
      allMismatches.push(...m);
    }
  }

  if (allMismatches.length === 0) {
    process.stdout.write(`\n[path-verify] all ${entries.length} entries verified clean\n`);
    process.exit(EXIT_PASS);
  }

  process.stderr.write('\n[path-verify] MISMATCHES:\n');
  for (const m of allMismatches) {
    process.stderr.write(`  - ${m}\n`);
  }
  process.stderr.write(
    `\n[path-verify] ${allMismatches.length} mismatch(es) across ${entries.length} entries\n`
  );
  process.exit(EXIT_MISMATCH);
}

main();
