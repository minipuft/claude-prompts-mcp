const { PACKAGE_RESOURCES, added } = require('./package-resources-guard.cjs');

/**
 * Fails the run if any suite added a file to the package resource tree.
 *
 * Throwing here exits jest non-zero even when every test passed, which is the point: the leak this
 * catches is invisible to assertions because the suites that cause it are green.
 */
module.exports = function globalTeardown() {
  const leaked = added();
  if (leaked.length === 0) return;

  throw new Error(
    `${leaked.length} file(s) were written into the PACKAGE resource tree during this run.\n` +
      `A suite that mutates resources must redirect them to a temp workspace — pass\n` +
      `MCP_WORKSPACE (or MCP_RESOURCES_PATH) in the spawn helper's \`env\`, and remember that\n` +
      `MCP_RESOURCES_PATH outranks MCP_WORKSPACE in PathResolver.\n\n` +
      `Root: ${PACKAGE_RESOURCES}\n` +
      leaked.map((entry) => `  + ${entry}`).join('\n') +
      `\n\nThese files are still on disk. Remove them before committing.`
  );
};
