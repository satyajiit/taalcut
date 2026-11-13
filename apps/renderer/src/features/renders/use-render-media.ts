// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A render's poster for the page: `renders.mediaUrl` (app://preview, which
 * main serves) as the page can load it (`MediaUrls.preview`; the fake paints
 * it). Null keeps the frame on the viewer grey: nothing rendered yet, or the
 * URL didn't come.
 */
import { callRpc, type RenderId } from '@taalcut/core';
import { useEffect, useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useMediaUrls } from '../../services/provider';

/** `version` changes when the poster may have (the render's status, its finish time). */
export function useRenderPoster(renderId: RenderId, version: unknown): string | null {
  const backend = useBackend();
  const media = useMediaUrls();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void callRpc(backend.renders.mediaUrl({ renderId, kind: 'poster' })).then((result) => {
      if (live) setUrl(result.ok ? media.preview(result.value.url) : null);
    });
    return () => {
      live = false;
    };
  }, [backend, media, renderId, version]);
  return url;
}
