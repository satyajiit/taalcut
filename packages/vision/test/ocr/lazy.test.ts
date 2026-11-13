// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * lazyOcrEngine: nothing is made until the first call; a failed make answers
 * with its error and is tried again next time; a made engine is kept until
 * close, which closes it.
 */
import { err, ok } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { OcrUnavailable } from '../../src/errors';
import { lazyOcrEngine } from '../../src/ocr/lazy';
import type { OcrEngine } from '../../src/ocr/types';

function engine(closed: string[]): OcrEngine {
  return {
    capabilities: async () => ok({ scripts: ['devanagari'], languages: ['hi'] }),
    recognize: async (frames) => ok(frames.map((frame) => ({ frame: frame.index, observations: [] }))),
    close: async () => {
      closed.push('closed');
    },
  };
}

describe('lazyOcrEngine', () => {
  it('makes on first use, retries a failed make, keeps a made engine and closes it', async () => {
    const closed: string[] = [];
    let makes = 0;
    const lazy = lazyOcrEngine(async () => {
      makes++;
      return makes === 1
        ? err(OcrUnavailable({ language: 'hi' }, { detail: 'not installed' }))
        : ok(engine(closed));
    }, 'hi');
    expect(makes).toBe(0);

    const first = await lazy.capabilities();
    expect(!first.ok && first.error).toMatchObject({
      code: 'vision.ocr_unavailable',
      detail: 'not installed',
    });
    expect(await lazy.capabilities()).toEqual({
      ok: true,
      value: { scripts: ['devanagari'], languages: ['hi'] },
    });
    const frame = { index: 7, width: 1, height: 1, rgb: new Uint8Array(3) };
    expect(await lazy.recognize([frame], { languages: ['hi'] })).toEqual({
      ok: true,
      value: [{ frame: 7, observations: [] }],
    });
    expect(makes).toBe(2);

    await lazy.close?.();
    expect(closed).toEqual(['closed']);
    await lazy.capabilities();
    expect(makes).toBe(3);
  });
});
