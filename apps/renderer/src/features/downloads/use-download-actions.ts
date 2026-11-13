// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  callRpc,
  COMPONENT_COMMANDS,
  type Component,
  type FixAction,
  type Result,
  type TaalcutError,
} from '@taalcut/core';
import { useCallback, useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useDownloads } from './downloads-store';

export type DownloadAction = 'start' | 'pause' | 'resume' | 'cancel';

export interface DownloadActions {
  /** The command on its way: from the press until it settles. */
  readonly pending: DownloadAction | null;
  /** Why the last command failed, said plainly by ErrorLine (a component named by its name). */
  readonly error: TaalcutError | null;
  /** Starts the download, or picks it up again; `first` (components this Mac needs) go to the front. */
  start(first?: readonly string[]): void;
  pause(): void;
  resume(): void;
  /** Stops it and deletes what has arrived of the parts not installed yet. */
  cancel(): void;
  /** Runs an error's fix (a disk-space error opens System Settings › Storage). */
  fix(action: FixAction): Promise<Result<unknown>>;
}

/** The component manager names a component by its id; the window says its name ("Whisper tiny"). */
export function named(error: TaalcutError | null, listed: readonly Component[] | null): TaalcutError | null {
  const id = error?.params?.['component'];
  const component = typeof id === 'string' ? listed?.find((each) => each.id === id) : undefined;
  if (!error || !component) return error;
  return { ...error, params: { ...error.params, component: component.name } };
}

const COMMAND: Record<DownloadAction, string> = {
  start: COMPONENT_COMMANDS.download,
  pause: COMPONENT_COMMANDS.pauseDownloads,
  resume: COMPONENT_COMMANDS.resumeDownloads,
  cancel: COMPONENT_COMMANDS.cancelDownloads,
};

/**
 * The download's commands (UX2-DOWNLOADER): they run in the agent's jobs process and keep going when the view goes
 * away; the views follow the download's own events. A command that fails says why here; the download's state
 * says the rest (a disk too full is on the set too, so every view shows it).
 */
export function useDownloadActions(): DownloadActions {
  const backend = useBackend();
  const { downloads, refresh } = useDownloads();
  const [pending, setPending] = useState<DownloadAction | null>(null);
  const [error, setError] = useState<TaalcutError | null>(null);

  const run = useCallback(
    (action: DownloadAction, payload: Record<string, unknown>) => {
      setError(null);
      setPending(action);
      void callRpc(backend.commands.dispatch({ name: COMMAND[action], payload, source: 'ui' })).then(
        (outcome) => {
          setPending(null);
          refresh();
          if (!outcome.ok) setError(outcome.error);
        },
      );
    },
    [backend, refresh],
  );

  const fix = useCallback(
    (action: FixAction) =>
      callRpc(
        backend.commands.dispatch({ name: action.command, payload: action.payload ?? {}, source: 'ui' }),
      ),
    [backend],
  );

  return {
    pending,
    error: named(error, downloads?.components ?? null),
    start: (first) => run('start', first && first.length > 0 ? { first: [...first] } : {}),
    pause: () => run('pause', {}),
    resume: () => run('resume', {}),
    cancel: () => run('cancel', {}),
    fix,
  };
}
