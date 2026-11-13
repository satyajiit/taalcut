// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What main does with update events (P3-B9): the rollback is prepared once the verified update is staged, a quit
 * during the preparation waits for it, the log keeps progress to quarters and notes to their size, and About's
 * status follows each event (update-status.ts).
 */
import { err, ok, type LocalePreference, type UpdateState } from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import { localeState } from '../src/main/locale/locale-host';
import { UpdatePrepFailed, type InstallPrep, type StagedUpdate } from '../src/main/update/install-prep';
import { armAtQuit, createStagingTracker } from '../src/main/update/staging-tracker';
import { updateEventSink } from '../src/main/update/update-event-sink';
import { NO_OFFER, stepStatus, type Offer } from '../src/main/update/update-status';
import type { UpdateEvent } from '../src/main/update/updater';
import type { PendingUpdate } from '../src/main/update/update-files';

const pending = (to: string): PendingUpdate => ({
  v: 1,
  from: '1.2.0',
  to,
  appPath: '/Applications/Taalcut.app',
  rollbackApp: '/u/updates/rollback/Taalcut-1.2.0.app',
  library: '/u/catalog/library.sqlite',
  at: 1,
  launchAttempts: 0,
});

/** An InstallPrep whose preparation finishes when the test says so. */
function fakePrep(outcome: 'ok' | 'failed' = 'ok') {
  const calls: StagedUpdate[] = [];
  let finish: () => void = () => undefined;
  const arm = vi.fn(() => ok(true));
  const prep: InstallPrep = {
    prepare: (update) => {
      calls.push(update);
      return new Promise((resolve) => {
        finish = () =>
          resolve(
            outcome === 'ok'
              ? ok(pending(update.to))
              : err(UpdatePrepFailed(undefined, { detail: 'clone: x' })),
          );
      });
    },
    arm,
  };
  return { prep, calls, arm, finish: () => finish() };
}

describe('the staging tracker', () => {
  it('prepares the verified version once it is staged, with the channel and whether it came as a delta', async () => {
    const { prep, calls, finish } = fakePrep();
    const log: string[] = [];
    const staging = createStagingTracker(
      prep,
      () => 'beta',
      (line) => log.push(line),
    );
    staging.note({ type: 'staged' });
    expect(calls).toEqual([]);
    for (const event of [
      { type: 'available', version: '1.3.0' },
      { type: 'delta' },
      { type: 'verified', version: '1.3.0', team: 'T' },
      { type: 'staged' },
    ] satisfies UpdateEvent[])
      staging.note(event);
    expect(calls).toEqual([{ to: '1.3.0', delta: true, channel: 'beta' }]);
    expect(staging.preparing()).toBe(true);
    finish();
    await staging.ready();
    expect(staging.preparing()).toBe(false);
    expect(log).toEqual(['[update] rollback to 1.2.0 prepared']);
  });

  it('forgets a delta that fell back, and logs a preparation that failed', async () => {
    const { prep, calls, finish } = fakePrep('failed');
    const log: string[] = [];
    const staging = createStagingTracker(
      prep,
      () => null,
      (line) => log.push(line),
    );
    for (const event of [
      { type: 'delta' },
      { type: 'delta-failed' },
      { type: 'verified', version: '1.3.0', team: 'T' },
      { type: 'staged' },
    ] satisfies UpdateEvent[])
      staging.note(event);
    expect(calls).toEqual([{ to: '1.3.0', delta: false }]);
    finish();
    await staging.ready();
    expect(log).toEqual(['[update] no rollback for 1.3.0: desktop.update_prep_failed clone: x']);
  });

  it('holds a quit that comes while the rollback is prepared, then quits again; arms at once otherwise', async () => {
    const { prep, arm, finish } = fakePrep();
    const staging = createStagingTracker(
      prep,
      () => 'stable',
      () => undefined,
    );
    staging.note({ type: 'verified', version: '1.3.0', team: 'T' });
    staging.note({ type: 'staged' });
    const quitEvent = { preventDefault: vi.fn() };
    const quit = vi.fn();
    armAtQuit(staging, quitEvent, quit);
    expect(quitEvent.preventDefault).toHaveBeenCalledTimes(1);
    expect(arm).not.toHaveBeenCalled();
    finish();
    await staging.ready();
    await Promise.resolve();
    expect(quit).toHaveBeenCalledTimes(1);
    const again = { preventDefault: vi.fn() };
    armAtQuit(staging, again, quit);
    expect(again.preventDefault).not.toHaveBeenCalled();
    expect(arm).toHaveBeenCalledTimes(1);
  });
});

