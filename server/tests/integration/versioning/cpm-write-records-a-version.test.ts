// @lifecycle test - Every cpm command that writes a resource is classified against what it records.
/**
 * The class, not the site.
 *
 * `cpm rollback` now records the state its write produced. The SHAPE of the defect it closed is
 * "a `cpm` command writes a resource file and no version row describes what the files became", and
 * that shape has more members than the one this slice fixed. This file enumerates them from the
 * command REGISTRY — `COMMANDS` in `cli/src/cli.ts`, resolved through the dispatch and the import
 * list to a module — so a new command that starts writing resources is a finding here rather than
 * an omission nobody notices.
 *
 * Each writing command must be in exactly one table below. `RECORDS_A_VERSION` is the closed half.
 * `HISTORY_HANDLED_WITHOUT_A_VERSION` is the half where recording one would be wrong, with the
 * reason. `CANNOT_RECORD_YET` is the open half, and every entry carries an as-of date and the
 * observation that flips it, because an unstamped `☐` disclaims work that may already have shipped.
 *
 * **Both polarities are checked.** A command in `CANNOT_RECORD_YET` that HAS started recording
 * fails here too — an exception whose condition no longer holds is a finding, not a pass.
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../cli/src');

/**
 * Calling any of these from a command means that command WRITES A RESOURCE.
 *
 * Function names rather than `fs` verbs alone, because `cpm config` and `cpm enable` write a file
 * too and neither writes a resource — the question this file asks is about resource state, which
 * `version_history` records, not about every byte the CLI puts on disk.
 */
const RESOURCE_WRITERS = [
  'createResourceDir',
  'deleteResource',
  'deleteResourceDir',
  'renameResource',
  'movePromptCategory',
  'toggleEnabled',
  'linkGate',
  'initWorkspace',
  'serializeYamlPreservingSource',
];

/** Calling any of these means the command records a version row for what it produced. */
const VERSION_RECORDERS = ['rollbackVersion', 'saveVersion', 'recordEditResult'];

/** The closed half: writes a resource AND records what the write produced. */
const RECORDS_A_VERSION = ['rollback'];

/** Writes a resource, and a version row would be wrong rather than missing. */
const HISTORY_HANDLED_WITHOUT_A_VERSION: Record<string, string> = {
  delete:
    'deleteResource purges the resource subtree from version_history — there is no state left ' +
    'for a row to describe.',
  rename:
    'renameHistoryResource re-keys the existing rows onto the new id. The bytes do not change, ' +
    'only the id field and the directory name, so a new row would record the state that is ' +
    'already the newest one.',
  move:
    "movePromptCategory changes the prompt's `category` field and moves its directory. Its " +
    'history key is its id, which a category move does not change (the function refuses an id ' +
    'containing a slash), so there is nothing to re-key and nothing new to record.',
  init: 'initWorkspace creates a workspace from nothing — there is no prior state to bridge.',
};

/**
 * Writes a resource, records nothing, and CANNOT until a second projection stops being the only
 * way to express what it produced.
 *
 * Every entry names the same blocker, measured 2026-09-21 and stated once here:
 *
 *   A version row's `snapshot` is a `SnapshotContract` projection. All four contracts live under
 *   `src/mcp/tools/**` (`gate-snapshot-contract.ts`, `framework-snapshot-contract.ts`,
 *   `category-snapshot-contract.ts`, and `promptSnapshotContract` in
 *   `prompt-versioning-processor.ts`). `cli-shared/` may not reach `src/mcp/` —
 *   `.dependency-cruiser.cjs` rule `cli-shared-no-runtime`, severity error, `reachable: true` —
 *   and `cli/src` cannot resolve them either: `cli/tsconfig.json` and `cli/esbuild.config.mjs`
 *   alias `@cli-shared`, `@shared`, `@engine` and `@modules`, and no `@mcp`. Measured by planting
 *   the import in `cli-shared/checkpointed-write.ts`: `validate:arch` went from 0 errors to 48
 *   `cli-shared-no-runtime` violations.
 *
 *   The second half is not an import at all. `project(id, live)` takes the server's LOADED model —
 *   a gate's `live.getGuidance()` inlines the body of `guidanceFile`, and a prompt's
 *   `userMessageTemplate` is the resolved template, not the `userMessageTemplateFile` pointer a
 *   raw YAML read returns. `cpm` runs no loader that produces either.
 *
 * Writing a CLI-side projection instead is the defect this slice exists to remove, and `cpm`
 * already has one: `cli/src/commands/rollback.ts` passes `loadYamlFileSync(...)` — the raw YAML
 * map — as the prior-state snapshot, so a gate's `cpm`-written row carries `severity` and
 * `guidanceFile` where the server's carries `guidance` holding the markdown body. That is why
 * every `cpm rollback` of a server-written resource bridges.
 */
const CANNOT_RECORD_YET: Record<string, { asOf: string; flipsWhen: string }> = {
  'link-gate': {
    asOf: '2026-09-21',
    flipsWhen:
      'a prompt projection the CLI can build reaches `cli-shared/` — either the contract moves ' +
      'out of `src/mcp/tools/` into a layer `cli-shared` may import, or the CLI gains a loader ' +
      'that resolves `userMessageTemplateFile`/`systemMessageFile` the way the server does.',
  },
  toggle: {
    asOf: '2026-09-21',
    flipsWhen:
      'the same projection reaches `cli-shared/` — `toggle` edits gates and frameworks too.',
  },
  create: {
    asOf: '2026-09-21',
    flipsWhen:
      'the same projection reaches `cli-shared/`. The server records a created resource as ' +
      'version 1, so this one needs the produced projection and no prior-state row.',
  },
};

