// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where people speak in an asset's speech PCM (IX-A2): Silero VAD over the non-silent stretches only, a second
 * of PCM at a time (an hour never sits in memory), in time order. It stops as soon as one language-ID window
 * holds enough voice, so a talking head is scanned for a few seconds; a clip with little or no voice is scanned
 * whole, which is what tells the pipeline nobody speaks in it. Speech is Silero's hysteresis (the cleanup's
 * `speechSegments`), per stretch, each stretch a fresh VAD stream.
 */
import { CancelledError, err, ok, type AsyncResult } from '@taalcut/core';
import { msToFrame, readPcmChunks, type SpeechPcm } from '../asset-audio/wav-file';
import { CLEANUP_AUDIO_CONFIG } from '../cleanup/config';
import { speechSegments, type Span } from '../cleanup/segments';
import { VAD_WINDOW_MS, type VadEngine } from '../cleanup/vad';
import { languageWindow, totalSpeechMs, type LanguageWindow } from './language-window';

export interface SpeechScanOptions {
  /** Where to listen: the non-silent stretches, asset clock, sorted. */
  readonly regions: readonly Span[];
  readonly windowMs: number;
  readonly enoughSpeechMs: number;
  readonly padMs: number;
  /** PCM read per VAD push. Default 1 s. */
  readonly chunkMs?: number;
  readonly signal?: AbortSignal;
}

export interface SpeechScan {
  /** Voice found; all of it when `complete`. */
  readonly speechMs: number;
  readonly window: LanguageWindow | null;
  /** PCM the VAD read. */
  readonly scannedMs: number;
  /** False: it stopped early because a window held enough voice. */
  readonly complete: boolean;
  /** The voice heard, asset clock, sorted (LIB1-LANG: the Indian-language identifier's pieces come from these). */
  readonly spans: readonly Span[];
}

/** A window is looked for again only after this much more voice was heard (it can't have grown before). */
const RECHECK_VOICE_MS = 1000;

interface ScanState {
  /** Speech in the stretches scanned whole. */
  readonly found: Span[];
  scannedMs: number;
  /** Voiced VAD windows heard so far, in ms: an upper bound on any window's voice. */
  voicedMs: number;
  /** `voicedMs` when a window was last looked for. */
  checkedAt: number;
}

interface ScanContext {
  readonly pcm: SpeechPcm;
  readonly vad: VadEngine;
  readonly options: SpeechScanOptions;
  readonly chunkFrames: number;
  readonly window: (speech: readonly Span[]) => LanguageWindow | null;
}

/** Stopped early: the speech heard so far and the window that holds enough of it. */
interface EarlyStop {
  readonly speech: readonly Span[];
  readonly window: LanguageWindow;
}

function regionSpeech(probabilities: readonly number[], startMs: number): Span[] {
  return speechSegments(probabilities, VAD_WINDOW_MS).map((s) => ({
    startMs: startMs + s.startMs,
    endMs: startMs + s.endMs,
  }));
}

/** Counts the voiced windows among the new probabilities. */
function hear(state: ScanState, probabilities: number[], scored: Iterable<number>): void {
  for (const p of scored) {
    probabilities.push(p);
    if (p >= CLEANUP_AUDIO_CONFIG.vad.threshold) state.voicedMs += VAD_WINDOW_MS;
  }
}

/** A window with enough voice, looked for only once enough voice was heard and again after each more second. */
function enoughWindow(
  state: ScanState,
  context: ScanContext,
  speech: () => readonly Span[],
): EarlyStop | null {
  const { enoughSpeechMs } = context.options;
  if (state.voicedMs < enoughSpeechMs || state.voicedMs - state.checkedAt < RECHECK_VOICE_MS) return null;
  state.checkedAt = state.voicedMs;
  const heard = speech();
  const best = context.window(heard);
  return best && best.speechMs >= enoughSpeechMs ? { speech: heard, window: best } : null;
}

/** One non-silent stretch through a fresh VAD stream: an early stop, or null once the stretch is scanned whole. */
async function scanRegion(
  state: ScanState,
  context: ScanContext,
  region: Span,
): AsyncResult<EarlyStop | null> {
  const { pcm, options } = context;
  const stream = context.vad.stream();
  const probabilities: number[] = [];
  const startFrame = msToFrame(region.startMs);
  const startMs = (startFrame * 1000) / pcm.sampleRate;
  const range = { startFrame, endFrame: msToFrame(region.endMs) };
  const speechSoFar = () => [...state.found, ...regionSpeech(probabilities, startMs)];
  for await (const samples of readPcmChunks(pcm, range, context.chunkFrames, options.signal)) {
    const scored = await stream.push(samples, options.signal);
    if (!scored.ok) return scored;
    hear(state, probabilities, scored.value);
    state.scannedMs += (samples.length * 1000) / pcm.sampleRate;
    const early = enoughWindow(state, context, speechSoFar);
    if (early) return ok(early);
  }
  if (options.signal?.aborted) return err(CancelledError());
  state.found.push(...regionSpeech(probabilities, startMs));
  return ok(null);
}

export async function scanSpeech(
  pcm: SpeechPcm,
  vad: VadEngine,
  options: SpeechScanOptions,
): AsyncResult<SpeechScan> {
  const { windowMs, padMs } = options;
  const context: ScanContext = {
    pcm,
    vad,
    options,
    chunkFrames: msToFrame(options.chunkMs ?? 1000),
    window: (speech) => languageWindow(speech, { windowMs, durationMs: pcm.durationMs, padMs }),
  };
  const state: ScanState = { found: [], scannedMs: 0, voicedMs: 0, checkedAt: 0 };
  for (const region of options.regions) {
    const early = await scanRegion(state, context, region);
    if (!early.ok) return early;
    if (early.value) {
      const { speech, window } = early.value;
      return ok({
        speechMs: totalSpeechMs(speech),
        window,
        scannedMs: state.scannedMs,
        complete: false,
        spans: speech,
      });
    }
  }
  const window = context.window(state.found);
  return ok({
    speechMs: totalSpeechMs(state.found),
    window,
    scannedMs: state.scannedMs,
    complete: true,
    spans: state.found,
  });
}
