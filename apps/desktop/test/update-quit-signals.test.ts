// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P3-B9: once an update is staged, SIGTERM, SIGINT and SIGHUP quit the normal way, once. */
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { QUIT_SIGNALS, quitSignals, type QuitSignal } from '../src/main/update/quit-signals';

function fakeProcess() {
  const emitter = new EventEmitter();
  return {
    source: {
      on: (signal: QuitSignal, listener: () => void) => emitter.on(signal, listener),
      removeListener: (signal: QuitSignal, listener: () => void) => emitter.removeListener(signal, listener),
    },
    emit: (signal: QuitSignal) => emitter.emit(signal),
    count: () => QUIT_SIGNALS.reduce((sum, signal) => sum + emitter.listenerCount(signal), 0),
  };
}

describe('quit signals after staging', () => {
  it('holds nothing until taken', () => {
    const proc = fakeProcess();
    quitSignals(proc.source, () => {});
    expect(proc.count()).toBe(0);
  });

  it('turns the first signal into a quit and lets the next one end the app', () => {
    const proc = fakeProcess();
    const quits: QuitSignal[] = [];
    const signals = quitSignals(proc.source, (signal) => quits.push(signal));
    signals.take();
    expect(proc.count()).toBe(QUIT_SIGNALS.length);
    expect(proc.emit('SIGTERM')).toBe(true);
    expect(quits).toEqual(['SIGTERM']);
    // Released: Node goes back to the default action, so a second signal is not caught here.
    expect(proc.count()).toBe(0);
    expect(proc.emit('SIGINT')).toBe(false);
    expect(quits).toEqual(['SIGTERM']);
  });

  it('takes them afresh for each staged update, without doubling them', () => {
    const proc = fakeProcess();
    const added: QuitSignal[] = [];
    const removed: QuitSignal[] = [];
    const source = {
      on: (signal: QuitSignal, listener: () => void) => {
        added.push(signal);
        return proc.source.on(signal, listener);
      },
      removeListener: (signal: QuitSignal, listener: () => void) => {
        removed.push(signal);
        return proc.source.removeListener(signal, listener);
      },
    };
    const quits: QuitSignal[] = [];
    const signals = quitSignals(source, (signal) => quits.push(signal));
    signals.take();
    signals.take();
    // Squirrel may have reset them under Node: removed and added again, so Node reinstalls its handler.
    expect(removed).toEqual([...QUIT_SIGNALS]);
    expect(added).toEqual([...QUIT_SIGNALS, ...QUIT_SIGNALS]);
    expect(proc.count()).toBe(QUIT_SIGNALS.length);
    proc.emit('SIGHUP');
    signals.take();
    proc.emit('SIGINT');
    expect(quits).toEqual(['SIGHUP', 'SIGINT']);
  });
});
