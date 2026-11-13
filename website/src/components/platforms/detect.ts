// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { PlatformId } from '#content/schema';

/** The site's three platforms in their default order: the server HTML's order, and anyone's we can't tell. */
export const DEFAULT_ORDER: readonly PlatformId[] = ['macos', 'ubuntu', 'windows'];

export interface Visitor {
  /** `navigator.userAgentData.platform` where the browser has it ("macOS", "Windows", "Linux", "Android"…). */
  readonly uaPlatform?: string | undefined;
  /** `navigator.userAgent`. */
  readonly userAgent: string;
  /** `navigator.maxTouchPoints`: an iPad asking for the desktop site says "Macintosh" but has touch points. */
  readonly touchPoints?: number;
}

/**
 * The visitor's computer, as one of the site's platforms, or null for a phone, a tablet or anything else. Client
 * hints first, then the user agent. Pure, for the test. Linux of any kind maps to Ubuntu, the Linux Taalcut is for.
 */
export function detectPlatform({ uaPlatform, userAgent, touchPoints = 0 }: Visitor): PlatformId | null {
  const hint = uaPlatform?.trim().toLowerCase() ?? '';
  if (hint) {
    if (hint === 'macos') return 'macos';
    if (hint === 'windows') return 'windows';
    if (hint === 'linux' || hint === 'ubuntu') return 'ubuntu';
    return null;
  }
  const ua = userAgent;
  if (/iPhone|iPad|iPod|Android|CrOS/i.test(ua)) return null;
  if (/Macintosh|Mac OS X/i.test(ua)) return touchPoints > 1 ? null : 'macos';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Linux|Ubuntu|X11/i.test(ua)) return 'ubuntu';
  return null;
}

/** The platforms with the visitor's first and the others in their default order. */
export function orderFor(yours: PlatformId | null): PlatformId[] {
  return yours ? [yours, ...DEFAULT_ORDER.filter((p) => p !== yours)] : [...DEFAULT_ORDER];
}
