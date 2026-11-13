// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The setup text holds a bearer (security review SB-33). Main copies it and, two minutes later, clears the
 * clipboard if it still holds that text, so the key doesn't stay on the general pasteboard for every app to read;
 * Settings can copy it again. (Electron can't mark a pasteboard item concealed or transient.)
 */
import { attemptAsync, ok, type AsyncResult } from '@taalcut/core';

export const SETUP_ON_CLIPBOARD_MS = 120_000;

/** Electron 44's clipboard reads and writes text asynchronously. */
export interface SetupClipboard {
  writeText(text: string): void | Promise<void>;
  readText(): string | Promise<string>;
  clear(): void;
}

export type Schedule = (run: () => void, ms: number) => void;

const unrefTimer: Schedule = (run, ms) => void setTimeout(run, ms).unref();

export async function copyForAWhile(
  clipboard: SetupClipboard,
  text: string,
  schedule: Schedule = unrefTimer,
  log: (message: string) => void = (message) => console.warn(message),
): AsyncResult<void> {
  const written = await attemptAsync(async () => {
    await clipboard.writeText(text);
  });
  if (!written.ok) return written;
  schedule(() => {
    void attemptAsync(async () => clipboard.readText()).then((now) => {
      if (!now.ok) return log(`[mcp] clipboard not checked: ${now.error.code}`);
      if (now.value === text) clipboard.clear();
    });
  }, SETUP_ON_CLIPBOARD_MS);
  return ok(undefined);
}
