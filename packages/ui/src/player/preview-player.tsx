// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: preview-player · genre: atmospheric studio app (the viewer) · system: DESIGN.md v0.4
 * states: as PreviewFrame (empty · loading · ready · updating · error) · UX1: no src yet because the host is
 *   still getting one (pending: the loading bone, never an empty black frame) or couldn't (failure: its cause
 *   and Load again) · motion: the bone's fade only */

/**
 * The preview (P2-M7): React round `<hyperframes-player>` on the host contract
 * in packages/render/SPEC.md section 5. The composition plays from
 * app://preview in the player's sandboxed iframe, cross-origin to the app, so
 * play, pause and seek go over the player's postMessage bridge.
 *
 * An edit bumps the session's `rev`, which changes `src`. The new version loads
 * behind the frame on show, seeks to the same frame and replaces it once it has
 * painted, so the viewer never blanks while you edit.
 */
import { useLingui } from '@lingui/react/macro';
import type { FrameRate } from '@taalcut/core';
import {
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import {
  createPlayer,
  definePlayer,
  dropLayer,
  frameAt,
  framesIn,
  frameTime,
  useOutOfSight,
  type PlayerLayer,
} from './player-element';
import { PreviewFrame, type PreviewPhase } from './preview-frame';

/** What the host's transport drives. Frames are 0-based. */
export interface PreviewPlayerHandle {
  /** Shows frame `frame`, clamped to the film. Before the first load, the frame it opens on. */
  seekFrame(frame: number): void;
  play(): void;
  pause(): void;
  /** The frame on show: ⌊currentTime · fps⌋. */
  currentFrame(): number;
}

export interface PreviewReady {
  /** The build actually painted, for revision acknowledgement. Absent on stand-in viewers. */
  readonly src?: string;
  readonly durationFrames: number;
  /** The composition's own size in pixels. */
  readonly width: number;
  readonly height: number;
}

export interface PreviewPlayerProps {
  /** A preview session's `app://preview/<token>/index.html?rev=<n>`, or a finished render's `renders.mediaUrl`. Null: nothing to show yet. */
  src: string | null;
  /** `video/mp4` plays a finished render in the same element (SPEC section 5). */
  type?: 'video/mp4';
  /** The timeline's rate: frames cross the boundary, not seconds. */
  rate: FrameRate;
  /** The film's length, when the caller knows it (`openPreview` returns it); otherwise from the player. */
  durationFrames?: number;
  /** The composition's size: the frame keeps its shape while loading. Default 1080 × 1920 (9:16). */
  width?: number;
  height?: number;
  poster?: string;
  muted?: boolean;
  /** Names the viewer for screen readers. Default "Video preview". */
  label?: string;
  /** Drawn over the frame: the safe-zone layer, the host's transport. */
  overlay?: ReactNode;
  /** Under the empty frame: what will play here and the one action that fills it. */
  empty?: ReactNode;
  /** No `src` yet because the host is still getting one (a preview session opening): the frame's loading bone. */
  pending?: boolean;
  /** No `src` because the host couldn't get one: this sentence (the cause) and Load again, which calls onRetry. */
  failure?: string | null;
  /** The frame is on show: after the first load and after each edit's (the length may have changed). */
  onReady?: (ready: PreviewReady) => void;
  /** The frame on show changed while playing (about ten times a second). */
  onFrame?: (frame: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  /** The player's own message, for logs; the user sees a plain line and Load again. */
  onError?: (message: string) => void;
  /** Load again was pressed. The player reloads `src` itself; a host whose session expired opens a new one. */
  onRetry?: () => void;
  className?: string;
  ref?: Ref<PreviewPlayerHandle>;
}

type ReadyDetail = { duration?: number; compositionWidth?: number; compositionHeight?: number };
const detailOf = <T,>(event: Event): Partial<T> => ((event as CustomEvent<T>).detail ?? {}) as Partial<T>;

export function PreviewPlayer({
  src,
  type,
  rate,
  durationFrames,
  width = 1080,
  height = 1920,
  poster,
  muted = false,
  label,
  overlay,
  empty,
  pending = false,
  failure = null,
  onReady,
  onFrame,
  onPlayingChange,
  onError,
  onRetry,
  className,
  ref,
}: PreviewPlayerProps) {
  const { t } = useLingui();
  const name = label ?? t`Video preview`;
  const stageRef = useRef<HTMLDivElement>(null);
  // `front` is on show; `incoming` is loading behind it (or alone, under the skeleton).
  const front = useRef<PlayerLayer | null>(null);
  const incoming = useRef<PlayerLayer | null>(null);
  const filmFrames = useRef<number | null>(null);
  const pendingFrame = useRef<number | null>(null);
  const lastFrame = useRef(-1);
  const waiting: PreviewPhase = failure ? 'error' : pending ? 'loading' : 'empty';
  const [phase, setPhase] = useState<PreviewPhase>(src ? 'loading' : waiting);
  const [updating, setUpdating] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const idle = useOutOfSight(stageRef);

  const clamp = (frame: number) => {
    const total = durationFrames ?? filmFrames.current;
    const last = total ? total - 1 : Number.POSITIVE_INFINITY;
    return Math.min(Math.max(0, Math.round(frame)), last);
  };

  const options = useEffectEvent((url: string) => ({
    src: url,
    type,
    width,
    height,
    poster,
    muted,
    idle,
    title: name,
  }));

  const layerReady = useEffectEvent((layer: PlayerLayer, detail: Partial<ReadyDetail>) => {
    const seconds = detail.duration ?? 0;
    layer.film = {
      seconds,
      width: detail.compositionWidth ?? width,
      height: detail.compositionHeight ?? height,
    };
    filmFrames.current = framesIn(seconds, rate);
    // Back to the frame on show (an edit), or to the one asked for before anything loaded.
    const shown = front.current;
    const target = shown ? frameAt(shown.el.currentTime, rate) : pendingFrame.current;
    if (target !== null) layer.el.seek(frameTime(clamp(target), rate));
  });

  const layerPainted = useEffectEvent((layer: PlayerLayer) => {
    if (incoming.current !== layer) return;
    const old = front.current;
    const resume = old ? !old.el.paused : false;
    incoming.current = null;
    front.current = layer;
    layer.el.classList.remove('opacity-0');
    dropLayer(old);
    pendingFrame.current = null;
    lastFrame.current = -1;
    if (resume) layer.el.play();
    setUpdating(false);
    setPhase('ready');
    const film = layer.film ?? { seconds: 0, width, height };
    onReady?.({
      src: layer.el.getAttribute('src') ?? '',
      durationFrames: framesIn(film.seconds, rate),
      width: film.width,
      height: film.height,
    });
  });

  const layerTime = useEffectEvent((layer: PlayerLayer, seconds: number | undefined) => {
    if (front.current !== layer || seconds === undefined) return;
    const frame = frameAt(seconds, rate);
    if (frame === lastFrame.current) return;
    lastFrame.current = frame;
    onFrame?.(frame);
  });

  const layerPlaying = useEffectEvent((layer: PlayerLayer, playing: boolean) => {
    if (front.current === layer) onPlayingChange?.(playing);
  });

  const failed = useEffectEvent((message: string) => {
    dropLayer(incoming.current);
    incoming.current = null;
    setUpdating(false);
    setPhase('error');
    onError?.(message);
  });

  useEffect(() => {
    const stage = stageRef.current;
    if (!src || !stage) {
      dropLayer(front.current);
      front.current = null;
      setUpdating(false);
      return;
    }
    let live = true;
    let layer: PlayerLayer | null = null;
    if (front.current) setUpdating(true);
    else setPhase('loading');
    definePlayer().then(
      () => {
        if (!live) return;
        const current: PlayerLayer = { el: createPlayer(options(src)), off: new AbortController() };
        const { el, off } = current;
        const signal = off.signal;
        el.addEventListener('ready', (event) => layerReady(current, detailOf<ReadyDetail>(event)), {
          signal,
        });
        el.addEventListener('painted', () => layerPainted(current), { signal });
        el.addEventListener(
          'timeupdate',
          (event) => layerTime(current, detailOf<{ currentTime: number }>(event).currentTime),
          { signal },
        );
        el.addEventListener('play', () => layerPlaying(current, true), { signal });
        el.addEventListener('pause', () => layerPlaying(current, false), { signal });
        el.addEventListener('ended', () => layerPlaying(current, false), { signal });
        el.addEventListener('error', (event) => failed(detailOf<{ message: string }>(event).message ?? ''), {
          signal,
        });
        layer = current;
        dropLayer(incoming.current);
        incoming.current = current;
        // Behind whatever is on show: the stage's later children paint on top.
        stage.prepend(el);
      },
      (error: unknown) => {
        if (live) failed(error instanceof Error ? error.message : String(error));
      },
    );
    return () => {
      live = false;
      if (layer && layer !== front.current) {
        dropLayer(layer);
        if (incoming.current === layer) incoming.current = null;
      }
    };
  }, [src, type, attempt]);

  // Nothing to load: the frame says why (still coming, couldn't, or nothing yet).
  useEffect(() => {
    if (!src) setPhase(waiting);
  }, [src, waiting]);

  useEffect(() => {
    for (const layer of [front.current, incoming.current]) layer?.el.toggleAttribute('muted', muted);
  }, [muted]);

  useEffect(() => {
    for (const layer of [front.current, incoming.current]) layer?.el.toggleAttribute('low-power-idle', idle);
  }, [idle]);

  // Leaving the page: the players go with it (disconnecting pauses them and frees their documents).
  useEffect(
    () => () => {
      dropLayer(incoming.current);
      dropLayer(front.current);
    },
    [],
  );

  useImperativeHandle(
    ref,
    () => ({
      seekFrame(frame) {
        const target = clamp(frame);
        const shown = front.current;
        if (shown) shown.el.seek(frameTime(target, rate));
        else pendingFrame.current = target;
      },
      // Before the first paint the player holds a play() until it is ready.
      play: () => (front.current ?? incoming.current)?.el.play(),
      pause: () => (front.current ?? incoming.current)?.el.pause(),
      currentFrame() {
        const shown = front.current;
        return shown ? frameAt(shown.el.currentTime, rate) : (pendingFrame.current ?? 0);
      },
    }),
    // clamp reads refs and these two props.
    [rate, durationFrames],
  );

  const retry = () => {
    setAttempt((count) => count + 1);
    onRetry?.();
  };

  return (
    <PreviewFrame
      phase={phase}
      updating={updating}
      width={width}
      height={height}
      label={name}
      video={type !== undefined}
      stageRef={stageRef}
      overlay={overlay}
      empty={empty}
      {...(failure && !src ? { errorText: failure } : {})}
      onRetry={retry}
      className={className}
    />
  );
}
