// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ProjectId, TimelineId } from '@taalcut/core';
import { useEffect, useRef, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { createPreviewRefresh, type PreviewRefreshState } from './preview-refresh';

export function usePreviewRefresh(projectId: ProjectId, timelineId: TimelineId, revision: number) {
  const backend = useBackend();
  const current = useRef<ReturnType<typeof createPreviewRefresh> | null>(null);
  const [loaded, setLoaded] = useState<{ id: TimelineId; state: PreviewRefreshState } | null>(null);
  const latest = useRef(revision);
  latest.current = revision;
  useEffect(() => {
    const refresh = createPreviewRefresh(
      {
        open: () => backend.renders.openPreview({ projectId, timelineId }),
        refresh: (session) => backend.renders.refreshPreview({ sessionId: session.sessionId }),
        close: (session) => backend.renders.closePreview({ sessionId: session.sessionId }),
      },
      (state) => setLoaded({ id: timelineId, state }),
    );
    current.current = refresh;
    refresh.request(latest.current);
    return () => {
      current.current = null;
      refresh.dispose();
    };
  }, [backend, projectId, timelineId]);
  useEffect(() => current.current?.request(revision), [revision]);
  const state = loaded?.id === timelineId ? loaded.state : null;
  return {
    state,
    retry: () => current.current?.retry(),
    painted: (src: string | undefined) => current.current?.painted(src),
  };
}
