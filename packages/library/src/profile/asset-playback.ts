// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the clip page's viewer plays (UX2): media.proxy's copy when it made one, else the original itself when
 * media.proxy found it small and plain enough to be its own proxy (its stored output says `reusedOriginal`). Main
 * serves the original only through `playableOriginal`, so a window can't ask for any other file.
 */
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { AssetId, MediaFacts, Playback } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { presentOriginal } from '../indexing/view';
import { createDerivedFileRepository } from '../repositories/derived-files';
import { assetIndexStages } from '../schema/media';

const PROXY_STAGE = 'media.proxy';
/** The part of media.proxy's stored output that says the original is its own proxy. */
const reusedSchema = z.object({ reusedOriginal: z.literal(true) });

/** Did media.proxy finish by keeping the original as the clip's proxy? */
function reusedOriginal(db: LibraryDatabase, id: AssetId): boolean {
  const row = db.orm
    .select({ output: assetIndexStages.output })
    .from(assetIndexStages)
    .where(
      and(
        eq(assetIndexStages.assetId, id),
        eq(assetIndexStages.stage, PROXY_STAGE),
        eq(assetIndexStages.state, 'done'),
      ),
    )
    .get();
  return row !== undefined && reusedSchema.safeParse(row.output).success;
}

/** The proxy copy, or the original that is its own proxy (sized from its facts); null until media.proxy ran. */
export function playbackOf(db: LibraryDatabase, id: AssetId, facts: MediaFacts | null): Playback | null {
  const copy = createDerivedFileRepository(db).find(id, 'proxy');
  if (copy && copy.mimeType === 'video/mp4') return { source: 'proxy', file: copy };
  if (!facts?.duration || !facts.frameRate || !reusedOriginal(db, id)) return null;
  return {
    source: 'original',
    width: facts.width,
    height: facts.height,
    duration: facts.duration,
    frameRate: facts.frameRate,
  };
}

/** The original's path for main's `app://media/originals/<id>`: only when it is the clip's proxy and present. */
export function playableOriginal(db: LibraryDatabase, id: AssetId): string | undefined {
  return reusedOriginal(db, id) ? presentOriginal(db, id)?.path : undefined;
}
