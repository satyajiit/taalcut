// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Splits a raw or JPEG stdout stream into one buffer per frame. */

export function splitRaw(bytesPerFrame: number, onFrame: (data: Buffer) => void): (chunk: Buffer) => void {
  let pending: Buffer = Buffer.alloc(0);
  return (chunk) => {
    pending = pending.length === 0 ? Buffer.from(chunk) : Buffer.concat([pending, chunk]);
    while (bytesPerFrame > 0 && pending.length >= bytesPerFrame) {
      onFrame(Buffer.from(pending.subarray(0, bytesPerFrame)));
      pending = Buffer.from(pending.subarray(bytesPerFrame));
    }
  };
}

export function splitJpeg(onFrame: (data: Buffer) => void): (chunk: Buffer) => void {
  let pending: Buffer = Buffer.alloc(0);
  const startMark = Buffer.from([0xff, 0xd8]);
  const endMark = Buffer.from([0xff, 0xd9]);
  return (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    for (;;) {
      const start = pending.indexOf(startMark);
      if (start < 0) {
        pending = Buffer.alloc(0);
        return;
      }
      const end = pending.indexOf(endMark, start + 2);
      if (end < 0) {
        pending = Buffer.from(pending.subarray(start));
        return;
      }
      onFrame(Buffer.from(pending.subarray(start, end + 2)));
      pending = Buffer.from(pending.subarray(end + 2));
    }
  };
}
