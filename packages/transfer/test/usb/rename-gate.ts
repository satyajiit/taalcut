// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Delayed I/O for two writers of one file, used through `vi.mock('node:fs/promises', …)`. Once armed, the
 * next rename into the target is held; the `nth` temp file opened beside the target after that lets it land,
 * and that open returns only once it has. So the held writer's rename always falls between the other
 * writer's open and its rename: on a busy Mac that happens by chance, here it happens every time.
 */
import type * as fsPromises from 'node:fs/promises';

export type FsPromises = typeof fsPromises;

interface Armed {
  readonly target: string;
  readonly nth: number;
  opens: number;
  release: (() => void) | null;
  landing: Promise<void> | null;
  landed: boolean;
  onHeld: () => void;
}

let armed: Armed | null = null;

export const renameGate = {
  /** Resolves once a rename into `target` is held. */
  arm(target: string, nth: number): Promise<void> {
    return new Promise((resolve) => {
      armed = { target, nth, opens: 0, release: null, landing: null, landed: false, onHeld: resolve };
    });
  },
  /** Whether the held rename has landed. */
  landed: (): boolean => armed?.landed ?? false,
  disarm(): void {
    armed?.release?.();
    armed = null;
  },
};

/** A temp file beside `target`: the fixed `<target>.tmp` or any `<target>.<…>.tmp`. */
function besideTarget(path: string, target: string): boolean {
  return path.startsWith(`${target}.`) && path.endsWith('.tmp');
}

export function gated(actual: FsPromises): FsPromises {
  const open = async (...args: Parameters<FsPromises['open']>): ReturnType<FsPromises['open']> => {
    const handle = await actual.open(...args);
    const gate = armed;
    if (gate?.release && besideTarget(String(args[0]), gate.target)) {
      gate.opens += 1;
      if (gate.opens === gate.nth) {
        gate.release();
        await gate.landing;
      }
    }
    return handle;
  };
  const rename = async (...args: Parameters<FsPromises['rename']>): ReturnType<FsPromises['rename']> => {
    const gate = armed;
    if (!gate || gate.release || String(args[1]) !== gate.target) return actual.rename(...args);
    let go: () => void = () => undefined;
    const released = new Promise<void>((resolve) => {
      go = resolve;
    });
    let settle: () => void = () => undefined;
    gate.landing = new Promise<void>((resolve) => {
      settle = resolve;
    });
    gate.release = go;
    gate.onHeld();
    await released;
    try {
      await actual.rename(...args);
      gate.landed = true;
    } finally {
      settle();
    }
  };
  return { ...actual, open, rename };
}
