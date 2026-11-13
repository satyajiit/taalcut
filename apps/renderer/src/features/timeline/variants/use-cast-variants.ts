// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The videos of one request (a cast) for the editor's compare view (P3-V3): the project's timelines with that cast
 * (timelines.listByProject), in variant order, each watched (timelines.watch) so the differences from the first
 * stay current. The first is the original; the rest are labelled Variant 1, 2….
 */
import { useLingui } from '@lingui/react/macro';
import type { CastId, ProjectId, Timeline, TimelineId } from '@taalcut/core';
import { variantLabel, type CompareVariant } from '@taalcut/ui';
import { useEffect, useMemo, useState } from 'react';
import { useBackend, useTimelineDocuments } from '../../../backend/backend';
import { useRpcQuery, type Loadable } from '../../../backend/use-rpc';
import { followTimelineDocument } from '../../../backend/timeline-documents';
import { variantDifference } from './variant-difference';

export interface CastVariants {
  /** Original first. Empty while loading, and when the cast has no videos here. */
  readonly variants: readonly CompareVariant[];
  readonly list: Loadable<readonly TimelineId[]> & { reload: () => void };
  /** Every listed video has arrived (or is gone). */
  readonly ready: boolean;
}

export function useCastVariants(projectId: ProjectId, castId: CastId): CastVariants {
  const backend = useBackend();
  const documents = useTimelineDocuments();
  const { i18n } = useLingui();
  const list = useRpcQuery(
    async (signal) =>
      (await backend.timelines.listByProject({ projectId }, { signal }))
        .filter((summary) => summary.castId === castId)
        .sort((a, b) => (a.variantIndex ?? 0) - (b.variantIndex ?? 0))
        .map((summary) => summary.id),
    [backend, projectId, castId],
  );
  const ids = list.data ?? [];
  const key = ids.join(' ');
  const [docs, setDocs] = useState<ReadonlyMap<TimelineId, Timeline | null>>(new Map());

  useEffect(() => {
    setDocs(new Map());
    const stops = ids.map((timelineId) =>
      followTimelineDocument(
        documents.get(timelineId),
        (timeline) => setDocs((was) => new Map(was).set(timelineId, timeline)),
        () => setDocs((was) => new Map(was).set(timelineId, null)),
      ),
    );
    return () => {
      for (const stop of stops) stop();
    };
    // The ids' text is what matters; the array is new on every render.
  }, [documents, key]);

  const ready = ids.length > 0 && ids.every((id) => docs.has(id));
  const variants = useMemo(() => {
    const base = ids[0] ? docs.get(ids[0]) : undefined;
    if (!ready || !base) return [];
    return ids.flatMap((id, index): CompareVariant[] => {
      const doc = docs.get(id);
      if (!doc) return [];
      const customTitle = doc.name.trim() && !/^video\s+\d+$/i.test(doc.name.trim()) ? doc.name.trim() : null;
      return [
        {
          timelineId: id,
          revision: doc.revision,
          label: variantLabel(i18n, index === 0 ? null : index),
          title: customTitle,
          difference: index === 0 ? null : variantDifference(base, doc),
        },
      ];
    });
  }, [docs, key, ready, i18n]);

  return { variants, list, ready };
}
