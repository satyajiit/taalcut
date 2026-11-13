// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { TransferFile } from '@taalcut/core';
import type { SoundName } from './sound-player';

type FileState = TransferFile['state'];
const ACTIVE: ReadonlySet<FileState> = new Set(['uploading', 'paused', 'checking', 'importing']);
const FAILED: ReadonlySet<FileState> = new Set(['failed', 'cancelled', 'rejected']);

export interface TransferSoundState {
  readonly known: ReadonlyMap<string, FileState>;
  readonly busy: boolean;
  readonly landed: number;
  readonly failed: boolean;
}

export const QUIET: TransferSoundState = { known: new Map(), busy: false, landed: 0, failed: false };

/** Only work observed in flight can complete audibly; history and partial batches stay quiet. */
export function transferCue(
  state: TransferSoundState,
  files: readonly TransferFile[],
): { state: TransferSoundState; cue: SoundName | null } {
  const known = new Map<string, FileState>();
  let landed = state.busy ? state.landed : 0;
  let failed = state.busy && state.failed;
  for (const file of files) {
    const before = state.known.get(file.id);
    if (before && ACTIVE.has(before)) {
      if (file.state === 'imported') landed += 1;
      if (FAILED.has(file.state)) failed = true;
    }
    known.set(file.id, file.state);
  }
  const busy = files.some((file) => ACTIVE.has(file.state));
  return {
    state: { known, busy, landed: busy ? landed : 0, failed: busy && failed },
    cue: state.busy && !busy && landed > 0 && !failed ? 'importDone' : null,
  };
}
