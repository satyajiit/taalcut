// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Main starts the lan utility on a transfer call and stops it 60 seconds
 * after Wi-Fi has stopped and nothing else holds it: a file still
 * `checking` or `importing`, an open `transfer.devices` stream, or a
 * device run whose latest state is `running`. The process's own 10-minute
 * idle stop is not this module.
 */
export const LAN_STOP_DELAY_MS = 60_000;

export interface LanLifecycleDeps {
  readonly start: () => void;
  readonly stop: () => Promise<void>;
  readonly now: () => number;
  readonly schedule: (ms: number, fn: () => void) => { cancel: () => void };
}

export interface LanLifecycle {
  /** First transfer.* call, and any call while the process should be up. */
  onTransferCall(): void;
  /**
   * A transfer.session payload. State 'stopped' arms the 60s timer.
   * Any other state (a new session) cancels it.
   */
  onSession(session: { readonly state: string }): void;
  /** A transfer.file payload. */
  onFile(file: { readonly id: string; readonly state: string }): void;
  /** True while a window is iterating transfer.devices. */
  onDevicesWatch(open: boolean): void;
  /** A transfer.deviceRun payload. Only `running` holds the process. */
  onDeviceRun(run: { readonly id: string; readonly state: string }): void;
  dispose(): void;
}

const HOLDING = new Set(['checking', 'importing']);

/** The 60s idle stop. A backwards clock jump does not fire it. */
function createIdleStop(deps: LanLifecycleDeps): {
  cancel(): void;
  arm(): void;
  armed(): boolean;
} {
  let ticket = 0;
  let pending: { cancel: () => void } | undefined;
  const cancel = (): void => {
    ticket += 1;
    const handle = pending;
    pending = undefined;
    handle?.cancel();
  };
  return {
    cancel,
    armed: () => pending !== undefined,
    arm() {
      cancel();
      const mine = ticket;
      const armedAt = deps.now();
      const handle = deps.schedule(LAN_STOP_DELAY_MS, () => {
        if (mine !== ticket) return;
        pending = undefined;
        // A clock that jumps backwards past the arm must not stop on that tick.
        if (deps.now() < armedAt) return;
        try {
          void Promise.resolve(deps.stop()).catch(() => undefined);
        } catch {
          // stop() must not escape the timer.
        }
      });
      if (mine !== ticket) {
        handle.cancel();
        return;
      }
      pending = handle;
    },
  };
}

/** Files, an open cable watch, and running imports. Each is a separate hold. */
function createHolds(): {
  held(): boolean;
  noteFile(id: string, state: string): void;
  /** True when a devices watch just closed. */
  noteDevices(open: boolean): boolean;
  /** `left` when a running import just ended, `entered` when one just started. */
  noteRun(id: string, state: string): 'entered' | 'left' | 'same';
} {
  const holding = new Map<string, string>();
  const running = new Set<string>();
  let devicesOpen = false;
  return {
    held: () => holding.size > 0 || devicesOpen || running.size > 0,
    noteFile(id, state) {
      if (HOLDING.has(state)) holding.set(id, state);
      else holding.delete(id);
    },
    noteDevices(open) {
      const was = devicesOpen;
      devicesOpen = open;
      return was && !open;
    },
    noteRun(id, state) {
      const was = running.has(id);
      if (state === 'running') running.add(id);
      else running.delete(id);
      if (!was && state === 'running') return 'entered';
      if (was && state !== 'running') return 'left';
      return 'same';
    },
  };
}

interface IdleFlags {
  wifiLive: boolean;
  stopWhenIdle: boolean;
}

/**
 * `usbReleased` is a transition off a real USB hold. That may arm even
 * after a transfer call cleared `stopWhenIdle`, and only when Wi-Fi is idle.
 * A file or run that was never holding must not push an armed deadline back.
 */
function releaseHold(
  idle: ReturnType<typeof createIdleStop>,
  holds: ReturnType<typeof createHolds>,
  flags: IdleFlags,
  usbReleased: boolean,
): void {
  if (holds.held()) {
    idle.cancel();
    return;
  }
  if (idle.armed()) return;
  if (flags.stopWhenIdle || (usbReleased && !flags.wifiLive)) idle.arm();
}

export function createLanLifecycle(deps: LanLifecycleDeps): LanLifecycle {
  // Idle until a session says otherwise, so a USB-only process can stop.
  const flags: IdleFlags = { wifiLive: false, stopWhenIdle: false };
  const idle = createIdleStop(deps);
  const holds = createHolds();
  const release = (usbReleased: boolean): void => releaseHold(idle, holds, flags, usbReleased);

  return {
    onTransferCall() {
      flags.stopWhenIdle = false;
      idle.cancel();
      deps.start();
    },
    onSession(session) {
      if (session.state !== 'stopped') {
        flags.wifiLive = true;
        flags.stopWhenIdle = false;
        idle.cancel();
        return;
      }
      flags.wifiLive = false;
      flags.stopWhenIdle = true;
      release(false);
    },
    onFile(file) {
      holds.noteFile(file.id, file.state);
      release(false);
    },
    onDevicesWatch(open) {
      const released = holds.noteDevices(open);
      if (open || released) release(released);
    },
    onDeviceRun(run) {
      const change = holds.noteRun(run.id, run.state);
      if (change !== 'same') release(change === 'left');
    },
    dispose() {
      idle.cancel();
    },
  };
}