/** The registry, the dispatch and the import list — read, never restated. */
function commandModules(): Map<string, string> {
  const cli = readFileSync(path.join(CLI_SRC, 'cli.ts'), 'utf8');

  const registry = /const COMMANDS = \[([^\]]*)\] as const;/.exec(cli);
  if (registry === null) throw new Error('COMMANDS registry not found in cli/src/cli.ts');
  const names = [...registry[1]!.matchAll(/'([^']+)'/g)].map((match) => match[1]!);

  const handlerModule = new Map<string, string>();
  for (const match of cli.matchAll(/import \{ ([^}]+) \} from '\.\/commands\/([\w-]+)\.js';/g)) {
    for (const symbol of match[1]!.split(',')) {
      handlerModule.set(symbol.trim(), match[2]!);
    }
  }

  const resolved = new Map<string, string>();
  for (const name of names) {
    const dispatched = new RegExp(`case '${name}':\\s*\\n\\s*exitCode = await (\\w+)\\(`).exec(cli);
    if (dispatched === null) throw new Error(`command '${name}' has no dispatch in cli.ts`);
    const module = handlerModule.get(dispatched[1]!);
    if (module === undefined) {
      throw new Error(`handler '${dispatched[1]!}' for '${name}' is not imported from ./commands/`);
    }
    resolved.set(name, module);
  }
  return resolved;
}

const calls = (source: string, names: string[]): string[] =>
  names.filter((name) => new RegExp(`(^|[^\\w.])${name}\\s*\\(`, 'm').test(source));

describe('every cpm command that writes a resource is classified against what it records', () => {
  const modules = commandModules();
  const sourceOf = new Map(
    [...new Set(modules.values())].map((module) => [
      module,
      readFileSync(path.join(CLI_SRC, 'commands', `${module}.ts`), 'utf8'),
    ])
  );

  it('resolves every registered command to a module — the control for the enumeration', () => {
    // An absence below is only evidence once this has been shown to find something. If the
    // registry, the dispatch or the import list changes shape, `commandModules()` throws above
    // rather than quietly resolving nothing and passing every assertion vacuously.
    expect(modules.size).toBeGreaterThanOrEqual(15);
    expect(modules.get('rollback')).toBe('rollback');
    expect(modules.get('enable')).toBe('enable-disable');
  });

  it('classifies every writing command, and only writing commands', () => {
    const unclassified: string[] = [];
    const misclassified: string[] = [];
    let writers = 0;

    for (const [name, module] of modules) {
      const source = sourceOf.get(module)!;
      const writes = calls(source, RESOURCE_WRITERS).length > 0;
      const classified =
        RECORDS_A_VERSION.includes(name) ||
        name in HISTORY_HANDLED_WITHOUT_A_VERSION ||
        name in CANNOT_RECORD_YET;

      if (writes) writers += 1;
      if (writes && !classified) {
        unclassified.push(`${name} (${module}.ts) writes a resource and is in no table`);
      }
      if (!writes && classified) {
        misclassified.push(`${name} (${module}.ts) is classified but writes no resource`);
      }
    }

    expect(writers).toBeGreaterThan(0);
    expect(unclassified).toEqual([]);
    // The reverse direction, so the tables cannot outlive what they describe: a command that
    // stops writing resources must leave its table rather than sit there as a satisfied exception.
    expect(misclassified).toEqual([]);
  });

  it('has every command in RECORDS_A_VERSION actually recording one', () => {
    for (const name of RECORDS_A_VERSION) {
      const source = sourceOf.get(modules.get(name)!)!;
      expect(calls(source, VERSION_RECORDERS).length).toBeGreaterThan(0);
    }
  });

  it('has every CANNOT_RECORD_YET entry still unable to — a satisfied exception is a finding', () => {
    const satisfied: string[] = [];
    for (const [name, marker] of Object.entries(CANNOT_RECORD_YET)) {
      // Both halves stamped: a `☐` with no as-of date and no falsifier is not actionable.
      expect(marker.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(marker.flipsWhen.length).toBeGreaterThan(30);

      const source = sourceOf.get(modules.get(name)!)!;
      if (calls(source, VERSION_RECORDERS).length > 0) {
        satisfied.push(`${name} now records a version — move it to RECORDS_A_VERSION`);
      }
    }
    expect(satisfied).toEqual([]);
  });

  it('detects a planted writer that records nothing — the probe sees something', () => {
    // The positive control for `calls()`, which every assertion above rests on. Two sources
    // differing in ONE identifier: the writer is present in both, the recorder in only one.
    const writesOnly = `import { linkGate } from '@cli-shared/index.js';\nlinkGate(file, id);\n`;
    const writesAndRecords = `${writesOnly}saveVersion(dir, ref, id, snapshot);\n`;

    expect(calls(writesOnly, RESOURCE_WRITERS)).toEqual(['linkGate']);
    expect(calls(writesOnly, VERSION_RECORDERS)).toEqual([]);
    expect(calls(writesAndRecords, VERSION_RECORDERS)).toEqual(['saveVersion']);
    // An IMPORT is not a call: the name appearing in an import list must not answer for a call
    // site, or deleting the only call while leaving the import behind reads as coverage.
    expect(calls(`import { saveVersion } from 'x';\n`, VERSION_RECORDERS)).toEqual([]);
  });
});
