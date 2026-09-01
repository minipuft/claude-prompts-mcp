const { capture } = require('./package-resources-guard.cjs');

/** Records the package resource tree before any suite runs. See package-resources-guard.cjs. */
module.exports = function globalSetup() {
  capture();
};
