// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { Timeline, TimelineId } from '@taalcut/core';
import { useSyncExternalStore } from 'react';
import { useTimelineDocuments } from './backend';
import type { TimelineDocument } from './timeline-documents';
import type { Reloadable } from './use-rpc';

const EMPTY = { status: 'loading' } as const;
const absent: TimelineDocument = {
  snapshot: () => EMPTY,
  subscribe: () => () => {},
  reload: () => {},
};

export function useTimelineDocument(id: TimelineId | undefined): Reloadable<Timeline> {
  const documents = useTimelineDocuments();
  const document = id ? documents.get(id) : absent;
  const state = useSyncExternalStore(document.subscribe, document.snapshot);
  return { ...state, reload: document.reload };
}
