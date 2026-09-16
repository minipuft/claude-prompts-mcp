const { REPO_ROOT, added } = require('./tree-state-guard.cjs');

/**
 * Fails the run if any suite left something in the working tree that nothing declares.
 *
 * Throwing here exits jest non-zero even when every test passed, which is the point: the leak this
 * catches is invisible to assertions because the suites that cause it are green.
 */
module.exports = function globalTeardown() {
  const result = added();

  if (result.unreadable !== null) {
    throw new Error(
      `The tree-state guard could not measure this run: ${result.unreadable}.\n` +
        'A run that cannot be shown clean is not a clean run — see ' +
        'tests/helpers/tree-state-guard.cjs.'
    );
  }

  if (result.leaked.length === 0) return;

  throw new Error(
    `${result.leaked.length} working-tree entr(ies) appeared during this run that nothing ` +
      `declares.\n\n` +
      `A suite that spawns a server must give it BOTH temp roots — createHermeticRoots() hands\n` +
      `back HOME and MCP_RUNTIME_ROOT as one object, and without the runtime root the server\n` +
      `writes runtime-state/ and logs/ into whatever it resolves as its workspace, which here is\n` +
      `the repository. A suite that mutates resources must redirect them too: MCP_RESOURCES_PATH\n` +
      `outranks MCP_WORKSPACE in PathResolver.\n\n` +
      `If a path genuinely belongs to a generator, add it to DECLARED in\n` +
      `tests/helpers/tree-state-guard.cjs WITH a reason naming that generator.\n\n` +
      `Root: ${REPO_ROOT}\n` +
      result.leaked.map((entry) => `  + ${entry}`).join('\n') +
      `\n\nThese entries are still on disk. Remove them before committing.`
  );
};
