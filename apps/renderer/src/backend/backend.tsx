// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { createEditorDrafts, type EditorDrafts } from './editor-drafts';
import type { Backend } from './contract';
import { createTimelineDocuments, type TimelineDocuments } from './timeline-documents';

const EditorDraftsContext = createContext<EditorDrafts | null>(null);
const BackendContext = createContext<Backend | null>(null);
const TimelineDocumentsContext = createContext<TimelineDocuments | null>(null);

/** Provides the typed client for the main process and the utility processes behind it. */
export function BackendProvider({ backend, children }: { backend: Backend; children: ReactNode }) {
  const drafts = useMemo(() => createEditorDrafts(backend), [backend]);
  const documents = useMemo(() => createTimelineDocuments(backend), [backend]);
  return (
    <BackendContext.Provider value={backend}>
      <TimelineDocumentsContext.Provider value={documents}>
        <EditorDraftsContext.Provider value={drafts}>{children}</EditorDraftsContext.Provider>
      </TimelineDocumentsContext.Provider>
    </BackendContext.Provider>
  );
}

export function useTimelineDocuments(): TimelineDocuments {
  const documents = useContext(TimelineDocumentsContext);
  if (!documents) throw new Error('useTimelineDocuments must be used inside <BackendProvider>');
  return documents;
}

export function useBackend(): Backend {
  const backend = useContext(BackendContext);
  if (!backend) throw new Error('useBackend must be used inside <BackendProvider>');
  return backend;
}

export type { Backend } from './contract';

export function useEditorDrafts(): EditorDrafts {
  const drafts = useContext(EditorDraftsContext);
  if (!drafts) throw new Error('useEditorDrafts must be used inside <BackendProvider>');
  return drafts;
}
