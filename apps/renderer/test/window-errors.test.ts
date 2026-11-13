// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P2-X5: the window's uncaught errors and rejections reach main's crashes.report, cut to its limits.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { forwardWindowErrors } from '../src/services/window-errors';

type Report = { kind: string; message: string; stack?: string };

function crashes(fail = false) {
  const reports: Report[] = [];
  const report = vi.fn((input: Report) => {
    reports.push(input);
    return fail ? Promise.reject(new Error('port closed')) : Promise.resolve();
  });
  return { reports, client: { report } };
}

function rejection(reason: unknown): Event {
  return Object.assign(new Event('unhandledrejection'), { reason });
}

let stop: (() => void) | undefined;
afterEach(() => {
  stop?.();
  stop = undefined;
  vi.restoreAllMocks();
});

describe('window errors', () => {
  it('forwards an uncaught error with its stack, and a rejection with its reason', async () => {
    const { reports, client } = crashes();
    stop = forwardWindowErrors(window, client);
    const error = new Error('boom');
    window.dispatchEvent(new ErrorEvent('error', { error, message: 'Uncaught Error: boom' }));
    window.dispatchEvent(rejection('not an error'));
    await vi.waitFor(() => expect(reports).toHaveLength(2));
    expect(reports[0]).toEqual({ kind: 'error', message: 'boom', stack: error.stack });
    expect(reports[1]).toEqual({ kind: 'unhandledrejection', message: 'not an error' });
  });

  it("cuts the text to the contract's limits", async () => {
    const { reports, client } = crashes();
    stop = forwardWindowErrors(window, client);
    const error = new Error('x'.repeat(3000));
    error.stack = 'y'.repeat(20_000);
    window.dispatchEvent(rejection(error));
    await vi.waitFor(() => expect(reports).toHaveLength(1));
    expect(reports[0]?.message).toHaveLength(2000);
    expect(reports[0]?.stack).toHaveLength(16_000);
  });

  it('logs a report main refused, without reporting it again, and stops when asked', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { reports, client } = crashes(true);
    stop = forwardWindowErrors(window, client);
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('first') }));
    await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
    expect(reports).toHaveLength(1);
    stop();
    stop = undefined;
    // A rejection: Vitest's own jsdom handler reports an ErrorEvent no page listener takes.
    window.dispatchEvent(rejection(new Error('second')));
    expect(reports).toHaveLength(1);
  });
});
