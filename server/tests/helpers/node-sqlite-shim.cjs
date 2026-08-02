// Jest CJS resolver shim for node:sqlite (unflagged at Node >=22.13.0)
// Jest's module resolver strips the node: protocol prefix, causing resolution failure.
// Jest's sandbox also intercepts require() and createRequire(), so we use
// Module._load() directly to bypass Jest's module system entirely.
//
// eslint-disable-next-line no-eval
const Module = eval('require')('node:module');
const sqlite = Module._load('node:sqlite');

module.exports = {
  __esModule: true,
  DatabaseSync: sqlite.DatabaseSync,
  StatementSync: sqlite.StatementSync,
  default: sqlite,
};
