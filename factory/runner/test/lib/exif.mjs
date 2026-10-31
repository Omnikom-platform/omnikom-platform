// Test helpers for the media runner, no dependency of their own: the EXIF bytes of a phone photo (Orientation 6 and a GPS block)
// written by hand, the insertion into a JPEG, and a reader of the chunks of a WebP file.

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const entry = (tag, type, count, valueOrOffset) => Buffer.concat([u16(tag), u16(type), u32(count), valueOrOffset]);
const rationals = (list) => Buffer.concat(list.flatMap(([n, d]) => [u32(n), u32(d)]));

// TIFF block (little endian): IFD0 { Orientation = <orientation>, GPSInfo -> GPS IFD }, GPS IFD { N, 40 deg 42 min 46 s; E, 74 deg 0 min 21 s }
export function gpsTiff(orientation = 6) {
  const IFD0 = 8, GPS = IFD0 + 2 + 2 * 12 + 4, LAT = GPS + 2 + 4 * 12 + 4, LON = LAT + 24;
  const ifd0 = Buffer.concat([u16(2), entry(0x0112, 3, 1, Buffer.concat([u16(orientation), u16(0)])), entry(0x8825, 4, 1, u32(GPS)), u32(0)]);
  const gps = Buffer.concat([u16(4),
    entry(0x0001, 2, 2, Buffer.from('N\0\0\0', 'latin1')), entry(0x0002, 5, 3, u32(LAT)),
    entry(0x0003, 2, 2, Buffer.from('E\0\0\0', 'latin1')), entry(0x0004, 5, 3, u32(LON)), u32(0)]);
  const header = Buffer.concat([Buffer.from('II', 'latin1'), u16(0x2a), u32(IFD0)]);
  return Buffer.concat([header, ifd0, gps, rationals([[40, 1], [42, 1], [46, 1]]), rationals([[74, 1], [0, 1], [21, 1]])]);
}

// Inserts an APP1 Exif segment right after the SOI marker of a JPEG.
export function withExif(jpeg, tiff) {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('not a JPEG');
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const seg = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([(payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload]);
  return Buffer.concat([jpeg.subarray(0, 2), seg, jpeg.subarray(2)]);
}

// the 24 bytes of the latitude (40 deg 42 min 46 s) as they sit in the GPS block: present in the input, absent from every output
export const GPS_BYTES = rationals([[40, 1], [42, 1], [46, 1]]);

// The four-character chunk names of a WebP (RIFF) file, in order.
export function webpChunks(buf) {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') throw new Error('not a WebP file');
  const names = [];
  for (let i = 12; i + 8 <= buf.length;) {
    const size = buf.readUInt32LE(i + 4);
    names.push(buf.toString('latin1', i, i + 4));
    i += 8 + size + (size & 1);
  }
  return names;
}

// Pixel width and height from the VP8 / VP8L / VP8X chunk of a WebP.
export function webpSize(buf) {
  const kind = buf.toString('latin1', 12, 16);
  if (kind === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  if (kind === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
  throw new Error('unknown WebP chunk ' + kind);
}
