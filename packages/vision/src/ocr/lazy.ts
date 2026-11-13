// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * An OCR engine made on first use: the composition root can wire engines
 * whose pieces aren't there yet (the helper resolved and started, a
 * component installed later). A failed make is tried again next time.
 */
import { err, ok, type AsyncResult } from '@taalcut/core';
import { OcrUnavailable } from '../errors';
import type { OcrEngine } from './types';

export function lazyOcrEngine(make: () => AsyncResult<OcrEngine>, language = 'und'): OcrEngine {
  let engine: Promise<OcrEngine | null> | undefined;
  let failure = OcrUnavailable({ language });
  const get = async (): Promise<OcrEngine | null> => {
    engine ??= make().then((made) => {
      if (made.ok) return made.value;
      failure = made.error;
      engine = undefined;
      return null;
    });
    return engine;
  };
  return {
    async capabilities() {
      const current = await get();
      return current ? current.capabilities() : err(failure);
    },
    async recognize(frames, options) {
      const current = await get();
      return current ? current.recognize(frames, options) : err(failure);
    },
    async warm() {
      const current = await get();
      if (!current) return err(failure);
      return current.warm ? current.warm() : ok(null);
    },
    async close() {
      const current = await engine;
      engine = undefined;
      await current?.close?.();
    },
  };
}
