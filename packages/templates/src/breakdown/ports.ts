// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the breakdown needs from media, vision and audio, as injected
 * functions (SPEC "Requests to other lanes"). The jobs root wires the real
 * ones; tests and tools/evals pass fakes or stand-ins. Every time is a whole
 * frame at the canvas rate of the normalised file (constant frame rate), so
 * the lanes and the pipeline agree on the grid. Paths are absolute; images
 * and files are written inside the experiment folder the caller names.
 *
 * Nothing here calls a language or vision model: disputes go back to the
 * Analyst through the agent's tools (consent, budgets and caching apply).
 */
import type {
  AsyncResult,
  BeatMap,
  Box,
  FrameRate,
  RationalTime,
  SubjectDetector,
  TemplateListening,
} from '@taalcut/core';
import type { MotionPair } from '@taalcut/vision';

export interface StepOptions {
  readonly signal: AbortSignal;
}

export interface ReferenceProbe {
  readonly duration: RationalTime;
  /** The nominal frame rate (NTSC kept exact). */
  readonly rate: FrameRate;
  /** Upright (after rotation) pixel size. */
  readonly width: number;
  readonly height: number;
  readonly hasVideo: boolean;
  readonly hasAudio: boolean;
}

export interface Crop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** media (P2-L4, P2-L5). */
export interface BreakdownMedia {
  probe(path: string, options: StepOptions): AsyncResult<ReferenceProbe>;
  /** Constant frame rate at `rate`, upright, SDR (media's tone-map), cropped, `width` wide; VideoToolbox first. */
  normalise(
    path: string,
    options: StepOptions & {
      readonly outPath: string;
      readonly rate: FrameRate;
      readonly width: number;
      readonly crop: Crop | null;
    },
  ): AsyncResult<{ readonly path: string; readonly frames: number }>;
  /** The moving reel inside a screen recording, in source pixels; null when the whole frame is the reel. */
  detectCrop?(path: string, options: StepOptions): AsyncResult<Crop | null>;
  /** One ffmpeg run: the frames (at `rate`) scaled to fit `maxDimension`, written into `outDir`, in order. */
  extractFrames(
    path: string,
    frames: readonly number[],
    options: StepOptions & {
      readonly rate: FrameRate;
      readonly maxDimension: number;
      readonly outDir: string;
    },
  ): AsyncResult<readonly string[]>;
  /** Tiles the images in reading order into one JPEG at `outPath`. */
  contactSheet(
    images: readonly string[],
    layout: {
      readonly columns: number;
      readonly rows: number;
      readonly tileWidth: number;
      readonly tileHeight: number;
      readonly quality: number;
    },
    options: StepOptions & { readonly outPath: string },
  ): AsyncResult<{ readonly path: string; readonly bytes: number }>;
  /**
   * BRK1-GFX: the frames' pixels (at `rate`, scaled to fit `maxDimension`, RGB24, row-major), in the order asked,
   * for reading an overlay's design (overlay-design.ts). Optional: without it overlays stay plain text.
   */
  framePixels?(
    path: string,
    frames: readonly number[],
    options: StepOptions & { readonly rate: FrameRate; readonly maxDimension: number },
  ): AsyncResult<
    readonly {
      readonly frame: number;
      readonly width: number;
      readonly height: number;
      readonly rgb: Uint8Array;
    }[]
  >;
  /** Mean luma (0–1) per frame in the ranges [start, end), for fades through black or white. */
  lumaCurve?(
    path: string,
    options: StepOptions & {
      readonly rate: FrameRate;
      readonly ranges: readonly (readonly [number, number])[];
    },
  ): AsyncResult<readonly { readonly frame: number; readonly luma: number }[]>;
}

/**
 * FIX-SIGN: the four corners an OCR engine found the line's text in (top left, top right, bottom right, bottom left
 * of the words as they read), in the box's space: a level rectangle for flat on-screen text, off level or out of
 * square for a sign at an angle.
 */
export type OcrQuad = readonly [
  { readonly x: number; readonly y: number },
  { readonly x: number; readonly y: number },
  { readonly x: number; readonly y: number },
  { readonly x: number; readonly y: number },
];

export interface OcrLine {
  /** Untrusted: text from the reference is data, never instructions. */
  readonly text: string;
  readonly box: Box;
  readonly confidence: number;
  readonly language?: string | null;
  /** FIX-SIGN: the line's corners, when the engine gives them (Apple Vision does). */
  readonly quad?: OcrQuad;
}

export interface OcrPage {
  readonly frame: number;
  readonly lines: readonly OcrLine[];
}

