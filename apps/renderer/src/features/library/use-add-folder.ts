// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { callRpc, LIBRARY_COMMANDS, type FixAction, type Result, type TaalcutError } from '@taalcut/core';
import { useCallback, useState } from 'react';
import { useBackend } from '../../backend/backend';
import { fixCommand } from '../../backend/fix-command';
import { useCommand } from '../../backend/use-command';

/** A dropped item that is a folder: no type and no extension. A file dropped as a source isn't one. */
export function looksLikeFolder(item: Pick<File, 'type' | 'name'>): boolean {
  return item.type === '' && !/\.[a-z0-9]{2,4}$/i.test(item.name);
}

export interface AddFolder {
  /** Main's folder dialog, then library.addSource. Cancelling the dialog does nothing. */
  choose(): Promise<void>;
  /** The first dropped item, added when it is a folder this Mac can name. */
  drop(item: File | undefined): Promise<void>;
  /** The dialog is open or the folder is being added. */
  readonly busy: boolean;
  /** The dialog or the command failed: the cause, as a value. */
  readonly error: TaalcutError | null;
  /** Why a drop wasn't taken: a file rather than a folder, or no way to read a dropped path here. */
  readonly note: string | null;
  /** How many folders this hook added. */
  readonly added: number;
  /**
   * Runs the error's fix (macOS refused the folder: Files and Folders), for the line that shows it to confirm or
   * replace in place.
   */
  fix(action: FixAction): Promise<Result<unknown>>;
}

/**
 * Adding a folder to the library, the one way everywhere (the Library's empty state and toolbar, first run): the
 * folder dialog or a dropped folder, then `library.addSource` on the bus (undoable). Failures come back as values
 * for the caller to show; nothing is dropped silently.
 */
export function useAddFolder(onAdded?: () => void): AddFolder {
  const { t } = useLingui();
  const backend = useBackend();
  // Every caller shows `error` itself (a line, or the toolbar's toast), so the command's own toast would say it twice.
  const command = useCommand({ toast: false });
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<TaalcutError | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [added, setAdded] = useState(0);
  const run = command.run;

  const add = useCallback(
    async (path: string) => {
      const result = await run({ name: LIBRARY_COMMANDS.addSource, payload: { path } });
      if (!result.ok) return setError(result.error);
      setAdded((n) => n + 1);
      onAdded?.();
    },
    [run, onAdded],
  );

  const choose = useCallback(async () => {
    setError(null);
    setNote(null);
    setPicking(true);
    const picked = await callRpc(backend.files.pickFolder());
    setPicking(false);
    if (!picked.ok) return setError(picked.error);
    if (picked.value) await add(picked.value.path);
  }, [backend, add]);

  const drop = useCallback(
    async (item: File | undefined) => {
      setError(null);
      setNote(null);
      if (!item || !looksLikeFolder(item))
        return setNote(t`Drop a folder, not a single file. Or choose one.`);
      // The preload's file bridge (window.taalcutFiles, declared in chat/card-actions.ts); absent in a browser.
      const path = window.taalcutFiles?.pathFor(item) ?? null;
      if (!path)
        return setNote(t`Taalcut can’t read where that folder is. Choose it with Add a folder instead.`);
      await add(path);
    },
    [add, t],
  );

  const fix = useCallback((action: FixAction) => run(fixCommand(action)), [run]);

  return { choose, drop, busy: picking || command.pending, error, note, added, fix };
}
