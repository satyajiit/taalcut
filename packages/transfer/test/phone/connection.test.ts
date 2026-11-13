// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import {
  initialConnection,
  LOST_AFTER,
  nextCheckMs,
  noteConnection,
  outcomeOf,
  POLL_MS,
  WAITING_AFTER_MS,
  // @ts-expect-error phone modules ship as plain JavaScript for the browser.
} from '../../phone/connection.mjs';

type State = { status: string; failures: number; since: number };
const run = (outcomes: Array<[string, number]>): State =>
  outcomes.reduce<State>((state, [outcome, at]) => noteConnection(state, outcome, at), initialConnection());

describe('the connection to the Mac', () => {
  it('shrugs off one missed check, and calls two in a row a lost connection', () => {
    expect(LOST_AFTER).toBe(2);
    expect(run([['network', 1_000]]).status).toBe('online');
    expect(run([['network', 1_000], ['network', 3_000]]).status).toBe('lost');
  });

  it('waits for the Mac after half a minute without an answer', () => {
    const lost = run([['network', 0], ['network', 2_000]]);
    expect(noteConnection(lost, 'network', WAITING_AFTER_MS - 1).status).toBe('lost');
    expect(noteConnection(lost, 'network', WAITING_AFTER_MS).status).toBe('waiting');
  });

  it("waits for the Mac at once when it answers that it isn't listening", () => {
    expect(run([['not-listening', 0]]).status).toBe('waiting');
  });

  it('is back online with the first good answer, and ignores answers that say nothing about it', () => {
    const waiting = run([['not-listening', 0]]);
    expect(noteConnection(waiting, 'ok', 5_000)).toEqual(initialConnection());
    expect(noteConnection(waiting, 'other', 5_000)).toBe(waiting);
  });

  it('checks every 2 s while online and backs off to 15 s while it waits', () => {
    expect(nextCheckMs(initialConnection())).toBe(POLL_MS);
    const delays = [2, 3, 4, 5, 6, 7].map((failures) => nextCheckMs({ status: 'lost', failures, since: 0 }));
    expect(delays).toEqual([4_000, 8_000, 15_000, 15_000, 15_000, 15_000]);
  });

  it('reads a failed request: no answer, not listening, a credential the Mac forgot, or anything else', () => {
    expect(outcomeOf(0)).toBe('network');
    expect(outcomeOf(404)).toBe('not-listening');
    expect(outcomeOf(401)).toBe('expired');
    expect(outcomeOf(429)).toBe('other');
    expect(outcomeOf(500)).toBe('other');
  });
});
