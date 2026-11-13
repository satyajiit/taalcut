// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { callRpc, type PreviewSession, type TaalcutError } from '@taalcut/core';

export interface PreviewRefreshState {
  readonly session: PreviewSession | null;
  readonly requested: number;
  readonly compiled: number | null;
  readonly displayed: number | null;
  readonly failure: TaalcutError | null;
}

export interface PreviewRefreshPort {
  open(): Promise<PreviewSession>;
  refresh(session: PreviewSession): Promise<PreviewSession>;
  close(session: PreviewSession): Promise<unknown>;
}

/** Serializes builds, coalesces edits, and only acknowledges the URL the player actually painted. */
export function createPreviewRefresh(
  port: PreviewRefreshPort,
  changed: (state: PreviewRefreshState) => void,
) {
  let state: PreviewRefreshState = {
    session: null,
    requested: -1,
    compiled: null,
    displayed: null,
    failure: null,
  };
  let session: PreviewSession | null = null;
  let running = false;
  let disposed = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const publish = (patch: Partial<PreviewRefreshState>) => {
    state = { ...state, ...patch };
    changed(state);
  };
  const close = (value: PreviewSession) => void callRpc(port.close(value));
  const schedule = (delay: number) => {
    clearTimeout(timer);
    if (!disposed) timer = setTimeout(() => void build(), delay);
  };

  async function build() {
    if (disposed || running) return;
    running = true;
    const result = await callRpc(session ? port.refresh(session) : port.open());
    running = false;
    if (disposed) {
      if (result.ok) close(result.value);
      return;
    }
    if (!result.ok) {
      if (result.error.code === 'render.preview_session_expired') session = null;
      publish({ failure: result.error });
      schedule(Math.min(5_000, 500 * 2 ** Math.min(failures++, 4)));
      return;
    }
    session = result.value;
    failures = 0;
    publish({ session, compiled: session.timelineRevision, failure: null });
    if (session.timelineRevision < state.requested) schedule(150);
  }

  return {
    request(revision: number) {
      if (disposed || revision <= state.requested) return;
      publish({ requested: revision });
      if (!running && (state.compiled === null || revision > state.compiled)) schedule(session ? 150 : 0);
    },
    painted(src: string | undefined) {
      if (disposed || !src || state.session?.url !== src) return;
      publish({ displayed: state.session.timelineRevision });
    },
    retry() {
      if (!disposed) {
        failures = 0;
        schedule(0);
      }
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      if (session) close(session);
    },
  };
}
