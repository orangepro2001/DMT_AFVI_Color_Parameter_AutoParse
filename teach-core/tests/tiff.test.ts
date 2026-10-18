import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readTiffGray } from '../src/tiff.ts';

interface TiffSpec {
  little: boolean;
  width: number;
  height: number;
  rowsPerStrip: number;
  photometric: number;
  pixels: number[];
  useLongOffsets: boolean;
}

function buildTiff(spec: TiffSpec): Uint8Array {
  const { little, width, height, rowsPerStrip, photometric, pixels } = spec;
  const stripCount = Math.ceil(height / rowsPerStrip);
  const headerSize = 8;
  const ifdEntryCount = 9;
  const ifdSize = 2 + ifdEntryCount * 12 + 4;
  const extraStart = headerSize + ifdSize;
  // Extra data: strip offsets array + strip byte counts array.
  // Values whose total byte size is <= 4 are inlined in the entry value field,
  // so only the arrays that exceed 4 bytes need external storage.
  const offsetType = spec.useLongOffsets ? 4 : 3;
  const offsetElemSize = offsetType === 4 ? 4 : 2;
  const offsetsInline = stripCount * offsetElemSize <= 4;
  const countsInline = stripCount * 4 <= 4;
  const offsetsArraySize = offsetsInline ? 0 : stripCount * offsetElemSize;
  const countsArraySize = countsInline ? 0 : stripCount * 4;
  const dataStart = extraStart + offsetsArraySize + countsArraySize;
  const total = dataStart + width * height;
  const bytes = new Uint8Array(total);

  const writeU16 = (off: number, v: number): void => {
    if (little) {
      bytes[off] = v & 0xff;
      bytes[off + 1] = (v >> 8) & 0xff;
    } else {
      bytes[off] = (v >> 8) & 0xff;
      bytes[off + 1] = v & 0xff;
    }
  };
  const writeU32 = (off: number, v: number): void => {
    if (little) {
      bytes[off] = v & 0xff;
      bytes[off + 1] = (v >> 8) & 0xff;
      bytes[off + 2] = (v >> 16) & 0xff;
      bytes[off + 3] = (v >> 24) & 0xff;
    } else {
      bytes[off] = (v >> 24) & 0xff;
      bytes[off + 1] = (v >> 16) & 0xff;
      bytes[off + 2] = (v >> 8) & 0xff;
      bytes[off + 3] = v & 0xff;
    }
  };

  if (little) {
    bytes[0] = 0x49;
    bytes[1] = 0x49;
  } else {
    bytes[0] = 0x4d;
    bytes[1] = 0x4d;
  }
  writeU16(2, 42);
  writeU32(4, 8);

  writeU16(8, ifdEntryCount);

  const stripOffsets: number[] = [];
  const stripByteCounts: number[] = [];
  for (let s = 0; s < stripCount; s++) {
    const rows = Math.min(rowsPerStrip, height - s * rowsPerStrip);
    stripOffsets.push(dataStart + s * rowsPerStrip * width);
    stripByteCounts.push(rows * width);
  }

  const writeEntry = (index: number, tag: number, type: number, count: number, value: number): void => {
    const off = 10 + index * 12;
    writeU16(off, tag);
    writeU16(off + 2, type);
    writeU32(off + 4, count);
    if (type === 3 && count === 1) {
      writeU16(off + 8, value);
      writeU16(off + 10, 0);
    } else {
      writeU32(off + 8, value);
    }
  };

  const writeEntryArray = (
    index: number,
    tag: number,
    type: number,
    count: number,
    values: number[],
    externalOffset: number,
  ): void => {
    const off = 10 + index * 12;
    writeU16(off, tag);
    writeU16(off + 2, type);
    writeU32(off + 4, count);
    const elemSize = type === 4 ? 4 : 2;
    const totalBytes = count * elemSize;
    if (totalBytes <= 4) {
      // Inline: values are left-aligned in the 4-byte value field, padded with zeros.
      for (let i = 0; i < count; i++) {
        if (type === 4) writeU32(off + 8 + i * 4, values[i]);
        else writeU16(off + 8 + i * 2, values[i]);
      }
    } else {
      writeU32(off + 8, externalOffset);
      for (let i = 0; i < count; i++) {
        if (type === 4) writeU32(externalOffset + i * 4, values[i]);
        else writeU16(externalOffset + i * 2, values[i]);
      }
    }
  };

  writeEntry(0, 256, 3, 1, width);
  writeEntry(1, 257, 3, 1, height);
  writeEntry(2, 258, 3, 1, 8);
  writeEntry(3, 259, 3, 1, 1);
  writeEntry(4, 262, 3, 1, photometric);
  writeEntryArray(5, 273, offsetType, stripCount, stripOffsets, extraStart);
  writeEntry(6, 277, 3, 1, 1);
  writeEntry(7, 278, 3, 1, rowsPerStrip);
  writeEntryArray(8, 279, 4, stripCount, stripByteCounts, extraStart + offsetsArraySize);

  for (let i = 0; i < width * height; i++) {
    bytes[dataStart + i] = pixels[i];
  }
  return bytes;
}

