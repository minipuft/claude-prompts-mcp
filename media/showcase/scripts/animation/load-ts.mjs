// Loads a TypeScript module of this project in plain node by bundling it with the esbuild already in node_modules (no new dependency).
// Used by the animation scripts so they read the same functions the compositions run.
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const loadTs = async (relPath) => {
  const result = await build({entryPoints: [path.join(root, relPath)], bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error', loader: {'.json': 'json'}});
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
};
