// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { UpdateState } from '@taalcut/core';
import { useBackend } from '../../backend/backend';
import { useRpcAction, useRpcStream } from '../../backend/use-rpc';

/** Main's update state, live (updates.changed: the current state, then every change). */
export function useUpdateState() {
  const backend = useBackend();
  return useRpcStream((signal) => backend.updates.changed(undefined, { signal }), [backend]);
}

/** A verified, staged update: its version, release notes and date. */
export type ReadyUpdate = Extract<UpdateState['status'], { kind: 'ready' }>;

/** The staged update, when there is one. */
export function readyUpdate(state: UpdateState | undefined): ReadyUpdate | null {
  return state?.status.kind === 'ready' ? state.status : null;
}

/** Restart now: main quits and installs the staged update (desktop.update_not_ready otherwise). */
export function useInstallNow() {
  const backend = useBackend();
  return useRpcAction((_: void) => backend.updates.installNow());
}

/** Check now: main asks the feed at once and answers with the state after the check. */
export function useCheckNow() {
  const backend = useBackend();
  return useRpcAction((_: void) => backend.updates.check());
}
