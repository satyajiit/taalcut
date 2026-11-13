// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One console line per process and reason for a decode-service route (IX2-V3, IX2-G3): which reads the service
 * leaves to FFmpeg and why, and the first it takes, without a line per file; and whether there is a service at all
 * (IX2-F14, helper-service.ts).
 */
export function tellOnce(route: string): (reason: string, line: string) => void {
  const told = new Set<string>();
  return (reason, line) => {
    if (told.has(reason)) return;
    told.add(reason);
    console.warn(`[media] ${route}: ${line}`);
  };
}
