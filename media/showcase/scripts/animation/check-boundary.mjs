#!/usr/bin/env node
// The animation library's import boundary: nothing under src/library/animation/ may import the cast, the worlds, the props, the tokens,
// the radiance, the sprite or the design module. The library takes scenes and renderers as parameters; src/scenes/ does the wiring.
// Exit 1 naming file:line for every violation. A positive control runs first: a planted import in a scratch tree must trip the same check.
// usage: node scripts/animation/check-boundary.mjs [--dir <animation dir>]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXT = /\.(ts|tsx|mts|js|jsx|mjs)$/;

/** Forbidden targets, as paths relative to the directory that holds `library/` (src/). A directory forbids everything under it. */
const FORBIDDEN = ['library/cast', 'library/worlds', 'library/props', 'library/tokens', 'library/Radiance', 'library/Sprite', 'design'];

const walk = (dir) =>
  fs.readdirSync(dir, {withFileTypes: true}).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : EXT.test(e.name) ? [path.join(dir, e.name)] : []));

// from '<spec>' | import '<spec>' | import('<spec>') | require('<spec>')
const SPEC = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

/** Violations in one file: {file, line, spec, target}. Comment lines are skipped; a specifier is resolved against the file's directory. */
export const violationsIn = (file, srcDir) => {
  const out = [];
  fs.readFileSync(file, 'utf8').split('\n').forEach((text, i) => {
    const t = text.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    for (const m of text.matchAll(SPEC)) {
      const spec = m[1];
      if (!spec.startsWith('.')) continue;
      const resolved = path.relative(srcDir, path.resolve(path.dirname(file), spec)).split(path.sep).join('/');
      const hit = FORBIDDEN.find((f) => resolved === f || resolved.startsWith(`${f}/`) || resolved.startsWith(`${f}.`));
      if (hit) out.push({file, line: i + 1, spec, target: hit});
    }
  });
  return out;
};

export const checkDir = (animationDir) => {
  const srcDir = path.dirname(path.dirname(animationDir)); // <src>/library/animation -> <src>
  return walk(animationDir).flatMap((f) => violationsIn(f, srcDir));
};

const argDir = process.argv.indexOf('--dir');
const animationDir = path.resolve(argDir > -1 ? process.argv[argDir + 1] : path.join(root, 'src/library/animation'));

// positive control: a scratch tree with the same layout, one clean file and one planted import per forbidden target
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'animation-boundary-'));
const scratchAnim = path.join(scratch, 'src/library/animation');
fs.mkdirSync(scratchAnim, {recursive: true});
fs.writeFileSync(path.join(scratchAnim, 'clean.ts'), "import {sample} from './track';\nimport type {Joints} from '../motion';\nexport const x = sample;\nexport type J = Joints;\n");
const planted = ["import {Crossing} from '../worlds/Crossing';", "import {MeshFigure} from '../cast/MeshFigure';", "import {Frame} from '../props/Frame';", "import {settled} from '../tokens';", "import {Radiance} from '../Radiance';", "import {Sprite} from '../Sprite';", "import {fonts} from '../../design';", "export {contracts} from '../worlds/contracts';"];
fs.writeFileSync(path.join(scratchAnim, 'planted.ts'), planted.join('\n') + '\n');
const control = checkDir(scratchAnim);
fs.rmSync(scratch, {recursive: true, force: true});
const controlOk = control.length === planted.length && control.every((v) => v.file.endsWith('planted.ts'));
console.log(`control: ${control.length} of ${planted.length} planted imports tripped, 0 in the clean file${controlOk ? '' : ' (CONTROL FAILED: the check cannot see a violation)'}`);
if (!controlOk) process.exit(2);

const found = checkDir(animationDir);
for (const v of found) console.error(`${path.relative(root, v.file)}:${v.line}: imports "${v.spec}", which reaches ${v.target}; the animation library takes it as a parameter instead`);
console.log(`boundary: ${walk(animationDir).length} files under ${path.relative(root, animationDir)}, ${found.length} violation(s)`);
process.exit(found.length ? 1 : 0);
