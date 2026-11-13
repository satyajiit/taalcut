// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { Component, Downloads } from '@taalcut/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDownloads } from './downloads-store';
import { bytesHere } from './job-groups';
import { useDownloadActions, type DownloadActions } from './use-download-actions';

export interface ModelDownloads {
  /** These models as the download has them, in the order asked; null before its state arrives. */
  readonly components: Component[] | null;
  /** Asked for but not among what this Mac needs: this window can't fetch them. */
  readonly unlisted: string[];
  /** Every one is on this Mac. */
  readonly ready: boolean;
  /** One of them is on its way now. */
  readonly moving: boolean;
  /**
   * Asked for here and on their way: the download runs with them first, though some may still wait for a part they
   * need or a free lane ("Waiting" on their rows). Nothing to ask again.
   */
  readonly asked: boolean;
  /** Asked for here, and the download hasn't said it runs yet: the button that asked stays busy. */
  readonly starting: boolean;
  /** One of them failed (its row says why, with Try again). */
  readonly failed: boolean;
  /** What is still to fetch of them. */
  readonly bytesLeft: number;
  /** The whole download's state (these go first when it runs). */
  readonly state: Downloads['state'] | null;
  readonly actions: DownloadActions;
  /** Starts the download, or picks it up again, with these first. */
  getFirst(): void;
}

/**
 * Some named models out of everything this Mac needs (a clip waiting for its models; UX2-DOWNLOADER). There is one
 * download: fetching these starts it, or picks it up again, with them at the front, and the rest follows.
 */
export function useModelDownloads(ids: readonly string[]): ModelDownloads {
  const { downloads } = useDownloads();
  const actions = useDownloadActions();
  // Keyed by the ids' text: callers pass a fresh array each render.
  const key = ids.join('\n');
  const wanted = useMemo(() => key.split('\n').filter(Boolean), [key]);
  const listed = downloads?.components ?? null;
  const components = listed ? wanted.flatMap((id) => listed.filter((each) => each.id === id)) : null;
  const rows = components ?? [];
  const unlisted = listed ? wanted.filter((id) => !listed.some((each) => each.id === id)) : [];
  const here = rows.map((each) => each.id);
  const state = downloads?.state ?? null;
  const asked = useAsked(state, actions);
  return {
    components,
    unlisted,
    ready: components !== null && unlisted.length === 0 && rows.every((each) => each.status === 'installed'),
    moving: rows.some((each) => each.status === 'downloading'),
    failed: rows.some((each) => each.status === 'failed'),
    bytesLeft: rows.reduce((sum, each) => sum + each.sizeBytes - bytesHere(each), 0),
    asked: asked.value && state === 'downloading',
    starting: actions.pending === 'start' || (asked.value && state !== 'downloading'),
    state,
    actions,
    getFirst: () => {
      asked.set(true);
      actions.start(here);
    },
  };
}

/** How long the button waits for the download to say it runs before it offers itself again. */
const START_WAIT_MS = 15_000;

/**
 * Whether these were asked for from here, from the press until the download stops running (paused, failed, done) or
 * the command fails. The command answers before the download says it runs, and the models may then wait their turn:
 * without this, the button came back between the two, as if the press had done nothing.
 */
function useAsked(state: Downloads['state'] | null, actions: DownloadActions) {
  const [value, set] = useState(false);
  const ran = useRef(false);
  useEffect(() => {
    if (!value) {
      ran.current = false;
      return;
    }
    if (state === 'downloading') {
      ran.current = true;
      return;
    }
    if (ran.current) {
      set(false);
      return;
    }
    const timer = setTimeout(() => set(false), START_WAIT_MS);
    return () => clearTimeout(timer);
  }, [value, state]);
  useEffect(() => {
    if (actions.error) set(false);
  }, [actions.error]);
  return { value, set };
}
