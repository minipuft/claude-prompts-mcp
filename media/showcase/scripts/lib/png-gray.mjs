import {readFileSync} from 'node:fs';
import {inflateSync} from 'node:zlib';

/** Minimal PNG reader: 8-bit grayscale, non-interlaced (what cutout.py writes for mask.png). Throws on anything else. */
export const readGrayPng = (path) => {
  const buf = readFileSync(path);
  if (buf.toString('latin1', 1, 4) !== 'PNG') throw new Error(`${path}: not a PNG`);
  let pos = 8, width = 0, height = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), type = buf.toString('latin1', pos + 4, pos + 8), body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0); height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 0 || body[12] !== 0) throw new Error(`${path}: need 8-bit grayscale non-interlaced (bit depth ${body[8]}, colour type ${body[9]}, interlace ${body[12]})`);
    } else if (type === 'IDAT') idat.push(body);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (width + 1)], row = y * (width + 1) + 1;
    for (let x = 0; x < width; x++) {
      const a = x > 0 ? data[y * width + x - 1] : 0, b = y > 0 ? data[(y - 1) * width + x] : 0, c = x > 0 && y > 0 ? data[(y - 1) * width + x - 1] : 0;
      const v = raw[row + x];
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`${path}: unknown PNG filter ${filter}`);
      data[y * width + x] = (v + pred) & 255;
    }
  }
  return {width, height, data};
};
