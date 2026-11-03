#!/usr/bin/env node
/**
 * Build-time mask -> mesh (D73). Reads assets/human/mask.png (8-bit grayscale PNG), runs maskToMesh over the figure's region and writes
 * assets/human/mesh.json, so a Remotion render never reads PNG pixels.
 *
 * usage: node scripts/mesh.mjs [--mask assets/human/mask.png] [--out assets/human/mesh.json]
 *                              [--region 31,30,621,952] [--simplify 1.5] [--grid 24]
 * The mask holds the whole parts sheet; the default region is the full figure (part00 in assets/human/parts.json, bbox [31,30,620,951]).
 * Node >= 22.18 strips the TypeScript types of the imported module.
 */
import {readFileSync, writeFileSync} from 'node:fs';
import {readGrayPng} from './lib/png-gray.mjs';
import {maskToMesh} from '../src/library/motion/mesh.ts';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []));
const maskPath = args.mask ?? 'assets/human/mask.png';
const outPath = args.out ?? 'assets/human/mesh.json';
const parts = JSON.parse(readFileSync('assets/human/parts.json', 'utf8')).parts;
const fig = parts.find((p) => p.id === 'part00').bbox; // [x0, y0, x1, y1] with x1, y1 as measured extents
const region = (args.region ? args.region.split(',').map(Number) : [fig[0], fig[1], fig[2] + 1, fig[3] + 1]);
const simplify = Number(args.simplify ?? 1.5);
const gridSpacing = Number(args.grid ?? 24);

const mask = readGrayPng(maskPath);
const mesh = maskToMesh(mask, {region, simplify, gridSpacing});
const round = (a, d) => Array.from(a, (v) => Math.round(v * d) / d);
writeFileSync(outPath, JSON.stringify({
  width: mask.width, height: mask.height, region, simplify, gridSpacing,
  vertices: round(mesh.vertices, 1000), triangles: Array.from(mesh.triangles), uvs: round(mesh.uvs, 1e6),
}) + '\n');
console.log(`${outPath}: ${JSON.stringify(mesh.stats)} region=${region.join(',')} simplify=${simplify} grid=${gridSpacing}`);
