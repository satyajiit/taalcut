// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MP4 boxes built in bytes, laid out as the real phones lay them out (LIB1-OEM; docs/media/phone-metadata.md):
 * a Galaxy Example's `udta`, an iPhone's track `keys`, the Sample Cam app's comment.
 */

/** A box: a 32-bit size, a four-character type, then its body (children or bytes). */
export function box(type: string, ...body: Buffer[]): Buffer {
  const content = Buffer.concat(body);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + content.length, 0);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, content]);
}

/** A full box: four bytes of version and flags before its body. */
export function fullBox(type: string, ...body: Buffer[]): Buffer {
  return box(type, Buffer.alloc(4), ...body);
}

const utf8 = (text: string) => Buffer.from(text, 'utf8');

function dataBox(value: string | number): Buffer {
  const head = Buffer.alloc(8);
  if (typeof value === 'number') {
    head.writeUInt32BE(23, 0); // float32, big-endian
    const float = Buffer.alloc(4);
    float.writeFloatBE(value, 0);
    return box('data', head, float);
  }
  head.writeUInt32BE(1, 0); // UTF-8
  return box('data', head, utf8(value));
}

/** A QuickTime `meta` (an `mdta` handler, `keys` and `ilst`); `full` writes it as an ISO full box. */
export function metaBox(entries: Readonly<Record<string, string | number>>, full = false): Buffer {
  const names = Object.keys(entries);
  const handler = Buffer.alloc(25);
  handler.write('mdta', 8, 'latin1');
  const count = Buffer.alloc(8);
  count.writeUInt32BE(names.length, 4);
  const keys = box('keys', count, ...names.map((name) => box('mdta', utf8(name))));
  const items = names.map((name, i) => {
    const item = box('xxxx', dataBox(entries[name]!));
    item.writeUInt32BE(i + 1, 4); // an item's type is its 1-based index into keys
    return item;
  });
  const children = [box('hdlr', handler), keys, box('ilst', ...items)];
  return full ? fullBox('meta', ...children) : box('meta', ...children);
}

/** A 3GPP text box (`auth`): version and flags, a packed language code, then the text, NUL-terminated. */
export function threeGppBox(type: string, text: string, encoding: 'utf8' | 'utf16' = 'utf8'): Buffer {
  const language = Buffer.from([0x15, 0xc7]);
  const body =
    encoding === 'utf8'
      ? Buffer.concat([utf8(text), Buffer.from([0])])
      : Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, 'utf16le').swap16()]);
  return fullBox(type, language, body);
}

/** A QuickTime international text box (`©mak`): a 16-bit length, a 16-bit language, then the text. */
export function quickTimeTextBox(type: string, text: string): Buffer {
  const head = Buffer.alloc(4);
  head.writeUInt16BE(Buffer.byteLength(text), 0);
  head.writeUInt16BE(0x15c7, 2);
  return box(type, head, utf8(text));
}

/** A track with a handler (`vide`, `soun`) and an optional `meta`. */
export function track(handler: string, meta?: Buffer): Buffer {
  const hdlr = Buffer.alloc(24);
  hdlr.write(handler, 8, 'latin1');
  return box('trak', box('mdia', box('hdlr', hdlr)), ...(meta ? [meta] : []));
}

/** A Galaxy Example's `udta` as its camera writes it (20260314_113000.mp4's layout, with its values). */
export function samsungUserData(): Buffer {
  return box(
    'udta',
    box('SDLN', utf8('SEQ_PLAY')),
    box('smrd', utf8('TRUEBLUE')),
    threeGppBox('auth', 'Galaxy Example'),
    fullBox('smta', box('saut', Buffer.alloc(6)), box('mdln', utf8('SM-X000Z'))),
    box('cami', Buffer.alloc(4), utf8('36, 2, 1024, 1579, 2.0')),
  );
}
