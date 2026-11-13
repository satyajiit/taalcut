// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `media.makeFilmstrip`'s operation (UX2): the sprite from the proxy when there is one (else the original, which is
 * then its own proxy), stored in the cache under `filmstrips/…<hash>.v2.jpg`, and the output the asset detail
 * carries as it is: the file, its grid and its frames' times.
 */
import { type AsyncResult } from '@taalcut/core';
import { derivedKey } from '../cache/layout';
import { FILMSTRIP_RECIPE } from '../previews/filmstrip';
import { makeFilmstrip } from '../previews/make-filmstrip';
import { counted, noCache, storeDerived, type Phase2Host, type RunOptions } from './operate';
import type { MakeFilmstripJobInput, MakeFilmstripJobOutput } from './phase2-kinds';

export function filmstripAsset(
  input: MakeFilmstripJobInput & RunOptions,
  host: Phase2Host,
): AsyncResult<MakeFilmstripJobOutput> {
  if (!host.cache) return Promise.resolve(noCache());
  const proxyPath = input.proxyKey ? host.cache.absPath(input.proxyKey) : undefined;
  const key = derivedKey('filmstrip', input.contentHash, FILMSTRIP_RECIPE, 'jpg');
  return storeDerived(
    host,
    input.contentHash,
    { prefix: 'taalcut-filmstrip-', file: 'strip.jpg', key },
    async (ctx, out) => {
      const profile = await host.decodeProfile?.();
      return makeFilmstrip(proxyPath ?? input.path, input.plan, counted(ctx, input), {
        out,
        alreadyNormalised: proxyPath !== undefined,
        ...(input.signal ? { signal: input.signal } : {}),
        ...(profile ? { profile } : {}),
      });
    },
    (made, bytes) => ({
      filmstrip: {
        file: {
          kind: 'filmstrip',
          key,
          bytes,
          mimeType: 'image/jpeg',
          width: made.layout.width,
          height: made.layout.height,
          recipe: FILMSTRIP_RECIPE,
        },
        columns: made.layout.columns,
        rows: made.layout.rows,
        tileWidth: made.layout.tileWidth,
        tileHeight: made.layout.tileHeight,
        times: made.layout.tiles.map((tile) => tile.time),
      },
      source: made.source,
    }),
  );
}
