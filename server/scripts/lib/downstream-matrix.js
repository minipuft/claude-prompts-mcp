/**
 * One parse of `extension-publish.yml`'s downstream sync matrix, for every check that needs it.
 *
 * The matrix is the SSOT for WHO gets synced on a release. Two checks now read it —
 * `validate-release-workflow.js` (is each entry's merge contract explicit) and
 * `verify-downstream-sync.js` (did each entry actually land the release) — and a second copy of
 * this parser would be a second thing to update when a downstream is added, with nothing
 * reporting the divergence. `scripts/render-targets.json` deliberately does NOT serve this role:
 * it enumerates DISTRIBUTION targets and omits `minipuft-plugins` (a listing, not a
 * distribution) and `codex-prompts`, so reading it here would silently audit three of five.
 *
 * `name` is parsed alongside `repo` because it selects the probe: the marketplace entry carries a
 * literal version, the npm consumers carry a resolved lock version, and those are read from
 * different files. A parser that dropped `name` would force the caller to re-derive the mapping
 * from the repo slug, which is exactly the hardcoded second list this module exists to prevent.
 */

/**
 * @param {string} source Raw `extension-publish.yml` contents.
 * @returns {Array<{repo: string, name?: string, mergeMode?: string}>} Entries in matrix order.
 */
export function parseDownstreamMatrix(source) {
  const matrixStart = source.indexOf('      matrix:\n');
  const stepsStart = source.indexOf('    steps:\n', matrixStart);
  if (matrixStart === -1 || stepsStart === -1) return [];
  const matrix = source.slice(matrixStart, stepsStart);
  const entries = [];
  let current;
  for (const line of matrix.split(/\r?\n/)) {
    const repo = line.match(/^\s+- repo:\s*(\S+)\s*$/);
    if (repo) {
      current = { repo: repo[1] };
      entries.push(current);
      continue;
    }
    if (!current) continue;
    const name = line.match(/^\s+name:\s*(\S+)\s*$/);
    if (name) {
      current.name = name[1];
      continue;
    }
    const mode = line.match(/^\s+merge_mode:\s*(\S+)\s*$/);
    if (mode) current.mergeMode = mode[1];
  }
  return entries;
}
