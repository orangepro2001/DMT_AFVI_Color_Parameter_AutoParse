import type { GrayImage } from './gray.ts';

interface IfdEntry {
  tag: number;
  type: number;
  count: number;
  valueOffset: number;
  inlineValue: number;
}

const TYPE_SIZES: Record<number, number> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL
};

function readUint16(bytes: Uint8Array, offset: number, little: boolean): number {
  if (little) return bytes[offset] | (bytes[offset + 1] << 8);
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function readUint32(bytes: Uint8Array, offset: number, little: boolean): number {
  if (little) {
    return (
      (bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] << 24)) >>>
      0
    );
  }
  return (
    ((bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]) >>>
    0
  );
}

function readValues(bytes: Uint8Array, entry: IfdEntry, little: boolean): number[] {
  const size = TYPE_SIZES[entry.type];
  if (size === undefined) {
    throw new Error(`Unsupported TIFF: field type ${entry.type} for tag ${entry.tag}`);
  }
  const total = size * entry.count;
  const base = total <= 4 ? entry.valueOffset : entry.inlineValue;
  const out: number[] = [];
  for (let i = 0; i < entry.count; i++) {
    const off = base + i * size;
    if (entry.type === 3) out.push(readUint16(bytes, off, little));
    else if (entry.type === 4) out.push(readUint32(bytes, off, little));
    else out.push(bytes[off]);
  }
  return out;
}

export function readTiffGray(bytes: Uint8Array): GrayImage {
  if (bytes.length < 8) throw new Error('Unsupported TIFF: file too small');
  const b0 = bytes[0];
  const b1 = bytes[1];
  let little: boolean;
  if (b0 === 0x49 && b1 === 0x49) little = true;
  else if (b0 === 0x4d && b1 === 0x4d) little = false;
  else throw new Error('Unsupported TIFF: bad byte order marker');

  const magic = readUint16(bytes, 2, little);
  if (magic === 43) throw new Error('Unsupported TIFF: BigTIFF (magic 43) is not supported');
  if (magic !== 42) throw new Error(`Unsupported TIFF: bad magic ${magic} (only 42 is supported)`);

  const ifdOffset = readUint32(bytes, 4, little);
  if (ifdOffset + 2 > bytes.length) throw new Error('Unsupported TIFF: IFD offset out of range');
  const entryCount = readUint16(bytes, ifdOffset, little);
  const entries = new Map<number, IfdEntry>();
  for (let i = 0; i < entryCount; i++) {
    const off = ifdOffset + 2 + i * 12;
    if (off + 12 > bytes.length) throw new Error('Unsupported TIFF: IFD entry out of range');
    const tag = readUint16(bytes, off, little);
    const type = readUint16(bytes, off + 2, little);
    const count = readUint32(bytes, off + 4, little);
    const valueOffset = off + 8;
    const inlineValue = readUint32(bytes, off + 8, little);
    entries.set(tag, { tag, type, count, valueOffset, inlineValue });
  }

  const getFirst = (tag: number): number | undefined => {
    const entry = entries.get(tag);
    if (!entry) return undefined;
    const values = readValues(bytes, entry, little);
    return values.length > 0 ? values[0] : undefined;
  };

  if (entries.has(322)) throw new Error('Unsupported TIFF: tiled images (TileWidth 322) are not supported');

  const width = getFirst(256);
  const height = getFirst(257);
  if (width === undefined || height === undefined) {
    throw new Error('Unsupported TIFF: missing ImageWidth(256) or ImageLength(257)');
  }

  const bitsPerSample = getFirst(258) ?? 8;
  if (bitsPerSample !== 8) {
    throw new Error(`Unsupported TIFF: BitsPerSample=${bitsPerSample} (only 8 is supported)`);
  }
  const samplesPerPixel = getFirst(277) ?? 1;
  if (samplesPerPixel !== 1) {
    throw new Error(`Unsupported TIFF: SamplesPerPixel=${samplesPerPixel} (only 1 is supported)`);
  }
  const compression = getFirst(259) ?? 1;
  if (compression !== 1) {
    throw new Error(`Unsupported TIFF: Compression=${compression} (only 1 is supported)`);
  }
  const planar = getFirst(284) ?? 1;
  if (planar !== 1) {
    throw new Error(`Unsupported TIFF: PlanarConfiguration=${planar} (only 1 is supported)`);
  }
  const photometric = getFirst(262) ?? 1;
  if (photometric !== 0 && photometric !== 1) {
    throw new Error(`Unsupported TIFF: Photometric=${photometric} (only 0 and 1 are supported)`);
  }

  const stripOffsetsEntry = entries.get(273);
  if (!stripOffsetsEntry) throw new Error('Unsupported TIFF: missing StripOffsets(273)');
  const stripOffsets = readValues(bytes, stripOffsetsEntry, little);
  const stripByteCountsEntry = entries.get(279);
  if (!stripByteCountsEntry) throw new Error('Unsupported TIFF: missing StripByteCounts(279)');
  const stripByteCounts = readValues(bytes, stripByteCountsEntry, little);
  const rowsPerStrip = getFirst(278) ?? height;

  const data = new Uint8Array(width * height);
  let row = 0;
  for (let s = 0; s < stripOffsets.length; s++) {
    const offset = stripOffsets[s];
    const count = stripByteCounts[s] ?? 0;
    if (offset + count > bytes.length) {
      throw new Error(`Unsupported TIFF: strip ${s} out of range (offset=${offset}, count=${count})`);
    }
    const rows = Math.min(rowsPerStrip, height - row);
    const needed = rows * width;
    if (count < needed) {
      throw new Error(`Unsupported TIFF: strip ${s} too small (count=${count}, needed=${needed})`);
    }
    for (let i = 0; i < needed; i++) {
      const v = bytes[offset + i];
      data[row * width + i] = photometric === 0 ? 255 - v : v;
    }
    row += rows;
    if (row >= height) break;
  }
  if (row < height) {
    throw new Error(`Unsupported TIFF: strips cover ${row} of ${height} rows`);
  }
  return { width, height, data };
}
