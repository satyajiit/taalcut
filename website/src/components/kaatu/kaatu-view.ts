// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The engine's view on the page: it writes Kaatu's frame straight into the DOM (data attributes on the layers React
 * rendered once), so a frame change never re-renders React. Writes only, no layout reads: frames are opacity and
 * background-position, moves and notes are transforms and opacity on the compositor.
 */
import { REDUCED_FADE } from '#lib/motion';
import type { KaatuBreath, KaatuView } from './kaatu-part';
import { facing, locate, type KaatuFrame } from './kaatu-frames';
import { playMove, type KaatuMove } from './kaatu-moves';
import { loadSheet, sheetState } from './kaatu-sheets';

export interface KaatuParts {
  /** The decorative drawing, `[data-slot="kaatu"]`: carries data-frame and data-facing. */
  readonly art: HTMLElement;
  readonly stage: HTMLElement;
  readonly breath: HTMLElement;
  /** The music notes' holder, when Kaatu dances. */
  readonly notes: HTMLElement | null;
}

const NOTE_MS = 900;

export class DomView implements KaatuView {
  private readonly layers: HTMLElement[];
  private readonly ghost: HTMLElement | null;
  private wanted: KaatuFrame | null = null;
  private current: KaatuFrame;
  private noteTurn = 0;

  constructor(private readonly parts: KaatuParts) {
    this.layers = [...parts.stage.querySelectorAll<HTMLElement>('[data-layer]')];
    this.ghost = parts.stage.querySelector<HTMLElement>('[data-slot="kaatu-ghost"]');
    this.current = (parts.art.dataset.frame as KaatuFrame | undefined) ?? 'center';
    const on = this.layers.findIndex((l) => l.hasAttribute('data-on'));
    if (on >= 0) void loadSheet(on).then(() => this.mark(on));
  }

  show(frame: KaatuFrame, fade: boolean): void {
    const { sheet, cell } = locate(frame);
    const state = sheetState(sheet);
    if (state === 'failed') return;
    if (state === 'loading') {
      // Keep what shows until the atlas is in: a frame never flashes empty.
      this.wanted = frame;
      void loadSheet(sheet).then(() => {
        this.mark(sheet);
        if (this.wanted === frame) this.show(frame, fade);
      });
      return;
    }
    this.wanted = null;
    if (fade && frame !== this.current) this.fadeOut(this.current);
    this.layers.forEach((layer, i) => {
      if (i === sheet) {
        layer.dataset.cell = String(cell);
        layer.setAttribute('data-on', '');
      } else layer.removeAttribute('data-on');
    });
    this.current = frame;
    this.parts.art.dataset.frame = frame;
    this.parts.art.dataset.facing = facing(frame);
  }

  move(move: KaatuMove): void {
    playMove(this.parts.stage, move);
  }

  breath(state: KaatuBreath): void {
    this.parts.breath.dataset.breath = state;
  }

  note(side: 'left' | 'right'): void {
    const holder = this.parts.notes;
    const notes = holder ? [...holder.children] : [];
    const note = notes[this.noteTurn++ % Math.max(notes.length, 1)] as HTMLElement | undefined;
    if (!note || typeof note.animate !== 'function') return;
    note.dataset.side = side;
    const drift = side === 'left' ? -40 : 40;
    const turn = side === 'left' ? -18 : 18;
    note.animate(
      [
        { opacity: 0, transform: 'translate(0, 0) scale(0.6) rotate(0deg)' },
        { opacity: 1, transform: `translate(${drift * 0.3}%, -40%) scale(1) rotate(${turn * 0.4}deg)`, offset: 0.25 },
        { opacity: 0, transform: `translate(${drift}%, -150%) scale(0.9) rotate(${turn}deg)` },
      ],
      { duration: NOTE_MS, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
    );
  }

  /** Gives the layer its image for good, so a later switch to it shows at once. */
  private mark(sheet: number): void {
    this.layers[sheet]?.setAttribute('data-loaded', '');
  }

  /** Reduced motion: the old frame stays on top for a moment and fades out over the new one. */
  private fadeOut(frame: KaatuFrame): void {
    const ghost = this.ghost;
    if (!ghost || typeof ghost.animate !== 'function') return;
    const { sheet, cell } = locate(frame);
    ghost.dataset.sheet = String(sheet);
    ghost.dataset.cell = String(cell);
    ghost.setAttribute('data-on', '');
    const fade = ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: REDUCED_FADE * 1000, easing: 'linear' });
    fade.onfinish = () => ghost.removeAttribute('data-on');
  }
}
