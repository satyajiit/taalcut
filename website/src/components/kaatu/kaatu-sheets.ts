// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which of the eight atlases a Kaatu needs, and loading them once for the whole page. The server HTML fetches only
 * the sheet of the frame it shows (kaatu.css gives a layer its image when it is on or loaded). The rest load when
 * Kaatu first comes on screen (what its own life uses) or on first contact (what pointing and poking use), so a page
 * never pays for frames it never shows.
 */
import { ANTICS, CALM_POKES, DIZZY, DOZE, POKES, SHY, THINKING, WAKE, type Clip } from './kaatu-acts';
import { KAATU_SHEETS, SHEETS, locate, type KaatuFrame } from './kaatu-frames';
import { IDLE_ANTICS, moodScript } from './kaatu-moods';
import { POSES } from './kaatu-poses';
import type { KaatuPart } from './kaatu-part';

const framesOf = (...clips: Clip[]): KaatuFrame[] => clips.flat().map((b) => b.frame);
const sheetsOf = (frames: readonly KaatuFrame[]): Set<number> => new Set(frames.map((f) => locate(f).sheet));
const TURNS = [0, 1, 2]; // directions, blinks, glances: turning and blinking

/** The sheets a part plays on its own: its opening and the life it settles into, and the dance when it has a beat. */
export function arrivalSheets(part: Omit<KaatuPart, 'reduce'>, dancing: boolean): Set<number> {
  if (part.pose) {
    const script = POSES[part.pose];
    const sheets = sheetsOf([script.frame, ...framesOf(script.act ?? [])]);
    return sheets;
  }
  const script = moodScript(part.mood, part.toward);
  const sheets = sheetsOf([script.home, script.still, ...framesOf(script.opening ?? [])]);
  if (script.life !== 'still') for (const s of TURNS) sheets.add(s);
  if (script.life === 'think') for (const s of sheetsOf(THINKING)) sheets.add(s);
  if (script.life === 'idle') for (const s of sheetsOf(framesOf(DOZE, WAKE, ...IDLE_ANTICS.map((a) => ANTICS[a]), ANTICS.look))) sheets.add(s);
  if (dancing) sheets.add(locate('bop-left').sheet);
  return sheets;
}

/** The sheets an interactive Kaatu needs once someone comes near: turning to look, every poke, dizzy, waking, shy. */
export function contactSheets(): Set<number> {
  const sheets = sheetsOf(framesOf(...POKES, ...CALM_POKES, DIZZY, WAKE, SHY));
  for (const s of TURNS) sheets.add(s);
  return sheets;
}

const ready = new Set<number>();
const failed = new Set<number>();
const pending = new Map<number, Promise<void>>();

/** True once a sheet's image is decoded (a frame on it shows at once), or it failed (its frames are skipped). */
export function sheetState(sheet: number): 'ready' | 'failed' | 'loading' {
  if (ready.has(sheet)) return 'ready';
  return failed.has(sheet) ? 'failed' : 'loading';
}

/** Loads and decodes one atlas, once per page. */
export function loadSheet(sheet: number): Promise<void> {
  if (ready.has(sheet) || failed.has(sheet)) return Promise.resolve();
  const url = KAATU_SHEETS[sheet];
  if (!url || typeof Image === 'undefined') return Promise.resolve();
  let promise = pending.get(sheet);
  if (!promise) {
    promise = new Promise<void>((resolve) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        const decoded = typeof image.decode === 'function' ? image.decode() : Promise.resolve();
        decoded.catch(() => undefined).then(() => {
          ready.add(sheet);
          resolve();
        });
      };
      image.onerror = () => {
        failed.add(sheet);
        resolve();
      };
      image.src = url;
    });
    pending.set(sheet, promise);
  }
  return promise;
}

/** Loads several sheets; resolves when all are in, or after `within` ms, whichever is first. */
export function loadSheets(sheets: Iterable<number>, within = 1500): Promise<void> {
  const all = Promise.all([...sheets].filter((s) => s >= 0 && s < SHEETS.length).map(loadSheet)).then(() => undefined);
  return Promise.race([all, new Promise<void>((resolve) => setTimeout(resolve, within))]);
}
