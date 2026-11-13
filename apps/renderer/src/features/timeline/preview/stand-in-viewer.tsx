// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: stand-in viewer (the fake's preview) · genre: atmospheric studio app (the viewer)
 * system: DESIGN.md v0.3 ("Footage first": the frame on the viewer grey, the same in both themes, no text of ours)
 * states: empty (no clips: the grey alone) · loading (pictures arriving: the grey shows through) · ready · playing
 *   (a slow push-in per clip so stills read as video; reduced motion: none) · not interactive (the editor's
 *   transport drives it) · pre-emit critique: P4 H4 E5 S4 R5 V4 */

/**
 * The preview in a plain browser (the dev server, the end-to-end tests),
 * where there is no render process to compile a HyperFrames composition: the
 * timeline's clips painted frame by frame on a canvas from the fake's
 * pictures, with its text on top, at the timeline's rate on
 * requestAnimationFrame. It takes the transport the real player takes
 * (PreviewPlayerHandle) and reports the same callbacks, so the editor and the
 * timeline card can't tell them apart. Electron never uses it.
 */
import type { Clip, Timeline } from '@taalcut/core';
import type { PreviewPlayerHandle } from '@taalcut/ui';
import { useEffect, useEffectEvent, useImperativeHandle, useMemo, useRef } from 'react';
import { buildModel, clipAt, fpsOf, toFrames, type TimelineModel } from '../model';
import type { TimelineViewerProps } from './viewer-types';
import { usePlaybackActivity } from '../../sounds/sound-activity-context';

const WIDTH = 1080;
const HEIGHT = 1920;
/** How far a clip pushes in over its length: enough to read as moving footage, not a zoom effect. */
const PUSH = 0.06;