test('readTiffGray reads little-endian multi-strip SHORT offsets', () => {
  const pixels = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const bytes = buildTiff({
    little: true,
    width: 5,
    height: 3,
    rowsPerStrip: 2,
    photometric: 1,
    pixels,
    useLongOffsets: false,
  });
  const img = readTiffGray(bytes);
  assert.equal(img.width, 5);
  assert.equal(img.height, 3);
  assert.deepEqual(Array.from(img.data), pixels);
});

test('readTiffGray reads big-endian multi-strip LONG offsets', () => {
  const pixels = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150];
  const bytes = buildTiff({
    little: false,
    width: 5,
    height: 3,
    rowsPerStrip: 2,
    photometric: 1,
    pixels,
    useLongOffsets: true,
  });
  const img = readTiffGray(bytes);
  assert.deepEqual(Array.from(img.data), pixels);
});

test('readTiffGray inverts pixels when Photometric=0', () => {
  const pixels = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  const bytes = buildTiff({
    little: true,
    width: 5,
    height: 3,
    rowsPerStrip: 3,
    photometric: 0,
    pixels,
    useLongOffsets: false,
  });
  const img = readTiffGray(bytes);
  assert.deepEqual(Array.from(img.data), pixels.map((v) => 255 - v));
});

test('readTiffGray rejects unsupported compression', () => {
  const pixels = new Array(15).fill(0);
  const bytes = buildTiff({
    little: true,
    width: 5,
    height: 3,
    rowsPerStrip: 3,
    photometric: 1,
    pixels,
    useLongOffsets: false,
  });
  // Patch Compression tag (entry index 3) value to 5
  bytes[10 + 3 * 12 + 8] = 5;
  bytes[10 + 3 * 12 + 9] = 0;
  assert.throws(() => readTiffGray(bytes), /Compression=5/);
});

test('readTiffGray rejects BigTIFF magic 43', () => {
  const bytes = new Uint8Array(16);
  bytes[0] = 0x49;
  bytes[1] = 0x49;
  bytes[2] = 43;
  bytes[3] = 0;
  assert.throws(() => readTiffGray(bytes), /BigTIFF/);
});

test('readTiffGray rejects missing StripOffsets', () => {
  const pixels = new Array(15).fill(0);
  const bytes = buildTiff({
    little: true,
    width: 5,
    height: 3,
    rowsPerStrip: 3,
    photometric: 1,
    pixels,
    useLongOffsets: false,
  });
  // Overwrite StripOffsets tag (entry index 5) with an unknown tag
  bytes[10 + 5 * 12] = 0xff;
  bytes[10 + 5 * 12 + 1] = 0xff;
  assert.throws(() => readTiffGray(bytes), /StripOffsets/);
});
