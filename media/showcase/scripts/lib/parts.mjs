// The parts of a plate family (row 6.9): assets/<actor>/families/<family>/parts/parts.json and what it names. `loadParts` refuses parts cut from a plate that has since changed,
// and files that no longer match the hashes cut-parts.mjs recorded, so a family whose plate moved cannot be drawn with stale parts.
import fs from 'node:fs';
import path from 'node:path';
import {familiesDir, sha256} from './families.mjs';

/** {dir, meta, file}: `file` is parts.json parsed for src/library/motion/partsRig.ts (`parseParts`); the pictures and the meshes are verified against the hashes cut-parts.mjs recorded. */
export const loadParts = (root, actor, family) => {
  const dir = path.join(familiesDir(root, actor), family, 'parts');
  const metaPath = path.join(dir, 'parts.json');
  if (!fs.existsSync(metaPath)) throw new Error(`parts ${actor}/${family}: ${path.relative(root, metaPath)} does not exist; run \`npm run parts\``);
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const plate = path.join(familiesDir(root, actor), family, 'plate.png');
  if (sha256(plate) !== meta.plateSha256) throw new Error(`parts ${actor}/${family}: the family plate changed since the parts were cut; run \`npm run parts\``);
  if (sha256(path.join(dir, meta.owners)) !== meta.ownersSha256) throw new Error(`parts ${actor}/${family}: ${meta.owners} no longer matches its hash`);
  for (const p of meta.parts) for (const k of ['png', 'ramp']) if (sha256(path.join(dir, p[k])) !== p.sha256[k]) throw new Error(`parts ${actor}/${family}: ${p[k]} no longer matches its hash; run \`npm run parts\``);
  return {dir, file: meta};
};
