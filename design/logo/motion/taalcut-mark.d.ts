// Types for <taalcut-mark> (taalcut-mark.js). React 19 passes these props and events to
// the custom element natively; this file makes them type-check in JSX.
//
//   import '<path>/design/logo/motion/taalcut-mark.js';
//   <taalcut-mark state="progress" progress={0.42} label="Rendering" onsam={done} />

import type { DetailedHTMLProps, HTMLAttributes, Ref } from 'react';

export type TaalcutMarkMotion = 'count-in' | 'tihai' | 'tap';
export type TaalcutMarkState = 'idle' | 'keep-time' | 'thinking' | 'progress';

/** Sent on every beat a motion plays, so sound can follow the mark. */
export interface TaalcutBeatDetail {
  /** 1–10 within jhaptaal's cycle. */
  matra: number;
  /** The theka syllable for that beat: dhi, na or ti. */
  bol: string;
  /** Tala sign: 'X' (beat one), '2', '0' (the empty beat), '3', or ''. */
  sign: string;
  /** Arc index, clockwise from the top: 0 beat one, 1 clap, 2 empty beat, 3 clap. */
  arc: number;
  /** True for the return to beat one that ends a count-in, tihai or progress cycle. */
  landing: boolean;
}

export declare class TaalcutMarkElement extends HTMLElement {
  variant: 'symbol' | 'lockup';
  palette: 'four' | 'two' | 'mono';
  state: TaalcutMarkState;
  /** Tempo for state="keep-time": the reference reel's BPM, folded into 60–180. */
  bpm: number;
  /** 0–1, for state="progress". */
  progress: number;
  /** 'auto' follows prefers-reduced-motion; 'reduced' and 'full' override it (an app setting). */
  motion: 'auto' | 'full' | 'reduced';
  /** Accessible name. Defaults to "Taalcut", or "Progress" in the progress state. */
  label: string;
  readonly reducedMotion: boolean;
  play(name: TaalcutMarkMotion): Promise<void>;
  stop(): void;
  scrub(name: TaalcutMarkMotion | 'keep-time' | 'thinking', ms: number): void;
  addEventListener(type: 'beat', listener: (event: CustomEvent<TaalcutBeatDetail>) => void, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: 'sam' | 'motionend', listener: (event: CustomEvent) => void, options?: boolean | AddEventListenerOptions): void;
  addEventListener(type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions): void;
}

export interface TaalcutMarkProps extends Omit<DetailedHTMLProps<HTMLAttributes<TaalcutMarkElement>, TaalcutMarkElement>, 'ref'> {
  ref?: Ref<TaalcutMarkElement>;
  variant?: 'symbol' | 'lockup';
  palette?: 'four' | 'two' | 'mono';
  state?: TaalcutMarkState;
  bpm?: number;
  progress?: number;
  motion?: 'auto' | 'full' | 'reduced';
  label?: string;
  /** Plays the count-in on mount; 'session' plays it once per browser session. */
  autoplay?: boolean | 'session';
  onbeat?: (event: CustomEvent<TaalcutBeatDetail>) => void;
  onsam?: (event: CustomEvent) => void;
  onmotionend?: (event: CustomEvent<{ motion: string }>) => void;
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'taalcut-mark': TaalcutMarkProps;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'taalcut-mark': TaalcutMarkElement;
  }
}