function cover(ctx: CanvasRenderingContext2D, image: HTMLImageElement, w: number, h: number, scale: number) {
  const ratio = Math.max(w / image.naturalWidth, h / image.naturalHeight) * scale;
  const dw = image.naturalWidth * ratio;
  const dh = image.naturalHeight * ratio;
  ctx.drawImage(image, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/** The app's face and its fallbacks (Onest, then a Noto family per script): the words are people's own, any script. */
let FACES: string | null = null;
function faces(): string {
  FACES ??= getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'sans-serif';
  return FACES;
}

function drawText(ctx: CanvasRenderingContext2D, model: TimelineModel, frame: number, w: number, h: number) {
  for (const text of model.texts) {
    if (frame < text.start || frame >= text.end) continue;
    const { box, appearance } = text.item;
    const size = Math.max(10, (appearance.size / 0.7) * h);
    const words =
      appearance.case === 'upper'
        ? text.item.text.toLocaleUpperCase()
        : appearance.case === 'lower'
          ? text.item.text.toLocaleLowerCase()
          : text.item.text;
    // A font for the canvas, not words for people.
    // eslint-disable-next-line lingui/no-unlocalized-strings
    ctx.font = `600 ${size}px ${faces()}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = appearance.align;
    const x =
      appearance.align === 'left'
        ? box.x * w
        : appearance.align === 'right'
          ? (box.x + box.width) * w
          : (box.x + box.width / 2) * w;
    const y = (box.y + box.height / 2) * h;
    // Footage, not interface: caption-style white on a dark edge, as the template's look asks.
    if (appearance.background === 'box') {
      const width = Math.min(box.width * w, ctx.measureText(words).width + size);
      const left =
        appearance.align === 'center' ? x - width / 2 : appearance.align === 'left' ? x : x - width;
      ctx.fillStyle = 'rgba(12,10,8,0.72)';
      ctx.fillRect(left, y - size * 0.75, width, size * 1.5);
    } else {
      ctx.lineWidth = size * 0.14;
      ctx.strokeStyle = 'rgba(12,10,8,0.6)';
      ctx.strokeText(words, x, y, box.width * w);
    }
    ctx.fillStyle = 'rgb(250,247,242)';
    ctx.fillText(words, x, y, box.width * w);
  }
}

function drawGraphics(
  ctx: CanvasRenderingContext2D,
  timeline: Timeline,
  model: TimelineModel,
  frame: number,
  w: number,
  h: number,
  reduced: boolean,
) {
  for (const track of timeline.tracks) {
    if (track.kind !== 'text' || !track.enabled) continue;
    for (const item of track.items) {
      if (item.type !== 'graphic') continue;
      const start = toFrames(item.start, model.rate);
      const end = start + toFrames(item.duration, model.rate);
      if (frame < start || frame >= end) continue;
      const paramWords = item.composition
        ? Object.values(item.composition.params)
            .filter(
              (val): val is string =>
                typeof val === 'string' &&
                val.trim().length > 0 &&
                !val.startsWith('#') &&
                val !== 'left' &&
                val !== 'right',
            )
            .join(' · ')
        : '';
      const designName =
        timeline.graphicCompositions?.find((comp) => comp.id === item.composition?.id)?.name ?? '';
      const label = paramWords || designName;
      if (!label) continue;

      const ramp = 10;
      const t = reduced ? 1 : Math.min(1, (frame - start + 1) / ramp, (end - frame) / ramp);
      const ease = 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
      const size = Math.max(14, Math.round(h * 0.026));
      const padX = size * 0.85;
      const padY = size * 0.55;
      // eslint-disable-next-line lingui/no-unlocalized-strings
      ctx.font = `600 ${size}px ${faces()}`;
      const textWidth = Math.min(w * 0.82, ctx.measureText(label).width);
      const boxW = textWidth + padX * 2;
      const boxH = size + padY * 2;
      const baseY =
        item.placement === 'top' ? h * 0.14 : item.placement === 'middle' ? h * 0.5 : h * 0.78;
      const slideY = (1 - ease) * h * 0.025;
      const x = (w - boxW) / 2;
      const y = baseY - boxH / 2 + slideY;

      ctx.save();
      ctx.globalAlpha = ease;
      ctx.fillStyle = 'rgba(18,16,14,0.84)';
      ctx.strokeStyle = 'rgba(228,87,46,0.85)';
      ctx.lineWidth = Math.max(1.5, size * 0.08);
      ctx.beginPath();
      ctx.roundRect(x, y, boxW, boxH, boxH / 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = 'rgb(250,247,242)';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(label, w / 2, y + boxH / 2, textWidth);
      ctx.restore();
    }
  }
}

export function StandInViewer({
  timeline,
  frameUrl,
  label,
  overlay,
  onReady,
  onFrame,
  onPlayingChange,
  className,
  ref,
}: TimelineViewerProps) {
  const setSoundPlayback = usePlaybackActivity();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const model = useMemo(() => buildModel(timeline), [timeline]);
  const images = useRef(new Map<string, HTMLImageElement>());
  const state = useRef({ frame: 0, playing: false, base: { frame: 0, at: 0 }, raf: 0, drawn: -1 });
  const reduced = useRef(false);
  const fps = fpsOf(model.rate);
  const total = Math.max(1, model.total);

  const imageFor = (clip: Clip): HTMLImageElement | null => {
    const url = frameUrl(clip);
    if (!url) return null;
    let image = images.current.get(url);
    if (!image) {
      image = new Image();
      image.decoding = 'async';
      image.onload = () => paint(true);
      image.src = url;
      images.current.set(url, image);
    }
    return image.complete && image.naturalWidth > 0 ? image : null;
  };

  const paint = useEffectEvent((force = false) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const frame = state.current.frame;
    if (!force && frame === state.current.drawn) return;
    state.current.drawn = frame;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const clip = clipAt(model, frame);
    if (!clip) return;
    const image = imageFor(clip.item);
    if (image) {
      const progress = (frame - clip.start) / Math.max(1, clip.end - clip.start);
      const scale = reduced.current ? 1 : 1 + PUSH * progress;
      cover(ctx, image, w, h, scale);
    }
    drawText(ctx, model, frame, w, h);
    drawGraphics(ctx, timeline, model, frame, w, h, reduced.current);
  });

  const report = useEffectEvent((frame: number) => onFrame?.(frame));
  const playingChanged = useEffectEvent((playing: boolean) => {
    setSoundPlayback(playing);
    onPlayingChange?.(playing);
  });

  const tick = useEffectEvent((now: number) => {
    const s = state.current;
    s.raf = 0;
    if (!s.playing) return;
    const frame = Math.min(total - 1, s.base.frame + Math.floor(((now - s.base.at) * fps) / 1000));
    if (frame !== s.frame) {
      s.frame = frame;
      paint();
      report(frame);
    }
    if (frame >= total - 1) {
      s.playing = false;
      playingChanged(false);
      return;
    }
    s.raf = requestAnimationFrame(tick);
  });

  useImperativeHandle(
    ref,
    (): PreviewPlayerHandle => ({
      seekFrame(frame) {
        const s = state.current;
        s.frame = Math.min(Math.max(0, Math.round(frame)), total - 1);
        s.base = { frame: s.frame, at: performance.now() };
        paint();
      },
      play() {
        const s = state.current;
        if (s.playing) return;
        if (s.frame >= total - 1) s.frame = 0;
        s.playing = true;
        s.base = { frame: s.frame, at: performance.now() };
        playingChanged(true);
        s.raf = requestAnimationFrame(tick);
      },
      pause() {
        const s = state.current;
        if (!s.playing) return;
        s.playing = false;
        if (s.raf) cancelAnimationFrame(s.raf);
        s.raf = 0;
        playingChanged(false);
      },
      currentFrame: () => state.current.frame,
    }),
    [total],
  );

  // The canvas at the frame's size in device pixels, redrawn when it changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduced.current = query.matches;
    const resize = () => {
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * scale));
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * scale));
      paint(true);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    return () => observer.disconnect();
  }, []);

  // A new revision (an edit): the same frame, drawn again; the length may have changed.
  useEffect(() => {
    const s = state.current;
    if (s.frame > total - 1) s.frame = total - 1;
    paint(true);
    onReady?.({ durationFrames: total, width: WIDTH, height: HEIGHT });
    // onReady is the host's; a new timeline or length is what matters.
  }, [model, total]);

  // Pictures the host has found since (a clip's file loaded): draw the frame with them.
  useEffect(() => paint(true), [frameUrl]);

  useEffect(
    () => () => {
      const s = state.current;
      s.playing = false;
      if (s.raf) cancelAnimationFrame(s.raf);
    },
    [],
  );

  return (
    <div
      data-slot="preview-player"
      data-state="ready"
      data-stand-in=""
      className={className ?? 'flex min-w-0 flex-col'}
    >
      <div
        role="group"
        aria-label={label}
        className="tc-viewer relative w-full overflow-hidden rounded-xl"
        style={{ aspectRatio: `${WIDTH} / ${HEIGHT}` }}
      >
        <canvas ref={canvasRef} aria-hidden className="absolute inset-0 size-full" />
        {overlay ? <div className="absolute inset-0">{overlay}</div> : null}
      </div>
    </div>
  );
}
