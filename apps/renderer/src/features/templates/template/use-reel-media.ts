// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * "Get the reel's video and music" (REF1): `templates.fetchMedia` fetches an older template's origin link again and
 * keeps the reel. The service runs it as a `templates.fetchReference` job, so while the call is out the page follows
 * that kind's `job.progress` (the downloader's stage, how far, the time left). The answer's media shows at once, while
 * the template's frame reads the summary again (`library.changed`); a failure stays here, with its cause.
 */
import {
  callRpc,
  type JobProgress,
  type TaalcutError,
  type TemplateId,
  type TemplateMedia,
} from '@taalcut/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useBackendEvents } from '../../../backend/use-events';

/** The job kind the service fetches a reel with (packages/templates' fetch job). */
const FETCH_JOB = 'templates.fetchReference';

export type ReelMediaFetch =
  | { readonly status: 'idle' }
  | { readonly status: 'getting'; readonly progress: JobProgress | null }
  | { readonly status: 'failed'; readonly error: TaalcutError }
  | { readonly status: 'kept'; readonly media: TemplateMedia };

export function useReelMedia(templateId: TemplateId): { state: ReelMediaFetch; get: () => void } {
  const backend = useBackend();
  const [state, setState] = useState<ReelMediaFetch>({ status: 'idle' });
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  // Another template's page: whatever was showing was that template's.
  useEffect(() => setState({ status: 'idle' }), [templateId]);

  useBackendEvents(['job.progress'], ({ payload }) => {
    if (payload.kind !== FETCH_JOB) return;
    setState((was) => (was.status === 'getting' ? { status: 'getting', progress: payload.progress } : was));
  });

  const get = useCallback(() => {
    setState({ status: 'getting', progress: null });
    void callRpc(backend.templates.fetchMedia({ id: templateId })).then((answer) => {
      if (!live.current) return;
      if (!answer.ok) setState({ status: 'failed', error: answer.error });
      else setState(answer.value.media ? { status: 'kept', media: answer.value.media } : { status: 'idle' });
    });
  }, [backend, templateId]);

  return { state, get };
}
