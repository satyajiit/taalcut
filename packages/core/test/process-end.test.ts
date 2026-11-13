// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-K2: how a child process is ended. A run that may hold a hardware video session is asked, sent at most one
 * SIGTERM (only where SIGTERM is orderly), released, reported as a stall, and never SIGKILLed; any other run keeps
 * SIGTERM, then SIGKILL after the grace. Pure: no process runs here.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STALL_AFTER_MS,
  FFMPEG_STOP,
  HELPER_STOP,
  PLAIN_STOP,
  planProcessEnd,
  scheduleEnd,
  stallLine,
  type EndAction,
  type EndPlan,
} from '@taalcut/core';

const actions = (plan: EndPlan) => plan.steps.map((step) => `${step.action}@${step.afterMs}`);
const signals = (plan: EndPlan) =>
  plan.steps.filter((step) => step.action === 'terminate' || step.action === 'kill').length;
const holding = { holdsVideoSession: true };

describe('planProcessEnd', () => {
  it('keeps SIGTERM, then SIGKILL after the grace, for a run that holds nothing, whatever the program', () => {
    for (const program of [FFMPEG_STOP, HELPER_STOP, PLAIN_STOP]) {
      const plan = planProcessEnd({ holdsVideoSession: false }, program, 2000);
      expect(plan.mayKill).toBe(true);
      expect(actions(plan)).toEqual(['terminate@0', 'kill@2000']);
    }
  });

  it('asks FFmpeg with q, then one SIGTERM, releases the caller and reports a stall, never a SIGKILL', () => {
    const plan = planProcessEnd(holding, FFMPEG_STOP, 2000);
    expect(plan.mayKill).toBe(false);
    expect(actions(plan)).toEqual([
      'ask@0',
      'terminate@2000',
      'release@4000',
      `stall@${DEFAULT_STALL_AFTER_MS}`,
    ]);
    expect(signals(plan)).toBe(1);
  });

  it('never signals the helper, and sends nothing to a program it can neither ask nor stop in order', () => {
    expect(actions(planProcessEnd(holding, HELPER_STOP, 1000))).toEqual([
      'ask@0',
      'release@2000',
      `stall@${DEFAULT_STALL_AFTER_MS}`,
    ]);
    expect(actions(planProcessEnd(holding, PLAIN_STOP, 500))).toEqual(['release@1000', 'stall@60000']);
  });

  it('terminates at once a program that traps SIGTERM but cannot be asked (FFmpeg with -nostdin)', () => {
    const plan = planProcessEnd(holding, { ask: 'none', orderlySigterm: true }, 2000);
    expect(actions(plan)).toEqual(['terminate@0', 'release@4000', 'stall@60000']);
  });

  it('never reports a stall before the caller is released', () => {
    expect(actions(planProcessEnd(holding, FFMPEG_STOP, 2000, 100))).toEqual([
      'ask@0',
      'terminate@2000',
      'release@4000',
      'stall@4000',
    ]);
  });
});

describe('scheduleEnd and stallLine', () => {
  it('hands each step to its handler through the executor’s schedule', () => {
    const seen: string[] = [];
    const handler = (action: EndAction) => () => seen.push(action);
    const handlers = {
      ask: handler('ask'),
      terminate: handler('terminate'),
      kill: handler('kill'),
      release: handler('release'),
      stall: handler('stall'),
    };
    const delays: number[] = [];
    scheduleEnd(planProcessEnd(holding, FFMPEG_STOP, 10), handlers, (afterMs, run) => {
      delays.push(afterMs);
      run();
    });
    expect(seen).toEqual(['ask', 'terminate', 'release', 'stall']);
    expect(delays).toEqual([0, 10, 20, 60_000]);
  });

  it('names the pid and the command, cutting long argument lists', () => {
    const stall = {
      pid: 42,
      command: '/x/ffmpeg',
      args: ['-i', 'a.mov'],
      reason: 'cancelled',
      afterMs: 60_000,
    };
    expect(stallLine(stall)).toMatch(
      /^stall: pid 42 \(\/x\/ffmpeg -i a\.mov\).*60 s.*\(cancelled\).*never killed$/,
    );
    expect(stallLine({ ...stall, args: ['a', 'b', 'c'] }, 2)).toContain('(/x/ffmpeg a b …)');
  });
});
