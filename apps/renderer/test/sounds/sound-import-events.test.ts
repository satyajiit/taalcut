// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type ImportSession, type TransferFile, type DeviceRun } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { cableRun, importSession, setup, wifiFile } from './sound-event-fixtures';

describe('Wi-Fi import sound events', () => {
  it('announces the completed active batch once and drops historical terminal files', () => {
    const { sounds, handle } = setup();
    const first = wifiFile();
    const second = wifiFile({ sessionId: first.sessionId });
    const send = (payload: TransferFile) => handle({ type: 'transfer.file', at: 1, payload });
    send(wifiFile({ state: 'imported' }));
    send(first);
    send(second);
    send({ ...first, state: 'imported', updatedAt: 2 });
    expect(sounds.play).not.toHaveBeenCalled();
    send({ ...second, state: 'imported', updatedAt: 3 });
    send({ ...second, state: 'imported', updatedAt: 3 });
    expect(sounds.play.mock.calls).toEqual([['importDone', `wifi:${first.sessionId}:${second.id}:3`]]);
  });

  it.each(['failed', 'rejected', 'cancelled'] as const)('keeps partial %s batches silent', (state) => {
    const { sounds, handle } = setup();
    const first = wifiFile();
    const second = wifiFile({ sessionId: first.sessionId });
    for (const payload of [first, second, { ...first, state: 'imported' as const }, { ...second, state }]) {
      handle({ type: 'transfer.file', at: 1, payload });
    }
    expect(sounds.play).not.toHaveBeenCalled();
  });

  it('forgets a stopped session before a late completion', () => {
    const { sounds, handle } = setup();
    const file = wifiFile();
    handle({ type: 'transfer.file', at: 1, payload: file });
    handle({
      type: 'transfer.session',
      at: 2,
      payload: {
        id: file.sessionId,
        state: 'stopped',
        pairingResets: 0,
        devices: [],
        startedAt: 1,
        totals: { files: 1, done: 0, failed: 0, bytes: 1000, bytesDone: 0 },
      },
    });
    handle({ type: 'transfer.file', at: 3, payload: { ...file, state: 'imported' } });
    expect(sounds.play).not.toHaveBeenCalled();
  });
});

describe('cable import sound events', () => {
  it.each(['running', 'paused'] as const)('announces an observed %s run succeeding only once', (state) => {
    const { sounds, handle } = setup();
    const run = cableRun({ state });
    const send = (payload: DeviceRun) => handle({ type: 'transfer.deviceRun', at: 1, payload });
    send(cableRun({ state: 'succeeded' }));
    send(run);
    send({ ...run, state: 'succeeded' });
    send({ ...run, state: 'succeeded' });
    expect(sounds.play.mock.calls).toEqual([['importDone', `cable:${run.id}`]]);
  });

  it.each(['failed', 'cancelled'] as const)('keeps %s runs silent', (state) => {
    const { sounds, handle } = setup();
    const run = cableRun();
    handle({ type: 'transfer.deviceRun', at: 1, payload: run });
    handle({ type: 'transfer.deviceRun', at: 2, payload: { ...run, state } });
    expect(sounds.play).not.toHaveBeenCalled();
  });

  it.each(['failed', 'rejected', 'duplicates'] as const)(
    'keeps unsuccessful or %s-only runs silent',
    (field) => {
      const { sounds, handle } = setup();
      const run = cableRun();
      handle({ type: 'transfer.deviceRun', at: 1, payload: run });
      handle({
        type: 'transfer.deviceRun',
        at: 2,
        payload: {
          ...run,
          state: 'succeeded',
          totals: { ...run.totals, imported: field === 'duplicates' ? 0 : 1, [field]: 1 },
        },
      });
      expect(sounds.play).not.toHaveBeenCalled();
    },
  );
});

describe('local import sound snapshots', () => {
  it('seeds history silently and announces only observed active work finishing once', () => {
    const { sounds, observe } = setup();
    const old = importSession({ status: 'completed', finishedAt: 1 });
    const active = importSession();
    observe([old, active]);
    expect(sounds.play).not.toHaveBeenCalled();
    const done = { ...active, status: 'completed' as const, finishedAt: 2 };
    observe([old, done]);
    observe([old, done]);
    expect(sounds.play.mock.calls).toEqual([['importDone', `import:${active.id}:2`]]);
  });

  it.each(['files', 'folder', 'camera', 'dji', 'insta360', 'photos'] as const)(
    'announces a successful %s import',
    (method) => {
      const { sounds, observe } = setup();
      const session = importSession({ method, status: 'paused' });
      observe([session]);
      observe([{ ...session, status: 'completed', finishedAt: 2 }]);
      expect(sounds.play).toHaveBeenCalledWith('importDone', `import:${session.id}:2`);
    },
  );

  it('counts an archived camera original as completed work', () => {
    const { sounds, observe } = setup();
    const session = importSession({ method: 'dji' });
    observe([session]);
    observe([
      {
        ...session,
        status: 'completed',
        finishedAt: 2,
        progress: { ...session.progress, completedItems: 0, archivedItems: 1 },
      },
    ]);
    expect(sounds.play).toHaveBeenCalledWith('importDone', `import:${session.id}:2`);
  });

  it.each(['partial', 'failed', 'cancelled', 'interrupted'] as const)('keeps %s imports silent', (status) => {
    const { sounds, observe } = setup();
    const session = importSession();
    observe([session]);
    observe([{ ...session, status }]);
    expect(sounds.play).not.toHaveBeenCalled();
  });

  it('keeps failed-item and duplicate-only completion snapshots silent', () => {
    const { sounds, observe } = setup();
    const failed = importSession();
    const duplicate = importSession();
    observe([failed, duplicate]);
    observe([
      { ...failed, status: 'completed', progress: { ...failed.progress, failedItems: 1 } },
      {
        ...duplicate,
        status: 'completed',
        progress: { ...duplicate.progress, completedItems: 0, skippedItems: 1 },
      },
    ]);
    expect(sounds.play).not.toHaveBeenCalled();
  });

  it('does not infer a completion when a session appears already finished or leaves the snapshot', () => {
    const { sounds, observe } = setup();
    const active = importSession();
    observe([active]);
    observe([]);
    observe([{ ...active, status: 'completed' }, importSession({ status: 'completed' })]);
    expect(sounds.play).not.toHaveBeenCalled();
  });

  it.each(['phone-wifi', 'phone-cable'] as const)('uses the transfer stream exclusively for %s', (method) => {
    const { sounds, handle, observe } = setup();
    const session: ImportSession = importSession({ method });
    observe([session]);
    observe([{ ...session, status: 'completed', finishedAt: 2 }]);
    expect(sounds.play).not.toHaveBeenCalled();
    if (method === 'phone-wifi') {
      const file = wifiFile();
      handle({ type: 'transfer.file', at: 1, payload: file });
      handle({ type: 'transfer.file', at: 2, payload: { ...file, state: 'imported' } });
    } else {
      const run = cableRun();
      handle({ type: 'transfer.deviceRun', at: 1, payload: run });
      handle({ type: 'transfer.deviceRun', at: 2, payload: { ...run, state: 'succeeded' } });
    }
    observe([{ ...session, status: 'completed', finishedAt: 2 }]);
    expect(sounds.play).toHaveBeenCalledTimes(1);
    expect(sounds.play.mock.calls[0]?.[0]).toBe('importDone');
  });
});
