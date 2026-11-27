// @lifecycle canonical - Refuses a skills-sync.yaml that carries the top-level "exports" key.
/**
 * `skills-sync.yaml` selects what to export per client under `registrations`. A top-level
 * `exports` key, in any of its old shapes (`all`, a list of keys, a `user`/`project` map), selects
 * nothing any more (ledger entry `skills-sync-exports-list`). The file is never translated and
 * never rewritten: the refusal names the file and the shape to write instead.
 *
 * One function, three callers, each refusing at its own boundary: the skills-sync command loader
 * (`export`, `sync`, `diff`, `pull`, through `npm run skills:*` and `system_control`), the
 * `system_control` skills-sync status, and the server's prompt registration, which skips the file.
 * Pure: it reads a parsed document and returns text.
 */

import { retirementNotice } from './retirement-notice.js';

const REGISTRATIONS_EXAMPLE = [
  '  registrations:',
  '    claude-code:',
  '      user:',
  '        - prompt:<category>/<id>',
].join('\n');

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The refusal text for a parsed skills-sync document that carries a top-level `exports` key, or
 * `undefined` for one that does not (or for a document that is not a mapping, which its reader
 * treats as empty). The text names the file and is a complete sentence set without a prefix.
 */
export function retiredSkillsSyncExportsRefusal(
  configPath: string,
  parsed: unknown
): string | undefined {
  if (!isRecord(parsed) || !Object.hasOwn(parsed, 'exports')) return undefined;
  const notice = retirementNotice('skills-sync-exports-list');
  return [
    `${configPath} carries ${notice.retired}, which is refused since ${notice.refusedIn}.`,
    `Remove the "exports" key and use ${notice.replacement}:`,
    REGISTRATIONS_EXAMPLE,
  ].join('\n');
}
