// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import {
  DATATYPE_UINT64,
  OP_OPEN_SESSION,
  PROP_OBJECT_SIZE,
  TYPE_COMMAND,
} from '../../../src/bridges/mtp/codes';
import {
  decodeContainer,
  encodeCommand,
  encodeIdArray,
  encodeObjectInfo,
  encodeParams,
  encodePtpString,
  encodeUint64,
  concatBytes,
  parseIdArray,
  parseObjectInfo,
  parsePropListUint64,
  parsePtpDate,
  parseUint64,
  readPtpString,
} from '../../../src/bridges/mtp/container';

describe('MTP containers', () => {
  it('round-trips a command and rejects a short buffer', () => {
    const command = encodeCommand(OP_OPEN_SESSION, 1, [1]);
    const decoded = decodeContainer(command);
    expect(decoded).toMatchObject({ type: TYPE_COMMAND, code: OP_OPEN_SESSION, transactionId: 1 });
    expect(decodeContainer(command.subarray(0, 8))).toBeNull();
  });

  it('reads an empty PTP string and a name', () => {
    expect(readPtpString(encodePtpString(''), 0)).toEqual({ text: '', next: 1 });
    const named = readPtpString(encodePtpString('DCIM'), 0);
    expect(named.text).toBe('DCIM');
  });

  it('reads a capture date as local time unless it names a zone', () => {
    expect(parsePtpDate('20240601T120000')).toBe(new Date(2024, 5, 1, 12, 0, 0).getTime());
    expect(parsePtpDate('20240601T120000.5')).toBe(new Date(2024, 5, 1, 12, 0, 0).getTime());
    expect(parsePtpDate('20240601T120000Z')).toBe(Date.UTC(2024, 5, 1, 12, 0, 0));
    expect(parsePtpDate('20240601T120000-0700')).toBe(Date.UTC(2024, 5, 1, 19, 0, 0));
    expect(parsePtpDate('20241301T120000')).toBeNull();
    expect(parsePtpDate('20240601T120000junk')).toBeNull();
    expect(parsePtpDate('')).toBeNull();
  });

  it('parses an object-info dataset and marks a 32-bit size of 0xFFFFFFFF unknown', () => {
    const payload = encodeObjectInfo({
      storageId: 1,
      format: 0x3801,
      size: 32,
      width: 640,
      height: 480,
      parent: 2,
      name: 'a.jpg',
      created: '20240601T120000',
      modified: '20240601T120100',
    });
    const info = parseObjectInfo(payload);
    expect(info).toMatchObject({
      storageId: 1,
      format: 0x3801,
      size: 32,
      width: 640,
      height: 480,
      parent: 2,
      name: 'a.jpg',
      sizeKnown: true,
      createdAt: new Date(2024, 5, 1, 12, 0, 0).getTime(),
    });
    const big = parseObjectInfo(
      encodeObjectInfo({
        storageId: 1,
        format: 0x300d,
        size: 5 * 2 ** 30,
        width: 0,
        height: 0,
        parent: 2,
        name: 'big.mov',
        created: '',
        modified: '',
      }),
    );
    expect(big).toMatchObject({ size: 0xffff_ffff, sizeKnown: false });
  });

  it('reads ObjectSize from a property value and from a property list', () => {
    expect(parseUint64(encodeUint64(5 * 2 ** 30))).toBe(5 * 2 ** 30);
    expect(parseUint64(Uint8Array.of(1, 2))).toBeNull();
    const element = (handle: number, size: number) =>
      concatBytes([
        encodeParams([handle]),
        Uint8Array.of(PROP_OBJECT_SIZE & 0xff, PROP_OBJECT_SIZE >> 8, DATATYPE_UINT64, 0),
        encodeUint64(size),
      ]);
    const list = concatBytes([encodeParams([2]), element(7, 10), element(9, 6 * 2 ** 30)]);
    expect(parsePropListUint64(list, 9, PROP_OBJECT_SIZE)).toBe(6 * 2 ** 30);
    expect(parsePropListUint64(list, 8, PROP_OBJECT_SIZE)).toBeNull();
  });

  it('round-trips a handle array', () => {
    expect(parseIdArray(encodeIdArray([2, 9]))).toEqual([2, 9]);
  });
});
