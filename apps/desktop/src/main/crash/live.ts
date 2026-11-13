// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Live crash-reporting flag. Turning reporting on waits until the next launch;
 * turning it off clears this flag so the transport can drop the next envelope.
 */

let live = false;

export function crashReportingLive(): boolean {
  return live;
}

export function setCrashReportingLive(on: boolean): void {
  live = on;
}