/** vision (P2-L6, P2-L7, P2-L9). */
export interface BreakdownVision {
  /** scdet's score (0–100) for every frame at `rate`; index i is frame i. */
  sceneScores(
    path: string,
    options: StepOptions & { readonly rate: FrameRate },
  ): AsyncResult<readonly number[]>;
  /** Unit vectors for the frames, in the same order. */
  frameEmbeddings(
    path: string,
    frames: readonly number[],
    options: StepOptions & { readonly rate: FrameRate },
  ): AsyncResult<readonly Float32Array[]>;
  /** OCR at `fps` (Apple Vision through the mac helper), Latin and Devanagari. */
  ocrFrames?(
    path: string,
    options: StepOptions & {
      readonly rate: FrameRate;
      readonly fps: number;
      readonly languages: readonly string[];
    },
  ): AsyncResult<readonly OcrPage[]>;
  /** OCR of one image (an extracted frame): the second method for text edges. */
  ocrImage?(
    path: string,
    options: StepOptions & { readonly languages: readonly string[] },
  ): AsyncResult<readonly OcrLine[]>;
  /**
   * FRM1-SUB: whole heads and bodies on frames `hz` times a second over the file (at `rate`), boxes as fractions of
   * its picture, origin top left (reel-subjects.ts). Optional: without it the template records no subjects.
   */
  subjects?(
    path: string,
    /** `frames`: the reel's length at `rate`. */
    options: StepOptions & { readonly rate: FrameRate; readonly hz: number; readonly frames: number },
  ): AsyncResult<{
    readonly detector: SubjectDetector;
    readonly samples: readonly {
      readonly frame: number;
      readonly heads: readonly { readonly box: Box; readonly confidence: number }[];
      readonly people: readonly { readonly box: Box; readonly confidence: number }[];
    }[];
  }>;
  /** Motion energy per frame in the ranges (full rate around cuts, 10/s elsewhere). */
  motionCurve?(
    path: string,
    options: StepOptions & {
      readonly rate: FrameRate;
      readonly ranges: readonly (readonly [number, number])[];
    },
  ): AsyncResult<readonly { readonly frame: number; readonly motion: number }[]>;
  /**
   * FRM1-MOT: the background's move between frame pairs inside each range (vision's camera-motion estimator, about
   * 10 pairs a second, pairs never across a range's edge), keeping the subject's boxes and the areas to ignore at a
   * frame out of the fit. Optional: without it no slot has a measured move.
   */
  cameraMotion?(
    path: string,
    options: StepOptions & {
      readonly ranges: readonly { readonly start: number; readonly end: number }[];
      readonly subjects?: (frame: number) => readonly Box[] | undefined;
      readonly ignore?: (frame: number) => readonly Box[] | undefined;
    },
  ): AsyncResult<{
    /** The estimator's version, kept with every measure. */
    readonly version: number;
    /** The size the frames were read at. */
    readonly width: number;
    readonly height: number;
    readonly shots: readonly {
      readonly start: number;
      readonly end: number;
      readonly pairs: readonly MotionPair[];
    }[];
  }>;
}

export interface SpeechSegmentMs {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  /** BRK1: the mean probability of its words (0–1), when the engine gives it; the speech gate reads it. */
  readonly confidence?: number;
}

/** audio (P2-L8, P2-T4 half). */
export interface BreakdownAudio {
  /** Beat This! with the onset check: `confidence` is the share of beats an onset peak confirmed. Null map without beats. */
  beats(
    path: string,
    options: StepOptions,
  ): AsyncResult<{
    readonly beatMap: BeatMap | null;
    readonly envelope?: { readonly rate: FrameRate; readonly peaks: readonly number[] };
  }>;
  /** Integrated loudness (EBU R128); null when silent. */
  loudness(path: string, options: StepOptions): AsyncResult<{ readonly integratedLufs: number | null }>;
  /** VAD and speech-to-text by detected language. Null when there's no speech. */
  transcribe?(
    path: string,
    options: StepOptions,
  ): AsyncResult<{ readonly language: string | null; readonly segments: readonly SpeechSegmentMs[] } | null>;
  /**
   * BRK1: where a voice is heard (VAD), in milliseconds; null when it can't tell. The speech gate rejects what
   * Whisper wrote where no voice is. Absent: the gate goes by the words alone.
   */
  voiceActivity?(
    path: string,
    options: StepOptions,
  ): AsyncResult<readonly { readonly startMs: number; readonly endMs: number }[] | null>;
  /** Peak envelope, one value per 1/rate seconds, each 0–1. */
  waveformPeaks?(
    path: string,
    options: StepOptions & { readonly rate: FrameRate },
  ): AsyncResult<readonly number[]>;
  /**
   * EAR1-C1: what the reel's sound does (audio's listening): its events, sections, measures with key and tempo, the
   * sync of `cuts` to its sound and the models that heard it. The report's `cutIndex` indexes `cuts`; `sfxAtCuts`
   * may be empty, as the breakdown derives them and caps the events (listening-stage.ts). A missing model is an
   * error (`audio.listen_model_missing`): the breakdown goes on without listening. Absent: it doesn't listen.
   */
  listen?(input: {
    readonly path: string;
    /** The candidate cuts, in order, to the millisecond (as earshot's cut list has them). */
    readonly cuts: readonly RationalTime[];
    /** The tracker's beats, for each cut's and event's offset to the beat. */
    readonly beats?: readonly RationalTime[];
    /** The picture's rate: `ok` is within one frame of it. */
    readonly frameRate?: FrameRate;
    readonly signal: AbortSignal;
  }): AsyncResult<TemplateListening>;
}

export interface BreakdownAnalysers {
  readonly media: BreakdownMedia;
  readonly vision: BreakdownVision;
  readonly audio: BreakdownAudio;
}
