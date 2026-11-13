// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The brand kit editor's writes (P3-V10): one `style.update` per committed field, naming the revision it was made
 * on, each its own undo step in the app-wide history (⌘Z on this page). Commits run one after another, each
 * built from the kit as the previous one left it, so two quick commits never undo each other. A refused one says
 * why beside its field; a stale revision (the agent, another window) reloads the kit and says so.
 */
import { useLingui } from '@lingui/react/macro';
import {
  callRpc,
  createSerialQueue,
  newId,
  STYLE_COMMANDS,
  type Style,
  type StyleId,
  type StyleInput,
  type TaalcutError,
} from '@taalcut/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useBackend } from '../../backend/backend';
import { styleErrorMessage } from './brand-words';
import { useStyle } from './use-styles';

export type StylePatch = Partial<Omit<StyleInput, 'kind'>>;
/** What a field commits: a patch built from the kit as it is when the commit runs. */
export type PatchOf = (style: Style) => StylePatch;

export interface FieldState {
  readonly field: string;
  readonly state: 'saving' | 'saved' | 'failed';
  readonly message?: string;
}

/** style.update's result names the revision it wrote. */
function revisionOf(result: unknown): number | null {
  if (typeof result !== 'object' || result === null || !('revision' in result)) return null;
  return typeof result.revision === 'number' ? result.revision : null;
}

export function useStyleEditor(styleId: StyleId) {
  const { i18n } = useLingui();
  const backend = useBackend();
  const query = useStyle(styleId);
  const latest = useRef<Style | null>(null);
  /** Commits one after another, each from the kit as the previous one left it. */
  const [commits] = useState(createSerialQueue);
  const running = useRef(0);
  const [status, setStatus] = useState<FieldState | null>(null);

  // What the server says wins over what the queue assumed whenever no commit is running. Not "once it is newer":
  // an undo restores the previous Style with its own, lower revision.
  useEffect(() => {
    if (query.data && running.current === 0) latest.current = query.data;
  }, [query.data]);

  const commit = useCallback(
    (field: string, patchOf: PatchOf): Promise<boolean> => {
      const run = async () => {
        const style = latest.current;
        if (!style) return false;
        setStatus({ field, state: 'saving' });
        const patch = patchOf(style);
        const result = await callRpc(
          backend.commands.dispatch({
            name: STYLE_COMMANDS.update,
            payload: { styleId, baseRevision: style.revision, patch },
            source: 'ui',
            idempotencyKey: newId(),
          }),
        );
        if (!result.ok) {
          fail(field, result.error);
          return false;
        }
        latest.current = {
          ...style,
          ...patch,
          revision: revisionOf(result.value.result) ?? style.revision + 1,
        };
        setStatus({ field, state: 'saved' });
        return true;
      };
      const fail = (name: string, error: TaalcutError) => {
        if (error.code === 'core.conflict') {
          latest.current = null;
          query.reload();
        }
        setStatus({ field: name, state: 'failed', message: styleErrorMessage(i18n, error) });
      };
      const counted = async () => {
        running.current += 1;
        try {
          return await run();
        } finally {
          running.current -= 1;
        }
      };
      return commits.run(counted);
    },
    [backend, styleId, i18n, query, commits],
  );

  return { query, style: query.data, commit, status };
}

export type StyleEditor = ReturnType<typeof useStyleEditor>;
