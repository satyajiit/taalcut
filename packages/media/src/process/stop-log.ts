// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the runner did to stop a process, for the error's detail: "ffmpeg stopped (cancelled) with q on stdin,
 * then SIGTERM after 2000 ms, ended by exit code 255", followed by the stderr tail.
 */
import { basename } from 'node:path';
import type { ProgramStop } from './end-policy';

export class StopLog {
  private readonly sent: string[] = [];
  private escalation = '';

  /** `command` is named by its basename, read only when a stop is described (a spawn that failed has none). */
  constructor(private readonly command: string) {}

  /** The program's own way out was used. */
  asked(program: ProgramStop): void {
    if (program.ask === 'none') return;
    this.sent.push(program.ask === 'end-of-input' ? 'the end of stdin' : `${program.ask.input} on stdin`);
  }

  /** SIGTERM went to the group `afterMs` after the stop. */
  terminated(afterMs: number): void {
    this.sent.push(afterMs === 0 ? 'SIGTERM' : `SIGTERM after ${afterMs} ms`);
  }

  /** What followed when SIGTERM wasn't enough (SIGKILL), appended to the outcome. */
  escalate(text: string): void {
    this.escalation = text;
  }

  detail(reason: string | undefined, how: string, stderrTail: string): string {
    const sent = this.sent.length > 0 ? this.sent.join(', then ') : 'nothing';
    const head = `${basename(this.command)} stopped (${String(reason)}) with ${sent}, ended by ${how}${this.escalation}`;
    return `${head}\n${stderrTail}`.trimEnd();
  }
}

/** The outcome of a process the caller stopped waiting for `afterMs` after the stop. */
export function leftRunning(afterMs: number): string {
  return (
    `nothing yet: still running ${afterMs} ms after the stop, left running and never killed ` +
    '(it may hold a hardware video session)'
  );
}
