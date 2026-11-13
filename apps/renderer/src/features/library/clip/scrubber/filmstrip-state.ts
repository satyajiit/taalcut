// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the scrubber's filmstrip shows (UX2, round 2): the sprite media.filmstrip made at import, or, until there is
 * one, where that stage really is. Never frames from anywhere else. Words are the strip's (clip-filmstrip.tsx); this
 * file only decides, from the library's detail.
 */
import type { AssetDetail, Filmstrip } from '@taalcut/core';

type StageRow = AssetDetail['stages'][number];

export type FilmstripState =
  /** The sprite is made: draw it. */
  | { readonly kind: 'drawn'; readonly filmstrip: Filmstrip }
  /** media.filmstrip runs now. */
  | { readonly kind: 'making' }
  /** Its job is in the queue, next in line or soon. */
  | { readonly kind: 'next' }
  /** It waits for the copy to play, which media.proxy is still making. */
  | { readonly kind: 'afterCopy' }
  /** The copy to play couldn't be made, so there is nothing to lay the frames out from. */
  | { readonly kind: 'noCopy' }
  /** It waits its turn, or for the library's reason (the original away, say). */
  | { readonly kind: 'waiting'; readonly reasonKey?: string }
  /** It failed: the library's cause when it has one. */
  | { readonly kind: 'failed'; readonly error: NonNullable<StageRow['error']> | null }
  /** It was skipped (the clip couldn't be prepared), or the library lists no such step for it: why, when it says. */
  | { readonly kind: 'skipped'; readonly reasonKey?: string }
  /** It finished but the media cache let the sprite go: opening the clip makes it again (library SPEC, UX2). */
  | { readonly kind: 'again' };

const STAGE = 'media.filmstrip';
const PROXY = 'media.proxy';

const reason = (row: StageRow) => (row.reasonKey ? { reasonKey: row.reasonKey } : {});

export function filmstripState(detail: Pick<AssetDetail, 'filmstrip' | 'stages'>): FilmstripState {
  if (detail.filmstrip) return { kind: 'drawn', filmstrip: detail.filmstrip };
  const row = detail.stages.find((stage) => stage.stage === STAGE);
  if (!row) return { kind: 'skipped' };
  switch (row.state) {
    case 'running':
      return { kind: 'making' };
    case 'queued':
      return { kind: 'next' };
    case 'failed':
      return { kind: 'failed', error: row.error ?? null };
    case 'skipped':
      return { kind: 'skipped', ...reason(row) };
    case 'done':
      return { kind: 'again' };
    default:
      break;
  }
  // Waiting: for the library's reason, else for the copy to play first, else its turn.
  if (row.reasonKey) return { kind: 'waiting', reasonKey: row.reasonKey };
  const proxy = detail.stages.find((stage) => stage.stage === PROXY);
  if (proxy?.state === 'failed') return { kind: 'noCopy' };
  if (proxy && proxy.state !== 'done' && proxy.state !== 'skipped') return { kind: 'afterCopy' };
  return { kind: 'waiting' };
}
