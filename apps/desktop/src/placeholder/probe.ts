// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The placeholder renderer's only script (static/renderer-placeholder, used
 * by the launch tests until apps/renderer is built). It connects to main the
 * way the renderer does and leaves the client on window.taalcutProbe, so the
 * tests drive real calls: renderer → main → agent and jobs. Never part of
 * the real renderer.
 */
import { connectToMain, type AppClient, type MainWorldLike } from '@taalcut/core';

export interface TaalcutProbe {
  /** The app client, or null without a preload bridge. Rejects if main never answers. */
  readonly client: Promise<AppClient | null>;
}

const page = globalThis as unknown as MainWorldLike & { taalcutProbe?: TaalcutProbe };

page.taalcutProbe = {
  client: connectToMain(page).then((connected) => {
    if (!connected.ok) throw new Error(connected.error.code);
    return connected.value?.client ?? null;
  }),
};
