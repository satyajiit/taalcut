// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The template index following every committed template write (LRN1-TPL): each `library.changed` about templates
 * (write-notes.ts sends one per write, once its command commits) syncs those templates. While no embedding space is
 * open there is nothing to write to; the reconcile that runs when one opens catches up. A sync that fails is
 * reported, never retried here: the next write or the next start's reconcile brings the template up to date.
 */
import type { EventBus, TaalcutError, TemplateId, Unsubscribe } from '@taalcut/core';
import type { TemplateVectors } from './template-vectors';

export interface FollowTemplateWritesDeps {
  readonly events: Pick<EventBus, 'on'>;
  /** The open space's vectors; undefined while no space is open. */
  readonly vectors: () => Promise<TemplateVectors | undefined>;
  readonly onError: (error: TaalcutError) => void;
}

export function followTemplateWrites(deps: FollowTemplateWritesDeps): Unsubscribe {
  return deps.events.on('library.changed', ({ payload }) => {
    if (payload.entity !== 'template') return;
    const ids = payload.ids as TemplateId[];
    void deps.vectors().then(async (vectors) => {
      if (!vectors) return;
      const synced = await vectors.sync(ids);
      if (!synced.ok) deps.onError(synced.error);
    });
  });
}
