const { capture } = require('./tree-state-guard.cjs');

/** Records the working tree before any suite runs. See tree-state-guard.cjs. */
module.exports = function globalSetup() {
  capture();
};
