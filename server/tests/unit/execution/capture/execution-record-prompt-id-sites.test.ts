// @lifecycle canonical - P6.144 / R66: every execution-record append site names a prompt id.
/**
 * R66: every execution record names its prompt. For a step-level record that is the step's prompt
 * (`recordedStep`); for a run-level record, the run's own (the parsed command's, which the run id
 * names). MEASURED 2026-09-27 on `6dad55f3` (`rg -n "\.append\(\{" src`): six sites, and
 * `prompt_id` was null on the stepless run's records and on every remainder node's capture row.
 *
 * | site | record | prompt |
 * | --- | --- | --- |
 * | `prompt-execution-pipeline.ts` `emitFailureRecord` | run failed | parsed command |
 * | `18-execution-stage.ts` chain render | step working | the rendered step |
 * | `18-execution-stage.ts` `ledgerRenderedRunPrompt` | one-node run step working (P6.156) | `recordedStep` |
 * | `20-gate-review-stage.ts` `ledgerFirstRenderedStep` | step working | `recordedStep` |
 * | `21-formatting-stage.ts` `emitChainTerminalRecord` | run terminal | parsed command |
 * | `step-capture-service.ts` `ledgerCapturedStep` | step completed / input_required | `recordedStep` |
 * | `step-capture-service.ts` `ledgerSubmittedVerdict` | step verdict | `recordedStep` |
 * | `step-capture-service.ts` `ledgerSubmittedReviewAction` | skipped node's BYPASS | `recordedStep` |
 *
 * The predicate is the append's object literal naming `promptId`. The count is asserted against the
 * table, so an additional append fails until it is classified here; the BYPASS row resolves the
 * skipped node's prompt rather than the current cursor. The planted site proves the
 * predicate reports an append that names no prompt.
 */
import { describe, expect, test } from '@jest/globals';

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../src');
const APPEND = '.append({';

/** Every `.append({ … })` object literal in `source`, brace-matched. */
function appendLiterals(source: string): string[] {
  const literals: string[] = [];
  let from = source.indexOf(APPEND);
  while (from !== -1) {
    const open = from + APPEND.length - 1;
    let depth = 0;
    let end = open;
    for (; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1;
      if (source[end] === '}') depth -= 1;
      if (depth === 0) break;
    }
    literals.push(source.slice(open, end + 1));
    from = source.indexOf(APPEND, end);
  }
  return literals;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith('.ts') ? [full] : [];
  });
}

const SITES: Readonly<Record<string, number>> = {
  'engine/execution/pipeline/prompt-execution-pipeline.ts': 1,
  'engine/execution/pipeline/stages/18-execution-stage.ts': 2,
  'engine/execution/pipeline/stages/20-gate-review-stage.ts': 1,
  'engine/execution/pipeline/stages/21-formatting-stage.ts': 1,
  'engine/execution/capture/step-capture-service.ts': 3,
};

const namesPrompt = (literal: string): boolean => /\bpromptId\b/.test(literal);

describe('P6.144 / R66: every execution-record append names a prompt id', () => {
  const found = sourceFiles(SRC).flatMap((file) =>
    appendLiterals(readFileSync(file, 'utf8')).map((literal) => ({
      site: path.relative(SRC, file).split(path.sep).join('/'),
      literal,
    }))
  );

  test('the append sites are exactly the classified ones', () => {
    const counts: Record<string, number> = {};
    for (const { site } of found) counts[site] = (counts[site] ?? 0) + 1;
    expect(counts).toEqual(SITES);
  });

  test('each append names a prompt id', () => {
    expect(found.filter(({ literal }) => !namesPrompt(literal)).map(({ site }) => site)).toEqual(
      []
    );
  });

  test('planted control: an append naming no prompt is reported', () => {
    const planted = [
      'store.append({ sessionId, status: "completed", scope: { a: 1 } });',
      'store.append({ sessionId, promptId: "p", status: "working" });',
    ].join('\n');
    const literals = appendLiterals(planted);
    expect(literals).toHaveLength(2);
    expect(literals.map(namesPrompt)).toEqual([false, true]);
  });
});
