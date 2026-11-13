// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What main does with each UpdateEvent (P3-B9): the quit signals once an update is staged (quit-signals.ts), the
 * rollback preparation (staging-tracker.ts), one log line (progress only at each 25%; release notes by their
 * size, never their text), the host's status, the offer's notes in the person's language, then the listener.
 */
import type { AppLocale } from '@taalcut/core';
import type { UpdateHost } from './host';
import { releaseDateOf, releaseNotesFor } from './release-notes';
import type { StagingTracker } from './staging-tracker';
import type { UpdateEvent } from './updater';

export interface UpdateEventSinkDeps {
  readonly host?: UpdateHost;
  readonly staging: Pick<StagingTracker, 'note'>;
  readonly signals: { take(): void };
  /** The person's language for release notes. */
  readonly notesLocale: () => Promise<AppLocale>;
  readonly onEvent?: (event: UpdateEvent) => void;
  readonly log?: (line: string) => void;
}

/** Release notes can be long; the log keeps their size only. */
export function loggedEvent(event: UpdateEvent): unknown {
  if (event.type !== 'release-info') return event;
  return {
    ...event,
    releaseNotes: event.releaseNotes === undefined ? undefined : `${event.releaseNotes.length} chars`,
  };
}

type ReleaseInfo = Extract<UpdateEvent, { type: 'release-info' }>;

async function noteOffer(deps: UpdateEventSinkDeps, event: ReleaseInfo): Promise<void> {
  const locale = await deps.notesLocale();
  const notes = releaseNotesFor(event.releaseNotes, locale);
  const releaseDate = releaseDateOf(event.releaseDate);
  deps.host?.noteOffer(event.version, {
    ...(notes !== undefined ? { notes } : {}),
    ...(releaseDate !== undefined ? { releaseDate } : {}),
  });
}

export function updateEventSink(deps: UpdateEventSinkDeps): (event: UpdateEvent) => void {
  const log = deps.log ?? console.warn;
  let lastQuarter = -1;
  /** Every event but progress, which only when it reaches another quarter. */
  const worthLogging = (event: UpdateEvent): boolean => {
    if (event.type !== 'progress') return true;
    const quarter = Math.floor(event.percent / 25);
    if (quarter === lastQuarter) return false;
    lastQuarter = quarter;
    return true;
  };
  return (event) => {
    if (event.type === 'staged') deps.signals.take();
    deps.staging.note(event);
    if (worthLogging(event)) log(`[update] ${JSON.stringify(loggedEvent(event))}`);
    deps.host?.apply(event);
    if (event.type === 'release-info') void noteOffer(deps, event);
    deps.onEvent?.(event);
  };
}
