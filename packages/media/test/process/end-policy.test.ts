// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-K2: the end policy's plans. A run that may hold a hardware video session is asked, sent at most one
 * SIGTERM (only where SIGTERM is orderly), released, reported as a stall, and never SIGKILLed; any other run
 * keeps SIGTERM, then SIGKILL after the grace. Pure: no process runs here.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createEndPolicy,
  DEFAULT_STALL_AFTER_MS,
  FFMPEG_STOP,
  HELPER_STOP,
  PLAIN_STOP,
  type EndPlan,
  type ProcessStall,
} from '@taalcut/media';

const actions = (plan: EndPlan) => plan.steps.map((step) => `${step.action}@${step.afterMs}`);
const signals = (plan: EndPlan) =>
  plan.steps.filter((step) => step.action === 'terminate' || step.action === 'kill').length;

describe('the end policy', () => {
  const policy = createEndPolicy();

  it('keeps SIGTERM, then SIGKILL after the grace, for a run that holds nothing, whatever the program', () => {
    for (const program of [FFMPEG_STOP, HELPER_STOP, PLAIN_STOP]) {
      const plan = policy.plan({ holdsVideoSession: false }, program, 2000);
      expect(plan.mayKill).toBe(true);
      expect(actions(plan)).toEqual(['terminate@0', 'kill@2000']);
    }
  });

  it('asks FFmpeg with q, then sends one SIGTERM, releases the caller and reports a stall, never a SIGKILL', () => {
    const plan = policy.plan({ holdsVideoSession: true }, FFMPEG_STOP, 2000);
    expect(plan.mayKill).toBe(false);
    expect(actions(plan)).toEqual([
      'ask@0',
      'terminate@2000',
      'release@4000',
      `stall@${DEFAULT_STALL_AFTER_MS}`,
    ]);
    expect(signals(plan)).toBe(1);
  });

  it('never signals the helper (no SIGTERM handler: a SIGTERM would end it where it stands)', () => {
    const plan = policy.plan({ holdsVideoSession: true }, HELPER_STOP, 1000);
    expect(plan.mayKill).toBe(false);
    expect(actions(plan)).toEqual(['ask@0', 'release@2000', `stall@${DEFAULT_STALL_AFTER_MS}`]);
    expect(signals(plan)).toBe(0);
  });

  it('sends nothing at all to a program it can neither ask nor terminate in order', () => {
    const plan = policy.plan({ holdsVideoSession: true }, PLAIN_STOP, 500);
    expect(actions(plan)).toEqual(['release@1000', `stall@${DEFAULT_STALL_AFTER_MS}`]);
  });

  it('terminates at once a program that traps SIGTERM but cannot be asked', () => {
    const plan = policy.plan({ holdsVideoSession: true }, { ask: 'none', orderlySigterm: true }, 500);
    expect(actions(plan)).toEqual(['terminate@0', 'release@1000', `stall@${DEFAULT_STALL_AFTER_MS}`]);
  });

  it('never reports a stall before the caller is released', () => {
    const plan = createEndPolicy({ stallAfterMs: 100 }).plan({ holdsVideoSession: true }, FFMPEG_STOP, 2000);
    expect(actions(plan)).toEqual(['ask@0', 'terminate@2000', 'release@4000', 'stall@4000']);
  });

  it('sends stalls to the sink it was given, and to the console by default', () => {
    const seen: ProcessStall[] = [];
    const stall: ProcessStall = {
      pid: 42,
      command: '/x/ffmpeg',
      args: ['-i', 'a.mov'],
      reason: 'cancelled',
      afterMs: 60_000,
    };
    createEndPolicy({ onStall: (event) => seen.push(event) }).stalled(stall);
    expect(seen).toEqual([stall]);

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      createEndPolicy().stalled(stall);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toMatch(/pid 42 \(\/x\/ffmpeg -i a\.mov\).*60 s.*never killed/);
    } finally {
      warn.mockRestore();
    }
  });
});
