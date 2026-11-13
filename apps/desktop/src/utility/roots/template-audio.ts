// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The breakdown's audio analysers in the jobs process: Beat This! on the ORT
 * WebGPU route (audio's tracker, with its onset check and envelope) from the
 * `beat-this` component, EBU R128 loudness from media, and speech segments
 * from whisper.cpp on Metal (`whisper-cpp` and `whisper-small-q8-0`).
 *
 * Missing beat or speech models are installed through the component manager on
 * first use. Test builds with no components (TAALCUT_TEST_STANDIN_ANALYSERS=1)
 * never download: they track beats with a stand-in (template-standins.ts) and
 * skip speech.
 *
 * EAR1-C1: the reel is heard by the process's listen service (audio-listen.ts),
 * CLAP and AST installed on first use like the beat model (never in a test
 * build with stand-ins: there a missing model is `listening_unavailable`), with
 * the reel's own critique metrics measured over the same cuts (K1).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok, RationalTime, type AsyncResult, type ComputeFallbackEvent } from '@taalcut/core';
import {
  audioPass,
  createBeatTracker,
  createOrtBeatRuntime,
  createWhisperEngine,
  decodeListenSource,
  FILM_METRIC_IDS,
  filmMetrics,
  ListenUnavailable,
  musicWindows,
  type AnalyseSoundRequest,
  type BeatDevicePlan,
  type ListenService,
  type MusicWindow,
  type SoundAnalysis,
} from '@taalcut/audio';
import { measureLoudness, runFfmpeg, type MediaContext } from '@taalcut/media';
import { breakdownListener, type BreakdownAudio, type SpeechSegmentMs } from '@taalcut/templates';

export const BEAT_COMPONENT = 'beat-this';
const WHISPER_CLI_COMPONENT = { id: 'whisper-cpp', file: 'whisper-cli' } as const;
const WHISPER_MODEL_COMPONENT = { id: 'whisper-small-q8-0', file: 'ggml-small-q8_0.bin' } as const;

/** Under this a mix is silence (EBU R128 gates at −70 LUFS). */
const SILENT_LUFS = -70;

/** The component manager, as the breakdown and the fetcher use it. */
export interface ComponentLookup {
  get(id: string): Promise<{ readonly path: string; readonly file?: string } | undefined>;
  install(id: string, options?: { readonly signal?: AbortSignal }): AsyncResult<{ readonly path: string }>;
}

export interface AudioAnalyserDeps {
  readonly media: () => AsyncResult<MediaContext>;
  readonly components: () => ComponentLookup;
  readonly onFallback: (event: ComputeFallbackEvent) => void;
  /** Beat This!'s devices on this machine (machine-accelerators.ts's machineBeatPlan): CUDA, WebGPU, then the CPU. */
  readonly beatPlan: () => Promise<BeatDevicePlan>;
  /** Test builds only: beats when the model isn't installed, with no download. */
  readonly standinBeats?: () => Promise<BreakdownAudio['beats']>;
  /** EAR1-C1: the process's listen service (audio-listen.ts's ListenServiceToken); absent: no listening. */
  readonly listen?: () => ListenService | undefined;
  readonly log?: (message: string) => void;
}

const seconds = (times: AnalyseSoundRequest['cuts']) => (times ?? []).map((t) => RationalTime.toSeconds(t));

/** K1's audio pass over the reel (its decode, loudness curves and onsets), started beside the analysis. */
async function reelPass(deps: AudioAnalyserDeps, service: ListenService, request: AnalyseSoundRequest) {
  if (!request.path) return null;
  const media = await deps.media();
  if (!media.ok) return null;
  const signal = request.signal ? { signal: request.signal } : {};
  const decoded = await decodeListenSource(request.path, { media: media.value, ...signal });
  if (!decoded.ok) return null;
  return {
    decoded: decoded.value,
    pass: await audioPass(decoded.value.audio, await service.deps.spectrograms()),
  };
}

/**
 * K1: the reel's own critique metrics (audio's filmMetrics, every FILM_METRIC_IDS one) over the cuts it was heard
 * against, with the AudioSet music windows when the models ran; null when they can't be measured.
 */
async function reelCritiqueMetrics(
  service: ListenService,
  started: ReturnType<typeof reelPass> | undefined,
  request: AnalyseSoundRequest,
  analysis: SoundAnalysis,
): Promise<Record<string, number | null> | null> {
  const reel = await started;
  if (!reel) return null;
  let music: MusicWindow[] | null = null;
  if (analysis.model?.ast && service.deps.models) {
    const set = await service.deps.models();
    const windows = await musicWindows(set.models.ast, reel.decoded.source.samples, request.signal);
    music = windows.ok ? windows.value : null;
  }
  const film = filmMetrics({
    pass: reel.pass,
    picture: { cuts: seconds(request.cuts), ...(request.frameRate ? { frameRate: request.frameRate } : {}) },
    music,
    beats: seconds(request.beats),
    tempo: analysis.measures?.tempo?.bpm ?? null,
  });
  return Object.fromEntries(FILM_METRIC_IDS.map((id) => [id, film.metrics[id]]));
}

/** EAR1-C1: BreakdownAudio.listen over the listen service; K1's audio pass runs while the models listen. */
function reelListener(deps: AudioAnalyserDeps, service: () => ListenService | undefined) {
  const passes = new WeakMap<AnalyseSoundRequest, ReturnType<typeof reelPass>>();
  return breakdownListener(
    async (request) => {
      const listen = service();
      if (!listen) return err(ListenUnavailable({ reason: 'no_listen_service' }));
      passes.set(
        request,
        reelPass(deps, listen, request).catch(() => null),
      );
      return listen.analyse(request);
    },
    {
      install: !deps.standinBeats,
      critiqueMetrics: async (request, analysis) => {
        const listen = service();
        return listen ? reelCritiqueMetrics(listen, passes.get(request), request, analysis) : null;
      },
    },
  );
}

export function breakdownAudio(deps: AudioAnalyserDeps): BreakdownAudio {
  // One ORT runtime for the process, on the probe's devices: it remembers its choice and logs a CPU one once.
  let runtime: ReturnType<typeof createOrtBeatRuntime> | undefined;
  const onnx = () => (runtime ??= createOrtBeatRuntime(deps.onFallback, deps.beatPlan));

  /** The installed model's folder, or the test build's stand-in when there is none. */
  async function tracker(
    signal: AbortSignal,
  ): AsyncResult<{ readonly dir: string } | { readonly standin: BreakdownAudio['beats'] }> {
    const installed = await deps.components().get(BEAT_COMPONENT);
    if (installed) return ok({ dir: installed.path });
    if (deps.standinBeats) return ok({ standin: await deps.standinBeats() });
    deps.log?.(`[templates] installing ${BEAT_COMPONENT} for the breakdown's beats`);
    const fresh = await deps.components().install(BEAT_COMPONENT, { signal });
    return fresh.ok ? ok({ dir: fresh.value.path }) : fresh;
  }

  async function resolveComponentFile(
    spec: { readonly id: string; readonly file: string },
    signal: AbortSignal,
  ): AsyncResult<string | null> {
    const installed = await deps.components().get(spec.id);
    if (installed) return ok(installed.file ?? join(installed.path, spec.file));
    deps.log?.(`[templates] installing ${spec.id} for the breakdown's speech`);
    const fresh = await deps.components().install(spec.id, { signal });
    if (!fresh.ok) return fresh.error.code === 'core.not_found' ? ok(null) : fresh;
    return ok(join(fresh.value.path, spec.file));
  }

  return {
    async beats(path, { signal }) {
      const chosen = await tracker(signal);
      if (!chosen.ok) return chosen;
      if ('standin' in chosen.value) return chosen.value.standin(path, { signal });
      const media = await deps.media();
      if (!media.ok) return media;
      const beats = createBeatTracker({
        onnx: onnx(),
        modelDir: chosen.value.dir,
        media: media.value,
        onFallback: deps.onFallback,
      });
      const tracked = await beats.trackBeats({ path }, { signal });
      if (!tracked.ok) return tracked;
      return ok({ beatMap: tracked.value.beatMap, envelope: tracked.value.envelope });
    },

    async loudness(path, { signal }) {
      const media = await deps.media();
      if (!media.ok) return media;
      const measured = await measureLoudness(path, media.value, { signal });
      if (!measured.ok) return measured;
      const lufs = measured.value.integratedLufs;
      return ok({ integratedLufs: Number.isFinite(lufs) && lufs > SILENT_LUFS ? lufs : null });
    },

    ...(deps.listen ? { listen: reelListener(deps, deps.listen) } : {}),

    ...(deps.standinBeats
      ? {}
      : {
          async transcribe(path, { signal }) {
            const cli = await resolveComponentFile(WHISPER_CLI_COMPONENT, signal);
            if (!cli.ok) return cli;
            const model = await resolveComponentFile(WHISPER_MODEL_COMPONENT, signal);
            if (!model.ok) return model;
            if (!cli.value || !model.value) return ok(null);
            const media = await deps.media();
            if (!media.ok) return media;
            const dir = await mkdtemp(join(tmpdir(), 'taalcut-breakdown-speech-'));
            try {
              const wav = join(dir, 'speech.wav');
              const extracted = await runFfmpeg(
                media.value,
                ['-v', 'error', '-i', path, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav],
                // Audio only: a stop keeps SIGTERM then SIGKILL (IX3-K2).
                { holdsVideoSession: false, signal },
              );
              if (!extracted.ok) return extracted;
              const engine = createWhisperEngine({
                binary: cli.value,
                model: model.value,
                onFallback: deps.onFallback,
              });
              const transcript = await engine.transcribe(wav, { language: 'auto', signal });
              if (!transcript.ok) return transcript;
              const segments: SpeechSegmentMs[] = transcript.value.segments.map((segment) => {
                const startMs = Math.round(RationalTime.toSeconds(segment.range.start) * 1000);
                const durationMs = Math.round(RationalTime.toSeconds(segment.range.duration) * 1000);
                return { startMs, endMs: startMs + durationMs, text: segment.text };
              });
              return ok(segments.length > 0 ? { language: transcript.value.language, segments } : null);
            } finally {
              await rm(dir, { recursive: true, force: true }).catch(() => undefined);
            }
          },
        }),
  };
}