describe('the update event sink', () => {
  const sink = (preference: LocalePreference = 'hi') => {
    const log: string[] = [];
    const host = { apply: vi.fn(), noteOffer: vi.fn() };
    const take = vi.fn();
    const note = vi.fn();
    const onEvent = vi.fn();
    const handle = updateEventSink({
      host: {
        ...host,
        state: vi.fn(),
        changed: vi.fn(),
        check: vi.fn(),
        installNow: vi.fn(),
        configure: vi.fn(),
        noteRollback: vi.fn(),
        attach: vi.fn(),
      },
      staging: { note },
      signals: { take },
      notesLocale: async () => localeState(preference, ['hi-IN']).resolved,
      onEvent,
      log: (line) => log.push(line),
    });
    return { handle, log, host, take, note, onEvent };
  };

  it('logs progress once per quarter and every other event, and passes each on', () => {
    const { handle, log, host, note, onEvent, take } = sink();
    for (const percent of [1, 10, 26, 30, 99]) handle({ type: 'progress', percent });
    handle({ type: 'staged' });
    expect(log).toEqual([
      '[update] {"type":"progress","percent":1}',
      '[update] {"type":"progress","percent":26}',
      '[update] {"type":"progress","percent":99}',
      '[update] {"type":"staged"}',
    ]);
    expect(host.apply).toHaveBeenCalledTimes(6);
    expect(note).toHaveBeenCalledTimes(6);
    expect(onEvent).toHaveBeenCalledTimes(6);
    expect(take).toHaveBeenCalledTimes(1);
  });

  it.each(['system', 'en', 'hi', 'es', 'pt-BR'] as const)(
    'release notes use the app’s beta locale policy for %s, even on a Hindi Mac',
    async (preference) => {
      const { handle, host } = sink(preference);
      const notes = { en: 'English', hi: 'हिन्दी', es: 'Español', 'pt-BR': 'Português' };
      handle({ type: 'release-info', version: '1.3.0', releaseNotes: JSON.stringify({ v: 1, notes }) });
      await vi.waitFor(() => expect(host.noteOffer).toHaveBeenCalled());
      expect(host.noteOffer).toHaveBeenCalledWith('1.3.0', {
        notes: notes[preference === 'system' ? 'en' : preference],
      });
    },
  );

  it("logs release notes by their size and gives the host the person's language", async () => {
    const { handle, log, host } = sink();
    const releaseNotes = JSON.stringify({ v: 1, notes: { en: 'English', hi: 'हिन्दी' } });
    handle({ type: 'release-info', version: '1.3.0', releaseNotes, releaseDate: '2026-10-14T00:00:00Z' });
    expect(log).toHaveLength(1);
    expect(log[0]).toContain(`"releaseNotes":"${releaseNotes.length} chars"`);
    await vi.waitFor(() => expect(host.noteOffer).toHaveBeenCalled());
    expect(host.noteOffer).toHaveBeenCalledWith('1.3.0', {
      notes: 'हिन्दी',
      releaseDate: Date.parse('2026-10-14T00:00:00Z'),
    });
  });
});

describe("About's status, step by step", () => {
  const state = (status: UpdateState['status']): UpdateState => ({
    version: '1.2.0',
    channel: 'beta',
    choice: 'beta',
    status,
    lastRollback: null,
  });
  const run = (events: UpdateEvent[], from: UpdateState['status'] = { kind: 'idle' }) => {
    let current = state(from);
    let offer: Offer = NO_OFFER;
    for (const event of events) {
      const step = stepStatus(event, { state: current, offer, now: () => 7 });
      offer = step.offer;
      if (step.status) current = { ...current, status: step.status };
    }
    return { status: current.status, offer };
  };

  it('downloads (a delta says so), then is ready with the notes the host was given', () => {
    const offered = run([
      { type: 'checking', feedUrl: 'https://x/' },
      { type: 'available', version: '1.3.0' },
      { type: 'delta' },
      { type: 'progress', percent: 140 },
    ]);
    expect(offered.status).toEqual({ kind: 'downloading', version: '1.3.0', percent: 100, delta: true });
    const notes = { ...offered.offer, notes: { notes: 'New', releaseDate: 5 } };
    const staged = stepStatus(
      { type: 'staged' },
      { state: state(offered.status), offer: notes, now: () => 7 },
    );
    expect(staged.status).toEqual({ kind: 'ready', version: '1.3.0', notes: 'New', releaseDate: 5 });
  });

  it('keeps a staged update shown through later checks and failures', () => {
    const ready = { kind: 'ready', version: '1.3.0' } as const;
    expect(run([{ type: 'checking', feedUrl: 'https://x/' }], ready).status).toEqual(ready);
    expect(run([{ type: 'error', message: 'offline' }], ready).status).toEqual(ready);
    expect(run([{ type: 'not-available', version: '1.2.0' }]).status).toEqual({ kind: 'idle', checkedAt: 7 });
    expect(run([{ type: 'error', message: 'offline' }]).status).toMatchObject({
      kind: 'error',
      error: { code: 'desktop.update_check_failed' },
    });
  });

  it('drops the notes of a different offer and has nothing to stage without one', () => {
    const first = { version: '1.3.0', notes: { notes: 'Old' }, delta: false };
    const next = stepStatus(
      { type: 'available', version: '1.4.0' },
      { state: state({ kind: 'idle' }), offer: first, now: () => 7 },
    );
    expect(next.offer).toEqual({ version: '1.4.0', notes: {}, delta: false });
    expect(run([{ type: 'staged' }]).status).toEqual({ kind: 'idle' });
  });
});
