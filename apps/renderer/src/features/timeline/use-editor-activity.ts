// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { UnknownError, type ProjectId } from '@taalcut/core';
import { useEffect } from 'react';
import { useBackend } from '../../backend/backend';
import { useRpcStream } from '../../backend/use-rpc';

/** Admission lives in the command queue; this stream explains why controls are temporarily unavailable. */
export function useEditorActivity(projectId: ProjectId) {
  const backend = useBackend();
  const activity = useRpcStream(
    async (signal) => ({
      async *[Symbol.asyncIterator]() {
        const stream = await backend.commands.watchEditing({ projectId }, { signal });
        yield* stream;
        if (!signal.aborted) throw UnknownError(undefined, { detail: 'editing_stream_ended' });
      },
    }),
    [backend, projectId],
  );
  const { reload, status } = activity;
  useEffect(() => {
    if (status !== 'error') return;
    const timer = setTimeout(reload, 1000);
    return () => clearTimeout(timer);
  }, [status, reload]);
  return {
    ...activity,
    paused: status !== 'ready' || activity.data.phase !== 'idle',
    phase: activity.data?.projectId === projectId ? activity.data.phase : undefined,
  };
}
