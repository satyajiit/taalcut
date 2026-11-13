// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The update dialog's one mount (the root route), and its one way of opening by itself: on a launch after the
 * person said Later to the update that is still staged. Never mid-task: only the first state a launch reads counts.
 */
import { useEffect, useRef } from 'react';
import { UpdateDialog } from './update-dialog';
import { openUpdateDialog } from './update-dialog-state';
import { laterVersion } from './update-later';
import { readyUpdate, useUpdateState } from './use-updates';

export function UpdateHost() {
  const state = useUpdateState();
  const decided = useRef(false);
  const ready = readyUpdate(state.data);
  const loaded = state.data !== undefined;

  useEffect(() => {
    if (decided.current || !loaded) return;
    decided.current = true;
    if (ready && laterVersion() === ready.version) openUpdateDialog();
  }, [loaded, ready]);

  return <UpdateDialog ready={ready} />;
}
