// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A HEIC still from one HEVC frame (Annex B, as `ffmpeg -f hevc` writes it), for a machine without macOS's `sips`
 * (LNX1-PKG). HEIF is ISO BMFF. The image is one `hvc1` item: `ftyp` (heic, mif1), then `meta` with `hdlr` pict,
 * `pitm`, `iinf`/`infe`, `iloc` pointing into `mdat`, and `iprp` holding the item's `hvcC` (its parameter sets) and
 * `ispe` (its size). `mdat` holds the frame's slices, each with a 4-byte length. Measured: the bundled ffprobe reads
 * it as HEVC Main at its size, FFmpeg decodes it, and libheif 1.17 reads and decodes it too.
 */

function box(type: string, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length, 0);
  header.write(type, 4, 'ascii');
  return Buffer.concat([header, body]);
}

function fullBox(type: string, version: number, ...parts: Buffer[]): Buffer {
  return box(type, Buffer.from([version, 0, 0, 0]), ...parts);
}

const u16 = (value: number) => {
  const out = Buffer.alloc(2);
  out.writeUInt16BE(value, 0);
  return out;
};
const u32 = (value: number) => {
  const out = Buffer.alloc(4);
  out.writeUInt32BE(value, 0);
  return out;
};

/** The NAL units of an Annex B stream, without their start codes (or trailing zero bytes). */
function nalUnits(annexB: Buffer): Buffer[] {
  const starts: number[] = [];
  for (let i = 0; i + 3 <= annexB.length; i++)
    if (annexB[i] === 0 && annexB[i + 1] === 0 && annexB[i + 2] === 1) starts.push((i += 2) + 1);
  return starts.map((start, k) => {
    let end = k + 1 < starts.length ? starts[k + 1]! - 3 : annexB.length;
    while (end > start && annexB[end - 1] === 0) end -= 1;
    return annexB.subarray(start, end);
  });
}

/** A NAL unit's payload without its emulation-prevention bytes (00 00 03 → 00 00). */
function rbsp(nal: Buffer): Buffer {
  const out: number[] = [];
  for (let i = 0; i < nal.length; i++) {
    if (i >= 2 && nal[i] === 3 && nal[i - 1] === 0 && nal[i - 2] === 0) continue;
    out.push(nal[i]!);
  }
  return Buffer.from(out);
}

const VPS = 32;
const SPS = 33;
const PPS = 34;
const nalType = (nal: Buffer) => (nal[0]! >> 1) & 0x3f;

/**
 * The HEVCDecoderConfigurationRecord for 8-bit 4:2:0: the profile, tier and level are the SPS's (the 12 bytes after
 * its NAL header and first byte), then the parameter sets, each NAL with a 2-byte length.
 */
function hvcC(units: readonly Buffer[]): Buffer {
  const sps = units.find((nal) => nalType(nal) === SPS);
  if (!sps) throw new Error('the HEVC frame has no SPS');
  const profileTierLevel = rbsp(sps).subarray(3, 15);
  const fixed = Buffer.from([
    0xf0,
    0x00, // reserved, min_spatial_segmentation_idc 0
    0xfc, // reserved, parallelismType 0
    0xfd, // reserved, chroma_format_idc 1 (4:2:0)
    0xf8,
    0xf8, // reserved, bit depths 8
    0x00,
    0x00, // avgFrameRate unknown
    0x0f, // constantFrameRate 0, one temporal layer, nested, 4-byte NAL lengths
  ]);
  const arrays = [VPS, SPS, PPS].map((type) => {
    const list = units.filter((nal) => nalType(nal) === type);
    return Buffer.concat([
      Buffer.from([0x80 | type]),
      u16(list.length),
      ...list.flatMap((nal) => [u16(nal.length), nal]),
    ]);
  });
  return box('hvcC', Buffer.from([1]), profileTierLevel, fixed, Buffer.from([arrays.length]), ...arrays);
}

/** A `width` × `height` HEIC whose one image is the HEVC frame in `annexB`. */
export function heicFromHevc(annexB: Buffer, width: number, height: number): Buffer {
  const units = nalUnits(annexB);
  const slices = units.filter((nal) => nalType(nal) < VPS);
  if (slices.length === 0) throw new Error('the HEVC stream has no picture');
  const data = Buffer.concat(slices.flatMap((nal) => [u32(nal.length), nal]));
  const ftyp = box('ftyp', Buffer.from('heic', 'ascii'), u32(0), Buffer.from('mif1heic', 'ascii'));
  const properties = box(
    'iprp',
    box('ipco', hvcC(units), fullBox('ispe', 0, u32(width), u32(height))),
    // Item 1: property 1 (hvcC, essential) and 2 (ispe).
    fullBox('ipma', 0, u32(1), u16(1), Buffer.from([2, 0x81, 0x02])),
  );
  const meta = (dataOffset: number) =>
    fullBox(
      'meta',
      0,
      fullBox('hdlr', 0, u32(0), Buffer.from('pict', 'ascii'), Buffer.alloc(12), Buffer.from([0])),
      fullBox('pitm', 0, u16(1)),
      // 4-byte offsets and lengths, no base offset: item 1, one extent in this file.
      fullBox(
        'iloc',
        0,
        Buffer.from([0x44, 0x00]),
        u16(1),
        u16(1),
        u16(0),
        u16(1),
        u32(dataOffset),
        u32(data.length),
      ),
      fullBox(
        'iinf',
        0,
        u16(1),
        fullBox('infe', 2, u16(1), u16(0), Buffer.from('hvc1', 'ascii'), Buffer.from([0])),
      ),
      properties,
    );
  const dataOffset = ftyp.length + meta(0).length + 8;
  return Buffer.concat([ftyp, meta(dataOffset), box('mdat', data)]);
}
