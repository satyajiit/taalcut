// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { CoverImageInput, TaalcutError } from '@taalcut/core';
import { useEffect, useRef, useState } from 'react';
import { useCardData } from './card-data';

/** Coalesces draft changes; a late image never replaces a newer requested design. */
export function useCoverImage(input: CoverImageInput) {
  const { coverImage } = useCardData();
  const key = JSON.stringify(input);
  const latest = useRef({ input, key });
  latest.current = { input, key };
  const flight = useRef<Promise<void> | null>(null);
  const [state, setState] = useState<{ key: string; url?: string; error?: TaalcutError }>({ key: '' });
  const [retry, setRetry] = useState(0);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (!coverImage) return;
    const timer = setTimeout(() => {
      if (flight.current) return;
      flight.current = (async () => {
        while (alive.current) {
          const asked = latest.current;
          const result = await coverImage(asked.input);
          if (!alive.current) return;
          if (asked.key !== latest.current.key) continue;
          setState(
            result.ok
              ? { key: asked.key, url: `data:${result.value.mimeType};base64,${result.value.dataBase64}` }
              : { key: asked.key, error: result.error },
          );
          return;
        }
      })().finally(() => {
        flight.current = null;
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [key, coverImage, retry]);
  return { ...state, busy: state.key !== key, available: !!coverImage, retry: () => setRetry((n) => n + 1) };
}
