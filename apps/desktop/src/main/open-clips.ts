// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The clips the windows show (UX2 round 4), for the media cache in the jobs process: while a window shows a clip's
 * page, that clip's files stay in the cache however long it is watched. Main keeps the list, not the jobs process,
 * so a jobs process that restarts still has it: every change is written to the library (`saveOpenClips`), where the
 * jobs process reads it each time the cache is about to delete a file. The list is written empty when this starts,
 * before any utility process does. A page that goes elsewhere, a window that closes and a page whose renderer is
 * gone stop holding their clip. Electron-free, so unit-tested.
 */
import { idSchema, type AssetId } from '@taalcut/core';

/** The parts of a BrowserWindow read here. */
export interface ClipWindow {
  readonly id: number;
  on(event: 'closed', listener: () => void): unknown;
  readonly webContents: {
    getURL(): string;
    on(event: 'did-navigate' | 'did-navigate-in-page' | 'render-process-gone', listener: () => void): unknown;
  };
}

export interface OpenClips {
  /** Follows the window's page from now until the window closes. */
  watch(win: ClipWindow): void;
  /** The clips the windows show now, each once. */
  current(): AssetId[];
}

const assetId = idSchema<'Asset'>();
/** The clip page (the renderer's routes/_shell/library/$assetId.tsx). */
const CLIP_PAGE = /^\/library\/([^/]+)\/?$/;

/** The clip a page shows, by its URL; undefined for any other page. */
export function clipOf(url: string): AssetId | undefined {
  if (!URL.canParse(url)) return undefined;
  const page = CLIP_PAGE.exec(new URL(url).pathname);
  const clip = page ? assetId.safeParse(page[1]) : undefined;
  return clip?.success ? clip.data : undefined;
}

/**
 * `save` writes the whole list and says whether it was written. A list that wasn't is written again at the next
 * change (each write is the whole list), so a failed write is never left behind by a later one.
 */
export function createOpenClips(save: (assetIds: readonly AssetId[]) => boolean): OpenClips {
  const shown = new Map<number, AssetId>();
  const current = (): AssetId[] => [...new Set(shown.values())].sort();
  let written: string | undefined;
  const write = (): void => {
    const clips = current();
    const key = clips.join(' ');
    if (key === written) return;
    written = save(clips) ? key : undefined;
  };
  write();
  return {
    watch(win) {
      const id = win.id;
      const show = (clip: AssetId | undefined): void => {
        if (clip) shown.set(id, clip);
        else shown.delete(id);
        write();
      };
      const follow = (): void => show(clipOf(win.webContents.getURL()));
      win.webContents.on('did-navigate', follow);
      win.webContents.on('did-navigate-in-page', follow);
      // The page is gone until it loads again (did-navigate).
      win.webContents.on('render-process-gone', () => show(undefined));
      win.on('closed', () => show(undefined));
      follow();
    },
    current,
  };
}
