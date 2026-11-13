// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Between Squirrel staging an update and the app quitting (P3-B9). Once the update main verified is staged, the
 * rollback is prepared (install-prep.ts); at quit, or Restart now, the guard starts. A quit that comes while the
 * rollback is still being prepared (an APFS clone and a small file: a second or two) is held until it is ready
 * and then quits again, so ShipIt never installs with no guard running.
 */
import type { UpdateChannel } from '@taalcut/core';
import type { InstallPrep } from './install-prep';
import type { UpdateEvent } from './updater';

export interface StagingTracker {
  note(event: UpdateEvent): void;
  /** Settles once the latest preparation has. */
  ready(): Promise<void>;
  /** A preparation is still running. */
  preparing(): boolean;
  /** Starts the guard for the prepared update (once). */
  arm(): void;
}

export function createStagingTracker(
  prep: InstallPrep,
  channel: () => UpdateChannel | null,
  log: (line: string) => void = console.warn,
): StagingTracker {
  let verified: string | undefined;
  let delta = false;
  let running = 0;
  let preparing: Promise<void> = Promise.resolve();
  const prepare = (to: string): void => {
    const current = channel();
    running += 1;
    preparing = prep
      .prepare({ to, delta, ...(current ? { channel: current } : {}) })
      .then((prepared) => {
        if (prepared.ok) log(`[update] rollback to ${prepared.value.from} prepared`);
        else log(`[update] no rollback for ${to}: ${prepared.error.code} ${prepared.error.detail ?? ''}`);
      })
      .finally(() => {
        running -= 1;
      });
  };
  return {
    note(event) {
      if (event.type === 'available' || event.type === 'delta-failed') delta = false;
      if (event.type === 'delta') delta = true;
      if (event.type === 'verified') verified = event.version;
      if (event.type === 'staged' && verified) prepare(verified);
    },
    ready: () => preparing,
    preparing: () => running > 0,
    arm() {
      const armed = prep.arm();
      if (!armed.ok) log(`[update] guard not started: ${armed.error.detail ?? armed.error.code}`);
      else if (armed.value) log('[update] guard started');
    },
  };
}

/** Electron's will-quit: start the guard, or hold the quit until the rollback is ready and quit again. */
export function armAtQuit(
  staging: StagingTracker,
  event: { preventDefault(): void },
  quit: () => void,
): void {
  if (!staging.preparing()) {
    staging.arm();
    return;
  }
  event.preventDefault();
  void staging.ready().then(quit);
}
